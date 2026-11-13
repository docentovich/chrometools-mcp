/**
 * browser/page-manager.js
 *
 * Page lifecycle and monitoring management
 */

import { getBrowser } from './browser-manager.js';
// Note: injectRecorder removed - now using Chrome Extension for recording

/**
 * Click listener tracking script - injected via evaluateOnNewDocument
 * Monkey-patches addEventListener to track which elements have click listeners
 * This enables detection of click handlers added by frameworks like Angular
 */
const CLICK_LISTENER_TRACKER_SCRIPT = `
(function() {
  // Only inject once
  if (window.__clickListenerTracker) return;
  window.__clickListenerTracker = true;

  // WeakMap to track elements with click listeners (prevents memory leaks)
  const clickListeners = new WeakMap();

  // Store original methods
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener;

  // Patch addEventListener
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'click' && this instanceof Element) {
      // Track this element has click listener
      const count = clickListeners.get(this) || 0;
      clickListeners.set(this, count + 1);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // Patch removeEventListener for accuracy
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (type === 'click' && this instanceof Element) {
      const count = clickListeners.get(this) || 0;
      if (count > 0) {
        clickListeners.set(this, count - 1);
      }
    }
    return originalRemoveEventListener.call(this, type, listener, options);
  };

  // Global function to check if element has click listener
  window.__hasClickListener = function(element) {
    if (!element) return false;
    const count = clickListeners.get(element);
    return count && count > 0;
  };

  // Also expose for debugging
  window.__getClickListenerCount = function(element) {
    return clickListeners.get(element) || 0;
  };
})();
`;

/**
 * Debug log helper (only logs to stderr when DEBUG=1)
 * @param {...any} args - Arguments to log
 */
function debugLog(...args) {
  if (process.env.DEBUG === '1') {
    console.error('[page-manager]', ...args);
  }
}

// Global state for pages and monitoring
export const openPages = new Map();
export let lastPage = null;

// New tab events queue - for notifying AI about new tabs
export const newTabEvents = [];

// Console logs storage
export const consoleLogs = [];

// Network requests storage
export const networkRequests = [];

// Maximum number of network requests to keep in memory (prevent unbounded growth)
const MAX_NETWORK_REQUESTS = 500;

/**
 * Clean old network requests to prevent memory leak
 * Keeps only the most recent MAX_NETWORK_REQUESTS requests
 */
function cleanOldNetworkRequests() {
  if (networkRequests.length > MAX_NETWORK_REQUESTS) {
    // Remove oldest requests (keep most recent)
    const removeCount = networkRequests.length - MAX_NETWORK_REQUESTS;
    networkRequests.splice(0, removeCount);
  }
}

// Page analysis cache
export const pageAnalysisCache = new Map();

/** Get the CDP client used for network monitoring on a page (for Network.getResponseBody) */
export function getNetworkCDPClient(page) {
  return networkCDPClients.get(page) || null;
}

// Track pages with network monitoring to prevent duplicate setup
const pagesWithNetworkMonitoring = new WeakSet();
const networkCDPClients = new WeakMap();

/**
 * Setup network monitoring with auto-reinitialization on navigation
 * @param {Page} page - Puppeteer page instance
 */
export async function setupNetworkMonitoring(page) {
  // Prevent duplicate setup on the same page
  if (pagesWithNetworkMonitoring.has(page)) {
    return;
  }
  pagesWithNetworkMonitoring.add(page);

  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  networkCDPClients.set(page, client);

  client.on('Network.requestWillBeSent', (event) => {
    const timestamp = new Date().toISOString();

    // Check if request already exists (prevent duplicates from redirects/retries)
    const existingReq = networkRequests.find(r => r.requestId === event.requestId);
    if (existingReq) {
      // Update existing request instead of creating duplicate
      existingReq.url = event.request.url;
      existingReq.method = event.request.method;
      existingReq.headers = event.request.headers;
      existingReq.postData = event.request.postData;
      existingReq.timestamp = timestamp;
      return;
    }

    networkRequests.push({
      requestId: event.requestId,
      url: event.request.url,
      method: event.request.method,
      headers: event.request.headers,
      postData: event.request.postData,
      timestamp,
      type: event.type, // Document, Stylesheet, Image, Media, Font, Script, XHR, Fetch, etc.
      initiator: event.initiator.type, // parser, script, other
      status: 'pending',
      documentURL: event.documentURL
    });

    // Clean old requests to prevent unbounded memory growth
    cleanOldNetworkRequests();
  });

  client.on('Network.responseReceived', (event) => {
    const req = networkRequests.find(r => r.requestId === event.requestId);
    if (req) {
      req.status = event.response.status;
      req.statusText = event.response.statusText;
      req.responseHeaders = event.response.headers;
      req.mimeType = event.response.mimeType;
      req.fromCache = event.response.fromDiskCache || event.response.fromServiceWorker;
      req.timing = event.response.timing;
    }
  });

  client.on('Network.loadingFinished', (event) => {
    const req = networkRequests.find(r => r.requestId === event.requestId);
    if (req && req.status === 'pending') {
      req.status = 'completed';
    }
    if (req) {
      req.encodedDataLength = event.encodedDataLength;
      req.finishedTimestamp = new Date().toISOString();
    }
  });

  client.on('Network.loadingFailed', (event) => {
    const req = networkRequests.find(r => r.requestId === event.requestId);
    if (req) {
      req.status = 'failed';
      req.errorText = event.errorText;
      req.canceled = event.canceled;
      req.finishedTimestamp = new Date().toISOString();
    }
  });

  // Auto-reinitialize on navigation (CDP session is reset on navigation)
  let lastUrl = page.url();

  page.on('framenavigated', async (frame) => {
    // Only handle main frame navigation
    if (frame !== page.mainFrame()) return;

    const currentUrl = frame.url();

    // Skip if URL hasn't changed
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;

    // Remove from tracking set to allow re-setup
    pagesWithNetworkMonitoring.delete(page);

    // Small delay to let navigation settle
    setTimeout(async () => {
      try {
        await setupNetworkMonitoring(page);
      } catch (error) {
        debugLog('Failed to reinitialize network monitoring:', error.message);
      }
    }, 100);
  });
}

// Note: setupRecorderAutoReinjection removed - Chrome Extension handles recording now

/**
 * Format CDP stack trace frames as "fn (url:line:col)" lines.
 * @param {object} stackTrace - CDP Runtime.StackTrace
 * @param {number} max - max frames
 * @returns {string[]}
 */
export function formatStackTrace(stackTrace, max = 5) {
  const frames = stackTrace?.callFrames || [];
  return frames.slice(0, max).map(f =>
    `${f.functionName || '<anonymous>'} (${f.url || '?'}:${(f.lineNumber ?? 0) + 1}:${(f.columnNumber ?? 0) + 1})`
  );
}

/**
 * Capture console API calls, browser log entries and uncaught exceptions
 * of a page into consoleLogs. Best effort: never throws.
 * @param {Page} page
 */
const pagesWithConsoleCapture = new WeakSet();

export async function attachConsoleCapture(page) {
  // getOrCreatePage and the targetcreated handler both reach here for one tab
  if (pagesWithConsoleCapture.has(page)) return;
  pagesWithConsoleCapture.add(page);
  try {
    const client = await page.target().createCDPSession();
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    client.on('Runtime.consoleAPICalled', (event) => {
      const args = event.args.map(arg => {
        if (arg.value !== undefined) return typeof arg.value === 'object' ? JSON.stringify(arg.value) : arg.value;
        if (arg.description) return arg.description;
        if (arg.unserializableValue) return arg.unserializableValue;
        return arg.type;
      });
      consoleLogs.push({
        type: event.type, // log, warn, error, info, debug
        timestamp: new Date().toISOString(),
        message: args.join(' '),
        stackTrace: event.stackTrace
      });
    });

    client.on('Log.entryAdded', (event) => {
      const entry = event.entry;
      consoleLogs.push({
        type: entry.level, // verbose, info, warning, error
        timestamp: new Date(entry.timestamp).toISOString(),
        message: entry.text,
        source: entry.source,
        url: entry.url,
        lineNumber: entry.lineNumber,
        stackTrace: entry.stackTrace
      });
    });

    // Uncaught errors and unhandled rejections are not console calls
    client.on('Runtime.exceptionThrown', (event) => {
      const d = event.exceptionDetails || {};
      const description = d.exception?.description || d.exception?.value;
      consoleLogs.push({
        type: 'error',
        timestamp: new Date().toISOString(),
        message: description ? String(description) : (d.text || 'Uncaught exception'),
        uncaught: true,
        url: d.url,
        lineNumber: d.lineNumber,
        stackTrace: d.stackTrace
      });
    });
  } catch (error) {
    debugLog('Failed to setup console capture:', error.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Requested viewport. setViewport lives in the CDP session of one Page object;
// a different tab, a reconnect or a tab-sync switch loses it. We keep the last
// requested value and re-apply it where needed.
// ─────────────────────────────────────────────────────────────────────────────
let requestedViewport = null; // { width, height, deviceScaleFactor }

export function setRequestedViewport(vp) {
  requestedViewport = vp ? { ...vp } : null;
}

export function getRequestedViewport() {
  return requestedViewport ? { ...requestedViewport } : null;
}

async function measureViewport(page) {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio
  }));
}

// 1 px tolerance: with OS display scaling (e.g. 110%) Chrome rounds the emulated
// size through device pixels, 904 can come back as 905. Re-applying does not help.
function viewportMatches(actual, vp) {
  return Math.abs(actual.width - vp.width) <= 1 && Math.abs(actual.height - vp.height) <= 1 &&
    Math.abs(actual.devicePixelRatio - vp.deviceScaleFactor) < 0.01;
}

async function applyRequestedViewport(page) {
  if (!requestedViewport) return;
  try {
    await page.setViewport(requestedViewport);
  } catch (error) {
    debugLog('Failed to apply requested viewport:', error.message);
  }
}

/**
 * Re-apply the requested viewport when the page does not match it.
 * @param {Page} page
 * @returns {Promise<null|{reapplied: boolean, before: object, after: object, requested: object, mismatch: boolean}>}
 *   null when no viewport was requested or the page could not be measured
 */
export async function ensureViewport(page) {
  if (!requestedViewport) return null;
  try {
    const before = await measureViewport(page);
    if (viewportMatches(before, requestedViewport)) {
      return { reapplied: false, before, after: before, requested: getRequestedViewport(), mismatch: false };
    }
    await page.setViewport(requestedViewport);
    const after = await measureViewport(page);
    return {
      reapplied: true, before, after, requested: getRequestedViewport(),
      mismatch: !viewportMatches(after, requestedViewport)
    };
  } catch (error) {
    debugLog('ensureViewport failed:', error.message);
    return null;
  }
}

/**
 * One-line description of an ensureViewport() result for tool output ('' when nothing to say).
 */
export function formatViewportNote(info) {
  if (!info || (!info.reapplied && !info.mismatch)) return '';
  const fmt = v => `${v.width}x${v.height} DPR ${Math.round(v.devicePixelRatio * 100) / 100}`;
  const req = info.requested;
  let note = `\nViewport: ${req.width}x${req.height} DPR ${req.deviceScaleFactor}`;
  if (info.reapplied) note += ` (re-applied, was ${fmt(info.before)})`;
  if (info.mismatch) note += `\n⚠️ Viewport still ${fmt(info.after)} after re-apply. Check browser zoom (must be 100%).`;
  return note;
}

/**
 * Inject click listener tracker into page
 * Must be called BEFORE page.goto() to catch all listeners
 * @param {Page} page - Puppeteer page instance
 */
async function injectClickListenerTracker(page) {
  try {
    await page.evaluateOnNewDocument(CLICK_LISTENER_TRACKER_SCRIPT);
    debugLog('Click listener tracker injected');
  } catch (error) {
    debugLog('Failed to inject click listener tracker:', error.message);
  }
}

/**
 * Get or create page for URL
 * @param {string} url - URL to navigate to
 * @returns {Promise<Page>} - Puppeteer page instance
 */
export async function getOrCreatePage(url) {
  const browser = await getBrowser();

  // Check if page for this URL already exists
  if (openPages.has(url)) {
    const existingPage = openPages.get(url);
    // A detached page is not "closed" but unusable: drop it and open a new one
    if (await isPageUsable(existingPage)) {
      lastPage = existingPage;
      return existingPage;
    }
    openPages.delete(url);
  }

  // Create new page
  const page = await browser.newPage();

  // Inject click listener tracker BEFORE navigation
  await injectClickListenerTracker(page);

  // Set up console log capture
  await attachConsoleCapture(page);

  // Keep the viewport the user asked for (setViewport) on new tabs too
  await applyRequestedViewport(page);

  // Setup network monitoring with auto-reinitialization on navigation
  await setupNetworkMonitoring(page);

  // Use longer timeout (60s) and less strict wait condition for slow sites like Yahoo
  await page.goto(url, {
    waitUntil: 'domcontentloaded', // Less strict than networkidle2, works for sites with continuous loading
    timeout: 60000 // Increased from default 30s to 60s
  });
  openPages.set(url, page);
  lastPage = page;

  return page;
}

/**
 * Get last opened page (for tools that don't need URL)
 * @returns {Promise<Page>} - Puppeteer page instance
 */
// ─────────────────────────────────────────────────────────────────────────────
// Dead page detection. A tab can be closed, discarded by Chrome, swapped to a new
// target, or the CDP connection can drop: the Page object then is not "closed"
// but every call fails with "Attempted to use detached Frame". We detect that and
// re-attach to the same tab (same URL) or let the caller open a new one.
// ─────────────────────────────────────────────────────────────────────────────
const DEAD_PAGE_RE = /detached Frame|Target closed|Session closed|Connection closed|No target with given id|Protocol error.*(closed|not found)|frame was detached/i;

export function isDeadPageError(error) {
  return DEAD_PAGE_RE.test(String(error?.message || error));
}

/**
 * true when tools can work with the page. A slow page (busy, navigating) counts
 * as usable; only clear "dead" signals return false.
 */
export async function isPageUsable(page) {
  if (!page) return false;
  try {
    if (page.isClosed()) return false;
    if (page.mainFrame().detached) return false;
  } catch {
    return false;
  }
  try {
    await Promise.race([
      page.mainFrame().evaluate(() => 1),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
    return true;
  } catch (error) {
    return !isDeadPageError(error);
  }
}

let recoveryNote = null;

/** One-time note about an automatic tab recovery (for tool output). */
export function takeRecoveryNote() {
  const n = recoveryNote;
  recoveryNote = null;
  return n;
}

async function recoverPage(deadPage) {
  let url = '';
  try { url = deadPage.url(); } catch { /* ignore */ }
  for (const [key, pg] of [...openPages.entries()]) {
    if (pg === deadPage) openPages.delete(key);
  }
  if (!url || url === 'about:blank') return null;
  let browser;
  try {
    browser = await getBrowser();
  } catch {
    return null;
  }
  const noHash = u => u.split('#')[0];
  const pages = await browser.pages().catch(() => []);
  const candidates = pages.filter(pg => pg !== deadPage && (pg.url() === url || noHash(pg.url()) === noHash(url)));
  candidates.sort((a, b) => (b.url() === url) - (a.url() === url));
  for (const pg of candidates) {
    if (!(await isPageUsable(pg))) continue;
    if (![...openPages.values()].includes(pg)) {
      await setupNewPage(pg, 'recovered');
      openPages.set(pg.url(), pg);
    }
    lastPage = pg;
    recoveryNote = `Previous tab connection was lost (detached); re-attached to the open tab ${pg.url()}`;
    return pg;
  }
  return null;
}

/** Forget all tracked pages (resetBrowser). */
export function resetPageState() {
  lastPage = null;
  openPages.clear();
  recoveryNote = null;
}

export async function getLastOpenPage() {
  // Check if we have lastPage reference
  if (!lastPage) {
    throw new Error('No page is currently open. Use openBrowser first to open a page.');
  }

  // Check if page is closed with timeout to prevent hanging
  let isClosed = false;
  try {
    // Race between isClosed check and timeout
    isClosed = await Promise.race([
      lastPage.isClosed(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Page check timeout')), 1000)
      )
    ]);
  } catch (error) {
    // If timeout or error, assume page is not available
    lastPage = null;
    throw new Error('No page is currently open. Use openBrowser first to open a page.');
  }

  if (isClosed || !(await isPageUsable(lastPage))) {
    const dead = lastPage;
    lastPage = null;
    const recovered = await recoverPage(dead);
    if (recovered) return recovered;
    throw new Error('No page is currently open: the previous tab was detached (closed, discarded or reconnected). ' +
      'Use openBrowser / navigateTo to open a page, or resetBrowser.');
  }

  return lastPage;
}

/**
 * Update lastPage reference (for external updates)
 * @param {Page} page - New last page
 */
export function setLastPage(page) {
  lastPage = page;
}

// ─────────────────────────────────────────────────────────────────────────────
// Active frame state (P0-1: cross-origin iframe support)
//
// Tools default to the main frame. switchFrame() stores a *matcher* (not a Frame
// object — Frames get invalidated when the iframe re-navigates) keyed by Page.
// getTargetFrame() re-resolves the matcher against page.frames() on every call,
// so it survives iframe reloads. Cleared on top-level navigation.
// ─────────────────────────────────────────────────────────────────────────────
const activeFrames = new WeakMap(); // Page -> { frameUrl?, frameSelector? }

/**
 * Set (or clear) the active frame matcher for a page.
 * @param {Page} page
 * @param {{frameUrl?: string, frameSelector?: string}|null} matcher - null resets to main frame
 */
export function setActiveFrame(page, matcher) {
  if (!matcher || (!matcher.frameUrl && !matcher.frameSelector)) {
    activeFrames.delete(page);
  } else {
    activeFrames.set(page, matcher);
  }
}

/**
 * Clear the active frame for a page (back to main frame).
 * @param {Page} page
 */
export function clearActiveFrame(page) {
  activeFrames.delete(page);
}

/**
 * Get the matcher currently stored for a page (or null).
 * @param {Page} page
 * @returns {{frameUrl?: string, frameSelector?: string}|null}
 */
export function getActiveFrameMatcher(page) {
  return activeFrames.get(page) || null;
}

/**
 * Resolve the execution context (Frame) for a page based on its active matcher.
 * Returns the main frame when no active frame is set. A Frame exposes the same
 * surface tools rely on (.evaluate, .$, .$$, .click, .type, .waitForSelector),
 * so handlers can use the returned context in place of `page` for DOM work.
 * @param {Page} page
 * @returns {Promise<Frame>} - Target Puppeteer Frame
 */
export async function getTargetFrame(page) {
  const matcher = activeFrames.get(page);
  if (!matcher) {
    return page.mainFrame();
  }

  if (matcher.frameSelector) {
    const handle = await page.$(matcher.frameSelector);
    const frame = handle ? await handle.contentFrame() : null;
    if (!frame) {
      throw new Error(
        `Active frame (selector "${matcher.frameSelector}") not found. Call listFrames() and switchFrame() again, or switchFrame() with no args to reset.`
      );
    }
    return frame;
  }

  // frameUrl: substring match against all frames
  const frame = page.frames().find(f => f.url().includes(matcher.frameUrl));
  if (!frame) {
    throw new Error(
      `Active frame (url contains "${matcher.frameUrl}") not found. Call listFrames() and switchFrame() again, or switchFrame() with no args to reset.`
    );
  }
  return frame;
}

/**
 * List all frames on a page with metadata (for listFrames tool / analyzePage output).
 * @param {Page} page
 * @returns {Array<{url: string, name: string, isMain: boolean}>}
 */
export function listFramesForPage(page) {
  const main = page.mainFrame();
  return page.frames().map(f => ({
    url: f.url(),
    name: f.name() || '',
    isMain: f === main,
  }));
}

/**
 * Setup a new page with all monitoring (console, network, recorder)
 * Used for both explicitly created pages and auto-detected new tabs
 * @param {Page} page - Puppeteer page instance
 * @param {string} [source='manual'] - How the page was created ('manual', 'popup', 'newTab')
 * @returns {Promise<void>}
 */
export async function setupNewPage(page, source = 'manual') {
  // Inject click listener tracker
  // For new tabs, we need both:
  // 1. evaluateOnNewDocument for future navigations
  // 2. evaluate for already-loaded content (won't catch existing listeners, but will catch new ones)
  try {
    await page.evaluateOnNewDocument(CLICK_LISTENER_TRACKER_SCRIPT);
    // Also inject immediately for current page (in case content already loaded)
    await page.evaluate(CLICK_LISTENER_TRACKER_SCRIPT);
    debugLog(`Click listener tracker injected for ${source} page`);
  } catch (error) {
    debugLog('Failed to inject click listener tracker:', error.message);
  }

  // Set up console log capture
  await attachConsoleCapture(page);
  await applyRequestedViewport(page);

  // Setup network monitoring
  await setupNetworkMonitoring(page);

  debugLog(`New page setup complete (source: ${source})`);
}

/**
 * Handle a newly detected tab (from targetcreated event)
 * @param {Page} page - New Puppeteer page
 * @param {string} openerUrl - URL of the page that opened this tab
 */
export async function handleNewTab(page, openerUrl, openerPage = null) {
  const timestamp = new Date().toISOString();

  // Only tabs opened from a page chrometools works with (popup, target=_blank) become
  // active. A tab the user opened in the same Chrome is left alone: switching to it
  // made later tools act in the user's own tab (e.g. a form with unsaved input).
  const fromOurPage = !!openerPage && (openerPage === lastPage || [...openPages.values()].includes(openerPage));
  if (!fromOurPage) {
    debugLog(`New tab not opened by a chrometools page, not switching: ${page.url()}`);
    return;
  }

  // Wait for the page to have a URL (initial about:blank -> actual URL)
  let url = page.url();
  let attempts = 0;
  while ((url === 'about:blank' || url === '') && attempts < 20) {
    await new Promise(resolve => setTimeout(resolve, 100));
    url = page.url();
    attempts++;
  }

  debugLog(`New tab detected: ${url} (opened from: ${openerUrl})`);

  // Setup monitoring on the new page
  await setupNewPage(page, 'newTab');

  // Register the page
  if (url && url !== 'about:blank') {
    openPages.set(url, page);
  }

  // Make it the active page
  lastPage = page;

  // Add event to queue for AI notification
  newTabEvents.push({
    timestamp,
    url,
    openerUrl,
    title: await page.title().catch(() => ''),
  });

  // Bring the new tab to front
  try {
    await page.bringToFront();
  } catch (error) {
    debugLog('Failed to bring new tab to front:', error.message);
  }
}

/**
 * Get and clear new tab events (for AI notification)
 * @returns {Array} - Array of new tab events
 */
export function getAndClearNewTabEvents() {
  const events = [...newTabEvents];
  newTabEvents.length = 0;
  return events;
}

/**
 * Get all open pages as array with metadata
 * @returns {Promise<Array>} - Array of page info objects
 */
export async function getAllPages() {
  const pages = [];

  for (const [url, page] of openPages.entries()) {
    if (!page.isClosed()) {
      try {
        const title = await page.title().catch(() => '');
        const currentUrl = page.url();
        pages.push({
          url: currentUrl,
          originalUrl: url,
          title,
          isActive: page === lastPage,
        });
      } catch (error) {
        // Page might be in invalid state, skip it
        debugLog('Error getting page info:', error.message);
      }
    } else {
      // Clean up closed pages
      openPages.delete(url);
    }
  }

  return pages;
}

/**
 * Switch to a page by URL or index
 * @param {string|number} identifier - URL (partial match) or index
 * @returns {Promise<Page>} - The switched-to page
 */
export async function switchToPage(identifier) {
  const pages = await getAllPages();

  if (pages.length === 0) {
    throw new Error('No pages are currently open.');
  }

  let targetPage = null;

  if (typeof identifier === 'number') {
    // Switch by index
    if (identifier < 0 || identifier >= pages.length) {
      throw new Error(`Invalid tab index: ${identifier}. Valid range: 0-${pages.length - 1}`);
    }
    const targetUrl = pages[identifier].originalUrl;
    targetPage = openPages.get(targetUrl);
  } else {
    // Switch by URL (partial match)
    const matchingPage = pages.find(p =>
      p.url.includes(identifier) || p.originalUrl.includes(identifier)
    );
    if (!matchingPage) {
      throw new Error(`No page found matching: ${identifier}`);
    }
    targetPage = openPages.get(matchingPage.originalUrl);
  }

  if (!targetPage || targetPage.isClosed()) {
    throw new Error('Target page is not available.');
  }

  // Make it the active page
  lastPage = targetPage;

  // Bring to front
  await targetPage.bringToFront();

  return targetPage;
}

/**
 * Connect Puppeteer to a tab by URL (finds existing browser page)
 * Used when switching tabs via extension - need to sync Puppeteer
 * @param {string} url - URL of the tab to connect to
 * @returns {Promise<Page|null>} - The page or null if not found
 */
export async function connectToTabByUrl(url, { loose = false, trackedOnly = false } = {}) {
  if (!url || url === 'about:blank') return null;
  const browser = await getBrowser();
  const allPages = await browser.pages();

  // Match score: 3 exact, 2 same URL without hash, 1 substring (only with loose,
  // used by explicit switchTab). Loose matching on automatic tab sync used to
  // move lastPage to another tab of the same app (http://x/ is a substring of
  // http://x/#/route), so later tools worked on a tab without our viewport.
  const noHash = u => u.split('#')[0];
  const score = (pageUrl) => {
    if (!pageUrl || pageUrl === 'about:blank') return 0;
    if (pageUrl === url) return 3;
    if (noHash(pageUrl) === noHash(url)) return 2;
    if (loose && (pageUrl.includes(url) || url.includes(pageUrl))) return 1;
    return 0;
  };

  let best = null;
  let bestScore = 0;
  for (const page of allPages) {
    try {
      const s = score(page.url());
      // Prefer the current page on equal score: no switch when it already matches
      if (s > bestScore || (s === bestScore && s > 0 && page === lastPage)) {
        best = page;
        bestScore = s;
      }
    } catch (error) {
      debugLog('Error checking page URL:', error.message);
    }
  }

  if (!best) {
    debugLog(`No browser page found for URL: ${url}`);
    return null;
  }

  // Automatic sync (user clicked a tab): follow only tabs chrometools already works with
  const tracked = [...openPages.values()].includes(best);
  if (trackedOnly && !tracked) {
    debugLog(`Tab sync: ${url} is not a chrometools tab, keeping the current page`);
    return null;
  }

  // Setup monitoring if this Page object is not tracked yet
  if (!tracked) {
    await setupNewPage(best, 'extension-switch');
    openPages.set(url, best);
  }
  if (best !== lastPage) {
    debugLog(`Active page switched to tab: ${url}`);
  }
  lastPage = best;
  return best;
}

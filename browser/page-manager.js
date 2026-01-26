/**
 * browser/page-manager.js
 *
 * Page lifecycle and monitoring management
 */

import { getBrowser } from './browser-manager.js';
// Note: injectRecorder removed - now using Chrome Extension for recording

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

// Page analysis cache
export const pageAnalysisCache = new Map();

// Track pages with network monitoring to prevent duplicate setup
const pagesWithNetworkMonitoring = new WeakSet();

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

  client.on('Network.requestWillBeSent', (event) => {
    const timestamp = new Date().toISOString();
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
 * Get or create page for URL
 * @param {string} url - URL to navigate to
 * @returns {Promise<Page>} - Puppeteer page instance
 */
export async function getOrCreatePage(url) {
  const browser = await getBrowser();

  // Check if page for this URL already exists
  if (openPages.has(url)) {
    const existingPage = openPages.get(url);
    if (!existingPage.isClosed()) {
      lastPage = existingPage;
      return existingPage;
    }
    openPages.delete(url);
  }

  // Create new page
  const page = await browser.newPage();

  // Set up console log capture
  const client = await page.target().createCDPSession();
  await client.send('Runtime.enable');
  await client.send('Log.enable');

  client.on('Runtime.consoleAPICalled', (event) => {
    const timestamp = new Date().toISOString();
    const args = event.args.map(arg => {
      if (arg.value !== undefined) return arg.value;
      if (arg.description) return arg.description;
      return String(arg);
    });

    consoleLogs.push({
      type: event.type, // log, warn, error, info, debug
      timestamp,
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
      lineNumber: entry.lineNumber
    });
  });

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

  if (isClosed) {
    lastPage = null;
    throw new Error('No page is currently open. Use openBrowser first to open a page.');
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

/**
 * Setup a new page with all monitoring (console, network, recorder)
 * Used for both explicitly created pages and auto-detected new tabs
 * @param {Page} page - Puppeteer page instance
 * @param {string} [source='manual'] - How the page was created ('manual', 'popup', 'newTab')
 * @returns {Promise<void>}
 */
export async function setupNewPage(page, source = 'manual') {
  // Set up console log capture
  try {
    const client = await page.target().createCDPSession();
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    client.on('Runtime.consoleAPICalled', (event) => {
      const timestamp = new Date().toISOString();
      const args = event.args.map(arg => {
        if (arg.value !== undefined) return arg.value;
        if (arg.description) return arg.description;
        return String(arg);
      });

      consoleLogs.push({
        type: event.type,
        timestamp,
        message: args.join(' '),
        stackTrace: event.stackTrace
      });
    });

    client.on('Log.entryAdded', (event) => {
      const entry = event.entry;
      consoleLogs.push({
        type: entry.level,
        timestamp: new Date(entry.timestamp).toISOString(),
        message: entry.text,
        source: entry.source,
        url: entry.url,
        lineNumber: entry.lineNumber
      });
    });
  } catch (error) {
    debugLog('Failed to setup console capture for new page:', error.message);
  }

  // Setup network monitoring
  await setupNetworkMonitoring(page);

  debugLog(`New page setup complete (source: ${source})`);
}

/**
 * Handle a newly detected tab (from targetcreated event)
 * @param {Page} page - New Puppeteer page
 * @param {string} openerUrl - URL of the page that opened this tab
 */
export async function handleNewTab(page, openerUrl) {
  const timestamp = new Date().toISOString();

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
export async function connectToTabByUrl(url) {
  const browser = await getBrowser();
  const allPages = await browser.pages();

  // Find page matching URL
  for (const page of allPages) {
    try {
      const pageUrl = page.url();
      if (pageUrl === url || pageUrl.includes(url) || url.includes(pageUrl)) {
        // Setup monitoring if not already done
        if (!openPages.has(url)) {
          await setupNewPage(page, 'extension-switch');
          openPages.set(url, page);
        }
        lastPage = page;
        debugLog(`Connected Puppeteer to tab: ${url}`);
        return page;
      }
    } catch (error) {
      debugLog('Error checking page URL:', error.message);
    }
  }

  debugLog(`No browser page found for URL: ${url}`);
  return null;
}

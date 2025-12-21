/**
 * browser/page-manager.js
 *
 * Page lifecycle and monitoring management
 */

import { getBrowser } from './browser-manager.js';
import { injectRecorder } from '../recorder/recorder-script.js';

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

// Console logs storage
export const consoleLogs = [];

// Network requests storage
export const networkRequests = [];

// Page analysis cache
export const pageAnalysisCache = new Map();

// Track pages with recorder injected
export const pagesWithRecorder = new WeakSet();

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

/**
 * Setup recorder auto-reinjection on navigation
 * @param {Page} page - Puppeteer page instance
 */
export async function setupRecorderAutoReinjection(page) {
  let reinjectionTimeout = null;
  let lastUrl = null;

  // Handle navigation events (form submits, link clicks, history API)
  page.on('framenavigated', async (frame) => {
    // Only handle main frame navigation
    if (frame !== page.mainFrame()) return;

    // Get current URL
    const currentUrl = frame.url();

    // Skip if URL hasn't changed (prevents duplicate injections on same page)
    if (currentUrl === lastUrl) {
      return;
    }
    lastUrl = currentUrl;

    // Clear any pending reinjection
    if (reinjectionTimeout) {
      clearTimeout(reinjectionTimeout);
    }

    // Debounce reinjection (wait 100ms for navigation to settle)
    reinjectionTimeout = setTimeout(async () => {
      // Check if this page had recorder before
      if (pagesWithRecorder.has(page)) {
        try {
          // Project ID will be determined from URL in browser context
          await injectRecorder(page);
        } catch (error) {
          debugLog('Failed to re-inject recorder:', error.message);
        }
      }
    }, 100);
  });

  // Handle page reloads (F5, Ctrl+R) - use 'load' event
  page.on('load', async () => {
    // Check if this page had recorder before
    if (pagesWithRecorder.has(page)) {
      try {
        // Project ID will be determined from URL in browser context
        await injectRecorder(page);
      } catch (error) {
        debugLog('Failed to re-inject recorder after reload:', error.message);
      }
    }
  });
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

  // Setup recorder auto-reinjection on navigation
  setupRecorderAutoReinjection(page);

  await page.goto(url, { waitUntil: 'networkidle2' });
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

  // Setup recorder auto-reinjection if not already set up
  // Check if page already has navigation listener
  const listenerCount = lastPage.listenerCount('framenavigated');
  if (listenerCount === 0) {
    setupRecorderAutoReinjection(lastPage);
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

/**
 * browser/browser-manager.js
 *
 * Browser lifecycle management
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { getChromePath, getUserDataDir, isWSL, CHROME_DEBUG_PORT } from '../utils/platform-utils.js';
import { handleNewTab, openPages, lastPage } from './page-manager.js';

// Get extension path (use forward slashes for Chrome on Windows)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '..', 'extension').replace(/\\/g, '/');

// Fixed extension ID, derived from "key" in extension/manifest.json
export const EXTENSION_ID = 'dmehkibmncgphijnigkahhlekgajhpbl';

const CONNECT_TIMEOUT_MS = Number(process.env.CHROMETOOLS_CONNECT_TIMEOUT_MS) || 15000;

/**
 * puppeteer.connect with a hard timeout.
 * Puppeteer waits for every existing target to initialize; a hidden page with an
 * empty URL (prerender / discarded tab) may never answer, and connect then hangs
 * forever, blocking every later tool call. Such pages present at connect time are
 * skipped; targets created later are not filtered.
 */
async function connectToChrome(browserWSEndpoint) {
  let initial = true;
  const connecting = puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: null,
    targetFilter: target => !(initial && target.type() === 'page' && target.url() === ''),
  });
  let timer;
  try {
    const browser = await Promise.race([
      connecting,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Chrome at ${browserWSEndpoint} did not respond to attach within ${CONNECT_TIMEOUT_MS}ms`);
          error.code = 'CT_ATTACH_TIMEOUT';
          reject(error);
        }, CONNECT_TIMEOUT_MS);
      }),
    ]);
    return browser;
  } catch (error) {
    // Do not leak a connection that completes after the timeout
    connecting.then(b => b.disconnect()).catch(() => {});
    throw error;
  } finally {
    initial = false;
    clearTimeout(timer);
  }
}

// Global browser instance (persists between requests)
let browserPromise = null;
let chromeProcess = null;

// Track if we connected to existing Chrome (extension won't be auto-loaded)
let connectedToExistingChrome = false;

// Ensure bridge reconnect is only triggered once per Chrome launch
let bridgeReconnectScheduled = false;

// Track pages we've already seen to avoid double-handling
const knownTargets = new WeakSet();

/**
 * Debug log helper (only logs to stderr when DEBUG=1)
 * @param {...any} args - Arguments to log
 */
function debugLog(...args) {
  if (process.env.DEBUG === '1') {
    console.error('[browser-manager]', ...args);
  }
}

/**
 * Get WebSocket endpoint from Chrome remote debugging
 * @param {number} port - Chrome debugging port
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<string>} - WebSocket debugger URL
 */
async function getChromeWebSocketEndpoint(port = CHROME_DEBUG_PORT, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/json/version`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(1000);
      });

      const info = JSON.parse(response);
      if (info.webSocketDebuggerUrl) {
        return info.webSocketDebuggerUrl;
      }
    } catch (err) {
      // Chrome might not be ready yet, wait and retry
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error('Could not get Chrome WebSocket endpoint after multiple retries');
}

/**
 * Initialize browser (singleton)
 * @returns {Promise<Browser>} - Puppeteer browser instance
 */
export async function getBrowser() {
  // Check if we have a cached browser and if it's still connected
  if (browserPromise) {
    try {
      const cachedBrowser = await browserPromise;
      if (cachedBrowser && cachedBrowser.isConnected()) {
        return cachedBrowser;
      }
      // Browser disconnected, reset the promise
      debugLog("Browser disconnected, will reconnect...");
      browserPromise = null;
    } catch (error) {
      debugLog("Error checking cached browser:", error.message);
      browserPromise = null;
    }
  }

  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        let browser;
        let endpoint;

        // Highest priority: explicit CDP WebSocket endpoint (e.g. a real
        // logged-in Chrome the user already launched). Skips port-discovery
        // and spawning entirely — connect straight to the live session.
        const wsEndpoint = process.env.CHROMETOOLS_BROWSER_WS_ENDPOINT;
        if (wsEndpoint) {
          browser = await connectToChrome(wsEndpoint);
          debugLog("Connected via CHROMETOOLS_BROWSER_WS_ENDPOINT:", wsEndpoint);
          connectedToExistingChrome = true;
          console.error("[chrometools-mcp] Connected to Chrome via CHROMETOOLS_BROWSER_WS_ENDPOINT.");

          browser.on('disconnected', () => {
            debugLog("Browser disconnected");
            browserPromise = null;
            connectedToExistingChrome = false;
          });

          setupNewTabTracking(browser);
          await ensureExtensionLoaded(browser);
          scheduleBridgeReconnect();
          return browser;
        }

        // Try to connect to existing Chrome with remote debugging
        try {
          endpoint = await getChromeWebSocketEndpoint(CHROME_DEBUG_PORT, 2);
          browser = await connectToChrome(endpoint);
          debugLog("Connected to existing Chrome instance");
          debugLog("WebSocket endpoint:", endpoint);

          // Mark that we connected to existing Chrome (extension won't be auto-loaded)
          connectedToExistingChrome = true;
          console.error("[chrometools-mcp] Connected to existing Chrome. Extension may need manual installation.");

          // Set up disconnect handler to reset browserPromise
          browser.on('disconnected', () => {
            debugLog("Browser disconnected");
            browserPromise = null;
            connectedToExistingChrome = false;
          });

          // Set up new tab tracking
          setupNewTabTracking(browser);

          await ensureExtensionLoaded(browser);

          // Existing Chrome may already have bridge running — try to connect
          scheduleBridgeReconnect();

          return browser;
        } catch (connectError) {
          if (connectError.code === 'CT_ATTACH_TIMEOUT') {
            // Chrome is there but hung: launching another one on the busy port would hang too
            throw new Error(`Chrome on debug port ${CHROME_DEBUG_PORT} is running but does not respond to automation ` +
              `(${connectError.message}). Fully quit that Chrome (check Task Manager for chrome.exe left in background) ` +
              `and call the tool again: ChromeTools will launch a new one.`);
          }
          debugLog("No existing Chrome found, launching new instance...");
          connectedToExistingChrome = false;
        }

        // Launch new Chrome with remote debugging enabled
        const chromePath = getChromePath();
        const userDataDir = getUserDataDir();

        debugLog("Chrome path:", chromePath);
        debugLog("User data dir:", userDataDir);

        // Build Chrome launch arguments
        const chromeArgs = [
          `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${userDataDir}`,
          // Auto-load ChromeTools extension (ignored by Chrome 137+)
          `--load-extension=${EXTENSION_PATH}`,
          // Chrome 137+: allows CDP Extensions.loadUnpacked (see ensureExtensionLoaded)
          '--enable-unsafe-extension-debugging',
          // Keep rendering when the window is covered or in background: otherwise
          // screenshots wait for a frame that never comes
          '--disable-features=CalculateNativeWinOcclusion',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ];
        // OS display scaling (Windows 110%) still rounds borders and sizes under
        // emulation (1px border = 0.909px); only this flag gives exact CSS px
        const forcedDsf = process.env.CHROMETOOLS_FORCE_DEVICE_SCALE_FACTOR;
        if (forcedDsf && Number(forcedDsf) > 0) {
          chromeArgs.push(`--force-device-scale-factor=${Number(forcedDsf)}`);
        }

        debugLog("Extension path:", EXTENSION_PATH);

        chromeProcess = spawn(chromePath, chromeArgs, {
          detached: true,
          stdio: 'ignore',
        });

        chromeProcess.unref(); // Allow Node to exit even if Chrome is running

        debugLog("Chrome launched with remote debugging on port", CHROME_DEBUG_PORT);

        // Wait for Chrome to start and get the endpoint
        endpoint = await getChromeWebSocketEndpoint(CHROME_DEBUG_PORT, 20);

        // Connect to the Chrome instance
        browser = await connectToChrome(endpoint);

        debugLog("Connected to Chrome instance");
        debugLog("WebSocket endpoint:", endpoint);

        // Set up disconnect handler to reset browserPromise
        browser.on('disconnected', () => {
          debugLog("Browser disconnected");
          browserPromise = null;
        });

        // Set up new tab tracking
        setupNewTabTracking(browser);

        await ensureExtensionLoaded(browser);

        // Extension needs time to load and start the bridge service.
        // Schedule bridge reconnection after Chrome is ready.
        scheduleBridgeReconnect();

        return browser;
      } catch (error) {
        // Check if it's a display-related error in WSL
        if (isWSL && (
          error.message.includes('DISPLAY') ||
          error.message.includes('connect ECONNREFUSED') ||
          error.message.includes('cannot open display')
        )) {
          const helpMessage = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ WSL X Server Error Detected

You are running in WSL environment with headless:false mode.
This requires an X server to display the browser GUI.

🔧 Solution:
   1. Start X server on Windows (e.g., VcXsrv, X410)
   2. Set DISPLAY in your MCP config:

      {
        "mcpServers": {
          "chrometools": {
            "env": {
              "DISPLAY": "172.25.96.1:0"
            }
          }
        }
      }

📚 For detailed setup instructions, see:
   WSL_SETUP.md in chrometools-mcp package

💡 Alternative: Run in headless mode (modify index.js)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.error(helpMessage);
          throw new Error(`WSL X Server not available. ${error.message}\n\nSee above for setup instructions.`);
        }

        // Re-throw other errors as-is
        throw error;
      }
    })();
  }

  return await browserPromise;
}

/**
 * Make sure the ChromeTools extension is loaded.
 * Chrome 137+ ignores --load-extension, so load it via CDP Extensions.loadUnpacked.
 * That requires Chrome started with --enable-unsafe-extension-debugging; for an
 * existing Chrome without the flag this fails and we only log it.
 * Extension data (chrome.storage, IndexedDB) persists in the profile across restarts.
 * @param {Browser} browser
 * @param {Object} [options]
 * @param {boolean} [options.force] - reload even if extension targets exist (wakes an idle service worker)
 * @returns {Promise<boolean>} true if the extension is loaded
 */
export async function ensureExtensionLoaded(browser, { force = false } = {}) {
  try {
    const session = await browser.target().createCDPSession();
    try {
      if (!force) {
        // Ask Chrome directly: right after connect Puppeteer's browser.targets()
        // may not list the extension service worker yet. Reloading an already
        // loaded extension breaks other MCP processes attached to its worker.
        const { targetInfos } = await session.send('Target.getTargets');
        if (targetInfos.some(t => t.url.startsWith(`chrome-extension://${EXTENSION_ID}/`))) return true;
      }
      await session.send('Extensions.loadUnpacked', { path: path.resolve(EXTENSION_PATH) });
    } finally {
      await session.detach().catch(() => {});
    }
    debugLog('Extension loaded via CDP Extensions.loadUnpacked');
    return true;
  } catch (error) {
    console.error(`[chrometools-mcp] ChromeTools extension not loaded: ${error.message}. ` +
      `Start Chrome with --enable-unsafe-extension-debugging or install the extension manually.`);
    return false;
  }
}

/**
 * Schedule bridge reconnection after Chrome launches.
 * Extension needs ~2-3s to load and start the bridge service via Native Messaging.
 * Retries a few times in case the bridge takes longer to start.
 */
function scheduleBridgeReconnect() {
  if (bridgeReconnectScheduled) return;
  bridgeReconnectScheduled = true;

  const delays = [2000, 3000, 5000]; // retry schedule in ms
  let attempt = 0;

  async function tryConnect() {
    try {
      const { retryBridgeConnection, isBridgeConnected } = await import('../bridge/bridge-client.js');
      if (isBridgeConnected()) {
        debugLog('Bridge already connected, skipping reconnect');
        return;
      }
      debugLog(`Bridge reconnect attempt ${attempt + 1}/${delays.length}`);
      const connected = await retryBridgeConnection();
      if (connected) {
        console.error('[chrometools-mcp] Bridge connected after Chrome launch');
        return;
      }
    } catch (e) {
      debugLog('Bridge reconnect error:', e.message);
    }

    attempt++;
    if (attempt < delays.length) {
      setTimeout(tryConnect, delays[attempt]);
    } else {
      debugLog('Bridge not available after Chrome launch (extension may not be installed)');
    }
  }

  setTimeout(tryConnect, delays[0]);
}

/**
 * Setup tracking for new tabs opened via window.open, target="_blank", etc.
 * @param {Browser} browser - Puppeteer browser instance
 */
function setupNewTabTracking(browser) {
  browser.on('targetcreated', async (target) => {
    // Only handle page targets (not service workers, etc.)
    if (target.type() !== 'page') {
      return;
    }

    // Skip if we've already processed this target
    if (knownTargets.has(target)) {
      return;
    }
    knownTargets.add(target);

    try {
      const page = await target.page();
      if (!page) {
        return;
      }

      // Check if this page is already tracked (created via getOrCreatePage)
      const currentUrl = page.url();
      for (const [url, trackedPage] of openPages.entries()) {
        if (trackedPage === page) {
          debugLog('Page already tracked, skipping:', url);
          return;
        }
      }

      // Get opener URL if available
      const opener = target.opener();
      let openerUrl = '';
      let openerPage = null;
      if (opener) {
        try {
          openerPage = await opener.page();
          openerUrl = openerPage ? openerPage.url() : '';
        } catch (e) {
          // Opener might not be available
        }
      }

      // Handle the new tab (switches only when opened from a chrometools page)
      await handleNewTab(page, openerUrl, openerPage);

    } catch (error) {
      debugLog('Error handling new tab:', error.message);
    }
  });

  debugLog('New tab tracking enabled');
}

/**
 * Close browser and cleanup
 * @returns {Promise<void>}
 */
export async function closeBrowser() {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await browser.close();
    } catch (error) {
      debugLog("Error closing browser:", error.message);
    }
    browserPromise = null;
  }
  connectedToExistingChrome = false;
}

/**
 * Drop the CDP connection without closing Chrome (user tabs stay open).
 * The next getBrowser() connects again (existing Chrome on the debug port).
 */
export async function resetBrowserConnection() {
  if (browserPromise) {
    const pending = browserPromise;
    browserPromise = null;
    try {
      const browser = await Promise.race([pending, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
      await browser.disconnect();
    } catch (error) {
      debugLog("Error disconnecting browser:", error.message);
    }
  }
  connectedToExistingChrome = false;
}

/**
 * Check if we connected to an existing Chrome instance
 * (extension won't be auto-loaded in this case)
 * @returns {boolean}
 */
export function isConnectedToExistingChrome() {
  return connectedToExistingChrome;
}

/**
 * Get extension path for manual installation
 * @returns {string}
 */
export function getExtensionPath() {
  return EXTENSION_PATH;
}

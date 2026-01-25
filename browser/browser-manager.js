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
import { getChromePath, getTempDir, isWSL, CHROME_DEBUG_PORT } from '../utils/platform-utils.js';
import { handleNewTab, openPages, lastPage } from './page-manager.js';

// Get extension path (use forward slashes for Chrome on Windows)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, '..', 'extension').replace(/\\/g, '/');

// Global browser instance (persists between requests)
let browserPromise = null;
let chromeProcess = null;

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

        // Try to connect to existing Chrome with remote debugging
        try {
          endpoint = await getChromeWebSocketEndpoint(CHROME_DEBUG_PORT, 2);
          browser = await puppeteer.connect({
            browserWSEndpoint: endpoint,
            defaultViewport: null,
          });
          debugLog("Connected to existing Chrome instance");
          debugLog("WebSocket endpoint:", endpoint);

          // Set up disconnect handler to reset browserPromise
          browser.on('disconnected', () => {
            debugLog("Browser disconnected");
            browserPromise = null;
          });

          // Set up new tab tracking
          setupNewTabTracking(browser);

          return browser;
        } catch (connectError) {
          debugLog("No existing Chrome found, launching new instance...");
        }

        // Launch new Chrome with remote debugging enabled
        const chromePath = getChromePath();
        const userDataDir = `${getTempDir()}/chrome-mcp-profile`;

        debugLog("Chrome path:", chromePath);
        debugLog("User data dir:", userDataDir);

        // Build Chrome launch arguments
        const chromeArgs = [
          `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${userDataDir}`,
          // Auto-load ChromeTools extension
          `--load-extension=${EXTENSION_PATH}`,
        ];

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
        browser = await puppeteer.connect({
          browserWSEndpoint: endpoint,
          defaultViewport: null,
        });

        debugLog("Connected to Chrome instance");
        debugLog("WebSocket endpoint:", endpoint);

        // Set up disconnect handler to reset browserPromise
        browser.on('disconnected', () => {
          debugLog("Browser disconnected");
          browserPromise = null;
        });

        // Set up new tab tracking
        setupNewTabTracking(browser);

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
      if (opener) {
        try {
          const openerPage = await opener.page();
          openerUrl = openerPage ? openerPage.url() : '';
        } catch (e) {
          // Opener might not be available
        }
      }

      // Handle the new tab
      await handleNewTab(page, openerUrl);

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
}

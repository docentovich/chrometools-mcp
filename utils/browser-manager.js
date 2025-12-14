import { spawn } from 'child_process';
import http from 'http';

// Detect WSL environment
const isWSL = (() => {
  try {
    const fs = require('fs');
    const proc_version = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    return proc_version.includes('microsoft') || proc_version.includes('wsl');
  } catch {
    return false;
  }
})();

// Detect Windows environment (including WSL)
const isWindows = process.platform === 'win32' || isWSL;

// Get Chrome executable path based on platform
function getChromePath() {
  if (process.platform === 'win32') {
    // Native Windows
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  } else if (isWSL) {
    // WSL - use Windows Chrome
    return '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
  } else {
    // Linux
    return '/usr/bin/google-chrome';
  }
}

// Get temp directory based on platform
function getTempDir() {
  if (process.platform === 'win32') {
    return process.env.TEMP || 'C:\\Windows\\Temp';
  } else if (isWSL) {
    return '/mnt/c/Windows/Temp';
  } else {
    return process.env.TMPDIR || '/tmp';
  }
}

// Debug port for Chrome remote debugging
const CHROME_DEBUG_PORT = 9222;

// Global browser instance (persists between requests)
let browserPromise = null;
const openPages = new Map();
let lastPage = null;
let chromeProcess = null;

// Helper function to get WebSocket endpoint from Chrome
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

// Initialize browser (singleton)
async function getBrowser(puppeteer) {
  // Check if we have a cached browser and if it's still connected
  if (browserPromise) {
    try {
      const cachedBrowser = await browserPromise;
      if (cachedBrowser && cachedBrowser.isConnected()) {
        return cachedBrowser;
      }
      // Browser disconnected, reset the promise
      console.error("[chrometools-mcp] Browser disconnected, will reconnect...");
      browserPromise = null;
    } catch (error) {
      console.error("[chrometools-mcp] Error checking cached browser:", error.message);
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
          console.error("[chrometools-mcp] Connected to existing Chrome instance");
          console.error("[chrometools-mcp] WebSocket endpoint:", endpoint);

          // Set up disconnect handler to reset browserPromise
          browser.on('disconnected', () => {
            console.error("[chrometools-mcp] Browser disconnected");
            browserPromise = null;
          });

          return browser;
        } catch (connectError) {
          console.error("[chrometools-mcp] No existing Chrome found, launching new instance...");
        }

        // Launch new Chrome with remote debugging enabled
        const chromePath = getChromePath();
        const userDataDir = `${getTempDir()}/chrome-mcp-profile`;

        console.error("[chrometools-mcp] Chrome path:", chromePath);
        console.error("[chrometools-mcp] User data dir:", userDataDir);

        chromeProcess = spawn(chromePath, [
          `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${userDataDir}`,
        ], {
          detached: true,
          stdio: 'ignore',
        });

        chromeProcess.unref(); // Allow Node to exit even if Chrome is running

        console.error("[chrometools-mcp] Chrome launched with remote debugging on port", CHROME_DEBUG_PORT);

        // Wait for Chrome to start and get the endpoint
        endpoint = await getChromeWebSocketEndpoint(CHROME_DEBUG_PORT, 20);

        // Connect to the Chrome instance
        browser = await puppeteer.connect({
          browserWSEndpoint: endpoint,
          defaultViewport: null,
        });

        console.error("[chrometools-mcp] Connected to Chrome instance");
        console.error("[chrometools-mcp] WebSocket endpoint:", endpoint);

        // Set up disconnect handler to reset browserPromise
        browser.on('disconnected', () => {
          console.error("[chrometools-mcp] Browser disconnected");
          browserPromise = null;
        });

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
  return browserPromise;
}

// Get or create page for URL
async function getOrCreatePage(url, puppeteer, setupNetworkMonitoring, setupRecorderAutoReinjection, consoleLogs) {
  const browser = await getBrowser(puppeteer);

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

// Get last opened page (for tools that don't need URL)
async function getLastOpenPage(setupRecorderAutoReinjection) {
  if (!lastPage || lastPage.isClosed()) {
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

export {
  isWSL,
  isWindows,
  getChromePath,
  getTempDir,
  getBrowser,
  getOrCreatePage,
  getLastOpenPage,
  CHROME_DEBUG_PORT
};

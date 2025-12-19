#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import puppeteer from "puppeteer";
import Jimp from "jimp";
import pixelmatch from "pixelmatch";
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { spawn } from 'child_process';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';

// Figma token from environment variable (can be set in MCP config)
const FIGMA_TOKEN = process.env.FIGMA_TOKEN || null;

// Get current directory for loading utils
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load element finder utilities
const elementFinderUtils = readFileSync(path.join(__dirname, 'element-finder-utils.js'), 'utf-8');

// Import hints generator
import {
  generateNavigationHints,
  generateClickHints,
  generateFormSubmitHints,
  generatePageHints
} from './utils/hints-generator.js';

// Import Recorder modules
import { injectRecorder } from './recorder/recorder-script.js';
import { executeScenario } from './recorder/scenario-executor.js';
import {
  initializeStorage,
  saveScenario,
  loadScenario,
  listScenarios,
  searchScenarios,
  deleteScenario
} from './recorder/scenario-storage.js';

// Import Figma tools
import {
  parseFigmaUrl,
  normalizeFigmaNodeId,
  fetchFigmaAPI,
  getFigmaFile,
  listFigmaPages,
  searchFigmaFrames,
  getFigmaComponents,
  getFigmaStyles,
  getFigmaColorPalette,
  extractTextFromNode,
  collectAllText
} from './figma-tools.js';

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

// Global browser instance (persists between requests)
let browserPromise = null;
const openPages = new Map();
let lastPage = null;
let chromeProcess = null;

// Console logs storage
const consoleLogs = [];

// Network requests storage
const networkRequests = [];

// Page analysis cache (method 4)
const pageAnalysisCache = new Map();

// Track pages with recorder injected
const pagesWithRecorder = new WeakSet();

// Debug port for Chrome remote debugging
const CHROME_DEBUG_PORT = 9222;

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
async function getBrowser() {
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

// Setup navigation listener for recorder auto-reinjection
// Track pages with network monitoring to prevent duplicate setup
const pagesWithNetworkMonitoring = new WeakSet();

// Setup network monitoring with auto-reinitialization on navigation
async function setupNetworkMonitoring(page) {
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
        console.error('[chrometools-mcp] Failed to reinitialize network monitoring:', error.message);
      }
    }, 100);
  });
}

async function setupRecorderAutoReinjection(page) {
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
          await injectRecorder(page);
        } catch (error) {
          console.error('[chrometools-mcp] Failed to re-inject recorder:', error.message);
        }
      }
    }, 100);
  });

  // Handle page reloads (F5, Ctrl+R) - use 'load' event
  page.on('load', async () => {
    // Check if this page had recorder before
    if (pagesWithRecorder.has(page)) {
      try {
        await injectRecorder(page);
      } catch (error) {
        console.error('[chrometools-mcp] Failed to re-inject recorder after reload:', error.message);
      }
    }
  });
}

// Get or create page for URL
async function getOrCreatePage(url) {
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

// Get last opened page (for tools that don't need URL)
async function getLastOpenPage() {
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

// Helper function to normalize Figma node ID (convert URL format to API format)
// Figma helper functions moved to figma-tools.js

// Helper function to process screenshot with compression and scaling
async function processScreenshot(screenshotBuffer, options = {}) {
  const {
    maxWidth = 1024,
    maxHeight = 8000, // API limit is 8000px
    quality = 80,
    format = 'auto',
    maxFileSize = 3 * 1024 * 1024 // 3 MB limit
  } = options;

  // Load image with Jimp
  const image = await Jimp.read(screenshotBuffer);
  const originalWidth = image.bitmap.width;
  const originalHeight = image.bitmap.height;
  const originalSize = screenshotBuffer.length;

  let processed = false;

  // Apply scaling if needed to fit within maxWidth and maxHeight
  if (maxWidth !== null || maxHeight !== null) {
    let newWidth = originalWidth;
    let newHeight = originalHeight;

    // Calculate scale factors for both dimensions
    let scaleWidth = 1.0;
    let scaleHeight = 1.0;

    if (maxWidth !== null && originalWidth > maxWidth) {
      scaleWidth = maxWidth / originalWidth;
    }

    if (maxHeight !== null && originalHeight > maxHeight) {
      scaleHeight = maxHeight / originalHeight;
    }

    // Use the smaller scale factor to ensure both dimensions fit
    const scale = Math.min(scaleWidth, scaleHeight);

    if (scale < 1.0) {
      newWidth = Math.round(originalWidth * scale);
      newHeight = Math.round(originalHeight * scale);
      image.resize(newWidth, newHeight);
      processed = true;
    }
  }

  // Determine output format
  let outputFormat = format;
  let mimeType = 'image/png';

  if (format === 'auto') {
    // Auto-select: use JPEG for large images, PNG for small
    const estimatedSize = image.bitmap.width * image.bitmap.height * 4;
    outputFormat = estimatedSize > 500000 ? 'jpeg' : 'png'; // ~500KB threshold
  }

  // Convert to buffer with appropriate format and quality
  let currentQuality = quality;
  let resultBuffer;
  let compressionAttempts = 0;
  const maxCompressionAttempts = 10;

  if (outputFormat === 'jpeg') {
    image.quality(currentQuality);
    resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    mimeType = 'image/jpeg';
    processed = true;

    // If file exceeds maxFileSize, reduce quality iteratively
    while (resultBuffer.length > maxFileSize && compressionAttempts < maxCompressionAttempts) {
      compressionAttempts++;
      // Reduce quality by 10 points each iteration
      currentQuality = Math.max(10, currentQuality - 10);
      image.quality(currentQuality);
      resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);

      // If quality is already at minimum and still too large, scale down the image
      if (currentQuality === 10 && resultBuffer.length > maxFileSize) {
        const scaleFactor = Math.sqrt(maxFileSize / resultBuffer.length * 0.9); // 0.9 for safety margin
        const newWidth = Math.round(image.bitmap.width * scaleFactor);
        const newHeight = Math.round(image.bitmap.height * scaleFactor);
        image.resize(newWidth, newHeight);
        image.quality(currentQuality);
        resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
        processed = true;
      }
    }
  } else {
    resultBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
    mimeType = 'image/png';

    // If PNG exceeds maxFileSize, convert to JPEG and compress
    if (resultBuffer.length > maxFileSize) {
      outputFormat = 'jpeg';
      mimeType = 'image/jpeg';
      currentQuality = quality;
      image.quality(currentQuality);
      resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
      processed = true;

      // Reduce quality iteratively if still too large
      while (resultBuffer.length > maxFileSize && compressionAttempts < maxCompressionAttempts) {
        compressionAttempts++;
        currentQuality = Math.max(10, currentQuality - 10);
        image.quality(currentQuality);
        resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);

        // If quality is already at minimum and still too large, scale down the image
        if (currentQuality === 10 && resultBuffer.length > maxFileSize) {
          const scaleFactor = Math.sqrt(maxFileSize / resultBuffer.length * 0.9);
          const newWidth = Math.round(image.bitmap.width * scaleFactor);
          const newHeight = Math.round(image.bitmap.height * scaleFactor);
          image.resize(newWidth, newHeight);
          image.quality(currentQuality);
          resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
          processed = true;
        }
      }
    }
  }

  // Return original if no processing was needed and format is PNG
  if (!processed && outputFormat === 'png' && resultBuffer.length <= maxFileSize) {
    return {
      buffer: screenshotBuffer,
      mimeType: 'image/png',
      metadata: {
        width: originalWidth,
        height: originalHeight,
        originalSize,
        finalSize: screenshotBuffer.length,
        format: 'png',
        compressed: false,
        scaled: false
      }
    };
  }

  return {
    buffer: resultBuffer,
    mimeType,
    metadata: {
      width: image.bitmap.width,
      height: image.bitmap.height,
      originalWidth,
      originalHeight,
      originalSize,
      finalSize: resultBuffer.length,
      format: outputFormat,
      compressed: outputFormat === 'jpeg' || compressionAttempts > 0,
      scaled: processed,
      compressionRatio: Math.round((1 - resultBuffer.length / originalSize) * 100),
      quality: outputFormat === 'jpeg' ? currentQuality : undefined,
      compressionAttempts: compressionAttempts > 0 ? compressionAttempts : undefined,
      autoCompressed: compressionAttempts > 0 || (outputFormat === 'jpeg' && format === 'png')
    }
  };
}

// Calculate SSIM (Structural Similarity Index) for image comparison
function calculateSSIM(img1Data, img2Data, width, height) {
  if (img1Data.length !== img2Data.length) {
    return 0;
  }

  const windowSize = 8;
  const k1 = 0.01;
  const k2 = 0.03;
  const c1 = (k1 * 255) ** 2;
  const c2 = (k2 * 255) ** 2;

  let ssimSum = 0;
  let validWindows = 0;

  for (let y = 0; y <= height - windowSize; y += windowSize) {
    for (let x = 0; x <= width - windowSize; x += windowSize) {
      let sum1 = 0, sum2 = 0, sum1Sq = 0, sum2Sq = 0, sum12 = 0;

      for (let dy = 0; dy < windowSize; dy++) {
        for (let dx = 0; dx < windowSize; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          if (idx + 2 >= img1Data.length) continue;

          const gray1 = (img1Data[idx] * 0.299 + img1Data[idx + 1] * 0.587 + img1Data[idx + 2] * 0.114);
          const gray2 = (img2Data[idx] * 0.299 + img2Data[idx + 1] * 0.587 + img2Data[idx + 2] * 0.114);

          sum1 += gray1;
          sum2 += gray2;
          sum1Sq += gray1 * gray1;
          sum2Sq += gray2 * gray2;
          sum12 += gray1 * gray2;
        }
      }

      const n = windowSize * windowSize;
      const mean1 = sum1 / n;
      const mean2 = sum2 / n;
      const variance1 = (sum1Sq / n) - (mean1 * mean1);
      const variance2 = (sum2Sq / n) - (mean2 * mean2);
      const covariance = (sum12 / n) - (mean1 * mean2);

      const ssim = ((2 * mean1 * mean2 + c1) * (2 * covariance + c2)) /
        ((mean1 * mean1 + mean2 * mean2 + c1) * (variance1 + variance2 + c2));

      ssimSum += ssim;
      validWindows++;
    }
  }

  return validWindows > 0 ? ssimSum / validWindows : 0;
}

// Cleanup on exit
process.on("SIGINT", async () => {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
  }
  process.exit(0);
});

// Create MCP server
const server = new Server(
  {
    name: "chrometools-mcp",
    version: "1.0.2",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// CSS property categorization
const CSS_CATEGORIES = {
  layout: [
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'display', 'float', 'clear', 'overflow', 'overflow-x', 'overflow-y',
    'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'justify-content', 'align-items', 'align-content', 'align-self', 'order',
    'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-gap',
    'gap', 'row-gap', 'column-gap',
    'box-sizing', 'visibility', 'clip', 'clip-path'
  ],
  typography: [
    'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration',
    'text-transform', 'text-indent', 'text-overflow', 'white-space', 'word-break',
    'word-wrap', 'overflow-wrap', 'hyphens', 'direction', 'unicode-bidi',
    'writing-mode', 'vertical-align'
  ],
  colors: [
    'color', 'background', 'background-color', 'background-image', 'background-position',
    'background-size', 'background-repeat', 'background-attachment', 'background-clip',
    'background-origin', 'background-blend-mode',
    'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'caret-color', 'column-rule-color'
  ],
  visual: [
    'opacity', 'transform', 'transform-origin', 'transform-style', 'perspective',
    'perspective-origin', 'backface-visibility',
    'transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
    'animation', 'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
    'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state',
    'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation',
    'box-shadow', 'text-shadow',
    'border', 'border-width', 'border-style', 'border-radius',
    'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'outline', 'outline-width', 'outline-style', 'outline-offset',
    'cursor', 'pointer-events', 'user-select'
  ]
};

// Common default CSS values to filter out
const CSS_DEFAULTS = {
  'display': 'inline',
  'position': 'static',
  'float': 'none',
  'clear': 'none',
  'visibility': 'visible',
  'overflow': 'visible',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  'z-index': 'auto',
  'opacity': '1',
  'transform': 'none',
  'filter': 'none',
  'backdrop-filter': 'none',
  'box-shadow': 'none',
  'text-shadow': 'none',
  'border-style': 'none',
  'border-width': '0px',
  'outline-style': 'none',
  'outline-width': '0px',
  'margin': '0px',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'padding': '0px',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'background-image': 'none',
  'transition': 'all 0s ease 0s',
  'animation': 'none',
  'pointer-events': 'auto',
  'user-select': 'auto',
  'cursor': 'auto',
  'text-decoration': 'none',
  'text-transform': 'none',
  'font-weight': '400',
  'font-style': 'normal',
  'font-variant': 'normal',
  'letter-spacing': 'normal',
  'word-spacing': 'normal',
  'text-align': 'start',
  'white-space': 'normal',
  'word-break': 'normal',
  'overflow-wrap': 'normal',
  'hyphens': 'manual'
};

// Filter computed CSS styles based on options
function filterCssStyles(computedStyle, options = {}) {
  const { category, properties, includeDefaults = false } = options;

  let filtered = computedStyle;

  // Filter by specific properties (highest priority)
  if (properties && properties.length > 0) {
    filtered = filtered.filter(prop =>
      properties.some(p => prop.name.toLowerCase() === p.toLowerCase())
    );
  }
  // Filter by category
  else if (category && category !== 'all') {
    const categoryProps = CSS_CATEGORIES[category] || [];
    filtered = filtered.filter(prop =>
      categoryProps.some(p => prop.name.toLowerCase().startsWith(p.toLowerCase()))
    );
  }

  // Filter out default values if requested
  if (!includeDefaults) {
    filtered = filtered.filter(prop => {
      const defaultValue = CSS_DEFAULTS[prop.name];
      if (!defaultValue) return true;

      // Normalize values for comparison
      const normalizedValue = prop.value.replace(/\s+/g, ' ').trim();
      const normalizedDefault = defaultValue.replace(/\s+/g, ' ').trim();

      return normalizedValue !== normalizedDefault;
    });
  }

  return filtered;
}

// Tool schemas
const PingSchema = z.object({
  message: z.string().optional().describe("Optional message to send"),
});

const OpenBrowserSchema = z.object({
  url: z.string().describe("URL to open in the browser"),
});

const ClickSchema = z.object({
  selector: z.string().describe("CSS selector for element to click"),
  waitAfter: z.number().optional().describe("Milliseconds to wait after click (default: 1500)"),
  screenshot: z.boolean().optional().describe("Capture screenshot after click (default: false for performance)"),
  timeout: z.number().optional().describe("Maximum time to wait for operation in ms (default: 30000)"),
});

const TypeSchema = z.object({
  selector: z.string().describe("CSS selector for input element"),
  text: z.string().describe("Text to type"),
  delay: z.number().optional().describe("Delay between keystrokes in ms (default: 0)"),
  clearFirst: z.boolean().optional().describe("Clear field before typing (default: true)"),
});

const GetElementSchema = z.object({
  selector: z.string().optional().describe("CSS selector (optional, defaults to body)"),
});

const GetComputedCssSchema = z.object({
  selector: z.string().optional().describe("CSS selector (optional, defaults to body)"),
  category: z.enum(['all', 'layout', 'typography', 'colors', 'visual']).optional().describe("Filter by CSS category: 'layout' (sizing, positioning), 'typography' (fonts, text), 'colors' (color schemes), 'visual' (effects, transforms), 'all' (default)"),
  properties: z.array(z.string()).optional().describe("Specific CSS properties to return (e.g., ['color', 'font-size']). Overrides category filter."),
  includeDefaults: z.boolean().optional().describe("Include properties with default values (default: false)"),
});

const GetBoxModelSchema = z.object({
  selector: z.string().describe("CSS selector for element"),
});

const ScreenshotSchema = z.object({
  selector: z.string().describe("CSS selector for element to screenshot"),
  padding: z.number().optional().describe("Padding around element in pixels (default: 0)"),
  maxWidth: z.number().nullable().optional().describe("Maximum width in pixels, auto-scales if larger (default: 1024, set to null for original size)"),
  maxHeight: z.number().nullable().optional().describe("Maximum height in pixels, auto-scales if larger (default: 8000 for API limit, set to null for original size)"),
  quality: z.number().min(1).max(100).optional().describe("JPEG quality 1-100 (default: 80, only applies to JPEG format)"),
  format: z.enum(['png', 'jpeg', 'auto']).optional().describe("Image format: 'png', 'jpeg', or 'auto' (default: 'auto' - chooses based on size)"),
});

const SaveScreenshotSchema = z.object({
  selector: z.string().describe("CSS selector for element to screenshot"),
  filePath: z.string().describe("Absolute path where to save file"),
  padding: z.number().optional().describe("Padding around element in pixels (default: 0)"),
  maxWidth: z.number().nullable().optional().describe("Maximum width in pixels, auto-scales if larger (default: 1024, set to null for original size)"),
  maxHeight: z.number().nullable().optional().describe("Maximum height in pixels, auto-scales if larger (default: 8000 for API limit, set to null for original size)"),
  quality: z.number().min(1).max(100).optional().describe("JPEG quality 1-100 (default: 80, only applies to JPEG format)"),
  format: z.enum(['png', 'jpeg', 'auto']).optional().describe("Image format: 'png', 'jpeg', or 'auto' (default: 'auto' - chooses based on size)"),
});

const ScrollToSchema = z.object({
  selector: z.string().describe("CSS selector for element to scroll to"),
  behavior: z.enum(['auto', 'smooth']).optional().describe("Scroll behavior (default: auto)"),
});

const WaitForElementSchema = z.object({
  selector: z.string().describe("CSS selector to wait for"),
  timeout: z.number().optional().describe("Maximum time to wait in milliseconds (default: 5000)"),
  visible: z.boolean().optional().describe("Wait for element to be visible (default: true)"),
});

const ExecuteScriptSchema = z.object({
  script: z.string().describe("JavaScript code to execute in page context"),
  waitAfter: z.number().optional().describe("Milliseconds to wait after execution (default: 500)"),
  screenshot: z.boolean().optional().describe("Capture screenshot after execution (default: false for performance)"),
  timeout: z.number().optional().describe("Maximum time to wait for operation in ms (default: 30000)"),
});

// Phase 2 schemas
const GetConsoleLogsSchema = z.object({
  types: z.array(z.enum(['log', 'warn', 'error', 'info', 'debug', 'verbose', 'warning']))
    .optional()
    .describe("Filter by log types (default: all)"),
  clear: z.boolean().optional().describe("Clear logs after reading (default: false)"),
});

// Network tools schemas
const ListNetworkRequestsSchema = z.object({
  types: z.array(z.enum(['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Script', 'XHR', 'Fetch', 'WebSocket', 'Other']))
    .optional()
    .default(['Fetch', 'XHR'])
    .describe("Filter by request types (default: Fetch, XHR)"),
  status: z.enum(['pending', 'completed', 'failed', 'all'])
    .optional()
    .describe("Filter by status (default: all)"),
  limit: z.number().min(1).max(500).optional().default(50).describe("Maximum number of requests to return (default: 50)"),
  offset: z.number().min(0).optional().default(0).describe("Number of requests to skip before returning results (default: 0)"),
  clear: z.boolean().optional().describe("Clear requests after reading (default: false)"),
});

const GetNetworkRequestSchema = z.object({
  requestId: z.string().describe("Request ID to get details for"),
});

const FilterNetworkRequestsSchema = z.object({
  urlPattern: z.string().describe("URL pattern to filter by (regex or partial match)"),
  types: z.array(z.enum(['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Script', 'XHR', 'Fetch', 'WebSocket', 'Other']))
    .optional()
    .default(['Fetch', 'XHR'])
    .describe("Filter by request types (default: Fetch, XHR)"),
  clear: z.boolean().optional().describe("Clear requests after reading (default: false)"),
});

const HoverSchema = z.object({
  selector: z.string().describe("CSS selector for element to hover"),
});

const SetStylesSchema = z.object({
  selector: z.string().describe("CSS selector for element to modify"),
  styles: z.array(z.object({
    name: z.string().describe("CSS property name (e.g., 'color')"),
    value: z.string().describe("CSS property value (e.g., 'red')")
  })).describe("Array of CSS property name-value pairs"),
});

const SetViewportSchema = z.object({
  width: z.number().min(320).max(4000).describe("Viewport width in pixels (320-4000)"),
  height: z.number().min(200).max(3000).describe("Viewport height in pixels (200-3000)"),
  deviceScaleFactor: z.number().min(0.5).max(3).optional().describe("Device pixel ratio (0.5-3, default: 1)"),
});

const GetViewportSchema = z.object({});

const NavigateToSchema = z.object({
  url: z.string().describe("URL to navigate to"),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2'])
    .optional()
    .describe("Wait until event (default: networkidle2)"),
});

// Figma tools schemas
const GetFigmaFrameSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key (from URL: figma.com/file/FILE_KEY/...)"),
  nodeId: z.string().describe("Figma node ID (frame/component ID)"),
  scale: z.number().min(0.1).max(4).optional().describe("Export scale (0.1-4, default: 2)"),
  format: z.enum(['png', 'jpg', 'svg']).optional().describe("Export format (default: png)")
});

const CompareFigmaToElementSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key"),
  nodeId: z.string().describe("Figma frame/component ID"),
  selector: z.string().describe("CSS selector for page element"),
  threshold: z.number().min(0).max(1).optional().describe("Difference threshold (0-1, default: 0.05)"),
  figmaScale: z.number().min(0.1).max(4).optional().describe("Figma export scale (default: 2)")
});

const GetFigmaSpecsSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key"),
  nodeId: z.string().describe("Figma frame/component ID")
});

const ParseFigmaUrlSchema = z.object({
  url: z.string().describe("Full Figma URL or fileKey")
});

const ListFigmaPagesSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL")
});

const SearchFigmaFramesSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL"),
  searchQuery: z.string().describe("Search query")
});

const GetFigmaComponentsSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL")
});

const GetFigmaStylesSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL")
});

const GetFigmaColorPaletteSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL")
});

// New AI optimization tools schemas
const SmartFindElementSchema = z.object({
  description: z.string().describe("Natural language description of element to find (e.g., 'login button', 'email field')"),
  maxResults: z.number().min(1).max(20).optional().describe("Maximum number of candidates to return (default: 5)"),
  action: z.object({
    type: z.enum(['click', 'type', 'scrollTo', 'screenshot', 'hover', 'setStyles']).describe("Action to perform on the best match"),
    text: z.string().optional().describe("Text to type (required for 'type' action)"),
    styles: z.array(z.object({
      name: z.string(),
      value: z.string()
    })).optional().describe("Styles to apply (required for 'setStyles' action)"),
    screenshot: z.boolean().optional().describe("Capture screenshot after action (default: false)"),
    waitAfter: z.number().optional().describe("Wait time in ms after action"),
  }).optional().describe("Optional action to perform on the best matching element"),
});

const AnalyzePageSchema = z.object({
  refresh: z.boolean().optional().describe("Force refresh of cached analysis (default: false)"),
});

const GetAllInteractiveElementsSchema = z.object({
  includeHidden: z.boolean().optional().describe("Include hidden elements (default: false)"),
});

const FindElementsByTextSchema = z.object({
  text: z.string().describe("Text to search for in elements"),
  exact: z.boolean().optional().describe("Exact match only (default: false)"),
  caseSensitive: z.boolean().optional().describe("Case sensitive search (default: false)"),
  action: z.object({
    type: z.enum(['click', 'type', 'scrollTo', 'screenshot', 'hover', 'setStyles']).describe("Action to perform on the first match"),
    text: z.string().optional().describe("Text to type (required for 'type' action)"),
    styles: z.array(z.object({
      name: z.string(),
      value: z.string()
    })).optional().describe("Styles to apply (required for 'setStyles' action)"),
    screenshot: z.boolean().optional().describe("Capture screenshot after action (default: false)"),
    waitAfter: z.number().optional().describe("Wait time in ms after action"),
  }).optional().describe("Optional action to perform on the first matching element"),
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ping",
        description: "Simple ping-pong tool for testing. Returns 'pong' with optional message.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Optional message to include in response" },
          },
        },
      },
      {
        name: "openBrowser",
        description: "Open browser and navigate to URL. Window persists for further interactions.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
          },
          required: ["url"],
        },
      },
      {
        name: "click",
        description: "Click element. Waits for animations. Optional screenshot parameter.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
            waitAfter: { type: "number", description: "Wait ms (default: 1500)" },
            screenshot: { type: "boolean", description: "Screenshot (default: false)" },
            timeout: { type: "number", description: "Max wait ms (default: 30000)" },
          },
          required: ["selector"],
        },
      },
      {
        name: "type",
        description: "Type text into input field. Optional clear and typing delay.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
            text: { type: "string", description: "Text to type" },
            delay: { type: "number", description: "Keystroke delay ms (default: 0)" },
            clearFirst: { type: "boolean", description: "Clear first (default: true)" },
          },
          required: ["selector", "text"],
        },
      },
      {
        name: "getElement",
        description: "Get HTML markup of element. Prefer analyzePage for better efficiency.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector (default: body)" },
          },
        },
      },
      {
        name: "getComputedCss",
        description: "Get computed CSS styles for element. For layout debugging and responsive design.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector (default: body)" },
            category: {
              type: "string",
              enum: ["all", "layout", "typography", "colors", "visual"],
              description: "Filter: 'layout', 'typography', 'colors', 'visual', 'all' (default)"
            },
            properties: {
              type: "array",
              items: { type: "string" },
              description: "Specific properties. Overrides category."
            },
            includeDefaults: {
              type: "boolean",
              description: "Include defaults (default: false)"
            },
          },
        },
      },
      {
        name: "getBoxModel",
        description: "Get element box model: dimensions, positioning, margins, padding, borders.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
          },
          required: ["selector"],
        },
      },
      {
        name: "screenshot",
        description: "Capture element image (15-25k tokens). For visual comparison. Use analyzePage for form data/validation (2-5k tokens).",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
            padding: { type: "number", description: "Padding px (default: 0)" },
            maxWidth: { type: "number", description: "Max width px (default: 1024, null=original)" },
            maxHeight: { type: "number", description: "Max height px (default: 8000, null=original)" },
            quality: { type: "number", minimum: 1, maximum: 100, description: "JPEG quality (default: 80)" },
            format: { type: "string", enum: ["png", "jpeg", "auto"], description: "Format (default: auto)" },
          },
          required: ["selector"],
        },
      },
      {
        name: "saveScreenshot",
        description: "Save screenshot to file without returning in context. Auto-scales and compresses. Use maxWidth: null and format: 'png' for original quality.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
            filePath: { type: "string", description: "Save path (extension auto-adjusted)" },
            padding: { type: "number", description: "Padding px (default: 0)" },
            maxWidth: { type: "number", description: "Max width px (default: 1024, null=original)" },
            maxHeight: { type: "number", description: "Max height px (default: 8000, null=original)" },
            quality: { type: "number", minimum: 1, maximum: 100, description: "JPEG quality (default: 80)" },
            format: { type: "string", enum: ["png", "jpeg", "auto"], description: "Format (default: auto)" },
          },
          required: ["selector", "filePath"],
        },
      },
      {
        name: "scrollTo",
        description: "Scroll to element. For lazy loading and visibility testing.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
            behavior: { type: "string", enum: ["auto", "smooth"], description: "Behavior (default: auto)" },
          },
          required: ["selector"],
        },
      },
      {
        name: "waitForElement",
        description: "Wait for element to appear. For dynamic content and lazy-loaded elements.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
            timeout: { type: "number", description: "Max wait ms (default: 5000)" },
            visible: { type: "boolean", description: "Wait for visible (default: true)" },
          },
          required: ["selector"],
        },
      },
      {
        name: "executeScript",
        description: "Execute JavaScript. Use only when specialized tools insufficient. Prefer analyzePage or findElementsByText.",
        inputSchema: {
          type: "object",
          properties: {
            script: { type: "string", description: "JavaScript code" },
            waitAfter: { type: "number", description: "Wait ms (default: 500)" },
            screenshot: { type: "boolean", description: "Screenshot (default: false)" },
            timeout: { type: "number", description: "Max wait ms (default: 30000)" },
          },
          required: ["script"],
        },
      },
      {
        name: "getConsoleLogs",
        description: "Get browser console messages. For debugging JS errors and tracking behavior.",
        inputSchema: {
          type: "object",
          properties: {
            types: { type: "array", items: { type: "string", enum: ["log", "warn", "error", "info", "debug", "verbose", "warning"] }, description: "Filter types (default: all)" },
            clear: { type: "boolean", description: "Clear after read (default: false)" },
          },
        },
      },
      {
        name: "listNetworkRequests",
        description: "List network requests (method, URL, status). Use getNetworkRequest for details. Supports pagination.",
        inputSchema: {
          type: "object",
          properties: {
            types: { type: "array", items: { type: "string", enum: ["Document", "Stylesheet", "Image", "Media", "Font", "Script", "XHR", "Fetch", "WebSocket", "Other"] }, description: "Filter types (default: Fetch, XHR)" },
            status: { type: "string", enum: ["pending", "completed", "failed", "all"], description: "Filter status (default: all)" },
            limit: { type: "number", description: "Max requests (default: 50)" },
            offset: { type: "number", description: "Skip requests (default: 0)" },
            clear: { type: "boolean", description: "Clear after read (default: false)" },
          },
        },
      },
      {
        name: "getNetworkRequest",
        description: "Get network request details (headers, payload, response). Use requestId from listNetworkRequests.",
        inputSchema: {
          type: "object",
          properties: {
            requestId: { type: "string", description: "Request ID" },
          },
          required: ["requestId"],
        },
      },
      {
        name: "filterNetworkRequests",
        description: "Filter network requests by URL pattern. Returns matching requests with full details.",
        inputSchema: {
          type: "object",
          properties: {
            urlPattern: { type: "string", description: "URL pattern (regex or partial)" },
            types: { type: "array", items: { type: "string", enum: ["Document", "Stylesheet", "Image", "Media", "Font", "Script", "XHR", "Fetch", "WebSocket", "Other"] }, description: "Filter types (default: Fetch, XHR)" },
            clear: { type: "boolean", description: "Clear after read (default: false)" },
          },
          required: ["urlPattern"],
        },
      },
      {
        name: "hover",
        description: "Hover over element. For testing hover effects, tooltips, and CSS :hover states.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
          },
          required: ["selector"],
        },
      },
      {
        name: "setStyles",
        description: "Apply inline CSS to element. For live editing and prototyping.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
            styles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Property name" },
                  value: { type: "string", description: "Property value" },
                },
                required: ["name", "value"],
              },
              description: "CSS property name-value pairs",
            },
          },
          required: ["selector", "styles"],
        },
      },
      {
        name: "setViewport",
        description: "Change viewport dimensions. Test responsive layouts across screen sizes.",
        inputSchema: {
          type: "object",
          properties: {
            width: { type: "number", minimum: 320, maximum: 4000, description: "Width px" },
            height: { type: "number", minimum: 200, maximum: 3000, description: "Height px" },
            deviceScaleFactor: { type: "number", minimum: 0.5, maximum: 3, description: "Pixel ratio (default: 1)" },
          },
          required: ["width", "height"],
        },
      },
      {
        name: "getViewport",
        description: "Get viewport size and pixel ratio. For responsive design testing.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "navigateTo",
        description: "Navigate to new URL. Reuses browser instance.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
            waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"], description: "Wait event (default: networkidle2)" },
          },
          required: ["url"],
        },
      },
      {
        name: "getFigmaFrame",
        description: "Export Figma frame as PNG. Requires API token and file/node IDs.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key" },
            nodeId: { type: "string", description: "Frame/component ID" },
            scale: { type: "number", minimum: 0.1, maximum: 4, description: "Scale (default: 2)" },
            format: { type: "string", enum: ["png", "jpg", "svg"], description: "Format (default: png)" },
          },
          required: ["fileKey", "nodeId"],
        },
      },
      {
        name: "compareFigmaToElement",
        description: "Compare Figma design with browser element. Pixel-perfect validation.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key" },
            nodeId: { type: "string", description: "Frame/component ID" },
            selector: { type: "string", description: "CSS selector" },
            threshold: { type: "number", minimum: 0, maximum: 1, description: "Diff threshold (default: 0.05)" },
            figmaScale: { type: "number", minimum: 0.1, maximum: 4, description: "Scale (default: 2)" },
          },
          required: ["fileKey", "nodeId", "selector"],
        },
      },
      {
        name: "getFigmaSpecs",
        description: "Extract design specs from Figma: colors, fonts, dimensions, spacing.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key" },
            nodeId: { type: "string", description: "Frame/component ID" },
          },
          required: ["fileKey", "nodeId"],
        },
      },
      {
        name: "parseFigmaUrl",
        description: "Parse Figma URL to extract fileKey and nodeId.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Figma URL or fileKey" },
          },
          required: ["url"],
        },
      },
      {
        name: "listFigmaPages",
        description: "Get file structure: all pages and frames. Use first to discover file contents.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key or URL" },
          },
          required: ["fileKey"],
        },
      },
      {
        name: "searchFigmaFrames",
        description: "Search frames/components by name. Case-insensitive across all pages.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key or URL" },
            searchQuery: { type: "string", description: "Search query" },
          },
          required: ["fileKey", "searchQuery"],
        },
      },
      {
        name: "getFigmaComponents",
        description: "Get all components from file (Design System). For extracting design system.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key or URL" },
          },
          required: ["fileKey"],
        },
      },
      {
        name: "getFigmaStyles",
        description: "Get all styles: color, text, effect, grid. For extracting design tokens.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key or URL" },
          },
          required: ["fileKey"],
        },
      },
      {
        name: "getFigmaColorPalette",
        description: "Extract color palette. Returns unique colors with hex, rgba, usage count.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key or URL" },
          },
          required: ["fileKey"],
        },
      },
      {
        name: "smartFindElement",
        description: "Find elements with natural language. Returns ranked candidates. Prefer analyzePage for better performance.",
        inputSchema: {
          type: "object",
          properties: {
            description: { type: "string", description: "Natural language description" },
            maxResults: { type: "number", minimum: 1, maximum: 20, description: "Max candidates (default: 5)" },
            action: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["click", "type", "scrollTo", "screenshot", "hover", "setStyles"], description: "Action type" },
                text: { type: "string", description: "Text for 'type'" },
                styles: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } } }, description: "Styles for 'setStyles'" },
                screenshot: { type: "boolean", description: "Screenshot (default: false)" },
                waitAfter: { type: "number", description: "Wait ms" },
              },
              required: ["type"],
              description: "Optional action on element",
            },
          },
          required: ["description"],
        },
      },
      {
        name: "analyzePage",
        description: "Get page state: forms, inputs, buttons, links with values. Use refresh:true after interactions. Cached per URL. 2-5k tokens vs screenshot 15-25k.",
        inputSchema: {
          type: "object",
          properties: {
            refresh: { type: "boolean", description: "Refresh cache (default: false)" },
          },
        },
      },
      {
        name: "getAllInteractiveElements",
        description: "Get all interactive elements with selectors. For understanding available actions.",
        inputSchema: {
          type: "object",
          properties: {
            includeHidden: { type: "boolean", description: "Include hidden (default: false)" },
          },
        },
      },
      {
        name: "findElementsByText",
        description: "Find elements by text. Returns elements with selectors. Optional actions on first match.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Search text" },
            exact: { type: "boolean", description: "Exact match (default: false)" },
            caseSensitive: { type: "boolean", description: "Case sensitive (default: false)" },
            action: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["click", "type", "scrollTo", "screenshot", "hover", "setStyles"], description: "Action type" },
                text: { type: "string", description: "Text for 'type'" },
                styles: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } } }, description: "Styles for 'setStyles'" },
                screenshot: { type: "boolean", description: "Screenshot (default: false)" },
                waitAfter: { type: "number", description: "Wait ms" },
              },
              required: ["type"],
              description: "Optional action on first match",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "enableRecorder",
        description: "Inject recorder UI widget. Visual recording with start/stop/save controls.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "executeScenario",
        description: "Execute recorded scenario by name. Runs actions with dependency resolution.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario name" },
            parameters: { type: "object", description: "Execution parameters" },
            executeDependencies: { type: "boolean", description: "Execute dependencies (default: true)" },
          },
          required: ["name"],
        },
      },
      {
        name: "listScenarios",
        description: "List all scenarios with metadata.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "searchScenarios",
        description: "Search scenarios by text or tags.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Search text" },
            tags: { type: "array", items: { type: "string" }, description: "Filter tags" },
          },
        },
      },
      {
        name: "getScenarioInfo",
        description: "Get scenario details: actions, parameters, dependencies.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario name" },
            includeSecrets: { type: "boolean", description: "Include secrets (default: false)" },
          },
          required: ["name"],
        },
      },
      {
        name: "deleteScenario",
        description: "Delete scenario and secrets.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario name" },
          },
          required: ["name"],
        },
      },
    ],
  };
});

// Helper function to execute actions on elements
async function executeElementAction(page, selector, action) {
  if (!action || !action.type) {
    return null;
  }

  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Element not found for action: ${selector}`);
  }

  const result = {
    action: action.type,
    selector,
    success: true,
  };

  switch (action.type) {
    case 'click':
      await element.click();
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 1500));
      result.message = `Clicked on ${selector}`;

      if (action.screenshot) {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        result.screenshot = screenshot;
      }
      break;

    case 'type':
      if (!action.text) {
        throw new Error('text parameter is required for type action');
      }
      await element.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await element.type(action.text, { delay: 0 });
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 500));
      result.message = `Typed "${action.text}" into ${selector}`;

      if (action.screenshot) {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        result.screenshot = screenshot;
      }
      break;

    case 'scrollTo':
      await element.scrollIntoView({ behavior: 'auto' });
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 300));
      const position = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY
      }));
      result.message = `Scrolled to ${selector}`;
      result.position = position;
      break;

    case 'screenshot':
      const box = await element.boundingBox();
      if (!box) {
        throw new Error(`Element not visible: ${selector}`);
      }
      const clip = {
        x: Math.max(box.x, 0),
        y: Math.max(box.y, 0),
        width: Math.max(box.width, 1),
        height: Math.max(box.height, 1)
      };
      const screenshot = await page.screenshot({ clip, encoding: 'base64' });
      result.message = `Captured screenshot of ${selector}`;
      result.screenshot = screenshot;
      break;

    case 'hover':
      await element.hover();
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 100));
      result.message = `Hovered over ${selector}`;

      if (action.screenshot) {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        result.screenshot = screenshot;
      }
      break;

    case 'setStyles':
      if (!action.styles || !Array.isArray(action.styles)) {
        throw new Error('styles parameter is required for setStyles action');
      }
      const stylesObject = {};
      for (const style of action.styles) {
        stylesObject[style.name] = style.value;
      }
      await page.evaluate((sel, styles) => {
        const el = document.querySelector(sel);
        if (el) {
          Object.entries(styles).forEach(([key, value]) => {
            el.style.setProperty(key, value);
          });
        }
      }, selector, stylesObject);
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 100));
      result.message = `Applied styles to ${selector}`;
      result.styles = stylesObject;

      if (action.screenshot) {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        result.screenshot = screenshot;
      }
      break;

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }

  return result;
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "ping") {
      const validatedArgs = PingSchema.parse(args);
      const responseMessage = validatedArgs.message
        ? `pong: ${validatedArgs.message}`
        : "pong";

      return {
        content: [
          {
            type: "text",
            text: responseMessage,
          },
        ],
      };
    }

    if (name === "openBrowser") {
      const validatedArgs = OpenBrowserSchema.parse(args);
      const page = await getOrCreatePage(validatedArgs.url);
      const title = await page.title();

      // Generate AI hints
      const hints = await generateNavigationHints(page, validatedArgs.url);

      return {
        content: [
          {
            type: "text",
            text: `Browser opened successfully!\nURL: ${validatedArgs.url}\nPage title: ${title}\n\nBrowser remains open for interaction.\n\n** AI HINTS **\nPage type: ${hints.pageType}\nAvailable actions: ${hints.availableActions.join(', ')}\nSuggested next: ${hints.suggestedNext.join('; ')}`,
          },
        ],
      };
    }

    if (name === "click") {
      const validatedArgs = ClickSchema.parse(args);
      const page = await getLastOpenPage();
      const timeout = validatedArgs.timeout || 30000;

      // Wrap operation in timeout
      const clickOperation = async () => {
        const element = await page.$(validatedArgs.selector);
        if (!element) {
          throw new Error(`Element not found: ${validatedArgs.selector}`);
        }

        await element.click();
        await new Promise(resolve => setTimeout(resolve, validatedArgs.waitAfter || 1500));

        // Generate AI hints after click
        const hints = await generateClickHints(page, validatedArgs.selector);

        let hintsText = '\n\n** AI HINTS **';
        if (hints.modalOpened) hintsText += '\nModal opened - interact with it or close';
        if (hints.newElements.length > 0) {
          hintsText += `\nNew elements appeared: ${hints.newElements.map(e => e.type).join(', ')}`;
        }
        if (hints.suggestedNext.length > 0) {
          hintsText += `\nSuggested next: ${hints.suggestedNext.join('; ')}`;
        }

        const content = [
          { type: "text", text: `Clicked: ${validatedArgs.selector}${hintsText}` }
        ];

        // Only add screenshot if requested
        if (validatedArgs.screenshot === true) {
          const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
          content.push({ type: "image", data: screenshot, mimeType: "image/png" });
        }

        return { content };
      };

      // Execute with timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Click operation timed out after ${timeout}ms`)), timeout)
      );

      return Promise.race([clickOperation(), timeoutPromise]);
    }

    if (name === "type") {
      const validatedArgs = TypeSchema.parse(args);
      const page = await getLastOpenPage();

      const element = await page.$(validatedArgs.selector);
      if (!element) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      const clearFirst = validatedArgs.clearFirst !== undefined ? validatedArgs.clearFirst : true;
      if (clearFirst) {
        await element.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
      }

      await element.type(validatedArgs.text, { delay: validatedArgs.delay || 0 });

      return {
        content: [
          { type: "text", text: `Typed "${validatedArgs.text}" into ${validatedArgs.selector}` }
        ],
      };
    }

    if (name === "getElement") {
      const validatedArgs = GetElementSchema.parse(args);
      const page = await getLastOpenPage();

      const client = await page.target().createCDPSession();
      await client.send('DOM.enable');

      const { root } = await client.send('DOM.getDocument');
      const useSelector = (validatedArgs.selector && validatedArgs.selector.trim()) ? validatedArgs.selector : 'body';

      const { nodeId } = await client.send('DOM.querySelector', {
        selector: useSelector,
        nodeId: root.nodeId
      });

      if (!nodeId) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      const { outerHTML } = await client.send('DOM.getOuterHTML', { nodeId });

      return {
        content: [{ type: "text", text: outerHTML }],
      };
    }

    if (name === "getComputedCss") {
      const validatedArgs = GetComputedCssSchema.parse(args);
      const page = await getLastOpenPage();

      const client = await page.target().createCDPSession();
      await client.send('DOM.enable');
      await client.send('CSS.enable');

      const { root } = await client.send('DOM.getDocument');
      const useSelector = (validatedArgs.selector && validatedArgs.selector.trim()) ? validatedArgs.selector : 'body';

      const { nodeId } = await client.send('DOM.querySelector', {
        selector: useSelector,
        nodeId: root.nodeId
      });

      if (!nodeId) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      const { computedStyle } = await client.send('CSS.getComputedStyleForNode', { nodeId });

      // Apply filtering based on options
      const filtered = filterCssStyles(computedStyle, {
        category: validatedArgs.category,
        properties: validatedArgs.properties,
        includeDefaults: validatedArgs.includeDefaults
      });

      // Add metadata about filtering
      const result = {
        selector: useSelector,
        totalProperties: computedStyle.length,
        filteredProperties: filtered.length,
        filters: {
          category: validatedArgs.category || 'all',
          specificProperties: validatedArgs.properties || null,
          includeDefaults: validatedArgs.includeDefaults || false
        },
        styles: filtered
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "getBoxModel") {
      const validatedArgs = GetBoxModelSchema.parse(args);
      const page = await getLastOpenPage();

      const client = await page.target().createCDPSession();
      await client.send('DOM.enable');

      const { root } = await client.send('DOM.getDocument');
      const { nodeId } = await client.send('DOM.querySelector', {
        selector: validatedArgs.selector,
        nodeId: root.nodeId
      });

      if (!nodeId) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      const boxModel = await client.send('DOM.getBoxModel', { nodeId });
      const metrics = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return {
          offsetWidth: el.offsetWidth,
          offsetHeight: el.offsetHeight,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight
        };
      }, validatedArgs.selector);

      if (!metrics) {
        throw new Error(`Element not found (render): ${validatedArgs.selector}`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ boxModel, metrics }, null, 2) }],
      };
    }

    if (name === "screenshot") {
      const validatedArgs = ScreenshotSchema.parse(args);
      const page = await getLastOpenPage();

      const element = await page.$(validatedArgs.selector);
      if (!element) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      const box = await element.boundingBox();
      if (!box) {
        throw new Error(`Element is not visible or has no bounding box: ${validatedArgs.selector}`);
      }

      const padding = validatedArgs.padding || 0;
      const clip = {
        x: Math.max(box.x - padding, 0),
        y: Math.max(box.y - padding, 0),
        width: Math.max(box.width + padding * 2, 1),
        height: Math.max(box.height + padding * 2, 1)
      };

      // Take screenshot as buffer
      const screenshotBuffer = await page.screenshot({ clip, encoding: 'binary' });

      // Process with compression and scaling
      const processed = await processScreenshot(screenshotBuffer, {
        maxWidth: validatedArgs.maxWidth ?? 1024,
        maxHeight: validatedArgs.maxHeight ?? 8000,
        quality: validatedArgs.quality ?? 80,
        format: validatedArgs.format ?? 'auto'
      });

      // Build info message
      const infoText = `Screenshot captured: ${processed.metadata.width}x${processed.metadata.height} ${processed.metadata.format.toUpperCase()}` +
        (processed.metadata.scaled ? ` (scaled from ${processed.metadata.originalWidth}x${processed.metadata.originalHeight})` : '') +
        (processed.metadata.compressed ? ` (${processed.metadata.compressionRatio}% compression)` : '') +
        `\nSize: ${(processed.metadata.finalSize / 1024).toFixed(1)}KB` +
        (processed.metadata.originalSize !== processed.metadata.finalSize ?
          ` (original: ${(processed.metadata.originalSize / 1024).toFixed(1)}KB)` : '');

      return {
        content: [
          {
            type: "text",
            text: infoText
          },
          {
            type: "image",
            data: processed.buffer.toString('base64'),
            mimeType: processed.mimeType
          }
        ],
      };
    }

    if (name === "saveScreenshot") {
      const validatedArgs = SaveScreenshotSchema.parse(args);
      const page = await getLastOpenPage();

      const element = await page.$(validatedArgs.selector);
      if (!element) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      const box = await element.boundingBox();
      if (!box) {
        throw new Error(`Element not visible: ${validatedArgs.selector}`);
      }

      const padding = validatedArgs.padding || 0;
      const clip = {
        x: Math.max(box.x - padding, 0),
        y: Math.max(box.y - padding, 0),
        width: Math.max(box.width + padding * 2, 1),
        height: Math.max(box.height + padding * 2, 1)
      };

      // Get screenshot as buffer (not base64)
      const screenshotBuffer = await page.screenshot({ clip, encoding: 'binary' });

      // Process with compression and scaling
      const processed = await processScreenshot(screenshotBuffer, {
        maxWidth: validatedArgs.maxWidth ?? 1024,
        maxHeight: validatedArgs.maxHeight ?? 8000,
        quality: validatedArgs.quality ?? 80,
        format: validatedArgs.format ?? 'auto'
      });

      // Ensure directory exists
      const dir = dirname(validatedArgs.filePath);
      mkdirSync(dir, { recursive: true });

      // Save to file
      writeFileSync(validatedArgs.filePath, processed.buffer);

      const infoText = `Screenshot saved to: ${validatedArgs.filePath}\n` +
        `Dimensions: ${processed.metadata.width}x${processed.metadata.height}\n` +
        `Format: ${processed.metadata.format.toUpperCase()}\n` +
        `Size: ${(processed.metadata.finalSize / 1024).toFixed(1)}KB` +
        (processed.metadata.scaled ? ` (scaled from ${processed.metadata.originalWidth}x${processed.metadata.originalHeight})` : '') +
        (processed.metadata.compressed ? `\nCompression: ${processed.metadata.compressionRatio}% saved` : '');

      return {
        content: [
          {
            type: "text",
            text: infoText
          }
        ],
      };
    }

    if (name === "scrollTo") {
      const validatedArgs = ScrollToSchema.parse(args);
      const page = await getLastOpenPage();

      // Check if element exists
      const elementExists = await page.$(validatedArgs.selector);
      if (!elementExists) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      // Scroll to element using page.evaluate
      await page.evaluate((selector, behavior) => {
        const element = document.querySelector(selector);
        if (element) {
          element.scrollIntoView({ behavior: behavior || 'auto', block: 'center' });
        }
      }, validatedArgs.selector, validatedArgs.behavior || 'auto');

      // Wait for scroll to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      const position = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY
      }));

      return {
        content: [
          { type: "text", text: `Scrolled to ${validatedArgs.selector} (position: ${position.x}, ${position.y})` }
        ],
      };
    }

    if (name === "waitForElement") {
      const validatedArgs = WaitForElementSchema.parse(args);
      const page = await getLastOpenPage();
      const timeout = validatedArgs.timeout || 5000;
      const waitForVisible = validatedArgs.visible !== false;

      try {
        if (waitForVisible) {
          // Wait for element to be visible
          await page.waitForSelector(validatedArgs.selector, { timeout, visible: true });
        } else {
          // Just wait for element to exist in DOM
          await page.waitForSelector(validatedArgs.selector, { timeout });
        }

        // Get info about the element
        const elementInfo = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;

          const rect = el.getBoundingClientRect();
          return {
            visible: el.offsetParent !== null,
            inViewport: rect.top >= 0 && rect.left >= 0 &&
                       rect.bottom <= window.innerHeight &&
                       rect.right <= window.innerWidth,
            tagName: el.tagName.toLowerCase(),
            text: el.textContent?.trim().substring(0, 100) || ''
          };
        }, validatedArgs.selector);

        return {
          content: [{
            type: "text",
            text: `Element appeared: ${validatedArgs.selector}\n${JSON.stringify(elementInfo, null, 2)}`
          }],
        };
      } catch (error) {
        if (error.name === 'TimeoutError') {
          throw new Error(`Element not found within ${timeout}ms: ${validatedArgs.selector}`);
        }
        throw error;
      }
    }

    if (name === "executeScript") {
      const validatedArgs = ExecuteScriptSchema.parse(args);
      const page = await getLastOpenPage();
      const timeout = validatedArgs.timeout || 30000;

      // Wrap operation in timeout
      const executeOperation = async () => {
        const result = await page.evaluate((code) => {
          try {
            // eslint-disable-next-line no-eval
            const evalResult = eval(code);
            return { success: true, result: evalResult };
          } catch (error) {
            return { success: false, error: error.message };
          }
        }, validatedArgs.script);

        await new Promise(resolve => setTimeout(resolve, validatedArgs.waitAfter || 500));

        const content = [
          {
            type: "text",
            text: result.success
              ? `Script executed successfully.\nResult: ${JSON.stringify(result.result)}`
              : `Script execution failed: ${result.error}`
          }
        ];

        // Only add screenshot if requested
        if (validatedArgs.screenshot === true) {
          const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
          content.push({ type: "image", data: screenshot, mimeType: "image/png" });
        }

        return { content };
      };

      // Execute with timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Script execution timed out after ${timeout}ms`)), timeout)
      );

      return Promise.race([executeOperation(), timeoutPromise]);
    }

    if (name === "getConsoleLogs") {
      const validatedArgs = GetConsoleLogsSchema.parse(args);

      let logs = consoleLogs;

      // Filter by types if specified
      if (validatedArgs.types && validatedArgs.types.length > 0) {
        logs = logs.filter(log => validatedArgs.types.includes(log.type));
      }

      const result = {
        count: logs.length,
        logs: logs.map(log => ({
          type: log.type,
          timestamp: log.timestamp,
          message: log.message
        }))
      };

      // Clear logs if requested
      if (validatedArgs.clear) {
        consoleLogs.length = 0;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
      };
    }

    // Tool 1: listNetworkRequests - compact summary
    if (name === "listNetworkRequests") {
      const validatedArgs = ListNetworkRequestsSchema.parse(args);

      let requests = networkRequests;

      // Filter by types (defaults to Fetch and XHR only)
      if (validatedArgs.types && validatedArgs.types.length > 0) {
        requests = requests.filter(req => validatedArgs.types.includes(req.type));
      }

      // Filter by status if specified
      if (validatedArgs.status && validatedArgs.status !== 'all') {
        requests = requests.filter(req => req.status === validatedArgs.status);
      }

      const totalCount = requests.length;
      const offset = validatedArgs.offset || 0;
      const limit = validatedArgs.limit || 50;

      // Apply pagination
      const paginatedRequests = requests.slice(offset, offset + limit);

      const result = {
        totalCount,
        returnedCount: paginatedRequests.length,
        offset,
        limit,
        hasMore: offset + limit < totalCount,
        requests: paginatedRequests.map(req => ({
          requestId: req.requestId,
          method: req.method,
          url: req.url,
          status: req.status,
          statusCode: req.status === 'completed' ? req.status : undefined,
          type: req.type,
        }))
      };

      // Clear requests if requested
      if (validatedArgs.clear) {
        networkRequests.length = 0;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
      };
    }

    // Tool 2: getNetworkRequest - full details of single request
    if (name === "getNetworkRequest") {
      const validatedArgs = GetNetworkRequestSchema.parse(args);

      const req = networkRequests.find(r => r.requestId === validatedArgs.requestId);
      if (!req) {
        throw new Error(`Request not found: ${validatedArgs.requestId}`);
      }

      // Helper to minify JSON strings
      const minifyJson = (str) => {
        if (!str) return str;
        try {
          const parsed = JSON.parse(str);
          return JSON.stringify(parsed); // Minified (no spacing)
        } catch {
          return str; // Return as-is if not valid JSON
        }
      };

      const result = {
        requestId: req.requestId,
        url: req.url,
        method: req.method,
        type: req.type,
        status: req.status,
        statusCode: req.status,
        statusText: req.statusText,
        timestamp: req.timestamp,
        finishedTimestamp: req.finishedTimestamp,
        duration: req.finishedTimestamp ? new Date(req.finishedTimestamp) - new Date(req.timestamp) + 'ms' : undefined,
        fromCache: req.fromCache,
        headers: req.headers,
        postData: req.postData ? minifyJson(req.postData) : undefined,
        responseHeaders: req.responseHeaders,
        mimeType: req.mimeType,
        errorText: req.errorText,
        canceled: req.canceled,
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
      };
    }

    // Tool 3: filterNetworkRequests - filter by URL pattern with full details
    if (name === "filterNetworkRequests") {
      const validatedArgs = FilterNetworkRequestsSchema.parse(args);

      let requests = networkRequests;

      // Filter by types (defaults to Fetch and XHR only)
      if (validatedArgs.types && validatedArgs.types.length > 0) {
        requests = requests.filter(req => validatedArgs.types.includes(req.type));
      }

      // Filter by URL pattern
      try {
        const regex = new RegExp(validatedArgs.urlPattern);
        requests = requests.filter(req => regex.test(req.url));
      } catch (error) {
        // Try partial match if regex fails
        requests = requests.filter(req => req.url.includes(validatedArgs.urlPattern));
      }

      // Helper to minify JSON strings
      const minifyJson = (str) => {
        if (!str) return str;
        try {
          const parsed = JSON.parse(str);
          return JSON.stringify(parsed); // Minified (no spacing)
        } catch {
          return str; // Return as-is if not valid JSON
        }
      };

      const result = {
        count: requests.length,
        pattern: validatedArgs.urlPattern,
        requests: requests.map(req => ({
          requestId: req.requestId,
          url: req.url,
          method: req.method,
          type: req.type,
          status: req.status,
          statusCode: req.status,
          statusText: req.statusText,
          timestamp: req.timestamp,
          duration: req.finishedTimestamp ? new Date(req.finishedTimestamp) - new Date(req.timestamp) + 'ms' : undefined,
          fromCache: req.fromCache,
          headers: req.headers,
          postData: req.postData ? minifyJson(req.postData) : undefined,
          responseHeaders: req.responseHeaders,
          mimeType: req.mimeType,
          errorText: req.errorText,
        }))
      };

      // Clear requests if requested
      if (validatedArgs.clear) {
        networkRequests.length = 0;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
      };
    }

    if (name === "hover") {
      const validatedArgs = HoverSchema.parse(args);
      const page = await getLastOpenPage();

      const element = await page.$(validatedArgs.selector);
      if (!element) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      await element.hover();
      await new Promise(resolve => setTimeout(resolve, 100));

      return {
        content: [{
          type: "text",
          text: `Hovered over: ${validatedArgs.selector}`
        }],
      };
    }

    if (name === "setStyles") {
      const validatedArgs = SetStylesSchema.parse(args);
      const page = await getLastOpenPage();

      const stylesObject = {};
      for (const style of validatedArgs.styles) {
        stylesObject[style.name] = style.value;
      }

      const success = await page.evaluate((sel, styles) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        Object.entries(styles).forEach(([key, value]) => {
          el.style.setProperty(key, value);
        });
        return true;
      }, validatedArgs.selector, stylesObject);

      if (!success) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      return {
        content: [{
          type: "text",
          text: `Styles applied to ${validatedArgs.selector}:\n${JSON.stringify(stylesObject, null, 2)}`
        }],
      };
    }

    if (name === "setViewport") {
      const validatedArgs = SetViewportSchema.parse(args);
      const page = await getLastOpenPage();

      await page.setViewport({
        width: validatedArgs.width,
        height: validatedArgs.height,
        deviceScaleFactor: validatedArgs.deviceScaleFactor || 1
      });

      const actual = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      }));

      return {
        content: [{
          type: "text",
          text: `Viewport set to ${validatedArgs.width}x${validatedArgs.height}\nActual: ${actual.width}x${actual.height} (DPR: ${actual.devicePixelRatio})`
        }],
      };
    }

    if (name === "getViewport") {
      const page = await getLastOpenPage();

      const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify(viewport, null, 2)
        }],
      };
    }

    if (name === "navigateTo") {
      const validatedArgs = NavigateToSchema.parse(args);
      const page = await getLastOpenPage();

      // Navigate to the new URL (always navigate, don't use cache)
      await page.goto(validatedArgs.url, { waitUntil: validatedArgs.waitUntil || 'networkidle2' });

      const title = await page.title();

      // Generate AI hints
      const hints = await generateNavigationHints(page, validatedArgs.url);

      return {
        content: [{
          type: "text",
          text: `Navigated to: ${validatedArgs.url}\nPage title: ${title}\n\n** AI HINTS **\nPage type: ${hints.pageType}\nAvailable actions: ${hints.availableActions.join(', ')}\nSuggested next: ${hints.suggestedNext.join('; ')}`
        }],
      };
    }

    // Figma tools
    if (name === "getFigmaFrame") {
      const validatedArgs = GetFigmaFrameSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      // Normalize node ID (convert URL format like "123-456" to API format "123:456")
      const nodeId = normalizeFigmaNodeId(validatedArgs.nodeId);

      const scale = validatedArgs.scale || 2;
      const format = validatedArgs.format || 'png';

      // Get export URL from Figma
      const exportData = await fetchFigmaAPI(
        `images/${validatedArgs.fileKey}?ids=${nodeId}&scale=${scale}&format=${format}`,
        token
      );

      if (!exportData.images || !exportData.images[nodeId]) {
        throw new Error(`Failed to export node ${nodeId} from file ${validatedArgs.fileKey}`);
      }

      const imageUrl = exportData.images[nodeId];

      // Download image
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.status}`);
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      // Get frame info
      const nodesData = await fetchFigmaAPI(`files/${validatedArgs.fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token);
      const frameInfo = nodesData.nodes?.[nodeId]?.document;

      // Process image to ensure it doesn't exceed 3 MB
      const processedImage = await processScreenshot(imageBuffer, {
        maxWidth: null, // Keep original dimensions
        maxHeight: null,
        quality: 85,
        format: format,
        maxFileSize: 3 * 1024 * 1024 // 3 MB limit
      });

      const result = {
        figmaInfo: {
          fileName: nodesData.name || 'Unknown',
          frameId: nodeId,
          frameName: frameInfo?.name || 'Unknown',
          dimensions: frameInfo ? {
            width: frameInfo.absoluteBoundingBox?.width,
            height: frameInfo.absoluteBoundingBox?.height
          } : null,
          exportSettings: {
            scale,
            format: processedImage.metadata.format,
            fileSize: processedImage.metadata.finalSize,
            originalFileSize: imageBuffer.length,
            compressed: processedImage.metadata.autoCompressed,
            quality: processedImage.metadata.quality
          }
        }
      };

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) },
          {
            type: 'image',
            data: processedImage.buffer.toString('base64'),
            mimeType: processedImage.mimeType
          }
        ]
      };
    }

    if (name === "compareFigmaToElement") {
      const validatedArgs = CompareFigmaToElementSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      const page = await getLastOpenPage();
      const figmaScale = validatedArgs.figmaScale || 2;
      const threshold = validatedArgs.threshold || 0.05;

      // Normalize node ID (convert URL format like "123-456" to API format "123:456")
      const nodeId = normalizeFigmaNodeId(validatedArgs.nodeId);

      // Get Figma image
      const exportData = await fetchFigmaAPI(
        `images/${validatedArgs.fileKey}?ids=${nodeId}&scale=${figmaScale}&format=png`,
        token
      );

      if (!exportData.images || !exportData.images[nodeId]) {
        throw new Error(`Failed to export Figma node ${nodeId}`);
      }

      const figmaImageUrl = exportData.images[nodeId];
      const figmaResponse = await fetch(figmaImageUrl);
      const figmaBuffer = Buffer.from(await figmaResponse.arrayBuffer());

      // Get page element screenshot
      const element = await page.$(validatedArgs.selector);
      if (!element) {
        throw new Error(`Selector not found: ${validatedArgs.selector}`);
      }

      const pageBuffer = await element.screenshot();

      // Load images for comparison
      const [figmaImg, pageImg] = await Promise.all([
        Jimp.read(figmaBuffer),
        Jimp.read(pageBuffer)
      ]);

      // Resize to same dimensions (use larger dimensions)
      const targetWidth = Math.max(figmaImg.bitmap.width, pageImg.bitmap.width);
      const targetHeight = Math.max(figmaImg.bitmap.height, pageImg.bitmap.height);

      figmaImg.resize(targetWidth, targetHeight);
      pageImg.resize(targetWidth, targetHeight);

      // Compare images
      const figmaData = new Uint8ClampedArray(figmaImg.bitmap.data);
      const pageData = new Uint8ClampedArray(pageImg.bitmap.data);
      const diffData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

      const diffPixels = pixelmatch(figmaData, pageData, diffData, targetWidth, targetHeight, {
        threshold: 0.1,
        includeAA: false
      });

      const ssimValue = calculateSSIM(figmaData, pageData, targetWidth, targetHeight);
      const totalPixels = targetWidth * targetHeight;
      const differencePercent = (diffPixels / totalPixels) * 100;

      // Analysis
      const analysis = {
        figmaVsPage: {
          identical: diffPixels === 0,
          withinThreshold: differencePercent <= (threshold * 100),
          pixelDifferences: diffPixels,
          differencePercent: Math.round(differencePercent * 100) / 100,
          ssim: Math.round(ssimValue * 10000) / 10000,
          recommendation: differencePercent < 1 ? 'Pixel-perfect match' :
            differencePercent < 3 ? 'Very close to design' :
              differencePercent < 10 ? 'Minor differences detected' :
                'Significant differences from design'
        },
        dimensions: {
          figma: { width: figmaImg.bitmap.width, height: figmaImg.bitmap.height },
          page: { width: pageImg.bitmap.width, height: pageImg.bitmap.height },
          comparison: { width: targetWidth, height: targetHeight }
        }
      };

      // Process images to ensure they don't exceed 3 MB
      const [processedFigma, processedPage] = await Promise.all([
        processScreenshot(figmaBuffer, {
          maxWidth: null,
          maxHeight: null,
          quality: 85,
          format: 'auto',
          maxFileSize: 3 * 1024 * 1024
        }),
        processScreenshot(pageBuffer, {
          maxWidth: null,
          maxHeight: null,
          quality: 85,
          format: 'auto',
          maxFileSize: 3 * 1024 * 1024
        })
      ]);

      const content = [
        { type: 'text', text: JSON.stringify(analysis, null, 2) },
        { type: 'image', data: processedFigma.buffer.toString('base64'), mimeType: processedFigma.mimeType },
        { type: 'image', data: processedPage.buffer.toString('base64'), mimeType: processedPage.mimeType }
      ];

      // Add difference map if there are differences
      if (diffPixels > 0) {
        const diffImg = new Jimp({ data: Buffer.from(diffData), width: targetWidth, height: targetHeight });
        const diffBuffer = await diffImg.getBufferAsync(Jimp.MIME_PNG);

        // Process diff image as well
        const processedDiff = await processScreenshot(diffBuffer, {
          maxWidth: null,
          maxHeight: null,
          quality: 85,
          format: 'auto',
          maxFileSize: 3 * 1024 * 1024
        });

        content.push({
          type: 'image',
          data: processedDiff.buffer.toString('base64'),
          mimeType: processedDiff.mimeType
        });
      }

      return { content };
    }

    if (name === "getFigmaSpecs") {
      const validatedArgs = GetFigmaSpecsSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      // Normalize node ID (convert URL format like "123-456" to API format "123:456")
      const nodeId = normalizeFigmaNodeId(validatedArgs.nodeId);

      // Get specific node via nodes API
      const nodesData = await fetchFigmaAPI(`files/${validatedArgs.fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token);

      if (!nodesData.nodes || !nodesData.nodes[nodeId]) {
        throw new Error(`Node ${nodeId} not found in Figma file`);
      }

      const node = nodesData.nodes[nodeId].document;

      // Extract specifications
      const specs = {
        general: {
          name: node.name,
          type: node.type,
          visible: node.visible !== false
        },
        dimensions: node.absoluteBoundingBox ? {
          width: node.absoluteBoundingBox.width,
          height: node.absoluteBoundingBox.height,
          x: node.absoluteBoundingBox.x,
          y: node.absoluteBoundingBox.y
        } : null,
        styling: {},
        children: []
      };

      // Analyze styles
      if (node.fills && node.fills.length > 0) {
        specs.styling.fills = node.fills.map(fill => {
          if (fill.type === 'SOLID') {
            const r = Math.round(fill.color.r * 255);
            const g = Math.round(fill.color.g * 255);
            const b = Math.round(fill.color.b * 255);
            const a = fill.opacity || 1;
            return {
              type: fill.type,
              color: `rgba(${r}, ${g}, ${b}, ${a})`,
              hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
              opacity: a
            };
          }
          return fill;
        });
      }

      if (node.strokes && node.strokes.length > 0) {
        specs.styling.strokes = node.strokes.map(stroke => {
          if (stroke.type === 'SOLID') {
            const r = Math.round(stroke.color.r * 255);
            const g = Math.round(stroke.color.g * 255);
            const b = Math.round(stroke.color.b * 255);
            const a = stroke.opacity || 1;
            return {
              type: stroke.type,
              color: `rgba(${r}, ${g}, ${b}, ${a})`,
              hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
              weight: node.strokeWeight || 1
            };
          }
          return stroke;
        });
      }

      // Text content (for TEXT nodes)
      if (node.type === 'TEXT' && node.characters) {
        specs.textContent = {
          text: node.characters,
          characterCount: node.characters.length
        };
      }

      // Typography
      if (node.style) {
        specs.styling.typography = {
          fontFamily: node.style.fontFamily,
          fontSize: node.style.fontSize,
          fontWeight: node.style.fontWeight,
          lineHeight: node.style.lineHeightPx || node.style.lineHeightPercent,
          letterSpacing: node.style.letterSpacing,
          textAlign: node.style.textAlignHorizontal,
          textCase: node.style.textCase
        };
      }

      // Effects (shadows, blur)
      if (node.effects && node.effects.length > 0) {
        specs.styling.effects = node.effects.map(effect => ({
          type: effect.type,
          visible: effect.visible !== false,
          radius: effect.radius,
          offset: effect.offset,
          color: effect.color ? {
            rgba: `rgba(${Math.round(effect.color.r * 255)}, ${Math.round(effect.color.g * 255)}, ${Math.round(effect.color.b * 255)}, ${effect.color.a || 1})`
          } : null
        }));
      }

      // Border radius
      if (node.cornerRadius !== undefined) {
        specs.styling.borderRadius = node.cornerRadius;
      }
      if (node.rectangleCornerRadii) {
        specs.styling.borderRadius = {
          topLeft: node.rectangleCornerRadii[0],
          topRight: node.rectangleCornerRadii[1],
          bottomRight: node.rectangleCornerRadii[2],
          bottomLeft: node.rectangleCornerRadii[3]
        };
      }

      // Analyze children with text extraction (using imported function)
      if (node.children && node.children.length > 0) {
        specs.children = node.children.map(child => extractTextFromNode(child));
      }

      const allTexts = collectAllText(node);
      if (allTexts.length > 0) {
        specs.allTextContent = allTexts;
        specs.textSummary = {
          totalTextNodes: allTexts.length,
          visibleTextNodes: allTexts.filter(t => t.visible).length,
          combinedText: allTexts.filter(t => t.visible).map(t => t.text).join(' ')
        };
      }

      return {
        content: [
          { type: 'text', text: JSON.stringify(specs, null, 2) }
        ]
      };
    }

    if (name === "parseFigmaUrl") {
      const validatedArgs = ParseFigmaUrlSchema.parse(args);
      const result = parseFigmaUrl(validatedArgs.url);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    if (name === "listFigmaPages") {
      const validatedArgs = ListFigmaPagesSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const result = await listFigmaPages(fileKey, token);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    if (name === "searchFigmaFrames") {
      const validatedArgs = SearchFigmaFramesSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const result = await searchFigmaFrames(fileKey, token, validatedArgs.searchQuery);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    if (name === "getFigmaComponents") {
      const validatedArgs = GetFigmaComponentsSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const result = await getFigmaComponents(fileKey, token);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    if (name === "getFigmaStyles") {
      const validatedArgs = GetFigmaStylesSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const result = await getFigmaStyles(fileKey, token);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    if (name === "getFigmaColorPalette") {
      const validatedArgs = GetFigmaColorPaletteSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const result = await getFigmaColorPalette(fileKey, token);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    // New AI optimization tools
    if (name === "smartFindElement") {
      const validatedArgs = SmartFindElementSchema.parse(args);
      const page = await getLastOpenPage();
      const maxResults = validatedArgs.maxResults || 5;

      // Execute smart search in page context
      const results = await page.evaluate((description, maxResults, utilsCode) => {
        // Inject utilities into page context
        eval(utilsCode);

        // Determine element type from description
        const elementType = determineElementType(description);

        // Build candidate selectors based on element type
        let candidates = [];

        if (elementType.type === 'input' || elementType.type === 'any') {
          candidates.push(...document.querySelectorAll('input'));
          candidates.push(...document.querySelectorAll('textarea'));
        }

        if (elementType.type === 'button' || elementType.type === 'any') {
          candidates.push(...document.querySelectorAll('button'));
          candidates.push(...document.querySelectorAll('input[type="submit"]'));
          candidates.push(...document.querySelectorAll('input[type="button"]'));
          candidates.push(...document.querySelectorAll('[role="button"]'));
        }

        if (elementType.type === 'link' || elementType.type === 'any') {
          candidates.push(...document.querySelectorAll('a'));
        }

        // Analyze each candidate
        const analyzed = candidates.map(el => {
          const context = analyzeButtonContextInPage(el);

          // Use appropriate scoring function based on element type
          let score;
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            score = scoreInputField(el, context, description);
          } else {
            score = scoreSubmitButton(el, context, description);
          }

          const selector = getUniqueSelectorInPage(el);

          return {
            selector,
            text: context.text.substring(0, 100), // Limit text length
            type: el.tagName.toLowerCase(),
            score,
            confidence: Math.min(Math.max(score / 100, 0), 1),
            visible: context.isVisible,
            reason: explainScore(el, context, description, score),
            attributes: {
              id: el.id || null,
              class: el.className || null,
              name: el.name || null,
              type: el.type || null,
            }
          };
        });

        // Filter and sort
        return analyzed
          .filter(r => r.score > 5) // Minimum threshold
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);

      }, validatedArgs.description, maxResults, elementFinderUtils);

      const hints = {
        totalCandidates: results.length,
        bestMatch: results[0] || null,
        suggestion: results.length > 0
          ? `Use selector: ${results[0].selector}`
          : 'No good matches found. Try a different description.',
      };

      const response = {
        candidates: results,
        hints
      };

      // Execute action if provided
      if (validatedArgs.action && results.length > 0) {
        const bestMatch = results[0];
        try {
          const actionResult = await executeElementAction(page, bestMatch.selector, validatedArgs.action);
          response.actionExecuted = actionResult;

          // If screenshot was captured, add it to content
          if (actionResult && actionResult.screenshot) {
            return {
              content: [
                { type: 'text', text: JSON.stringify(response, null, 2) },
                { type: 'image', data: actionResult.screenshot, mimeType: 'image/png' }
              ]
            };
          }
        } catch (error) {
          response.actionError = error.message;
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }]
      };
    }

    if (name === "analyzePage") {
      const validatedArgs = AnalyzePageSchema.parse(args);
      const page = await getLastOpenPage();
      const pageUrl = page.url();

      // Check cache
      if (!validatedArgs.refresh && pageAnalysisCache.has(pageUrl)) {
        const cached = pageAnalysisCache.get(pageUrl);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ ...cached, fromCache: true }, null, 2)
          }]
        };
      }

      // Perform comprehensive analysis
      const analysis = await page.evaluate((utilsCode) => {
        // Inject utilities
        eval(utilsCode);

        const result = {
          url: window.location.href,
          title: document.title,
          forms: [],
          interactiveElements: [],
          inputs: [],
          buttons: [],
          links: [],
          navigation: [],
        };

        // Analyze forms
        document.querySelectorAll('form').forEach((form, idx) => {
          const formData = {
            selector: form.id ? `#${form.id}` : `form:nth-of-type(${idx + 1})`,
            action: form.action,
            method: form.method,
            fields: [],
            submitButton: null,
          };

          // Find fields
          form.querySelectorAll('input, textarea, select').forEach(field => {
            if (field.type === 'submit' || field.type === 'button') return;

            formData.fields.push({
              selector: getUniqueSelectorInPage(field),
              type: field.type || 'text',
              name: field.name,
              id: field.id,
              placeholder: field.placeholder,
              label: (() => {
                const label = field.labels && field.labels[0];
                return label ? label.textContent.trim() : null;
              })(),
              required: field.required,
            });
          });

          // Find submit button
          const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
          if (submitBtn) {
            formData.submitButton = {
              selector: getUniqueSelectorInPage(submitBtn),
              text: submitBtn.textContent || submitBtn.value,
            };
          }

          result.forms.push(formData);
        });

        // All buttons
        document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach(btn => {
          if (btn.offsetWidth === 0 && btn.offsetHeight === 0) return; // Skip hidden

          result.buttons.push({
            selector: getUniqueSelectorInPage(btn),
            text: (btn.textContent || btn.value || '').trim().substring(0, 50),
            type: btn.type || 'button',
            inForm: btn.closest('form') !== null,
          });
        });

        // All inputs
        document.querySelectorAll('input, textarea, select').forEach(input => {
          if (input.type === 'submit' || input.type === 'button' || input.type === 'hidden') return;
          if (input.offsetWidth === 0 && input.offsetHeight === 0) return;

          result.inputs.push({
            selector: getUniqueSelectorInPage(input),
            type: input.type || 'text',
            name: input.name,
            placeholder: input.placeholder,
          });
        });

        // All links
        document.querySelectorAll('a[href]').forEach(link => {
          if (link.offsetWidth === 0 && link.offsetHeight === 0) return;

          const text = link.textContent.trim().substring(0, 50);
          if (!text) return;

          result.links.push({
            selector: getUniqueSelectorInPage(link),
            text,
            href: link.href,
          });
        });

        // Navigation elements
        document.querySelectorAll('nav a, [role="navigation"] a').forEach(link => {
          result.navigation.push({
            selector: getUniqueSelectorInPage(link),
            text: link.textContent.trim().substring(0, 50),
            href: link.href,
          });
        });

        // Interactive elements summary
        document.querySelectorAll('button, a, input, select, textarea, [onclick], [role="button"]').forEach(el => {
          if (el.offsetWidth === 0 && el.offsetHeight === 0) return;

          const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
          if (!text) return;

          result.interactiveElements.push({
            selector: getUniqueSelectorInPage(el),
            type: el.tagName.toLowerCase(),
            text: text.substring(0, 50),
          });
        });

        return result;
      }, elementFinderUtils);

      // Cache the result
      pageAnalysisCache.set(pageUrl, analysis);

      // Add hints
      const hints = {
        summary: `Found ${analysis.forms.length} forms, ${analysis.buttons.length} buttons, ${analysis.inputs.length} inputs, ${analysis.links.length} links`,
        suggestion: analysis.forms.length > 0
          ? `Start with form: ${analysis.forms[0].selector}`
          : 'No forms found on this page',
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ...analysis, hints }, null, 2)
        }]
      };
    }

    if (name === "getAllInteractiveElements") {
      const validatedArgs = GetAllInteractiveElementsSchema.parse(args);
      const page = await getLastOpenPage();

      const elements = await page.evaluate((includeHidden, utilsCode) => {
        eval(utilsCode);

        const results = [];
        const selector = 'button, a[href], input, select, textarea, [onclick], [role="button"], [tabindex]:not([tabindex="-1"])';

        document.querySelectorAll(selector).forEach(el => {
          const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;

          if (!includeHidden && !isVisible) return;

          const text = (el.textContent || el.value || el.getAttribute('aria-label') || el.placeholder || '').trim();

          results.push({
            selector: getUniqueSelectorInPage(el),
            type: el.tagName.toLowerCase(),
            text: text.substring(0, 100),
            visible: isVisible,
            attributes: {
              id: el.id || null,
              class: el.className || null,
              role: el.getAttribute('role') || null,
              type: el.type || null,
            }
          });
        });

        return results;
      }, validatedArgs.includeHidden || false, elementFinderUtils);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: elements.length,
            elements,
            hints: {
              suggestion: 'Use these selectors directly with click, type, or other tools'
            }
          }, null, 2)
        }]
      };
    }

    if (name === "findElementsByText") {
      const validatedArgs = FindElementsByTextSchema.parse(args);
      const page = await getLastOpenPage();

      const elements = await page.evaluate((text, exact, caseSensitive, utilsCode) => {
        eval(utilsCode);

        const results = [];
        const searchText = caseSensitive ? text : text.toLowerCase();

        document.querySelectorAll('*').forEach(el => {
          // Skip script, style, etc
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'BR', 'HR'].includes(el.tagName)) return;

          // Get element's own text (not children)
          let elementText = '';
          for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              elementText += node.textContent;
            }
          }

          elementText = elementText.trim();
          if (!elementText) return;

          const compareText = caseSensitive ? elementText : elementText.toLowerCase();

          const matches = exact
            ? compareText === searchText
            : compareText.includes(searchText);

          if (matches) {
            results.push({
              selector: getUniqueSelectorInPage(el),
              type: el.tagName.toLowerCase(),
              text: elementText.substring(0, 100), // Only first 100 chars for preview
              visible: el.offsetParent !== null, // Add visibility check
            });
          }
        });

        return results;
      }, validatedArgs.text, validatedArgs.exact || false, validatedArgs.caseSensitive || false, elementFinderUtils);

      // Prioritize visible elements and limit results to prevent token overflow
      const visibleElements = elements.filter(el => el.visible);
      const hiddenElements = elements.filter(el => !el.visible);
      const limitedElements = [...visibleElements, ...hiddenElements].slice(0, 20); // Max 20 results

      const response = {
        query: validatedArgs.text,
        totalCount: elements.length,
        visibleCount: visibleElements.length,
        count: limitedElements.length,
        elements: limitedElements,
        truncated: elements.length > 20
      };

      // Execute action if provided and elements found
      if (validatedArgs.action && elements.length > 0) {
        const firstMatch = elements[0];
        try {
          const actionResult = await executeElementAction(page, firstMatch.selector, validatedArgs.action);
          response.actionExecuted = actionResult;

          // If screenshot was captured, add it to content
          if (actionResult && actionResult.screenshot) {
            return {
              content: [
                { type: 'text', text: JSON.stringify(response, null, 2) },
                { type: 'image', data: actionResult.screenshot, mimeType: 'image/png' }
              ]
            };
          }
        } catch (error) {
          response.actionError = error.message;
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }]
      };
    }

    if (name === "enableRecorder") {
      const page = await getLastOpenPage();
      const result = await injectRecorder(page);

      // Track this page as having recorder enabled
      if (result.success) {
        pagesWithRecorder.add(page);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result.success ? {
            success: true,
            message: "Recorder UI injected into page. Click 'Start' to begin recording. Recorder will auto-reinject on page navigation/reload."
          } : {
            success: false,
            error: result.error
          }, null, 2)
        }]
      };
    }

    if (name === "executeScenario") {
      // Try to get existing page, or auto-open browser using scenario's entryUrl
      let page;
      try {
        page = await getLastOpenPage();
      } catch (error) {
        // No page is open - load scenario and open browser at entryUrl
        const scenario = await loadScenario(args.name);
        if (!scenario) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Scenario "${args.name}" not found`
              }, null, 2)
            }]
          };
        }

        const entryUrl = scenario.metadata?.entryUrl;
        if (!entryUrl) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Scenario "${args.name}" has no entryUrl. Cannot auto-open browser.`
              }, null, 2)
            }]
          };
        }

        // Auto-open browser at scenario's entry URL
        page = await getOrCreatePage(entryUrl);
      }

      const options = {};

      // Pass executeDependencies option if provided
      if (args.executeDependencies !== undefined) {
        options.executeDependencies = args.executeDependencies;
      }

      const result = await executeScenario(args.name, page, args.parameters || {}, options);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }

    if (name === "listScenarios") {
      const scenarios = await listScenarios();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(scenarios, null, 2)
        }]
      };
    }

    if (name === "searchScenarios") {
      const results = await searchScenarios(args);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(results, null, 2)
        }]
      };
    }

    if (name === "getScenarioInfo") {
      const scenario = await loadScenario(args.name, args.includeSecrets || false);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(scenario, null, 2)
        }]
      };
    }

    if (name === "deleteScenario") {
      const result = await deleteScenario(args.name);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}`,
        },
      ],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  console.error("Starting chrometools-mcp server...");

  // Show environment info
  if (isWSL) {
    console.error("[chrometools-mcp] WSL environment detected");
    console.error("[chrometools-mcp] GUI mode requires X server (DISPLAY=" + (process.env.DISPLAY || "not set") + ")");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("chrometools-mcp server running on stdio");
  console.error("Browser will be initialized on first openBrowser call");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

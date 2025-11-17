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

// Figma API helper function
async function fetchFigmaAPI(endpoint, figmaToken) {
  if (!figmaToken) {
    throw new Error('Figma token is required. Get it from https://www.figma.com/developers/api#access-tokens');
  }

  const response = await fetch(`https://api.figma.com/v1/${endpoint}`, {
    headers: {
      'X-Figma-Token': figmaToken
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Figma API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Helper function to process screenshot with compression and scaling
async function processScreenshot(screenshotBuffer, options = {}) {
  const {
    maxWidth = 1024,
    maxHeight = 8000, // API limit is 8000px
    quality = 80,
    format = 'auto'
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
  let resultBuffer;
  if (outputFormat === 'jpeg') {
    image.quality(quality);
    resultBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
    mimeType = 'image/jpeg';
    processed = true;
  } else {
    resultBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
    mimeType = 'image/png';
  }

  // Return original if no processing was needed and format is PNG
  if (!processed && outputFormat === 'png') {
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
      compressed: outputFormat === 'jpeg',
      scaled: processed,
      compressionRatio: Math.round((1 - resultBuffer.length / originalSize) * 100)
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

const ExecuteScriptSchema = z.object({
  script: z.string().describe("JavaScript code to execute in page context"),
  waitAfter: z.number().optional().describe("Milliseconds to wait after execution (default: 500)"),
});

// Phase 2 schemas
const GetConsoleLogsSchema = z.object({
  types: z.array(z.enum(['log', 'warn', 'error', 'info', 'debug', 'verbose', 'warning']))
    .optional()
    .describe("Filter by log types (default: all)"),
  clear: z.boolean().optional().describe("Clear logs after reading (default: false)"),
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

// New AI optimization tools schemas
const SmartFindElementSchema = z.object({
  description: z.string().describe("Natural language description of element to find (e.g., 'login button', 'email field')"),
  maxResults: z.number().min(1).max(20).optional().describe("Maximum number of candidates to return (default: 5)"),
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
        description: "Opens a browser window and navigates to the specified URL. Browser window remains open for further interactions. Use this as the first step before other tools.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to (e.g., https://example.com)" },
          },
          required: ["url"],
        },
      },
      {
        name: "click",
        description: "Click on an element to trigger interactions like opening modals, navigating, or submitting forms. Waits for animations and returns a screenshot showing the result.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to click" },
            waitAfter: { type: "number", description: "Milliseconds to wait after click (default: 1500)" },
          },
          required: ["selector"],
        },
      },
      {
        name: "type",
        description: "Type text into an input field, textarea, or contenteditable element. Can optionally clear the field first and control typing speed for realistic input simulation.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for input element" },
            text: { type: "string", description: "Text to type" },
            delay: { type: "number", description: "Delay between keystrokes in ms (default: 0)" },
            clearFirst: { type: "boolean", description: "Clear field before typing (default: true)" },
          },
          required: ["selector", "text"],
        },
      },
      {
        name: "getElement",
        description: "Get the HTML markup of an element for inspection and debugging. If no selector is provided, returns the entire <body> element. Useful for understanding component structure.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector (optional, defaults to body)" },
          },
        },
      },
      {
        name: "getComputedCss",
        description: "Get all computed CSS styles applied to an element. Essential for debugging layout issues, checking responsive design, and verifying CSS properties. Returns complete computed styles.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector (optional, defaults to body)" },
          },
        },
      },
      {
        name: "getBoxModel",
        description: "Get precise element dimensions, positioning, margins, padding, and borders. Returns complete box model data including content, padding, border, and margin dimensions.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element" },
          },
          required: ["selector"],
        },
      },
      {
        name: "screenshot",
        description: "Capture an optimized screenshot of a specific element. By default, auto-scales large images to 1024px width and 8000px height (API limit) and uses smart compression to reduce AI context usage. Perfect for visual documentation and design reviews. Use maxWidth: null and format: 'png' for original quality.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to screenshot" },
            padding: { type: "number", description: "Padding around element in pixels (default: 0)" },
            maxWidth: { type: "number", description: "Maximum width in pixels, auto-scales if larger (default: 1024, set to null for original size)" },
            maxHeight: { type: "number", description: "Maximum height in pixels, auto-scales if larger (default: 8000 for API limit, set to null for original size)" },
            quality: { type: "number", minimum: 1, maximum: 100, description: "JPEG quality 1-100 (default: 80, only applies to JPEG format)" },
            format: { type: "string", enum: ["png", "jpeg", "auto"], description: "Image format: 'png', 'jpeg', or 'auto' (default: 'auto' - chooses based on size)" },
          },
          required: ["selector"],
        },
      },
      {
        name: "saveScreenshot",
        description: "Save optimized screenshot directly to filesystem without returning in context. By default, auto-scales to 1024px width and 8000px height (API limit) and uses smart compression. Perfect for baseline screenshots and reducing file sizes. Use maxWidth: null and format: 'png' for original quality.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to screenshot" },
            filePath: { type: "string", description: "Absolute path where to save file (extension auto-adjusted based on format)" },
            padding: { type: "number", description: "Padding around element in pixels (default: 0)" },
            maxWidth: { type: "number", description: "Maximum width in pixels, auto-scales if larger (default: 1024, set to null for original size)" },
            maxHeight: { type: "number", description: "Maximum height in pixels, auto-scales if larger (default: 8000 for API limit, set to null for original size)" },
            quality: { type: "number", minimum: 1, maximum: 100, description: "JPEG quality 1-100 (default: 80, only applies to JPEG format)" },
            format: { type: "string", enum: ["png", "jpeg", "auto"], description: "Image format: 'png', 'jpeg', or 'auto' (default: 'auto' - chooses based on size)" },
          },
          required: ["selector", "filePath"],
        },
      },
      {
        name: "scrollTo",
        description: "Scroll the page to bring an element into view. Useful for testing lazy loading, sticky elements, and ensuring elements are visible. Supports smooth or instant scrolling.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to scroll to" },
            behavior: { type: "string", enum: ["auto", "smooth"], description: "Scroll behavior (default: auto)" },
          },
          required: ["selector"],
        },
      },
      {
        name: "executeScript",
        description: "Execute arbitrary JavaScript code in the page context. Perfect for complex interactions, setting values, triggering events, or any custom page manipulation. Returns execution result and a screenshot.",
        inputSchema: {
          type: "object",
          properties: {
            script: { type: "string", description: "JavaScript code to execute" },
            waitAfter: { type: "number", description: "Milliseconds to wait after execution (default: 500)" },
          },
          required: ["script"],
        },
      },
      {
        name: "getConsoleLogs",
        description: "Retrieve all console.log, console.warn, console.error messages from the browser. Essential for debugging JavaScript errors and tracking application behavior. Logs are captured automatically from page load.",
        inputSchema: {
          type: "object",
          properties: {
            types: { type: "array", items: { type: "string", enum: ["log", "warn", "error", "info", "debug", "verbose", "warning"] }, description: "Filter by log types (default: all)" },
            clear: { type: "boolean", description: "Clear logs after reading (default: false)" },
          },
        },
      },
      {
        name: "hover",
        description: "Simulate mouse hover over an element to test hover effects, tooltips, dropdown menus, and interactive states. Essential for testing CSS :hover pseudo-classes.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to hover" },
          },
          required: ["selector"],
        },
      },
      {
        name: "setStyles",
        description: "Apply inline CSS styles to an element for live editing and prototyping. Perfect for testing design changes without modifying source code.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to modify" },
            styles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "CSS property name" },
                  value: { type: "string", description: "CSS property value" },
                },
                required: ["name", "value"],
              },
              description: "Array of CSS property name-value pairs",
            },
          },
          required: ["selector", "styles"],
        },
      },
      {
        name: "setViewport",
        description: "Change viewport dimensions for responsive design testing. Test how your layout adapts to different screen sizes, mobile devices, tablets, and desktop resolutions.",
        inputSchema: {
          type: "object",
          properties: {
            width: { type: "number", minimum: 320, maximum: 4000, description: "Viewport width in pixels" },
            height: { type: "number", minimum: 200, maximum: 3000, description: "Viewport height in pixels" },
            deviceScaleFactor: { type: "number", minimum: 0.5, maximum: 3, description: "Device pixel ratio (default: 1)" },
          },
          required: ["width", "height"],
        },
      },
      {
        name: "getViewport",
        description: "Get current viewport size and device pixel ratio. Essential for responsive design testing and understanding how content fits on different screen sizes.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "navigateTo",
        description: "Navigate the current page to a new URL. Use this when you need to move to a different page while keeping the same browser instance. Page will be reused if already open.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
            waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"], description: "Wait until event (default: networkidle2)" },
          },
          required: ["url"],
        },
      },
      {
        name: "getFigmaFrame",
        description: "Export and download a Figma frame as PNG image for comparison. Requires Figma API token and file/node IDs from Figma URLs.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "Figma API token (optional if FIGMA_TOKEN env var is set)" },
            fileKey: { type: "string", description: "Figma file key (from URL: figma.com/file/FILE_KEY/...)" },
            nodeId: { type: "string", description: "Figma node ID (frame/component ID)" },
            scale: { type: "number", minimum: 0.1, maximum: 4, description: "Export scale (0.1-4, default: 2)" },
            format: { type: "string", enum: ["png", "jpg", "svg"], description: "Export format (default: png)" },
          },
          required: ["fileKey", "nodeId"],
        },
      },
      {
        name: "compareFigmaToElement",
        description: "Compare Figma design directly with browser implementation. The GOLD STANDARD for design-to-code validation. Fetches Figma frame, screenshots element, performs pixel-perfect comparison with difference analysis.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "Figma API token (optional if FIGMA_TOKEN env var is set)" },
            fileKey: { type: "string", description: "Figma file key" },
            nodeId: { type: "string", description: "Figma frame/component ID" },
            selector: { type: "string", description: "CSS selector for page element" },
            threshold: { type: "number", minimum: 0, maximum: 1, description: "Difference threshold (0-1, default: 0.05)" },
            figmaScale: { type: "number", minimum: 0.1, maximum: 4, description: "Figma export scale (default: 2)" },
          },
          required: ["fileKey", "nodeId", "selector"],
        },
      },
      {
        name: "getFigmaSpecs",
        description: "Extract detailed design specifications from Figma including colors, fonts, dimensions, and spacing. Perfect for design-to-code comparison.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "Figma API token (optional if FIGMA_TOKEN env var is set)" },
            fileKey: { type: "string", description: "Figma file key" },
            nodeId: { type: "string", description: "Figma frame/component ID" },
          },
          required: ["fileKey", "nodeId"],
        },
      },
      {
        name: "smartFindElement",
        description: "AI-powered element finder that uses natural language to locate elements. Returns multiple candidates ranked by relevance, eliminating the need for trial-and-error selector searches. Much faster than multiple getElement calls.",
        inputSchema: {
          type: "object",
          properties: {
            description: { type: "string", description: "Natural language description (e.g., 'login button', 'email input', 'submit form')" },
            maxResults: { type: "number", minimum: 1, maximum: 20, description: "Max candidates to return (default: 5)" },
          },
          required: ["description"],
        },
      },
      {
        name: "analyzePage",
        description: "Comprehensive page analysis that returns complete structure: all forms, inputs, buttons, links, and interactive elements with their selectors. Cached for fast repeated access. Use this ONCE at page load to understand the entire page structure.",
        inputSchema: {
          type: "object",
          properties: {
            refresh: { type: "boolean", description: "Force refresh cached analysis (default: false)" },
          },
        },
      },
      {
        name: "getAllInteractiveElements",
        description: "Get all clickable and interactive elements on the page with their selectors and descriptions. Perfect for understanding what actions are available.",
        inputSchema: {
          type: "object",
          properties: {
            includeHidden: { type: "boolean", description: "Include hidden elements (default: false)" },
          },
        },
      },
      {
        name: "findElementsByText",
        description: "Find all elements containing specific text. Returns elements with their selectors, making it easy to locate elements by visible text.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to search for" },
            exact: { type: "boolean", description: "Exact match only (default: false)" },
            caseSensitive: { type: "boolean", description: "Case sensitive (default: false)" },
          },
          required: ["text"],
        },
      },
      {
        name: "enableRecorder",
        description: "Inject recorder UI widget into the current page. Enables visual recording of user interactions with start/stop/save controls.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "executeScenario",
        description: "Execute a recorded scenario by name with optional parameters. Runs all actions in the scenario chain with dependency resolution.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario name to execute" },
            parameters: { type: "object", description: "Parameters for scenario execution (e.g., { email: 'user@test.com', password: 'secret' })" },
            executeDependencies: { type: "boolean", description: "Execute dependencies before running scenario (default: true)" },
          },
          required: ["name"],
        },
      },
      {
        name: "listScenarios",
        description: "Get list of all available scenarios with metadata (name, description, tags, dependencies, timestamps).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "searchScenarios",
        description: "Search scenarios by text query or tags. Returns matching scenarios with metadata.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to search in name/description" },
            tags: { type: "array", items: { type: "string" }, description: "Tags to filter by" },
          },
        },
      },
      {
        name: "getScenarioInfo",
        description: "Get detailed information about a specific scenario including actions, parameters, and dependencies.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario name" },
            includeSecrets: { type: "boolean", description: "Include secrets in response (default: false)" },
          },
          required: ["name"],
        },
      },
      {
        name: "deleteScenario",
        description: "Delete a scenario and its associated secrets from storage.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario name to delete" },
          },
          required: ["name"],
        },
      },
    ],
  };
});

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

      const element = await page.$(validatedArgs.selector);
      if (!element) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      await element.click();
      await new Promise(resolve => setTimeout(resolve, validatedArgs.waitAfter || 1500));

      // Generate AI hints after click
      const hints = await generateClickHints(page, validatedArgs.selector);

      const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

      let hintsText = '\n\n** AI HINTS **';
      if (hints.modalOpened) hintsText += '\nModal opened - interact with it or close';
      if (hints.newElements.length > 0) {
        hintsText += `\nNew elements appeared: ${hints.newElements.map(e => e.type).join(', ')}`;
      }
      if (hints.suggestedNext.length > 0) {
        hintsText += `\nSuggested next: ${hints.suggestedNext.join('; ')}`;
      }

      return {
        content: [
          { type: "text", text: `Clicked: ${validatedArgs.selector}${hintsText}` },
          { type: "image", data: screenshot, mimeType: "image/png" }
        ],
      };
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

      return {
        content: [{ type: "text", text: JSON.stringify(computedStyle, null, 2) }],
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

      const element = await page.$(validatedArgs.selector);
      if (!element) {
        throw new Error(`Element not found: ${validatedArgs.selector}`);
      }

      await element.scrollIntoView({ behavior: validatedArgs.behavior || 'auto' });
      await new Promise(resolve => setTimeout(resolve, 300));

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

    if (name === "executeScript") {
      const validatedArgs = ExecuteScriptSchema.parse(args);
      const page = await getLastOpenPage();

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

      const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

      return {
        content: [
          {
            type: "text",
            text: result.success
              ? `Script executed successfully.\nResult: ${JSON.stringify(result.result)}`
              : `Script execution failed: ${result.error}`
          },
          { type: "image", data: screenshot, mimeType: "image/png" }
        ],
      };
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
      const page = await getOrCreatePage(validatedArgs.url);

      if (validatedArgs.waitUntil) {
        await page.goto(validatedArgs.url, { waitUntil: validatedArgs.waitUntil });
      }

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

      const scale = validatedArgs.scale || 2;
      const format = validatedArgs.format || 'png';

      // Get export URL from Figma
      const exportData = await fetchFigmaAPI(
        `images/${validatedArgs.fileKey}?ids=${validatedArgs.nodeId}&scale=${scale}&format=${format}`,
        token
      );

      if (!exportData.images || !exportData.images[validatedArgs.nodeId]) {
        throw new Error(`Failed to export node ${validatedArgs.nodeId} from file ${validatedArgs.fileKey}`);
      }

      const imageUrl = exportData.images[validatedArgs.nodeId];

      // Download image
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.status}`);
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      // Get frame info
      const nodesData = await fetchFigmaAPI(`files/${validatedArgs.fileKey}/nodes?ids=${encodeURIComponent(validatedArgs.nodeId)}`, token);
      const frameInfo = nodesData.nodes?.[validatedArgs.nodeId]?.document;

      const result = {
        figmaInfo: {
          fileName: nodesData.name || 'Unknown',
          frameId: validatedArgs.nodeId,
          frameName: frameInfo?.name || 'Unknown',
          dimensions: frameInfo ? {
            width: frameInfo.absoluteBoundingBox?.width,
            height: frameInfo.absoluteBoundingBox?.height
          } : null,
          exportSettings: {
            scale,
            format,
            fileSize: imageBuffer.length
          }
        }
      };

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) },
          {
            type: 'image',
            data: imageBuffer.toString('base64'),
            mimeType: `image/${format}`
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

      // Get Figma image
      const exportData = await fetchFigmaAPI(
        `images/${validatedArgs.fileKey}?ids=${validatedArgs.nodeId}&scale=${figmaScale}&format=png`,
        token
      );

      if (!exportData.images || !exportData.images[validatedArgs.nodeId]) {
        throw new Error(`Failed to export Figma node ${validatedArgs.nodeId}`);
      }

      const figmaImageUrl = exportData.images[validatedArgs.nodeId];
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

      const content = [
        { type: 'text', text: JSON.stringify(analysis, null, 2) },
        { type: 'image', data: figmaBuffer.toString('base64'), mimeType: 'image/png' },
        { type: 'image', data: pageBuffer.toString('base64'), mimeType: 'image/png' }
      ];

      // Add difference map if there are differences
      if (diffPixels > 0) {
        const diffImg = new Jimp({ data: Buffer.from(diffData), width: targetWidth, height: targetHeight });
        const diffBuffer = await diffImg.getBufferAsync(Jimp.MIME_PNG);
        content.push({
          type: 'image',
          data: diffBuffer.toString('base64'),
          mimeType: 'image/png'
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

      // Get specific node via nodes API
      const nodesData = await fetchFigmaAPI(`files/${validatedArgs.fileKey}/nodes?ids=${encodeURIComponent(validatedArgs.nodeId)}`, token);

      if (!nodesData.nodes || !nodesData.nodes[validatedArgs.nodeId]) {
        throw new Error(`Node ${validatedArgs.nodeId} not found in Figma file`);
      }

      const node = nodesData.nodes[validatedArgs.nodeId].document;

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

      // Analyze children
      if (node.children && node.children.length > 0) {
        specs.children = node.children.map(child => ({
          id: child.id,
          name: child.name,
          type: child.type,
          dimensions: child.absoluteBoundingBox,
          visible: child.visible !== false
        }));
      }

      return {
        content: [
          { type: 'text', text: JSON.stringify(specs, null, 2) }
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

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ candidates: results, hints }, null, 2)
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
              text: elementText.substring(0, 100),
              fullText: elementText,
            });
          }
        });

        return results;
      }, validatedArgs.text, validatedArgs.exact || false, validatedArgs.caseSensitive || false, elementFinderUtils);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query: validatedArgs.text,
            count: elements.length,
            elements,
          }, null, 2)
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
      const page = await getLastOpenPage();
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

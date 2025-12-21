#!/usr/bin/env node

import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {CallToolRequestSchema, ListToolsRequestSchema,} from "@modelcontextprotocol/sdk/types.js";
import Jimp from "jimp";
import pixelmatch from "pixelmatch";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import path, {dirname} from 'path';
import {fileURLToPath} from 'url';
import {homedir} from 'os';

// Import browser and platform utilities
import {closeBrowser} from './browser/browser-manager.js';
import {isWSL} from './utils/platform-utils.js';

// Import page management utilities
import {
    consoleLogs,
    getLastOpenPage,
    getOrCreatePage,
    networkRequests,
    pageAnalysisCache,
    pagesWithRecorder
} from './browser/page-manager.js';

// Import image processing utilities
import {calculateSSIM, processScreenshot} from './utils/image-processing.js';

// Import CSS utilities
import {filterCssStyles} from './utils/css-utils.js';

// Import tool schemas and definitions
import * as schemas from './server/tool-schemas.js';
import {toolDefinitions} from './server/tool-definitions.js';

// Import element actions helper
import {executeElementAction} from './utils/element-actions.js';
// Import hints generator
import {generateClickHints, generateNavigationHints} from './utils/hints-generator.js';

// Import Recorder modules
import {injectRecorder} from './recorder/recorder-script.js';
import {executeScenario} from './recorder/scenario-executor.js';
import {deleteScenario, listScenarios, loadScenario, searchScenarios} from './recorder/scenario-storage.js';
import {generatePageObject} from './recorder/page-object-generator.js';

// Import Code Generators
import {PlaywrightTypeScriptGenerator} from './utils/code-generators/playwright-typescript.js';
import {PlaywrightPythonGenerator} from './utils/code-generators/playwright-python.js';
import {SeleniumPythonGenerator} from './utils/code-generators/selenium-python.js';
import {SeleniumJavaGenerator} from './utils/code-generators/selenium-java.js';
// Import Figma tools
import {
    collectAllText,
    extractTextFromNode,
    fetchFigmaAPI,
    getFigmaColorPalette,
    getFigmaComponents,
    getFigmaStyles,
    listFigmaPages,
    normalizeFigmaNodeId,
    parseFigmaUrl,
    searchFigmaFrames
} from './figma-tools.js';

// Debug mode - only use stderr for actual errors, not debug info
// MCP uses STDIO for JSON-RPC, so console.log/error breaks the protocol
const DEBUG_MODE = process.env.CHROMETOOLS_DEBUG === 'true';
const debugLog = DEBUG_MODE ? console.error : () => {};

// Figma token from environment variable (can be set in MCP config)
const FIGMA_TOKEN = process.env.FIGMA_TOKEN || null;

// Get current directory for loading utils
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load element finder utilities
const elementFinderUtils = readFileSync(path.join(__dirname, 'element-finder-utils.js'), 'utf-8');

// Base storage directory in user's home folder
const BASE_STORAGE_DIR = path.join(homedir(), '.config', 'chrometools-mcp');
const GLOBAL_INDEX_PATH = path.join(BASE_STORAGE_DIR, 'index.json');
const PROJECTS_DIR = path.join(BASE_STORAGE_DIR, 'projects');

/**
 * Load global index from ~/.config/chrometools-mcp/index.json
 * @returns {object} - Global index object
 */
function loadGlobalIndex() {
  try {
    const data = readFileSync(GLOBAL_INDEX_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    // Index doesn't exist yet, return empty structure
    return {
      version: '2.0',
      projects: {}
    };
  }
}

/**
 * Save global index to ~/.config/chrometools-mcp/index.json
 * @param {object} index - Global index object
 */
function saveGlobalIndex(index) {
  mkdirSync(BASE_STORAGE_DIR, { recursive: true });
  writeFileSync(GLOBAL_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
  debugLog('[chrometools-mcp] Global index saved');
}

/**
 * Get all project IDs from global index
 * @returns {string[]} - Array of project IDs
 */
function getAllProjectIds() {
  const index = loadGlobalIndex();
  return Object.keys(index.projects || {});
}

// Cleanup on exit
process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

// Migration: Remove old project-based scenarios (v2.0) on first run with v2.1.0
// This migration runs once to clean up old scenarios and start fresh with URL-based organization
try {
  const migrationFlagPath = path.join(BASE_STORAGE_DIR, '.migration-v2.1.0-done');

  if (!existsSync(migrationFlagPath)) {
    // Check if old projects directory exists
    if (existsSync(PROJECTS_DIR)) {
      console.error('[chrometools-mcp] Migration v2.1.0: Removing old project-based scenarios...');

      // Remove all old scenarios
      const { rmSync } = await import('fs');
      rmSync(PROJECTS_DIR, { recursive: true, force: true });

      console.error('[chrometools-mcp] Migration v2.1.0: Old scenarios removed. Starting fresh with URL-based organization.');
    }

    // Remove old global index
    if (existsSync(GLOBAL_INDEX_PATH)) {
      const { unlinkSync } = await import('fs');
      unlinkSync(GLOBAL_INDEX_PATH);
    }

    // Create migration flag
    mkdirSync(BASE_STORAGE_DIR, { recursive: true });
    writeFileSync(migrationFlagPath, new Date().toISOString(), 'utf-8');
    console.error('[chrometools-mcp] Migration v2.1.0: Complete. New scenarios will be organized by website domain.');
  }
} catch (migrationError) {
  console.error('[chrometools-mcp] Migration v2.1.0 failed:', migrationError.message);
  // Continue anyway - migration is optional
}

// Create MCP server
const server = new Server(
  {
    name: "chrometools-mcp",
    version: "2.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: toolDefinitions,
  };
});



// Wrapper to add timeout protection for all tool calls
async function executeToolWithTimeout(toolName, toolFunction, timeoutMs = 120000) {
  return Promise.race([
    toolFunction(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool '${toolName}' timeout after ${timeoutMs/1000}s`)), timeoutMs)
    )
  ]);
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Execute with timeout wrapper (2 minutes default, 5 minutes for scenario execution)
    const toolTimeout = name === 'executeScenario' ? 360000 : 120000; // 6 min for scenarios, 2 min for others

    return await executeToolWithTimeout(name, async () => {
      return await executeToolInternal(name, args);
    }, toolTimeout);
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message,
          tool: name
        }, null, 2)
      }],
      isError: true,
    };
  }
});

// Internal tool execution function
async function executeToolInternal(name, args) {
  try {
    if (name === "ping") {
      const validatedArgs = schemas.PingSchema.parse(args);
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
      const validatedArgs = schemas.OpenBrowserSchema.parse(args);
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
      const validatedArgs = schemas.ClickSchema.parse(args);
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
      const validatedArgs = schemas.TypeSchema.parse(args);
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
      const validatedArgs = schemas.GetElementSchema.parse(args);
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
      const validatedArgs = schemas.GetComputedCssSchema.parse(args);
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
      const validatedArgs = schemas.GetBoxModelSchema.parse(args);
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
      const validatedArgs = schemas.ScreenshotSchema.parse(args);
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
      const validatedArgs = schemas.SaveScreenshotSchema.parse(args);
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
      const validatedArgs = schemas.ScrollToSchema.parse(args);
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
      const validatedArgs = schemas.WaitForElementSchema.parse(args);
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
      const validatedArgs = schemas.ExecuteScriptSchema.parse(args);
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
      const validatedArgs = schemas.GetConsoleLogsSchema.parse(args);

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
      const validatedArgs = schemas.ListNetworkRequestsSchema.parse(args);

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
      const validatedArgs = schemas.GetNetworkRequestSchema.parse(args);

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
      const validatedArgs = schemas.FilterNetworkRequestsSchema.parse(args);

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
      const validatedArgs = schemas.HoverSchema.parse(args);
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
      const validatedArgs = schemas.SetStylesSchema.parse(args);
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
      const validatedArgs = schemas.SetViewportSchema.parse(args);
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
      const validatedArgs = schemas.NavigateToSchema.parse(args);
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
      const validatedArgs = schemas.GetFigmaFrameSchema.parse(args);
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
      const validatedArgs = schemas.CompareFigmaToElementSchema.parse(args);
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
      const validatedArgs = schemas.GetFigmaSpecsSchema.parse(args);
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
      const validatedArgs = schemas.ParseFigmaUrlSchema.parse(args);
      const result = parseFigmaUrl(validatedArgs.url);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    if (name === "listFigmaPages") {
      const validatedArgs = schemas.ListFigmaPagesSchema.parse(args);
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
      const validatedArgs = schemas.SearchFigmaFramesSchema.parse(args);
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
      const validatedArgs = schemas.GetFigmaComponentsSchema.parse(args);
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
      const validatedArgs = schemas.GetFigmaStylesSchema.parse(args);
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
      const validatedArgs = schemas.GetFigmaColorPaletteSchema.parse(args);
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
      const validatedArgs = schemas.SmartFindElementSchema.parse(args);
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
      const validatedArgs = schemas.AnalyzePageSchema.parse(args);
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
      const validatedArgs = schemas.GetAllInteractiveElementsSchema.parse(args);
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
      const validatedArgs = schemas.FindElementsByTextSchema.parse(args);
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
      // Project ID will be determined from URL in browser context
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
            message: 'Recorder UI injected into page. Click \'Start\' to begin recording. Scenarios will be organized by website domain in: ~/.config/chrometools-mcp/projects/'
          } : {
            success: false,
            error: result.error
          }, null, 2)
        }]
      };
    }

    if (name === "executeScenario") {
      // Load and validate scenario first (check for collisions)
      const scenario = await loadScenario(args.name, false, args.projectId || null);

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

      // Check for name collision
      if (scenario.collision) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: scenario.message,
              availableProjectIds: scenario.availableProjectIds,
              hint: `Use: executeScenario({ name: "${args.name}", projectId: "one-of-the-above" })`
            }, null, 2)
          }]
        };
      }

      // Try to get existing page, or auto-open browser using scenario's entryUrl
      let page;
      try {
        page = await getLastOpenPage();
      } catch (error) {
        // No page is open - open browser at scenario's entry URL
        const entryUrl = scenario.metadata?.entryUrl;
        if (!entryUrl) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Scenario "${args.name}" has no entryUrl. Cannot auto-open browser. Please open a browser first or ensure scenario has entryUrl.`
              }, null, 2)
            }]
          };
        }

        // Auto-open browser at scenario's entry URL with timeout
        try {
          page = await Promise.race([
            getOrCreatePage(entryUrl),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Browser open timeout')), 30000)
            )
          ]);
        } catch (openError) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Failed to open browser: ${openError.message}`
              }, null, 2)
            }]
          };
        }
      }

      const options = {};

      // Pass executeDependencies option if provided
      if (args.executeDependencies !== undefined) {
        options.executeDependencies = args.executeDependencies;
      }

      // Pass projectId option if provided
      if (args.projectId) {
        options.projectId = args.projectId;
      }

      // Execute scenario with timeout (5 minutes max)
      let result;
      try {
        result = await Promise.race([
          executeScenario(args.name, page, args.parameters || {}, options),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Scenario execution timeout (5 minutes)')), 300000)
          )
        ]);
      } catch (executeError) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Scenario execution failed: ${executeError.message}`,
              stack: executeError.stack
            }, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }

    if (name === "listScenarios") {
      // Return ALL scenarios from all projects (URL-based organization)
      // Agent can filter by projectId, entryUrl, exitUrl as needed
      const scenarios = await listScenarios(null, true);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(scenarios, null, 2)
        }]
      };
    }

    if (name === "searchScenarios") {
      // Return ALL matching scenarios from all projects
      // Agent can filter by projectId, entryUrl, exitUrl as needed
      const results = await searchScenarios(args, null, true);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(results, null, 2)
        }]
      };
    }

    if (name === "getScenarioInfo") {
      const scenario = await loadScenario(args.name, args.includeSecrets || false, null);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(scenario, null, 2)
        }]
      };
    }

    if (name === "deleteScenario") {
      const result = await deleteScenario(args.name, null);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: result }, null, 2)
        }]
      };
    }

    if (name === "exportScenarioAsCode") {
      const scenario = await loadScenario(args.scenarioName, false, null);

      if (!scenario) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: `Scenario "${args.scenarioName}" not found`
            }, null, 2)
          }],
          isError: true
        };
      }

      // Select generator based on language
      let generator;
      const options = {
        cleanSelectors: args.cleanSelectors !== false, // default true
        includeComments: args.includeComments !== false, // default true
      };

      switch (args.language) {
        case 'playwright-typescript':
          generator = new PlaywrightTypeScriptGenerator(options);
          break;
        case 'playwright-python':
          generator = new PlaywrightPythonGenerator(options);
          break;
        case 'selenium-python':
          generator = new SeleniumPythonGenerator(options);
          break;
        case 'selenium-java':
          generator = new SeleniumJavaGenerator(options);
          break;
        default:
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Unknown language: ${args.language}. Supported: playwright-typescript, playwright-python, selenium-python, selenium-java`
              }, null, 2)
            }],
            isError: true
          };
      }

      // Generate code
      const code = generator.generate(scenario, options);

      return {
        content: [{
          type: 'text',
          text: code
        }]
      };
    }

    if (name === "generatePageObject") {
      const page = await getLastOpenPage();

      const options = {
        className: args.className || null,
        framework: args.framework || 'playwright-typescript',
        includeComments: args.includeComments !== false,
        groupElements: args.groupElements !== false
      };

      const result = await generatePageObject(page, options);

      if (result.success) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              className: result.className,
              url: result.url,
              title: result.title,
              elementCount: result.elementCount,
              framework: result.framework,
              code: result.code
            }, null, 2)
          }]
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: result.error || 'Failed to generate Page Object'
            }, null, 2)
          }],
          isError: true
        };
      }
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
    // Re-throw to be caught by outer executeToolWithTimeout wrapper
    throw error;
  }
}

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

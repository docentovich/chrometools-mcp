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
import {closeBrowser, isConnectedToExistingChrome} from './browser/browser-manager.js';
import {isWSL} from './utils/platform-utils.js';

// Import Bridge client for Chrome Extension communication (via Bridge Service)
import {
  startWebSocketServer,
  isExtensionConnected,
  getTabsFromExtension,
  getActiveTabFromExtension,
  switchTabViaExtension,
  setActiveTabSyncHandler,
  getWsDebugInfo,
  isBridgeConnected
} from './bridge/bridge-client.js';

// Import page management utilities
import {
    consoleLogs,
    getLastOpenPage,
    getOrCreatePage,
    networkRequests,
    pageAnalysisCache,
    getAndClearNewTabEvents,
    getAllPages,
    switchToPage,
    connectToTabByUrl
} from './browser/page-manager.js';

// Import image processing utilities
import {calculateSSIM, processScreenshot} from './utils/image-processing.js';

// Import CSS utilities
import {filterCssStyles} from './utils/css-utils.js';

// Import tool schemas and definitions
import * as schemas from './server/tool-schemas.js';
import {toolDefinitions} from './server/tool-definitions.js';
import {getToolsFromGroups, getAllGroupNames} from './server/tool-groups.js';

// Import element actions helper
import {executeElementAction} from './utils/element-actions.js';
// Import hints generator
import {generateClickHints, generateNavigationHints} from './utils/hints-generator.js';
// Import post-click diagnostics
import {runPostClickDiagnostics, formatDiagnosticsForAI} from './utils/post-click-diagnostics.js';

// Import Recorder modules
// Note: injectRecorder removed - now using Chrome Extension
import {executeScenario} from './recorder/scenario-executor.js';
import {deleteScenario, listScenarios, loadScenario, searchScenarios} from './recorder/scenario-storage.js';
import {generatePageObject} from './recorder/page-object-generator.js';

// Import Code Generators
import {PlaywrightTypeScriptGenerator} from './utils/code-generators/playwright-typescript.js';

// Import Input Models
import { getInputModel, RadioGroupModel, CheckboxGroupModel } from './models/index.js';
import {PlaywrightPythonGenerator} from './utils/code-generators/playwright-python.js';
import {SeleniumPythonGenerator} from './utils/code-generators/selenium-python.js';
import {SeleniumJavaGenerator} from './utils/code-generators/selenium-java.js';
import {FileAppender} from './utils/code-generators/file-appender.js';
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
    searchFigmaFrames,
    simplifyNode
} from './figma-tools.js';

// Debug mode - only use stderr for actual errors, not debug info
// MCP uses STDIO for JSON-RPC, so console.log/error breaks the protocol
const DEBUG_MODE = process.env.CHROMETOOLS_DEBUG === 'true';
const debugLog = DEBUG_MODE ? console.error : () => {};

// Figma token from environment variable (can be set in MCP config)
const FIGMA_TOKEN = process.env.FIGMA_TOKEN || null;

// Tool filtering - read ENABLED_TOOLS environment variable
// If set, only enable specified tool groups (comma-separated list)
// If not set, enable all tools (default behavior)
const ENABLED_TOOLS = process.env.ENABLED_TOOLS;
let enabledToolsSet = null;

if (ENABLED_TOOLS) {
  const groupNames = ENABLED_TOOLS.split(',').map(g => g.trim()).filter(g => g.length > 0);
  enabledToolsSet = getToolsFromGroups(groupNames);
}
// Get current directory for loading utils
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load element finder utilities
const elementFinderUtils = readFileSync(path.join(__dirname, 'element-finder-utils.js'), 'utf-8');

// Load UI framework detector utilities
const uiFrameworkDetector = readFileSync(path.join(__dirname, 'utils', 'ui-framework-detector.js'), 'utf-8');

// Load selector resolver utilities
const selectorResolver = readFileSync(path.join(__dirname, 'utils', 'selector-resolver.js'), 'utf-8');

// Load element ID generator utilities
const elementIdGenerator = readFileSync(path.join(__dirname, 'pom', 'element-id-generator.js'), 'utf-8');

// Load APOM converter utilities (legacy - flat structure)
const apomConverter = readFileSync(path.join(__dirname, 'pom', 'apom-converter.js'), 'utf-8');

// Load APOM Tree converter utilities (v2 - tree structure with positioning)
const apomTreeConverter = readFileSync(path.join(__dirname, 'pom', 'apom-tree-converter.js'), 'utf-8');

// Base storage directory in user's home folder
const BASE_STORAGE_DIR = path.join(homedir(), '.config', 'chrometools-mcp');
const GLOBAL_INDEX_PATH = path.join(BASE_STORAGE_DIR, 'index.json');
const PROJECTS_DIR = path.join(BASE_STORAGE_DIR, 'projects');

// Extension path for installation instructions
const EXTENSION_PATH = path.join(__dirname, 'extension');

/**
 * Generate extension installation instructions for AI agents
 * @returns {object} Instructions object with steps and hints
 */
function getExtensionInstallInstructions() {
  return {
    message: 'ChromeTools Extension is NOT connected. Multi-tab features are limited.',
    reason: 'Extension enables: seeing ALL tabs (including manually opened), reliable tab switching, and scenario recording.',
    installSteps: [
      '1. Open Chrome and go to: chrome://extensions/',
      '2. Enable "Developer mode" toggle (top right)',
      '3. Click "Load unpacked" button',
      `4. Select folder: ${EXTENSION_PATH}`,
      '5. Extension "ChromeTools MCP" should appear in the list',
      '6. Restart your MCP client (Claude Desktop, etc.) to reconnect'
    ],
    alternativeFix: 'Close ALL Chrome windows and restart MCP - extension will auto-load with new Chrome instance.',
    extensionPath: EXTENSION_PATH
  };
}

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
    version: "2.4.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Filter tools based on ENABLED_TOOLS environment variable
  const tools = enabledToolsSet
    ? toolDefinitions.filter(tool => enabledToolsSet.has(tool.name))
    : toolDefinitions;

  return {
    tools,
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

      // Check if extension is connected
      const extensionConnected = isExtensionConnected();
      const usedExistingChrome = isConnectedToExistingChrome();

      let extensionNote = '';
      if (!extensionConnected && usedExistingChrome) {
        const instructions = getExtensionInstallInstructions();
        extensionNote = `\n\n⚠️ EXTENSION NOT CONNECTED\nConnected to existing Chrome - extension needs manual installation.\n${instructions.installSteps.join('\n')}\n\nAlternative: ${instructions.alternativeFix}`;
      }

      return {
        content: [
          {
            type: "text",
            text: `Browser opened successfully!\nURL: ${validatedArgs.url}\nPage title: ${title}\n\nBrowser remains open for interaction.\n\n** AI HINTS **\nPage type: ${hints.pageType}\nAvailable actions: ${hints.availableActions.join(', ')}\nSuggested next: ${hints.suggestedNext.join('; ')}${extensionNote}`,
          },
        ],
      };
    }

    /**
     * Helper: Resolve selector (ID or CSS selector)
     * Injects selector-resolver and resolves element identifier
     */
    async function resolveSelector(page, identifier) {
      return await page.evaluate((id, selectorResolverCode) => {
        // Inject selector resolver if not already loaded
        if (typeof resolveSelector === 'undefined') {
          eval(selectorResolverCode);
        }

        const resolved = resolveSelector(id);
        return {
          selector: resolved.selector,
          isPageObjectId: resolved.isPageObjectId,
          found: document.querySelector(resolved.selector) !== null
        };
      }, identifier, selectorResolver);
    }

    if (name === "click") {
      const validatedArgs = schemas.ClickSchema.parse(args);
      const page = await getLastOpenPage();
      const timeout = validatedArgs.timeout || 30000;

      // Wrap operation in timeout
      const clickOperation = async () => {
        // Get identifier (id or selector)
        const identifier = validatedArgs.id || validatedArgs.selector;

        // Resolve selector (supports both APOM ID and CSS selector)
        const resolved = await resolveSelector(page, identifier);
        if (!resolved.found) {
          throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
        }

        const element = await page.$(resolved.selector);
        if (!element) {
          throw new Error(`Element not found: ${identifier}`);
        }

        // Capture timestamp BEFORE click for error filtering
        const beforeClickTimestamp = Date.now();

        // Try multiple click methods for better reliability
        try {
          // Method 1: Puppeteer click (most reliable for most cases)
          await element.click();
        } catch (clickError) {
          // Method 2: Scroll into view and try again
          try {
            await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
            await new Promise(resolve => setTimeout(resolve, 100));
            await element.click();
          } catch (scrollClickError) {
            // Method 3: JavaScript click (works for hidden/overlapping elements)
            await element.evaluate(el => el.click());
          }
        }

        // NEW POST-CLICK PATTERN:
        // 1. Run post-click diagnostics (waits 500ms, checks pending requests, collects errors)
        const diagnostics = await runPostClickDiagnostics(page, beforeClickTimestamp);

        // 2. Generate AI hints after click
        const hints = await generateClickHints(page, identifier);

        // 3. Format output with hints and diagnostics
        let hintsText = '\n\n** AI HINTS **';
        if (hints.modalOpened) hintsText += '\nModal opened - interact with it or close';
        if (hints.newElements.length > 0) {
          hintsText += `\nNew elements appeared: ${hints.newElements.map(e => e.type).join(', ')}`;
        }
        if (hints.suggestedNext.length > 0) {
          hintsText += `\nSuggested next: ${hints.suggestedNext.join('; ')}`;
        }

        // 4. Add diagnostics to output
        const diagnosticsText = formatDiagnosticsForAI(diagnostics);

        const content = [
          { type: "text", text: `Clicked: ${identifier}${hintsText}${diagnosticsText}` }
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

      // Get identifier (id or selector)
      const identifier = validatedArgs.id || validatedArgs.selector;

      // Resolve selector (supports both APOM ID and CSS selector)
      const resolved = await resolveSelector(page, identifier);
      if (!resolved.found) {
        throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
      }

      const element = await page.$(resolved.selector);
      if (!element) {
        throw new Error(`Element not found: ${identifier}`);
      }

      // Use input model to handle the element appropriately
      const model = await getInputModel(element, page);
      const options = {
        delay: validatedArgs.delay !== undefined ? validatedArgs.delay : 30,
        clearFirst: validatedArgs.clearFirst !== undefined ? validatedArgs.clearFirst : true,
      };

      await model.setValue(validatedArgs.text, options);
      const description = model.getActionDescription(validatedArgs.text, identifier);

      return {
        content: [
          { type: "text", text: description }
        ],
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

      // Get identifier (id or selector)
      const identifier = validatedArgs.id || validatedArgs.selector;

      // Resolve selector (supports both APOM ID and CSS selector)
      const resolved = await resolveSelector(page, identifier);
      if (!resolved.found) {
        throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
      }

      const element = await page.$(resolved.selector);
      if (!element) {
        throw new Error(`Element not found: ${identifier}`);
      }

      await element.hover();
      await new Promise(resolve => setTimeout(resolve, 100));

      return {
        content: [{
          type: "text",
          text: `Hovered over: ${identifier}`
        }],
      };
    }

    if (name === "selectOption") {
      const validatedArgs = schemas.SelectOptionSchema.parse(args);
      const page = await getLastOpenPage();

      // Get identifier (id or selector)
      const identifier = validatedArgs.id || validatedArgs.selector;

      // Resolve selector (supports both APOM ID and CSS selector)
      const resolved = await resolveSelector(page, identifier);
      if (!resolved.found) {
        throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
      }

      // Select option with priority: value > text > index
      const result = await page.evaluate((selector, value, text, index) => {
        const selectElement = document.querySelector(selector);
        if (!selectElement || selectElement.tagName !== 'SELECT') {
          return { success: false, error: `Select element not found: ${selector}` };
        }

        let selectedOption = null;

        // Priority 1: Select by value
        if (value !== undefined && value !== null) {
          const option = Array.from(selectElement.options).find(opt => opt.value === value);
          if (option) {
            selectElement.value = value;
            selectedOption = option;
          }
        }

        // Priority 2: Select by text
        if (!selectedOption && text !== undefined && text !== null) {
          const option = Array.from(selectElement.options).find(opt => opt.textContent.trim() === text);
          if (option) {
            selectElement.value = option.value;
            selectedOption = option;
          }
        }

        // Priority 3: Select by index
        if (!selectedOption && index !== undefined && index !== null) {
          if (index >= 0 && index < selectElement.options.length) {
            selectElement.selectedIndex = index;
            selectedOption = selectElement.options[index];
          }
        }

        if (!selectedOption) {
          return { success: false, error: 'No matching option found' };
        }

        // Trigger events for React and other frameworks
        selectElement.dispatchEvent(new Event('input', { bubbles: true }));
        selectElement.dispatchEvent(new Event('change', { bubbles: true }));

        return {
          success: true,
          selectedValue: selectElement.value,
          selectedText: selectedOption.textContent.trim(),
          selectedIndex: selectElement.selectedIndex
        };
      }, resolved.selector, validatedArgs.value, validatedArgs.text, validatedArgs.index);

      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        content: [{
          type: "text",
          text: `Selected option in ${identifier}:\n` +
                `  Value: ${result.selectedValue}\n` +
                `  Text: ${result.selectedText}\n` +
                `  Index: ${result.selectedIndex}`
        }],
      };
    }

    if (name === "drag") {
      const validatedArgs = schemas.DragSchema.parse(args);
      const page = await getLastOpenPage();

      const distance = validatedArgs.distance || 100;
      const duration = validatedArgs.duration || 500;

      // Calculate drag deltas based on direction
      let deltaX = 0;
      let deltaY = 0;

      switch (validatedArgs.direction) {
        case 'up':
          deltaY = -distance;
          break;
        case 'down':
          deltaY = distance;
          break;
        case 'left':
          deltaX = -distance;
          break;
        case 'right':
          deltaX = distance;
          break;
        case 'up-left':
          deltaY = -distance;
          deltaX = -distance;
          break;
        case 'up-right':
          deltaY = -distance;
          deltaX = distance;
          break;
        case 'down-left':
          deltaY = distance;
          deltaX = -distance;
          break;
        case 'down-right':
          deltaY = distance;
          deltaX = distance;
          break;
      }

      // Get element center position for drag start
      const elementInfo = await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return { success: false, error: `Element not found: ${selector}` };
        }

        const rect = element.getBoundingClientRect();
        return {
          success: true,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height
        };
      }, validatedArgs.selector);

      if (!elementInfo.success) {
        throw new Error(elementInfo.error);
      }

      // Perform drag: mousedown → mousemove → mouseup
      const startX = elementInfo.centerX;
      const startY = elementInfo.centerY;
      const endX = startX + deltaX;
      const endY = startY + deltaY;

      // Move to start position
      await page.mouse.move(startX, startY);

      // Press mouse button (start drag)
      await page.mouse.down();

      // Wait a bit to ensure drag is registered
      await new Promise(resolve => setTimeout(resolve, 50));

      // Move mouse to end position (drag)
      const steps = Math.max(10, Math.floor(duration / 20)); // Smooth movement
      await page.mouse.move(endX, endY, { steps });

      // Wait for duration
      await new Promise(resolve => setTimeout(resolve, Math.max(0, duration - steps * 20)));

      // Release mouse button (end drag)
      await page.mouse.up();

      return {
        content: [{
          type: "text",
          text: `Dragged ${validatedArgs.selector} ${validatedArgs.direction} by ${distance}px:\n` +
                `  Start position: (${Math.round(startX)}, ${Math.round(startY)})\n` +
                `  End position: (${Math.round(endX)}, ${Math.round(endY)})\n` +
                `  Delta: (${deltaX}px, ${deltaY}px)\n` +
                `  Duration: ${duration}ms`
        }],
      };
    }

    if (name === "scrollHorizontal") {
      const validatedArgs = schemas.ScrollHorizontalSchema.parse(args);
      const page = await getLastOpenPage();

      const behavior = validatedArgs.behavior || 'auto';

      const result = await page.evaluate((selector, direction, amount, behavior) => {
        const element = document.querySelector(selector);
        if (!element) {
          return { success: false, error: `Element not found: ${selector}` };
        }

        // Determine scroll amount
        let scrollAmount;
        if (amount === 'full') {
          // Scroll to the end
          scrollAmount = direction === 'right'
            ? element.scrollWidth - element.clientWidth
            : 0;
        } else {
          // Relative scroll
          scrollAmount = direction === 'right'
            ? element.scrollLeft + amount
            : element.scrollLeft - amount;
        }

        // Perform scroll
        element.scrollTo({
          left: scrollAmount,
          behavior: behavior
        });

        // Wait a bit for scroll to complete (if smooth)
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              success: true,
              scrollLeft: element.scrollLeft,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              canScrollRight: element.scrollLeft < (element.scrollWidth - element.clientWidth),
              canScrollLeft: element.scrollLeft > 0
            });
          }, behavior === 'smooth' ? 300 : 50);
        });
      }, validatedArgs.selector, validatedArgs.direction, validatedArgs.amount, behavior);

      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        content: [{
          type: "text",
          text: `Scrolled ${validatedArgs.selector} ${validatedArgs.direction}:\n` +
                `  Scroll position: ${result.scrollLeft}px\n` +
                `  Total width: ${result.scrollWidth}px\n` +
                `  Visible width: ${result.clientWidth}px\n` +
                `  Can scroll right: ${result.canScrollRight}\n` +
                `  Can scroll left: ${result.canScrollLeft}`
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

      // Auto-open browser if no page is open (instead of throwing error)
      let page;
      let browserOpened = false;
      try {
        page = await getLastOpenPage();
      } catch (e) {
        // No page open - create one automatically
        page = await getOrCreatePage(validatedArgs.url);
        browserOpened = true;
      }

      // Navigate to the new URL (skip if we just created page with this URL)
      if (!browserOpened) {
        await page.goto(validatedArgs.url, { waitUntil: validatedArgs.waitUntil || 'networkidle2' });
      }

      const title = await page.title();

      // Generate AI hints
      const hints = await generateNavigationHints(page, validatedArgs.url);

      const message = browserOpened
        ? `Browser opened and navigated to: ${validatedArgs.url}`
        : `Navigated to: ${validatedArgs.url}`;

      return {
        content: [{
          type: "text",
          text: `${message}\nPage title: ${title}\n\n** AI HINTS **\nPage type: ${hints.pageType}\nAvailable actions: ${hints.availableActions.join(', ')}\nSuggested next: ${hints.suggestedNext.join('; ')}`
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

    if (name === "convertFigmaToCode") {
      const validatedArgs = schemas.ConvertFigmaToCodeSchema.parse(args);
      const token = validatedArgs.figmaToken || FIGMA_TOKEN;
      if (!token) {
        throw new Error('Figma token is required. Pass it as parameter or set FIGMA_TOKEN environment variable in MCP config.');
      }

      // Normalize node ID
      const nodeId = normalizeFigmaNodeId(validatedArgs.nodeId);
      const framework = validatedArgs.framework || 'react';
      const includeComments = validatedArgs.includeComments !== false; // default true

      // Fetch node structure
      const nodesData = await fetchFigmaAPI(
        `files/${validatedArgs.fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
        token
      );

      if (!nodesData.nodes || !nodesData.nodes[nodeId]) {
        throw new Error(`Node ${nodeId} not found in Figma file ${validatedArgs.fileKey}`);
      }

      // Fetch rendered image at 2x scale
      const exportData = await fetchFigmaAPI(
        `images/${validatedArgs.fileKey}?ids=${nodeId}&scale=2&format=png`,
        token
      );

      if (!exportData.images || !exportData.images[nodeId]) {
        throw new Error(`Failed to export image for node ${nodeId}`);
      }

      const imageUrl = exportData.images[nodeId];

      // Simplify node structure
      const nodeInfo = nodesData.nodes[nodeId];
      const simplifiedNode = simplifyNode(nodeInfo.document);

      // Build AI instruction based on framework
      const frameworkInstructions = {
        'react': 'React (JavaScript) with Tailwind CSS',
        'react-typescript': 'React (TypeScript) with Tailwind CSS',
        'html': 'Pure HTML with Tailwind CSS classes'
      };

      const instruction = `# Figma to Code Conversion

## Design Image
![Design](${imageUrl})

## Task
Convert this Figma design to ${frameworkInstructions[framework]}.

## Design Structure (Simplified)
\`\`\`json
${JSON.stringify(simplifiedNode, null, 2)}
\`\`\`

## Instructions

### Framework: ${framework.toUpperCase()}
${framework.startsWith('react') ? `
- Create a functional React component
- Use Tailwind CSS for all styling
- Props: Accept any necessary data as props
- Use semantic HTML elements (div, section, button, h1-h6, p, etc.)
${framework === 'react-typescript' ? '- Add TypeScript type definitions for props' : ''}
` : `
- Create clean, semantic HTML structure
- Use Tailwind CSS classes for styling
- No JavaScript required unless interactive elements present
`}

### Styling Guidelines
1. **Colors**: Convert RGB values to Tailwind colors or use arbitrary values: \`bg-[rgb(r,g,b)]\`
2. **Spacing**: Use Tailwind spacing scale (p-4, m-2, gap-4) matching design padding/gaps
3. **Layout**:
   - HORIZONTAL → \`flex flex-row\`
   - VERTICAL → \`flex flex-col\`
   - Use \`justify-*\` and \`items-*\` for alignment
4. **Typography**: Match font families, weights, sizes from textStyle properties
5. **Border Radius**: \`rounded-[Npx]\` for exact values
6. **Shadows**: Use Tailwind shadow utilities or arbitrary values
7. **Responsive**: Add responsive variants if design suggests multiple breakpoints

### Quality Requirements
- **Clean code**: No unnecessary divs, proper semantic structure
- **Accurate spacing**: Match design padding, gaps, and margins
- **Proper hierarchy**: Respect component nesting from design structure
${includeComments ? '- **Comments**: Add brief comments explaining complex layout decisions' : ''}
- **Accessibility**: Use proper ARIA labels where needed

### Output Format
Return ONLY the code, no explanations. ${framework.startsWith('react') ? 'Export the component as default.' : 'Provide complete HTML structure.'}

Start coding now.`;

      return {
        content: [{
          type: "text",
          text: instruction
        }],
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

      // APOM Tree format (default) - v2 with tree structure and positioning
      const apomResult = await page.evaluate((apomTreeConverterCode, selectorResolverCode, shouldRegister, includeAll) => {
        // Inject utilities
        eval(apomTreeConverterCode);
        eval(selectorResolverCode);

        // Build APOM tree
        // interactiveOnly = !includeAll (if includeAll is true, we want ALL elements)
        const apomData = buildAPOMTree(!includeAll);

        // Register elements in selector resolver if requested
        if (shouldRegister) {
          // Flatten tree to get all elements for registration
          const elementsArray = [];

          function collectElements(node) {
            if (!node) return;

            elementsArray.push({
              id: node.id,
              selector: node.selector,
              metadata: {
                type: node.type,
                tag: node.tag,
                position: node.position
              }
            });

            if (node.children) {
              node.children.forEach(child => collectElements(child));
            }
          }

          collectElements(apomData.tree);

          if (typeof registerElements !== 'undefined') {
            registerElements(elementsArray);
          }
        }

        return apomData;
      }, apomTreeConverter, selectorResolver, validatedArgs.registerElements !== false, validatedArgs.includeAll || false);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(apomResult)
        }]
      };
    }

    if (name === "getElementDetails") {
      const validatedArgs = schemas.GetElementDetailsSchema.parse(args);
      const page = await getLastOpenPage();

      const result = await page.evaluate((elementId, selectorResolverCode, apomTreeConverterCode, analyzeChildren, includeAll) => {
        // Inject selector resolver if not loaded
        if (typeof resolveSelector === 'undefined') {
          eval(selectorResolverCode);
        }

        // Inject APOM tree converter utilities
        if (typeof buildAPOMTree === 'undefined') {
          eval(apomTreeConverterCode);
        }

        // Resolve APOM ID to selector
        const resolved = resolveSelector(elementId);

        if (!resolved.isPageObjectId) {
          return {
            success: false,
            error: `Element ID "${elementId}" is not registered. Did you call analyzePage first?`,
            hint: "Use analyzePage to register all elements, or provide a valid APOM ID"
          };
        }

        const element = document.querySelector(resolved.selector);

        if (!element) {
          return {
            success: false,
            error: `Element with ID "${elementId}" was found in registry but not in DOM`,
            selector: resolved.selector
          };
        }

        // Get element details with full information
        const rect = element.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(element);

        const details = {
          success: true,
          id: elementId,
          selector: resolved.selector,
          tag: element.tagName.toLowerCase(),
          type: resolved.metadata.type || 'unknown',
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left)
          },
          position: resolved.metadata.position || null,
          visible: element.offsetWidth > 0 && element.offsetHeight > 0,
          text: element.textContent?.trim() || '',
          value: element.value || null,
          attributes: {
            id: element.id || null,
            class: element.className || null,
            name: element.getAttribute('name') || null,
            placeholder: element.getAttribute('placeholder') || null,
            disabled: element.hasAttribute('disabled'),
            required: element.hasAttribute('required'),
            readonly: element.hasAttribute('readonly'),
            href: element.getAttribute('href') || null,
            src: element.getAttribute('src') || null,
            type: element.getAttribute('type') || null,
            role: element.getAttribute('role') || null,
            ariaLabel: element.getAttribute('aria-label') || null
          },
          computed: {
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            zIndex: computedStyle.zIndex,
            position: computedStyle.position,
            cursor: computedStyle.cursor,
            backgroundColor: computedStyle.backgroundColor,
            color: computedStyle.color,
            fontSize: computedStyle.fontSize,
            fontWeight: computedStyle.fontWeight
          },
          metadata: resolved.metadata || {}
        };

        // If analyzeChildren is true, add children tree structure
        if (analyzeChildren) {
          try {
            const pageId = `element_${elementId}_${Date.now()}`;

            // Call buildAPOMTree with the element as root
            const fullAnalysis = buildAPOMTree(!includeAll, false);

            // Find the node in the tree that matches our element ID
            function findNodeById(node, targetId) {
              if (!node) return null;
              if (node.id === targetId) return node;
              if (node.children) {
                for (const child of node.children) {
                  const found = findNodeById(child, targetId);
                  if (found) return found;
                }
              }
              return null;
            }

            const targetNode = findNodeById(fullAnalysis.tree, elementId);

            if (targetNode) {
              details.childrenTree = {
                pageId,
                url: window.location.href,
                title: document.title,
                timestamp: Date.now(),
                rootElementId: elementId,
                tree: targetNode,
                metadata: fullAnalysis.metadata
              };
            } else {
              details.childrenTree = {
                success: false,
                error: `Could not find element "${elementId}" in analysis tree`
              };
            }
          } catch (err) {
            details.childrenTree = {
              success: false,
              error: `Failed to analyze children: ${err.message}`
            };
          }
        }

        return details;
      }, validatedArgs.id, selectorResolver, apomTreeConverter, validatedArgs.analyzeChildren || false, validatedArgs.includeAll || false);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
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

    if (name === "selectFromGroup") {
      const validatedArgs = schemas.SelectFromGroupSchema.parse(args);
      const page = await getLastOpenPage();

      const groupName = validatedArgs.name;
      const by = validatedArgs.by || 'auto';
      const mode = validatedArgs.mode || 'set';

      // Determine group type (radio or checkbox)
      const groupType = await page.evaluate((name) => {
        const radioInputs = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
        const checkboxInputs = document.querySelectorAll(`input[type="checkbox"][name="${name}"]`);

        if (radioInputs.length > 0) return 'radio';
        if (checkboxInputs.length > 0) return 'checkbox';
        return null;
      }, groupName);

      if (!groupType) {
        throw new Error(`No radio or checkbox group found with name "${groupName}"`);
      }

      let result;

      if (groupType === 'radio') {
        // Radio group - single selection
        const model = new RadioGroupModel(groupName, page);
        const valueToSelect = validatedArgs.value || validatedArgs.text;

        if (!valueToSelect) {
          throw new Error('Radio group requires "value" or "text" parameter');
        }

        result = await model.setValue(valueToSelect, { by });
        result.groupType = 'radio';
        result.groupName = groupName;

      } else {
        // Checkbox group - multi selection
        const model = new CheckboxGroupModel(groupName, page);

        // Collect values to select
        let valuesToSelect = [];
        if (validatedArgs.values) {
          valuesToSelect = validatedArgs.values;
        } else if (validatedArgs.texts) {
          valuesToSelect = validatedArgs.texts;
        } else if (validatedArgs.value) {
          valuesToSelect = [validatedArgs.value];
        } else if (validatedArgs.text) {
          valuesToSelect = [validatedArgs.text];
        }

        if (valuesToSelect.length === 0) {
          throw new Error('Checkbox group requires "value", "values", "text", or "texts" parameter');
        }

        result = await model.setValue(valuesToSelect, { mode, by });
        result.groupType = 'checkbox';
        result.groupName = groupName;
        result.mode = mode;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }

    if (name === "enableRecorder") {
      // Check if extension is connected
      const extensionConnected = isExtensionConnected();
      const debugInfo = getWsDebugInfo();

      if (extensionConnected) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'ChromeTools Extension is connected. Use startRecording/stopRecording tools to control recording programmatically.',
              extensionConnected: true,
              debugInfo
            }, null, 2)
          }]
        };
      } else {
        const instructions = getExtensionInstallInstructions();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ChromeTools Extension is not connected. Recording requires the extension.',
              extensionConnected: false,
              debugInfo,
              ...instructions
            }, null, 2)
          }]
        };
      }
    }

    if (name === "startRecording") {
      const extensionConnected = isExtensionConnected();

      if (!extensionConnected) {
        const instructions = getExtensionInstallInstructions();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ChromeTools Extension is not connected. Recording requires the extension.',
              extensionConnected: false,
              ...instructions
            }, null, 2)
          }]
        };
      }

      // Send start recording command to extension via Bridge
      const { sendExtensionCommand } = await import('./bridge/bridge-client.js');
      const result = await sendExtensionCommand({
        type: 'recorder_start',
        payload: {
          name: args.name || '',
          description: args.description || '',
          tags: args.tags || []
        }
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Recording started. Perform actions in the browser, then use stopRecording to finish.',
            ...result
          }, null, 2)
        }]
      };
    }

    if (name === "stopRecording") {
      const extensionConnected = isExtensionConnected();

      if (!extensionConnected) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ChromeTools Extension is not connected.',
              extensionConnected: false
            }, null, 2)
          }]
        };
      }

      // Send stop recording command to extension via Bridge
      const { sendExtensionCommand } = await import('./bridge/bridge-client.js');
      const result = await sendExtensionCommand({
        type: 'recorder_stop'
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Recording stopped.',
            actions: result.actions || [],
            secrets: result.secrets || {},
            actionCount: result.actions?.length || 0
          }, null, 2)
        }]
      };
    }

    if (name === "getRecorderState") {
      const extensionConnected = isExtensionConnected();

      if (!extensionConnected) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ChromeTools Extension is not connected.',
              extensionConnected: false
            }, null, 2)
          }]
        };
      }

      // Query recorder state from extension via Bridge
      const { sendExtensionCommand } = await import('./bridge/bridge-client.js');
      const result = await sendExtensionCommand({
        type: 'recorder_get_state'
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            ...result
          }, null, 2)
        }]
      };
    }

    if (name === "saveScenario") {
      const { saveScenario } = await import('./recorder/scenario-storage.js');

      const scenario = {
        name: args.name,
        description: args.description || '',
        tags: args.tags || [],
        actions: args.actions || [],
        secrets: args.secrets || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        const result = await saveScenario(scenario, lastPage.url());
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Scenario "${args.name}" saved successfully.`,
              scenarioPath: result.path
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          }]
        };
      }
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

      // Check if current page URL matches scenario's entryUrl
      // If not, navigate to entryUrl before executing scenario
      const entryUrl = scenario.metadata?.entryUrl;
      if (entryUrl) {
        try {
          const currentUrl = page.url();

          // Normalize URLs for comparison (remove trailing slashes, hash, some query params)
          const normalizeUrl = (url) => {
            try {
              const urlObj = new URL(url);
              // Keep protocol, hostname, pathname - ignore some query params like nr, redirect_ts
              return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`.replace(/\/$/, '');
            } catch (e) {
              return url;
            }
          };

          const normalizedCurrent = normalizeUrl(currentUrl);
          const normalizedEntry = normalizeUrl(entryUrl);

          if (normalizedCurrent !== normalizedEntry) {
            console.error(`[executeScenario] Current URL (${currentUrl}) doesn't match scenario entryUrl (${entryUrl})`);
            console.error(`[executeScenario] Navigating to entryUrl...`);

            await page.goto(entryUrl, {
              waitUntil: 'networkidle2',
              timeout: 30000
            });

            console.error(`[executeScenario] Navigation completed`);
          }
        } catch (navError) {
          console.error(`[executeScenario] Warning: Failed to navigate to entryUrl: ${navError.message}`);
          // Continue anyway - scenario might still work
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

    if (name === "appendScenarioToFile") {
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

      try {
        // Generate test code only (without imports)
        const testOnly = generator.generateTestOnly(scenario, {
          ...options,
          testName: args.testName
        });

        // Prepare append options for Claude Code
        const appendOptions = {
          insertPosition: args.insertPosition || 'end',
          referenceTestName: args.referenceTestName
        };

        // Generate Page Object if requested
        let pageObjectData = null;
        if (args.generatePageObject) {
          try {
            const entryUrl = scenario.metadata?.entryUrl;
            if (entryUrl) {
              let page;
              try {
                page = await getLastOpenPage();
                const currentUrl = page.url();
                if (currentUrl !== entryUrl) {
                  await page.goto(entryUrl, { waitUntil: 'networkidle2' });
                }
              } catch (error) {
                page = await getOrCreatePage(entryUrl);
              }

              const pageObjectOptions = {
                className: args.pageObjectClassName || null,
                framework: args.language,
                includeComments: args.includeComments !== false,
                groupElements: true
              };

              const pageObjectResult = await generatePageObject(page, pageObjectOptions);
              if (pageObjectResult.success) {
                // Suggest filename based on className
                const extension = args.language.includes('typescript') ? '.ts' :
                                 args.language.includes('java') ? '.java' : '.py';
                pageObjectData = {
                  code: pageObjectResult.code,
                  className: pageObjectResult.className,
                  suggestedFileName: `${pageObjectResult.className}${extension}`,
                  elementCount: pageObjectResult.elementCount
                };
              }
            }
          } catch (error) {
            // Page Object generation failed, continue without it
          }
        }

        // Return JSON with instructions for Claude Code to append the test
        const result = {
          action: 'append_test',
          targetFile: args.targetFile,
          testCode: testOnly,  // Only test code, no imports
          testName: args.testName || scenario.metadata?.name,
          insertPosition: appendOptions.insertPosition,
          referenceTestName: appendOptions.referenceTestName,
          instruction: `Read file '${args.targetFile}', append the testCode at position '${appendOptions.insertPosition}', then write the file back.`
        };

        if (pageObjectData) {
          result.pageObject = pageObjectData;
          result.instruction += ` Also create a Page Object file '${pageObjectData.suggestedFileName}' with the provided pageObject.code.`;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              action: 'append_test',
              targetFile: args.targetFile
            }, null, 2)
          }],
          isError: true
        };
      }
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

      // Generate test code with full imports
      const testCode = generator.generate(scenario, options);

      // Generate suggested filename
      const testName = scenario.metadata?.name || 'test';
      const extension = args.language.includes('typescript') ? '.spec.ts' :
                       args.language.includes('java') ? 'Test.java' :
                       args.language.includes('python') ? '_test.py' : '.test.js';
      const suggestedFileName = args.language.includes('java')
        ? testName.charAt(0).toUpperCase() + testName.slice(1) + 'Test.java'
        : testName.replace(/\s+/g, '_').toLowerCase() + extension;

      // If generatePageObject is requested, also generate Page Object class
      if (args.generatePageObject) {
        try {
          // Get page - need to open at scenario's entry URL
          let page;
          const entryUrl = scenario.metadata?.entryUrl;

          if (!entryUrl) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'Cannot generate Page Object: scenario has no entryUrl in metadata'
                }, null, 2)
              }],
              isError: true
            };
          }

          // Try to get existing page or open new one
          try {
            page = await getLastOpenPage();
            // Navigate to entry URL if current page is different
            const currentUrl = page.url();
            if (currentUrl !== entryUrl) {
              await page.goto(entryUrl, { waitUntil: 'networkidle2' });
            }
          } catch (error) {
            // No page open, create new one
            page = await getOrCreatePage(entryUrl);
          }

          // Generate Page Object
          const pageObjectOptions = {
            className: args.pageObjectClassName || null,
            framework: args.language, // Use same framework as test
            includeComments: args.includeComments !== false,
            groupElements: true
          };

          const pageObjectResult = await generatePageObject(page, pageObjectOptions);

          if (pageObjectResult.success) {
            // Suggest Page Object filename
            const poExtension = args.language.includes('typescript') ? '.ts' :
                               args.language.includes('java') ? '.java' : '.py';
            const pageObjectFileName = `${pageObjectResult.className}${poExtension}`;

            // Return both test code and Page Object code
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  action: 'create_new_file',
                  suggestedFileName: suggestedFileName,
                  testCode: testCode,
                  pageObject: {
                    code: pageObjectResult.code,
                    className: pageObjectResult.className,
                    suggestedFileName: pageObjectFileName,
                    elementCount: pageObjectResult.elementCount
                  },
                  instruction: `Create a new test file '${suggestedFileName}' with the testCode. Also create a Page Object file '${pageObjectFileName}' with the pageObject.code.`
                }, null, 2)
              }]
            };
          } else {
            // Page Object generation failed, return test code only with warning
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  action: 'create_new_file',
                  suggestedFileName: suggestedFileName,
                  testCode: testCode,
                  warning: 'Page Object generation failed: ' + (pageObjectResult.error || 'Unknown error'),
                  instruction: `Create a new test file '${suggestedFileName}' with the testCode.`
                }, null, 2)
              }]
            };
          }
        } catch (error) {
          // Page Object generation failed, return test code only with error
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                action: 'create_new_file',
                suggestedFileName: suggestedFileName,
                testCode: testCode,
                warning: 'Page Object generation error: ' + error.message,
                instruction: `Create a new test file '${suggestedFileName}' with the testCode.`
              }, null, 2)
            }]
          };
        }
      }

      // Default: return test code only
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            action: 'create_new_file',
            suggestedFileName: suggestedFileName,
            testCode: testCode,
            instruction: `Create a new test file '${suggestedFileName}' with the testCode.`
          }, null, 2)
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

    // Tab management tools
    if (name === "listTabs") {
      // Prefer extension tabs if connected (sees ALL tabs including manually opened)
      let tabs = [];
      let source = 'puppeteer';

      if (isExtensionConnected()) {
        const extTabs = getTabsFromExtension();
        if (extTabs.length > 0) {
          tabs = extTabs.map((t, index) => ({
            index,
            url: t.url,
            title: t.title,
            isActive: t.active
          }));
          source = 'extension';
        }
      }

      // Fallback to Puppeteer if extension not connected or has no tabs
      if (tabs.length === 0) {
        const pages = await getAllPages();
        tabs = pages.map((p, index) => ({
          index,
          url: p.url,
          title: p.title,
          isActive: p.isActive
        }));
      }

      const newTabEvts = getAndClearNewTabEvents();
      const extensionConnected = isExtensionConnected();

      const result = {
        tabs,
        totalCount: tabs.length,
        source,
        extensionConnected
      };

      // Include new tab notifications if any
      if (newTabEvts.length > 0) {
        result.newTabsDetected = newTabEvts;
      }

      // Add installation instructions if extension not connected
      if (!extensionConnected) {
        result.extensionNotConnected = getExtensionInstallInstructions();
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }

    if (name === "switchTab") {
      const validatedArgs = schemas.SwitchTabSchema.parse(args);

      // Try extension first if connected
      if (isExtensionConnected()) {
        const tab = switchTabViaExtension(validatedArgs.tab);
        if (tab) {
          // Also connect Puppeteer to this tab for analyzePage etc.
          const page = await connectToTabByUrl(tab.url);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                switchedTo: {
                  url: tab.url,
                  title: tab.title
                },
                message: `Switched to tab: ${tab.title || tab.url}`,
                source: 'extension',
                puppeteerConnected: !!page
              }, null, 2)
            }]
          };
        }
      }

      // Fallback to Puppeteer
      const page = await switchToPage(validatedArgs.tab);

      const url = page.url();
      const title = await page.title().catch(() => '');

      const result = {
        success: true,
        switchedTo: {
          url,
          title
        },
        message: `Switched to tab: ${title || url}`,
        source: 'puppeteer',
        extensionConnected: false
      };

      // Add note about extension benefits
      if (!isExtensionConnected()) {
        result.note = 'Using Puppeteer fallback. Install ChromeTools Extension to see ALL tabs (including manually opened).';
        result.extensionInstall = getExtensionInstallInstructions();
      }

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
    // Re-throw to be caught by outer executeToolWithTimeout wrapper
    throw error;
  }
}

// CLI argument handling
async function handleCLIArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--install-bridge')) {
    const { installBridge } = await import('./bridge/install.js');
    const result = await installBridge();
    process.exit(result.success ? 0 : 1);
  }

  if (args.includes('--uninstall-bridge')) {
    const { uninstallBridge } = await import('./bridge/install.js');
    const result = await uninstallBridge();
    process.exit(result.success ? 0 : 1);
  }

  if (args.includes('--check-bridge')) {
    const { isBridgeInstalled } = await import('./bridge/install.js');
    const installed = isBridgeInstalled();
    console.log(installed ? 'Bridge is installed' : 'Bridge is NOT installed');
    process.exit(installed ? 0 : 1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
chrometools-mcp - MCP server for Chrome automation

Usage: npx chrometools-mcp [options]

Options:
  --install-bridge    Install Native Messaging Bridge (required for extension)
  --uninstall-bridge  Uninstall Native Messaging Bridge
  --check-bridge      Check if Bridge is installed
  --help, -h          Show this help message

Environment variables:
  CHROMETOOLS_DEBUG=true   Enable debug logging
  ENABLED_TOOLS=group1,..  Enable only specified tool groups
  FIGMA_TOKEN=xxx          Figma API token for Figma tools
`);
    process.exit(0);
  }

  // Continue to main server
  return false;
}

// Start server
async function main() {
  // Handle CLI arguments first
  await handleCLIArgs();

  console.error("Starting chrometools-mcp server...");

  // Show environment info
  if (isWSL) {
    console.error("[chrometools-mcp] WSL environment detected");
    console.error("[chrometools-mcp] GUI mode requires X server (DISPLAY=" + (process.env.DISPLAY || "not set") + ")");
  }

  // Connect to Bridge Service (if running)
  await startWebSocketServer();

  // Register handler for syncing active tab when user switches tabs
  setActiveTabSyncHandler(connectToTabByUrl);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("chrometools-mcp server running on stdio");
  console.error("Browser will be initialized on first openBrowser call");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

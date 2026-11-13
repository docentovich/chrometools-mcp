#!/usr/bin/env node

import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {CallToolRequestSchema, ListToolsRequestSchema,} from "@modelcontextprotocol/sdk/types.js";
import Jimp from "jimp";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import path, {dirname} from 'path';
import {fileURLToPath} from 'url';
import {homedir} from 'os';

// Import browser and platform utilities
import {closeBrowser, getBrowser, isConnectedToExistingChrome, resetBrowserConnection} from './browser/browser-manager.js';
import * as vaultClient from './utils/vault-client.js';
import {randomUUID} from 'crypto';
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
    connectToTabByUrl,
    getNetworkCDPClient,
    getTargetFrame,
    setActiveFrame,
    clearActiveFrame,
    getActiveFrameMatcher,
    listFramesForPage,
    setRequestedViewport,
    ensureViewport,
    formatViewportNote,
    openPages,
    takeRecoveryNote,
    resetPageState,
    isDeadPageError
} from './browser/page-manager.js';
import * as pageState from './browser/page-manager.js';
import {waitForSpaSettle} from './utils/spa-settle.js';
import {compactTree} from './utils/figma-tree.js';
import {fontReport} from './utils/platform-fonts.js';
import {compareSpecs} from './utils/spec-compare.js';
import {
    createFigmaContext,
    formatSourceLine,
    getNodes as getFigmaNodes,
    getImages as getFigmaImages,
    getFile as getFigmaFileData,
    peekNode as peekFigmaNode,
    cachedFileName as cachedFigmaFileName,
    loadNodeFromFile as loadFigmaNodeFromFile,
    findFigmaNode,
    prefetch as prefetchFigmaData,
    cacheStatus as figmaCacheStatus,
    cacheClear as figmaCacheClear,
    importNodesFile as importFigmaNodesFile,
    importRenderFile as importFigmaRenderFile
} from './utils/figma-data.js';

// Import image processing utilities
import {compareImages, processScreenshot} from './utils/image-processing.js';
import {capture, withHiddenElements} from './utils/capture.js';

// Import CSS utilities
import {filterCssStyles, CSS_CATEGORIES} from './utils/css-utils.js';

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

// Import Input Models (Puppeteer-based)
import { getInputModel, RadioGroupModel, CheckboxGroupModel } from './models/puppeteer-models.js';

// Import Action Handlers
import {
  executeClickAction,
  executeTypeAction,
  executeHoverAction,
  executeScreenshotAction,
  executeSelectOptionAction,
  executeCheckAction,
  executeScrollToAction,
  executePressKeyAction,
  executeDatePickerAction
} from './utils/actions/index.js';
import {PlaywrightPythonGenerator} from './utils/code-generators/playwright-python.js';
import {SeleniumPythonGenerator} from './utils/code-generators/selenium-python.js';
import {SeleniumJavaGenerator} from './utils/code-generators/selenium-java.js';
import {FileAppender} from './utils/code-generators/file-appender.js';
import {parsePomFile} from './utils/code-generators/pom-integrator.js';

// Import OpenAPI / Swagger tools
import {OpenAPIParser} from './utils/openapi/parser.js';
import {ApiModelsTypeScriptGenerator} from './utils/api-generators/api-models-typescript.js';
import {ApiModelsPythonGenerator} from './utils/api-generators/api-models-python.js';
// Import Figma tools
import {
    collectAllText,
    extractTextFromNode,
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

// Figma token: tool argument, FIGMA_TOKEN env, or FIGMA_TOKEN_FILE (a file with a
// FIGMA_TOKEN=... line). Resolved on every call: an edited file works without restart.
function getFigmaTokenStatus() {
  if (process.env.FIGMA_TOKEN) {
    return { token: process.env.FIGMA_TOKEN, source: 'FIGMA_TOKEN env' };
  }
  const file = process.env.FIGMA_TOKEN_FILE;
  if (!file) {
    return { token: null, source: null, problem: 'FIGMA_TOKEN and FIGMA_TOKEN_FILE are not set in the MCP server env' };
  }
  if (!existsSync(file)) {
    return { token: null, source: null, problem: `FIGMA_TOKEN not set, FIGMA_TOKEN_FILE=${file} does not exist` };
  }
  const match = readFileSync(file, 'utf8').match(/^\s*FIGMA_TOKEN\s*=\s*(\S+)\s*$/m);
  if (!match) {
    return { token: null, source: null, problem: `FIGMA_TOKEN not set, FIGMA_TOKEN_FILE=${file} has no FIGMA_TOKEN=... line` };
  }
  return { token: match[1], source: `FIGMA_TOKEN_FILE (${file})` };
}

function resolveFigmaToken(argToken) {
  if (argToken) return argToken;
  const status = getFigmaTokenStatus();
  if (!status.token) {
    throw new Error(`Figma token is required: ${status.problem}. Pass figmaToken, or set FIGMA_TOKEN / FIGMA_TOKEN_FILE in the MCP server env.`);
  }
  return status.token;
}

// Figma data context: token resolved only when a request is needed (cache hits work without it)
function figmaContext(validatedArgs) {
  return createFigmaContext({
    getToken: () => resolveFigmaToken(validatedArgs.figmaToken),
    explicitToken: !!validatedArgs.figmaToken,
    refresh: !!validatedArgs.refresh,
    offline: !!validatedArgs.offline
  });
}

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

// Load Element Models (Strategy Pattern for element actions)
const elementModelBase = readFileSync(path.join(__dirname, 'models', 'ElementModel.js'), 'utf-8');
const elementModels = readFileSync(path.join(__dirname, 'models', 'index.js'), 'utf-8');
const modelRegistry = readFileSync(path.join(__dirname, 'models', 'ModelRegistry.js'), 'utf-8');

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

    const result = await executeToolWithTimeout(name, async () => {
      try {
        return await executeToolInternal(name, args);
      } catch (error) {
        // The tab died between the liveness check and the call (close event not yet
        // delivered): the call never reached a live page, so one retry is safe. The
        // retry sees the dead page and re-attaches or reports it.
        if (!isDeadPageError(error)) throw error;
        await new Promise(r => setTimeout(r, 300));
        return await executeToolInternal(name, args);
      }
    }, toolTimeout);
    appendTabNotes(name, result);
    // Credential vault: strip saved passwords from any output
    const redacted = await vaultClient.redactToolResult(result);
    // Written after redaction: saved passwords never reach the disk
    return OUTPUT_FILE_TOOLS.has(name) && args?.outputFile && !redacted.isError
      ? writeResultToFile(name, args.outputFile, redacted)
      : redacted;
  } catch (error) {
    const hint = isDeadPageError(error)
      ? ' The browser tab was detached (closed, discarded or reconnected). Call navigateTo / openBrowser to continue, or resetBrowser.'
      : '';
    return await vaultClient.redactToolResult({
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message + hint,
          tool: name
        }, null, 2)
      }],
      isError: true,
    });
  }
});

// Tools whose result can go to a file instead of the response (outputFile)
const OUTPUT_FILE_TOOLS = new Set(['executeScript', 'analyzePage', 'getComputedCss', 'screenshot', 'getFontReport', 'getFigmaNodeTree', 'compareFigmaSpecs']);

function writeResultToFile(name, outputFile, result) {
  const file = path.resolve(outputFile);
  mkdirSync(path.dirname(file), { recursive: true });
  const image = (result.content || []).find(c => c.type === 'image');
  let data;
  if (name === 'screenshot' && image) {
    data = Buffer.from(image.data, 'base64');
  } else {
    let text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    // executeScript: store the result value itself
    const m = name === 'executeScript' && text.match(/^Script executed successfully\.\nResult: ([\s\S]*?)(\nHint: [^\n]*)?$/);
    if (m) {
      try { text = JSON.stringify(JSON.parse(m[1]), null, 2); } catch { text = m[1]; }
    }
    data = Buffer.from(text, 'utf8');
  }
  writeFileSync(file, data);
  return {
    content: [{ type: 'text', text: `Saved ${name} result to ${file} (${(data.length / 1024).toFixed(1)} KB)` +
      (image && name !== 'screenshot' ? ' (images not saved)' : '') }]
  };
}

// Tell the caller which tab tools work on: after an automatic re-attach, and whenever
// the active tab changed since the last report (user's own tabs may be open next to ours)
let lastReportedPage = null;
const TAB_NOTE_SKIP = new Set(['ping', 'listTabs', 'parseFigmaUrl', 'figmaCacheStatus', 'figmaCacheClear', 'prefetchFigma',
  'listFigmaPages', 'searchFigmaFrames', 'getFigmaComponents', 'getFigmaStyles', 'getFigmaColorPalette', 'getFigmaFrame',
  'getFigmaSpecs', 'getFigmaNodeTree', 'convertFigmaToCode', 'listScenarios', 'searchScenarios', 'getScenarioInfo',
  'deleteScenario', 'loadSwagger', 'generateApiModels', 'listCredentials']);
function appendTabNotes(name, result) {
  if (!result || !Array.isArray(result.content)) return;
  const notes = [];
  const recovery = takeRecoveryNote();
  if (recovery) notes.push(recovery);
  const page = pageState.lastPage;
  if (page && page !== lastReportedPage && !TAB_NOTE_SKIP.has(name)) {
    let url = '';
    try { url = page.url(); } catch { /* detached */ }
    if (url) notes.push(`Active tab: ${url}`);
    lastReportedPage = page;
  }
  if (!notes.length) return;
  const text = notes.map(n => `[${n}]`).join('\n');
  const first = result.content.find(c => c.type === 'text');
  if (first) first.text += '\n' + text;
  else result.content.push({ type: 'text', text });
}

// Internal tool execution function
async function executeToolInternal(name, args) {
  try {
    if (name === "ping") {
      const validatedArgs = schemas.PingSchema.parse(args);
      const figma = getFigmaTokenStatus();
      const responseMessage = (validatedArgs.message
        ? `pong: ${validatedArgs.message}`
        : "pong") +
        `\nfigmaToken: ${figma.token ? `configured (${figma.source})` : `not configured (${figma.problem})`}`;

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
      vaultClient.assertNotExtensionUrl(validatedArgs.url);

      // Capture timestamp BEFORE opening for diagnostics
      const beforeOpenTimestamp = Date.now();

      const page = await getOrCreatePage(validatedArgs.url);
      const { title } = await waitForSpaSettle(page);
      const viewportNote = formatViewportNote(await ensureViewport(page));

      // Run post-navigation diagnostics (same as navigateTo)
      const diagnostics = await runPostClickDiagnostics(page, beforeOpenTimestamp);

      // Generate AI hints
      const hints = await generateNavigationHints(page, validatedArgs.url);

      // Format diagnostics for output
      const diagnosticsText = formatDiagnosticsForAI(diagnostics);

      // Check if extension is connected
      const extensionConnected = isExtensionConnected();
      const usedExistingChrome = isConnectedToExistingChrome();

      let extensionNote = '';
      if (!extensionConnected && usedExistingChrome) {
        const instructions = getExtensionInstallInstructions();
        extensionNote = `\n\n⚠️ EXTENSION NOT CONNECTED\nConnected to existing Chrome - extension needs manual installation.\n${instructions.installSteps.join('\n')}\n\nAlternative: ${instructions.alternativeFix}`;
      }

      let hintsText = '\n\n** AI HINTS **';
      hintsText += `\nPage type: ${hints.pageType}`;
      if (hints.heading) {
        hintsText += `\nPage heading: "${hints.heading}"`;
      }
      if (hints.authRedirect) {
        hintsText += `\n⚠️ AUTH REDIRECT: Page redirected to login (intended: ${hints.authRedirect.returnUrl || 'unknown'})`;
        hintsText += `\n  → Session/cookies not established. Login first, then retry navigation.`;
      }
      if (hints.availableActions.length > 0) {
        hintsText += `\nAvailable actions: ${hints.availableActions.join(', ')}`;
      }
      if (hints.suggestedNext.length > 0) {
        hintsText += `\nSuggested next: ${hints.suggestedNext.join('; ')}`;
      }

      return {
        content: [
          {
            type: "text",
            text: `Browser opened successfully!\nURL: ${validatedArgs.url}\nPage title: ${title}${viewportNote}\n\nBrowser remains open for interaction.${hintsText}${diagnosticsText}${extensionNote}`,
          },
        ],
      };
    }

    /**
     * Check if identifier looks like an APOM ID (e.g., button_8, input_4, form_1)
     */
    function isApomIdPattern(identifier) {
      return /^[a-z]+_\d+$/.test(identifier);
    }

    /**
     * Quick element registration - runs APOM analysis and registers elements
     */
    async function quickRegisterElements(page) {
      await page.evaluate((apomTreeConverterCode, selectorResolverCode, modelsCode) => {
        // Inject utilities. Models must be loaded BEFORE buildAPOMTree because
        // initializeModelRegistry() inside it references window.ModelRegistry. After a
        // navigation the browser window is wiped, so we always re-eval if missing.
        if (typeof window.ModelRegistry === 'undefined') {
          eval(modelsCode);
        }
        if (typeof buildAPOMTree === 'undefined') {
          eval(apomTreeConverterCode);
        }
        if (typeof registerElements === 'undefined') {
          eval(selectorResolverCode);
        }

        // Build APOM tree (interactive only for speed)
        const apomData = buildAPOMTree(true);

        // Flatten and register elements
        const elementsArray = [];
        function collectElements(node) {
          if (!node) return;
          if (node.id && node.selector) {
            elementsArray.push({
              id: node.id,
              selector: node.selector,
              metadata: { type: node.type, tag: node.tag }
            });
          }
          if (node.children) {
            node.children.forEach(child => collectElements(child));
          }
          // Also check for container keys (div_container_0, etc.)
          Object.keys(node).forEach(key => {
            if (Array.isArray(node[key])) {
              node[key].forEach(child => collectElements(child));
            }
          });
        }
        collectElements(apomData.tree);

        if (typeof registerElements !== 'undefined') {
          registerElements(elementsArray);
        }
      }, apomTreeConverter, selectorResolver, elementModelBase + '\n' + elementModels + '\n' + modelRegistry);
    }

    /**
     * Helper: Resolve selector (ID or CSS selector)
     * Injects selector-resolver and resolves element identifier
     * Auto-refreshes element registry if APOM ID not found
     */
    async function resolveSelector(page, identifier, timeoutMs = 5000) {
      const tryResolve = () => page.evaluate((id, selectorResolverCode) => {
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

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`resolveSelector timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      let resolved = await Promise.race([tryResolve(), timeoutPromise]);

      // Auto-refresh: if looks like APOM ID but not found, re-register elements and retry.
      // quickRegisterElements re-injects ModelRegistry — if that itself fails (e.g. ReferenceError
      // from a partially-loaded browser context), surface a clear "call analyzePage" message
      // instead of leaking the raw browser error.
      if (!resolved.found && isApomIdPattern(identifier)) {
        try {
          await quickRegisterElements(page);
        } catch (e) {
          if (/ModelRegistry is not defined/.test(String(e?.message || e))) {
            throw new Error(
              `APOM registry stale after navigation/reload. Call analyzePage() to refresh element ids before reusing "${identifier}".`
            );
          }
          throw e;
        }
        resolved = await Promise.race([tryResolve(), timeoutPromise]);
      }

      return resolved;
    }

    /**
     * Snapshot of all APOM ids on the page → { id: { tag, type, text } }
     * Used by click({ autoAnalyzeAfter: true }) to compute pre/post deltas.
     */
    async function getApomSnapshot(page) {
      return await page.evaluate((apomCode, modelsCode) => {
        if (typeof window.ModelRegistry === 'undefined') eval(modelsCode);
        if (typeof buildAPOMTree === 'undefined') eval(apomCode);
        const apom = buildAPOMTree(true);
        const map = {};
        function walk(node) {
          if (!node || typeof node !== 'object') return;
          if (node.id) {
            map[node.id] = {
              tag: node.tag,
              type: node.type,
              text: (node.metadata && node.metadata.text ? String(node.metadata.text).substring(0, 60) : null)
            };
          }
          if (Array.isArray(node.children)) node.children.forEach(walk);
          for (const k of Object.keys(node)) {
            if (Array.isArray(node[k])) node[k].forEach(walk);
          }
        }
        walk(apom.tree);
        return map;
      }, apomTreeConverter, elementModelBase + '\n' + elementModels + '\n' + modelRegistry);
    }

    if (name === "click") {
      const validatedArgs = schemas.ClickSchema.parse(args);
      const page = await getLastOpenPage();
      const timeout = validatedArgs.timeout || 30000;

      // Wrap operation in timeout
      const clickOperation = async () => {
        // Get identifier (id or selector)
        const identifier = validatedArgs.id || validatedArgs.selector;

        // Resolve/query inside the active frame (P0-1). The ElementHandle from
        // ctx.$() runs in the frame's context, so element.click()/.evaluate()
        // in executeClickAction operate inside the iframe. Page-level diagnostics
        // (network/screenshot) stay on `page`.
        const ctx = await getTargetFrame(page);

        // Resolve selector (supports both APOM ID and CSS selector)
        const resolved = await resolveSelector(ctx, identifier);
        if (!resolved.found) {
          throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
        }

        const element = await ctx.$(resolved.selector);
        if (!element) {
          throw new Error(`Element not found: ${identifier}`);
        }

        // Pre-click APOM snapshot (only if delta is requested) — captures every id
        // currently in the tree so we can diff the post-click state.
        let preSnap = null;
        if (validatedArgs.autoAnalyzeAfter) {
          preSnap = await getApomSnapshot(ctx);
        }

        // Use shared click action handler
        const clickResult = await executeClickAction(page, element, {
          identifier,
          screenshot: validatedArgs.screenshot,
          skipNetworkWait: validatedArgs.skipNetworkWait,
          networkWaitTimeout: validatedArgs.networkWaitTimeout,
          waitForSelector: validatedArgs.waitForSelector,
          waitTimeoutMs: validatedArgs.waitTimeoutMs,
          waitForRouteChange: validatedArgs.waitForRouteChange
        });

        // Post-click APOM delta: re-register new ids so callers can immediately
        // use them in follow-up click/type calls without an extra analyzePage call.
        if (validatedArgs.autoAnalyzeAfter && preSnap) {
          try {
            await quickRegisterElements(ctx);
            const postSnap = await getApomSnapshot(ctx);
            const added = Object.keys(postSnap).filter(id => !preSnap[id]);
            const removed = Object.keys(preSnap).filter(id => !postSnap[id]);

            let deltaText = '\n\n** APOM DELTA **';
            if (added.length === 0 && removed.length === 0) {
              deltaText += '\nNo APOM changes detected after click';
            } else {
              if (added.length > 0) {
                const sample = added.slice(0, 15).map(id => {
                  const m = postSnap[id] || {};
                  const lab = m.text ? `"${m.text}"` : (m.type || m.tag || '?');
                  return `${id}:${lab}`;
                });
                deltaText += `\n+${added.length} appeared: ${sample.join(', ')}${added.length > 15 ? `, ... (${added.length - 15} more)` : ''}`;
              }
              if (removed.length > 0) {
                deltaText += `\n-${removed.length} disappeared`;
              }
            }

            if (clickResult && Array.isArray(clickResult.content) && clickResult.content[0]) {
              clickResult.content[0].text += deltaText;
            }
          } catch (e) {
            // Delta is best-effort — never let it fail the actual click result
            if (clickResult && Array.isArray(clickResult.content) && clickResult.content[0]) {
              clickResult.content[0].text += `\n\n** APOM DELTA ** unavailable (${e.message})`;
            }
          }
        }

        return clickResult;
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
      const timeout = validatedArgs.timeout || 30000;

      // Wrap operation in timeout
      const typeOperation = async () => {
        // Get identifier (id or selector)
        const identifier = validatedArgs.id || validatedArgs.selector;

        // Resolve/query inside the active frame (P0-1)
        const ctx = await getTargetFrame(page);

        // Resolve selector (supports both APOM ID and CSS selector)
        const resolved = await resolveSelector(ctx, identifier);
        if (!resolved.found) {
          throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
        }

        const element = await ctx.$(resolved.selector);
        if (!element) {
          throw new Error(`Element not found: ${identifier}`);
        }

        // Use shared type action handler
        return await executeTypeAction(page, element, validatedArgs.text, {
          identifier,
          delay: validatedArgs.delay,
          clearFirst: validatedArgs.clearFirst
        });
      };

      // Execute with timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Type operation timed out after ${timeout}ms`)), timeout)
      );

      return Promise.race([typeOperation(), timeoutPromise]);
    }

    if (name === "typeCredential") {
      const validatedArgs = schemas.TypeCredentialSchema.parse(args);
      const page = await getLastOpenPage();
      const timeout = validatedArgs.timeout || 30000;
      const field = validatedArgs.field || 'password';

      const typeCredentialOperation = async () => {
        const identifier = validatedArgs.id || validatedArgs.selector;
        const ctx = await getTargetFrame(page);

        const resolved = await resolveSelector(ctx, identifier);
        if (!resolved.found) {
          throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
        }
        const element = await ctx.$(resolved.selector);
        if (!element) {
          throw new Error(`Element not found: ${identifier}`);
        }

        // One-time marker: the extension finds the field by it in any tab/frame
        const nonce = randomUUID();
        await element.evaluate((el, n) => {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.setAttribute('data-ct-fill', n);
        }, nonce);

        let result;
        try {
          result = await vaultClient.fillCredential({
            name: validatedArgs.name,
            field,
            nonce,
            pageUrl: page.url(),
            allowNonPasswordField: !!validatedArgs.allowNonPasswordField
          });
        } finally {
          // Extension removes the marker on success; clean up on any failure
          await element.evaluate(el => el.removeAttribute('data-ct-fill')).catch(() => {});
        }
        if (!result?.ok) {
          throw new Error(result?.error || 'Extension failed to type the credential');
        }

        const afterTypeTimestamp = Date.now();
        const diagnostics = await runPostClickDiagnostics(page, afterTypeTimestamp, { networkWaitTimeout: 3000 });
        return {
          content: [{
            type: "text",
            text: `Typed ${field} of "${result.name}" into ${identifier} (${result.origin})${formatDiagnosticsForAI(diagnostics)}`
          }]
        };
      };

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`typeCredential timed out after ${timeout}ms`)), timeout)
      );
      return Promise.race([typeCredentialOperation(), timeoutPromise]);
    }

    if (name === "listCredentials") {
      const validatedArgs = schemas.ListCredentialsSchema.parse(args);
      let currentOrigin = null;
      let currentUrl = null;
      // Path only: query strings may carry tokens
      const shortUrl = u => { const x = new URL(u); return x.origin + x.pathname; };
      try {
        const page = await getLastOpenPage();
        const ctx = await getTargetFrame(page);
        const o = new URL(ctx.url()).origin;
        currentOrigin = o === 'null' ? null : o;
        if (currentOrigin) currentUrl = shortUrl(ctx.url());
      } catch {
        // No page open - list everything
      }
      if (validatedArgs.currentPageOnly && !currentOrigin) {
        throw new Error('No current page to filter by');
      }

      const all = await vaultClient.listCredentials(validatedArgs.currentPageOnly ? currentOrigin : null);
      const matching = currentOrigin
        ? new Set((await vaultClient.listCredentials(currentOrigin)).map(c => c.name))
        : new Set();

      // Other open tabs with a saved credential: the visible tab may differ from
      // the one MCP works with (e.g. the user opened the login page by hand)
      const otherOpenTabs = [];
      if (!validatedArgs.currentPageOnly && all.length) {
        try {
          const seen = new Set([currentOrigin]);
          for (const p of await (await getBrowser()).pages()) {
            const u = p.url();
            if (!/^https?:/.test(u)) continue;
            const o = new URL(u).origin;
            if (seen.has(o) || seen.size > 12) continue;
            seen.add(o);
            const names = (await vaultClient.listCredentials(o)).map(c => c.name);
            if (names.length) otherOpenTabs.push({ url: shortUrl(u), credentials: names });
          }
        } catch (e) {
          debugLog('[listCredentials] open tabs scan failed:', e.message);
        }
      }

      let hint = all.length
        ? 'Use typeCredential({ name, id, field }) for login and password fields.'
        : 'No saved credentials. Ask the user to add one in the ChromeTools extension popup (Passwords tab).';
      if (!matching.size && otherOpenTabs.length) {
        hint += ' The current tab (currentUrl) has no matching credential, but otherOpenTabs do: ' +
          'switch to that tab (switchTab) or navigateTo its URL before typing.';
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            count: all.length,
            currentUrl,
            currentOrigin,
            credentials: all.map(c => ({
              name: c.name,
              username: c.username || null,
              origins: c.origins,
              matchesCurrentPage: matching.has(c.name)
            })),
            otherOpenTabs: otherOpenTabs.length ? otherOpenTabs : undefined,
            hint
          }, null, 2)
        }]
      };
    }

    if (name === "executeModelAction") {
      const validatedArgs = schemas.ExecuteModelActionSchema.parse(args);
      const page = await getLastOpenPage();
      const timeout = 30000;

      // Wrap operation in timeout
      const executeOperation = async () => {
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

        // Determine which action handler to use via Model Registry (in browser context)
        const handlerInfo = await page.evaluate((modelsCode, elementSelector, actionName) => {
          try {
            // Initialize models if needed
            if (typeof window.ModelRegistry === 'undefined') {
              eval(modelsCode);
            }

            // Initialize registry if needed
            const registry = window.__MODEL_REGISTRY__ || (() => {
              const reg = new window.ModelRegistry();
              if (window.ELEMENT_MODELS_CLASSES) {
                reg.registerAll(window.ELEMENT_MODELS_CLASSES);
              }
              window.__MODEL_REGISTRY__ = reg;
              return reg;
            })();

            // Find element
            const element = document.querySelector(elementSelector);
            if (!element) {
              return { error: `Element not found: ${elementSelector}` };
            }

            // Determine element type (simplified)
            function determineElementType(el) {
              const tag = el.tagName.toLowerCase();
              const type = el.type?.toLowerCase();
              const role = el.getAttribute('role');

              if (tag === 'form') return { type: 'form', metadata: {} };
              if (tag === 'input') {
                const inputType = type || 'text';
                return {
                  type: inputType === 'submit' || inputType === 'button' ? 'button' : 'input',
                  metadata: { inputType }
                };
              }
              if (tag === 'textarea') return { type: 'textarea', metadata: {} };
              if (tag === 'select') return { type: 'select', metadata: {} };
              if (tag === 'button' || role === 'button') return { type: 'button', metadata: {} };
              if (tag === 'a') return { type: 'link', metadata: {} };
              return { type: 'container', metadata: {} };
            }

            const elementType = determineElementType(element);

            // Get action handler name from registry
            return registry.getActionHandler(element, elementType, actionName);
          } catch (error) {
            return { error: error.message };
          }
        }, elementModelBase + '\n' + elementModels + '\n' + modelRegistry, resolved.selector, validatedArgs.action);

        if (handlerInfo.error) {
          throw new Error(handlerInfo.error);
        }

        // Map handler name to actual function
        const actionHandlers = {
          'executeClickAction': executeClickAction,
          'executeTypeAction': executeTypeAction,
          'executeHoverAction': executeHoverAction,
          'executeScreenshotAction': executeScreenshotAction,
          'executeSelectOptionAction': executeSelectOptionAction,
          'executeCheckAction': executeCheckAction,
          'executeScrollToAction': executeScrollToAction,
          'executePressKeyAction': executePressKeyAction,
          'executeDatePickerAction': executeDatePickerAction
        };

        const handlerFunction = actionHandlers[handlerInfo.handlerName];
        if (!handlerFunction) {
          throw new Error(`Action handler "${handlerInfo.handlerName}" not implemented yet`);
        }

        // Execute action via appropriate handler
        const actionParams = validatedArgs.params || {};
        const options = { identifier };

        // Call the action handler based on its signature
        let result;
        if (handlerInfo.handlerName === 'executeTypeAction') {
          let text = actionParams.text || '';
          let typeOptions = { ...options, ...actionParams };

          if (validatedArgs.action === 'append') {
            typeOptions.clearFirst = false;
          } else if (validatedArgs.action === 'clear') {
            text = '';
            typeOptions.clearFirst = true;
          }

          result = await handlerFunction(page, element, text, typeOptions);
        } else if (handlerInfo.handlerName === 'executeSelectOptionAction') {
          result = await handlerFunction(page, element, actionParams, options);
        } else if (handlerInfo.handlerName === 'executeClickAction') {
          result = await handlerFunction(page, element, { ...options, screenshot: actionParams.screenshot });
        } else if (handlerInfo.handlerName === 'executeCheckAction') {
          result = await handlerFunction(page, element, validatedArgs.action, options);
        } else if (handlerInfo.handlerName === 'executeDatePickerAction') {
          result = await handlerFunction(page, element, validatedArgs.action, { ...options, ...actionParams });
        } else if (handlerInfo.handlerName === 'executePressKeyAction') {
          result = await handlerFunction(page, element, { ...options, key: actionParams.key, modifiers: actionParams.modifiers });
        } else {
          result = await handlerFunction(page, element, { ...options, ...actionParams });
        }

        return result;
      };

      // Execute with timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`executeModelAction timed out after ${timeout}ms`)), timeout)
      );

      return Promise.race([executeOperation(), timeoutPromise]);
    }

    if (name === "getComputedCss") {
      const validatedArgs = schemas.GetComputedCssSchema.parse(args);
      const page = await getLastOpenPage();

      // Batch: many selectors, one evaluate, a table of properties
      if (validatedArgs.selectors?.length) {
        const DEFAULT_BATCH_PROPS = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color',
          'background-color', 'width', 'height', 'padding', 'gap', 'border-radius', 'border'];
        const props = validatedArgs.properties?.length ? validatedArgs.properties
          : (validatedArgs.category && validatedArgs.category !== 'all' ? CSS_CATEGORIES[validatedArgs.category] : DEFAULT_BATCH_PROPS);
        const ctx = await getTargetFrame(page);
        const table = await ctx.evaluate((selectors, props, all, maxTotal) => {
          const rows = [];
          const notFound = [];
          let truncated = false;
          for (const sel of selectors) {
            let list;
            try { list = [...document.querySelectorAll(sel)]; } catch (e) { notFound.push(`${sel} (invalid: ${e.message})`); continue; }
            if (!list.length) { notFound.push(sel); continue; }
            if (!all) list = list.slice(0, 1);
            list.forEach((el, i) => {
              if (rows.length >= maxTotal) { truncated = true; return; }
              const cs = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              const round = n => Math.round(n * 100) / 100;
              rows.push({
                sel, i,
                box: [round(r.left), round(r.top), round(r.width), round(r.height)],
                values: props.map(p => cs.getPropertyValue(p))
              });
            });
          }
          return { rows, notFound, truncated };
        }, validatedArgs.selectors, props, !!validatedArgs.all, 100);
        return {
          content: [{ type: "text", text: JSON.stringify({ props, ...table, ...(table.truncated ? { note: 'Limited to 100 elements' } : {}) }, null, 2) }],
        };
      }

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

      // Get identifier (id or selector)
      const identifier = validatedArgs.id || validatedArgs.selector;

      // No identifier → full viewport screenshot. Mirrors processSceenshot pipeline used
      // by element screenshots so the output (JPEG, scaled, base64) stays consistent.
      if (!identifier) {
        const buffer = await capture(page, () => page.screenshot({ encoding: 'binary', fullPage: false }));
        const processed = await processScreenshot(buffer, {
          maxWidth: validatedArgs.maxWidth !== undefined ? validatedArgs.maxWidth : 1024,
          maxHeight: validatedArgs.maxHeight !== undefined ? validatedArgs.maxHeight : 8000,
          quality: validatedArgs.quality || 40,
          format: validatedArgs.format || 'jpeg',
        });
        return {
          content: [
            { type: 'text', text: 'Viewport screenshot' },
            { type: 'image', data: processed.buffer.toString('base64'), mimeType: processed.mimeType }
          ]
        };
      }

      // Resolve selector (supports both APOM ID and CSS selector)
      const resolved = await resolveSelector(page, identifier);
      if (!resolved.found) {
        throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
      }

      const element = await page.$(resolved.selector);
      if (!element) {
        throw new Error(`Element not found: ${identifier}`);
      }

      // Use shared screenshot action handler
      return await executeScreenshotAction(page, element, {
        identifier,
        padding: validatedArgs.padding,
        maxWidth: validatedArgs.maxWidth,
        maxHeight: validatedArgs.maxHeight,
        quality: validatedArgs.quality,
        format: validatedArgs.format
      });
    }

    if (name === "saveScreenshot") {
      const validatedArgs = schemas.SaveScreenshotSchema.parse(args);
      const page = await getLastOpenPage();

      if (!validatedArgs.viewport && !validatedArgs.selector && !validatedArgs.clip) {
        throw new Error('Pass selector, clip {x, y, width, height}, or viewport: true.');
      }

      // Re-apply requested viewport before measuring: the clip depends on it
      await ensureViewport(page);

      // Viewport metrics in CSS px. Clip for CDP is in document coordinates.
      const vp = await page.evaluate(() => ({
        pageLeft: window.visualViewport ? window.visualViewport.pageLeft : window.scrollX,
        pageTop: window.visualViewport ? window.visualViewport.pageTop : window.scrollY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        dpr: window.devicePixelRatio
      }));

      const dprText = Math.round(vp.dpr * 100) / 100;
      const cssScale = validatedArgs.scale === 'css';
      let clip = null;
      let what;
      // Size the image must have in CSS px (used for the css scale without clip)
      let cssSize = null;
      if (validatedArgs.clip) {
        // Area in CSS px relative to the viewport (as getBoundingClientRect)
        const c = validatedArgs.clip;
        clip = { x: c.x + vp.pageLeft, y: c.y + vp.pageTop, width: c.width, height: c.height };
        what = `area ${c.x},${c.y} ${c.width}x${c.height} CSS px`;
      } else if (validatedArgs.viewport && !validatedArgs.excludeScrollbar) {
        // No clip: a clip is cut to the layout viewport, which has no scrollbars
        cssSize = { width: vp.innerWidth, height: vp.innerHeight };
        what = `viewport ${vp.innerWidth}x${vp.innerHeight} CSS px`;
      } else if (validatedArgs.viewport) {
        clip = { x: vp.pageLeft, y: vp.pageTop, width: vp.clientWidth, height: vp.clientHeight };
        what = `viewport ${vp.clientWidth}x${vp.clientHeight} CSS px (without scrollbar)`;
      } else {
        const element = await page.$(validatedArgs.selector);
        if (!element) {
          throw new Error(`Element not found: ${validatedArgs.selector}`);
        }
        const box = await element.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        });
        if (!box || box.width === 0 || box.height === 0) {
          throw new Error(`Element not visible: ${validatedArgs.selector}`);
        }
        const padding = validatedArgs.padding || 0;
        clip = {
          x: Math.max(box.x + vp.pageLeft - padding, 0),
          y: Math.max(box.y + vp.pageTop - padding, 0),
          width: Math.max(box.width + padding * 2, 1),
          height: Math.max(box.height + padding * 2, 1)
        };
        what = `element box ${Math.round(box.width * 100) / 100}x${Math.round(box.height * 100) / 100} CSS px` +
          (padding ? ` + padding ${padding}` : '');
      }

      // scale 'css': Chrome renders the clip in CSS pixels (1 image px = 1 CSS px) at any DPR
      if (cssScale && clip) {
        clip.scale = 1 / vp.dpr;
      }

      // Get screenshot as buffer (not base64)
      let screenshotBuffer = await withHiddenElements(page, validatedArgs.hideSelectors, () => capture(page, () => page.screenshot(clip
        ? { clip, encoding: 'binary', captureBeyondViewport: !validatedArgs.viewport }
        : { encoding: 'binary', captureBeyondViewport: false })));

      if (cssScale && !clip && Math.abs(vp.dpr - 1) > 0.01) {
        const img = await Jimp.read(screenshotBuffer);
        img.resize(cssSize.width, cssSize.height);
        screenshotBuffer = await img.getBufferAsync(Jimp.MIME_PNG);
      }

      // Process with compression and scaling (null = original size; ?? would turn null into the default)
      const processed = await processScreenshot(screenshotBuffer, {
        maxWidth: validatedArgs.maxWidth === undefined ? 1024 : validatedArgs.maxWidth,
        maxHeight: validatedArgs.maxHeight === undefined ? 8000 : validatedArgs.maxHeight,
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
        `Captured: ${what}, DPR ${dprText}${cssScale ? ', scale css (1 px = 1 CSS px)' : ''}\n` +
        `Format: ${processed.metadata.format.toUpperCase()}\n` +
        `Size: ${(processed.metadata.finalSize / 1024).toFixed(1)}KB` +
        (processed.metadata.scaled
          ? `\n⚠️ Scaled from ${processed.metadata.originalWidth}x${processed.metadata.originalHeight} by maxWidth/maxHeight. Pass maxWidth: null, maxHeight: null for exact size.`
          : '') +
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

      // Get identifier (id or selector)
      const identifier = validatedArgs.id || validatedArgs.selector;

      // Resolve/query inside the active frame (P0-1)
      const ctx = await getTargetFrame(page);

      // Resolve selector (supports both APOM ID and CSS selector)
      const resolved = await resolveSelector(ctx, identifier);
      if (!resolved.found) {
        throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
      }

      const element = await ctx.$(resolved.selector);
      if (!element) {
        throw new Error(`Element not found: ${identifier}`);
      }

      // Use shared scrollTo action handler
      return await executeScrollToAction(page, element, {
        identifier,
        behavior: validatedArgs.behavior
      });
    }

    if (name === "waitForElement") {
      const validatedArgs = schemas.WaitForElementSchema.parse(args);
      const page = await getLastOpenPage();
      const timeout = validatedArgs.timeout || 5000;
      const waitForVisible = validatedArgs.visible !== false;

      // Wait/query inside the active frame (P0-1)
      const ctx = await getTargetFrame(page);

      try {
        if (waitForVisible) {
          // Wait for element to be visible
          await ctx.waitForSelector(validatedArgs.selector, { timeout, visible: true });
        } else {
          // Just wait for element to exist in DOM
          await ctx.waitForSelector(validatedArgs.selector, { timeout });
        }

        // Get info about the element
        const elementInfo = await ctx.evaluate((selector) => {
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

      // Run in the active frame (P0-1) — defaults to main frame
      const ctx = await getTargetFrame(page);
      vaultClient.assertNotExtensionUrl(ctx.url());
      const scriptToRun = validatedArgs.script;

      // Wrap operation in timeout
      const executeOperation = async () => {
        // Two-pass eval (P1-4): first run the snippet as-is so bare expressions
        // (`document.title`) keep returning their value. If that throws an
        // "Illegal return statement" SyntaxError (top-level `return ...`), retry
        // wrapped in an async IIFE. Robust, no fragile `^return`/`!function` heuristic.
        const result = await ctx.evaluate(async (code) => {
          const runEval = async (src) => {
            // eslint-disable-next-line no-eval
            let evalResult = eval(src);
            // Await promises (async IIFE, fetch, etc.)
            if (evalResult && typeof evalResult === 'object' && typeof evalResult.then === 'function') {
              evalResult = await evalResult;
            }
            return evalResult;
          };
          try {
            return { success: true, result: await runEval(code) };
          } catch (error) {
            if (!(error instanceof SyntaxError)) {
              return { success: false, error: error.message };
            }
            const isIllegalReturn = /return/i.test(error.message) && /illegal|outside|unexpected/i.test(error.message);
            const isTopLevelAwait = /await is only valid|reserved word|unexpected identifier/i.test(error.message) &&
              /\bawait\b/.test(code);
            if (!isIllegalReturn && !isTopLevelAwait) {
              return { success: false, error: error.message };
            }
            // Single expression with await (`await fetch(...).then(r => r.json())`): keep its value
            if (isTopLevelAwait && !/\breturn\b/.test(code)) {
              try {
                return { success: true, result: await runEval(`(async () => (\n${code.replace(/;\s*$/, '')}\n))()`) };
              } catch (exprErr) {
                if (!(exprErr instanceof SyntaxError)) {
                  return { success: false, error: exprErr.message };
                }
              }
            }
            try {
              const result = await runEval(`(async () => {\n${code}\n})()`);
              const hint = result === undefined && !/\breturn\b/.test(code)
                ? 'Script ran inside an async function: add `return` to get a value.'
                : undefined;
              return { success: true, result, hint };
            } catch (wrapErr) {
              return { success: false, error: wrapErr.message };
            }
          }
        }, scriptToRun);

        await new Promise(resolve => setTimeout(resolve, validatedArgs.waitAfter || 500));

        const content = [
          {
            type: "text",
            text: result.success
              ? `Script executed successfully.\nResult: ${JSON.stringify(result.result)}${result.hint ? `\nHint: ${result.hint}` : ''}`
              : `Script execution failed: ${result.error}`
          }
        ];

        // Only add screenshot if requested
        if (validatedArgs.screenshot === true) {
          const screenshot = await capture(page, () => page.screenshot({ encoding: 'base64', fullPage: false }));
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

      // Retrieve response body via CDP using the same session that captured the request
      let responseBody = undefined;
      if (req.finishedTimestamp && !req.errorText) {
        try {
          const page = await getLastOpenPage();
          const client = getNetworkCDPClient(page);
          if (client) {
            const { body, base64Encoded } = await client.send('Network.getResponseBody', { requestId: req.requestId });
            if (base64Encoded) {
              responseBody = `[base64 encoded, ${body.length} chars]`;
            } else {
              // Minify JSON responses, truncate large bodies
              const maxBodySize = 50000;
              responseBody = body.length > maxBodySize
                ? minifyJson(body.substring(0, maxBodySize)) + `... [truncated, total ${body.length} chars]`
                : minifyJson(body);
            }
          } else {
            responseBody = '[unavailable: no network CDP session]';
          }
        } catch (e) {
          responseBody = `[unavailable: ${e.message}]`;
        }
      }

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
        responseBody,
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

      // Resolve/query inside the active frame (P0-1)
      const ctx = await getTargetFrame(page);

      // Resolve selector (supports both APOM ID and CSS selector)
      const resolved = await resolveSelector(ctx, identifier);
      if (!resolved.found) {
        throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
      }

      const element = await ctx.$(resolved.selector);
      if (!element) {
        throw new Error(`Element not found: ${identifier}`);
      }

      // Use shared hover action handler
      return await executeHoverAction(page, element, { identifier });
    }

    if (name === "pressKey") {
      const validatedArgs = schemas.PressKeySchema.parse(args);
      const page = await getLastOpenPage();

      const identifier = validatedArgs.id || validatedArgs.selector || null;
      let element = null;

      if (identifier) {
        // Resolve/query inside the active frame (P0-1)
        const ctx = await getTargetFrame(page);

        // Resolve selector (supports both APOM ID and CSS selector)
        const resolved = await resolveSelector(ctx, identifier);
        if (!resolved.found) {
          throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
        }

        element = await ctx.$(resolved.selector);
        if (!element) {
          throw new Error(`Element not found: ${identifier}`);
        }
      }

      // Use shared pressKey action handler
      return await executePressKeyAction(page, element, {
        key: validatedArgs.key,
        modifiers: validatedArgs.modifiers,
        identifier
      });
    }

    if (name === "selectOption") {
      const validatedArgs = schemas.SelectOptionSchema.parse(args);
      const page = await getLastOpenPage();

      // Get identifier (id or selector)
      const identifier = validatedArgs.id || validatedArgs.selector;

      // Resolve/query inside the active frame (P0-1)
      const ctx = await getTargetFrame(page);

      // Resolve selector (supports both APOM ID and CSS selector)
      const resolved = await resolveSelector(ctx, identifier);
      if (!resolved.found) {
        throw new Error(`Element not found: ${identifier}${resolved.isPageObjectId ? ' (APOM ID)' : ' (CSS selector)'}`);
      }

      const element = await ctx.$(resolved.selector);
      if (!element) {
        throw new Error(`Element not found: ${identifier}`);
      }

      // Use shared selectOption action handler
      return await executeSelectOptionAction(page, element,
        { value: validatedArgs.value, text: validatedArgs.text, index: validatedArgs.index },
        { identifier }
      );
    }

    if (name === "drag") {
      const validatedArgs = schemas.DragSchema.parse(args);
      const page = await getLastOpenPage();

      const distance = validatedArgs.distance || 100;
      const duration = validatedArgs.duration || 500;
      const mode = validatedArgs.mode || 'native';

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

      if (mode === 'synthetic') {
        // Synthetic mode: dispatch DOM events for better JS library compatibility
        const result = await page.evaluate((selector, deltaX, deltaY, duration) => {
          const element = document.querySelector(selector);
          if (!element) {
            return { success: false, error: `Element not found: ${selector}` };
          }

          const rect = element.getBoundingClientRect();
          const startX = rect.left + rect.width / 2;
          const startY = rect.top + rect.height / 2;
          const endX = startX + deltaX;
          const endY = startY + deltaY;

          // Helper to create mouse/pointer event
          const createEvent = (type, clientX, clientY, buttons = 0) => {
            // Try PointerEvent first (modern browsers)
            if (typeof PointerEvent !== 'undefined') {
              return new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX,
                clientY,
                screenX: clientX,
                screenY: clientY,
                buttons,
                button: 0,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
              });
            }
            // Fallback to MouseEvent
            return new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX,
              clientY,
              screenX: clientX,
              screenY: clientY,
              buttons,
              button: 0
            });
          };

          // Dispatch mousedown/pointerdown
          element.dispatchEvent(createEvent('pointerdown', startX, startY, 1));
          element.dispatchEvent(createEvent('mousedown', startX, startY, 1));

          // Dispatch intermediate mousemove/pointermove events
          const steps = Math.max(10, Math.floor(duration / 20));
          const stepDelay = duration / steps;

          return new Promise((resolve) => {
            let currentStep = 0;

            const moveInterval = setInterval(() => {
              currentStep++;
              const progress = currentStep / steps;
              const currentX = startX + (deltaX * progress);
              const currentY = startY + (deltaY * progress);

              element.dispatchEvent(createEvent('pointermove', currentX, currentY, 1));
              element.dispatchEvent(createEvent('mousemove', currentX, currentY, 1));

              if (currentStep >= steps) {
                clearInterval(moveInterval);

                // Dispatch mouseup/pointerup
                element.dispatchEvent(createEvent('pointerup', endX, endY, 0));
                element.dispatchEvent(createEvent('mouseup', endX, endY, 0));
                element.dispatchEvent(createEvent('click', endX, endY, 0));

                resolve({
                  success: true,
                  startX: Math.round(startX),
                  startY: Math.round(startY),
                  endX: Math.round(endX),
                  endY: Math.round(endY),
                  mode: 'synthetic'
                });
              }
            }, stepDelay);
          });
        }, validatedArgs.selector, deltaX, deltaY, duration);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [{
            type: "text",
            text: `Dragged ${validatedArgs.selector} ${validatedArgs.direction} by ${distance}px (${result.mode} mode):\n` +
                  `  Start position: (${result.startX}, ${result.startY})\n` +
                  `  End position: (${result.endX}, ${result.endY})\n` +
                  `  Delta: (${deltaX}px, ${deltaY}px)\n` +
                  `  Duration: ${duration}ms\n` +
                  `  Events: pointerdown → ${Math.floor(duration / 20)} × pointermove → pointerup`
          }],
        };
      } else {
        // Native mode: use Puppeteer mouse API (default, faster)
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
            text: `Dragged ${validatedArgs.selector} ${validatedArgs.direction} by ${distance}px (native mode):\n` +
                  `  Start position: (${Math.round(startX)}, ${Math.round(startY)})\n` +
                  `  End position: (${Math.round(endX)}, ${Math.round(endY)})\n` +
                  `  Delta: (${deltaX}px, ${deltaY}px)\n` +
                  `  Duration: ${duration}ms`
          }],
        };
      }
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

      let frameNote = '';
      let width = validatedArgs.width;
      let height = validatedArgs.height;
      if (validatedArgs.matchFigmaFrame) {
        // Viewport = size of a Figma frame (tree from cache, file, or one /nodes request)
        const m = validatedArgs.matchFigmaFrame;
        const fctx = figmaContext(m);
        let frame;
        if (m.figmaSpecPath) {
          frame = loadFigmaNodeFromFile(m.figmaSpecPath, m.nodeId).data.document;
        } else {
          if (!m.fileKey || !m.nodeId) throw new Error('matchFigmaFrame needs fileKey + nodeId, or figmaSpecPath.');
          const id = normalizeFigmaNodeId(m.nodeId);
          frame = (await getFigmaNodes(m.fileKey, [id], fctx))[id].document;
        }
        const b = frame.absoluteBoundingBox;
        if (!b) throw new Error(`Figma node ${frame.id} has no size`);
        width = Math.round(b.width);
        height = Math.round(b.height);
        frameNote = `\nFigma frame "${frame.name}" (${frame.id}): ${b.width}x${b.height}${formatSourceLine(fctx)}`;
      }
      if (!width || !height) {
        throw new Error('Pass width and height, or matchFigmaFrame.');
      }
      const requested = {
        width,
        height,
        deviceScaleFactor: validatedArgs.deviceScaleFactor || 1
      };
      await page.setViewport(requested);
      // Remembered for the session: re-applied after navigation, on other tabs and before screenshots
      setRequestedViewport(requested);

      const actual = await page.evaluate(() => {
        // A 1px border shows the real device scale: emulation does not override OS display scaling
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:10px;height:10px;border:1px solid transparent';
        (document.body || document.documentElement).appendChild(probe);
        const border = parseFloat(getComputedStyle(probe).borderTopWidth);
        probe.remove();
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          onePx: border
        };
      });
      const osScale = actual.onePx > 0 && Math.abs(actual.onePx - 1) > 0.01
        ? Math.round((requested.deviceScaleFactor / actual.onePx) * 100) / 100 : null;
      const osNote = osScale
        ? `\n⚠️ OS display scaling ${Math.round(osScale * 100)}% still applies: 1px border renders as ${Math.round(actual.onePx * 1000) / 1000}px, sizes may be off by 1px. ` +
          'Emulation cannot change it. For exact px: Windows scaling 100%, or start Chrome with --force-device-scale-factor=1 ' +
          '(Chrome launched by chrometools: set CHROMETOOLS_FORCE_DEVICE_SCALE_FACTOR=1 in the MCP env and restart that Chrome).'
        : '';

      const exact = actual.width === requested.width && actual.height === requested.height &&
        Math.abs(actual.devicePixelRatio - requested.deviceScaleFactor) < 0.01;
      const offByOne = !exact && Math.abs(actual.width - requested.width) <= 1 && Math.abs(actual.height - requested.height) <= 1 &&
        Math.abs(actual.devicePixelRatio - requested.deviceScaleFactor) < 0.01;
      const warning = exact ? '' : offByOne
        ? '\n⚠️ 1 px off: Chrome rounds the emulated size through the OS display scaling (e.g. 110%). Set Windows scaling to 100% for exact size.'
        : '\n⚠️ Actual viewport differs from requested. Check browser zoom (must be 100%).';

      return {
        content: [{
          type: "text",
          text: `Viewport set to ${requested.width}x${requested.height}\nActual: ${actual.width}x${actual.height} (DPR: ${Math.round(actual.devicePixelRatio * 100) / 100})${warning}\nKept for this session (re-applied after navigation and before screenshots).${osNote}${frameNote}`
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
      vaultClient.assertNotExtensionUrl(validatedArgs.url);

      // Auto-open browser if no page is open (instead of throwing error)
      let page = null;
      let browserOpened = false;
      try {
        page = await getLastOpenPage();
      } catch (e) {
        page = null;
      }

      // Capture timestamp BEFORE navigation for diagnostics
      const beforeNavTimestamp = Date.now();

      let prevTitle = null;
      if (page) {
        prevTitle = await page.title().catch(() => null);
        await page.goto(validatedArgs.url, { waitUntil: validatedArgs.waitUntil || 'networkidle2' });
      } else {
        // No page open - create one automatically
        page = await getOrCreatePage(validatedArgs.url);
        browserOpened = true;
      }

      // Top-level navigation invalidates any previously-selected iframe (P0-1).
      // Reset to main frame so subsequent tools don't target a dead frame.
      clearActiveFrame(page);

      // Hash routes: goto resolves before the router renders and sets the title
      const settle = await waitForSpaSettle(page, { prevTitle });
      const title = settle.title;
      const titleNote = settle.titleChanged === false ? ' (unchanged after navigation)' : '';
      const viewportNote = formatViewportNote(await ensureViewport(page));

      // Run post-navigation diagnostics (same as post-click)
      const diagnostics = await runPostClickDiagnostics(page, beforeNavTimestamp);

      // Generate AI hints
      const hints = await generateNavigationHints(page, validatedArgs.url);

      // Format diagnostics for output
      const diagnosticsText = formatDiagnosticsForAI(diagnostics);

      const message = browserOpened
        ? `No active tab was available, opened a new tab: ${validatedArgs.url}`
        : `Navigated to: ${validatedArgs.url}`;

      let hintsText = '\n\n** AI HINTS **';
      hintsText += `\nPage type: ${hints.pageType}`;
      if (hints.heading) {
        hintsText += `\nPage heading: "${hints.heading}"`;
      }
      if (hints.authRedirect) {
        hintsText += `\n⚠️ AUTH REDIRECT: Page redirected to login (intended: ${hints.authRedirect.returnUrl || 'unknown'})`;
        hintsText += `\n  → Session/cookies not established. Login first, then retry navigation.`;
      }
      if (hints.availableActions.length > 0) {
        hintsText += `\nAvailable actions: ${hints.availableActions.join(', ')}`;
      }
      if (hints.suggestedNext.length > 0) {
        hintsText += `\nSuggested next: ${hints.suggestedNext.join('; ')}`;
      }

      return {
        content: [{
          type: "text",
          text: `${message}\nPage title: ${title}${titleNote}${viewportNote}${hintsText}${diagnosticsText}`
        }],
      };
    }

    if (name === "listFrames") {
      schemas.ListFramesSchema.parse(args);
      const page = await getLastOpenPage();
      const frames = listFramesForPage(page);
      const matcher = getActiveFrameMatcher(page);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            count: frames.length,
            activeFrame: matcher || null, // null = main frame
            frames,
            hint: frames.length > 1
              ? 'Use switchFrame({ frameUrl }) to target a child frame (e.g. a cross-origin iframe). switchFrame() with no args resets to main frame.'
              : 'Only the main frame is present.'
          }, null, 2)
        }],
      };
    }

    if (name === "switchFrame") {
      const validatedArgs = schemas.SwitchFrameSchema.parse(args);
      const page = await getLastOpenPage();

      // No args → reset to main frame
      if (!validatedArgs.frameUrl && !validatedArgs.frameSelector) {
        clearActiveFrame(page);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ active: null, message: 'Reset to main frame.' }, null, 2)
          }],
        };
      }

      // Validate the matcher resolves before storing it, so switchFrame fails loudly
      // instead of every later tool failing.
      const matcher = validatedArgs.frameSelector
        ? { frameSelector: validatedArgs.frameSelector }
        : { frameUrl: validatedArgs.frameUrl };
      setActiveFrame(page, matcher);

      let frame;
      try {
        frame = await getTargetFrame(page);
      } catch (e) {
        clearActiveFrame(page); // don't leave a broken active frame set
        throw e;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            active: frame.url(),
            matcher,
            frames: listFramesForPage(page),
            message: `Switched to frame: ${frame.url()}. Subsequent click/type/analyzePage/find/executeScript run inside it until switchFrame() resets.`
          }, null, 2)
        }],
      };
    }

    // Figma tools
    if (name === "getFigmaFrame") {
      const validatedArgs = schemas.GetFigmaFrameSchema.parse(args);
      const fctx = figmaContext(validatedArgs);

      // One node or a batch: one /images request for all nodes missing in the cache
      const rawIds = validatedArgs.nodeIds?.length ? validatedArgs.nodeIds : (validatedArgs.nodeId ? [validatedArgs.nodeId] : []);
      if (!rawIds.length) {
        throw new Error('Pass nodeId or nodeIds.');
      }
      const ids = [...new Set(rawIds.map(normalizeFigmaNodeId))];
      const MAX_INLINE = 5;
      if (ids.length > MAX_INLINE && !validatedArgs.outputDir) {
        throw new Error(`${ids.length} nodes: pass outputDir to save them as files (inline images are limited to ${MAX_INLINE}).`);
      }

      const scale = validatedArgs.scale || 2;
      const format = validatedArgs.format || 'png';
      const buffers = await getFigmaImages(validatedArgs.fileKey, ids, { scale, format }, fctx);
      const fileName = cachedFigmaFileName(validatedArgs.fileKey);

      const frames = [];
      const content = [];
      let inlineBytes = 0;
      for (const nodeId of ids) {
        const imageBuffer = buffers[nodeId];
        // Frame info only from the cache: not worth a request of its own
        const frameInfo = peekFigmaNode(validatedArgs.fileKey, nodeId)?.document;
        const frame = {
          frameId: nodeId,
          frameName: frameInfo?.name || 'Unknown',
          dimensions: frameInfo ? {
            width: frameInfo.absoluteBoundingBox?.width,
            height: frameInfo.absoluteBoundingBox?.height
          } : 'node tree not cached (prefetchFigma / getFigmaSpecs to get it)'
        };

        if (validatedArgs.outputDir) {
          // Files keep the exact render (no recompression): needed for pixel checks
          const dir = path.resolve(validatedArgs.outputDir);
          mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${nodeId.replace(/[:;]/g, '-')}@${scale}x.${format}`);
          writeFileSync(file, imageBuffer);
          frame.file = file;
          frame.fileSize = imageBuffer.length;
        } else {
          // Process image to ensure it doesn't exceed 3 MB
          const processedImage = await processScreenshot(imageBuffer, {
            maxWidth: null, // Keep original dimensions
            maxHeight: null,
            quality: 85,
            format: format,
            maxFileSize: 3 * 1024 * 1024 // 3 MB limit
          });
          inlineBytes += processedImage.buffer.length;
          frame.exportSettings = {
            format: processedImage.metadata.format,
            fileSize: processedImage.metadata.finalSize,
            originalFileSize: imageBuffer.length,
            compressed: processedImage.metadata.autoCompressed,
            quality: processedImage.metadata.quality
          };
          content.push({ type: 'image', data: processedImage.buffer.toString('base64'), mimeType: processedImage.mimeType });
        }
        frames.push(frame);
      }
      if (inlineBytes > 3 * 1024 * 1024 * 1.5) {
        throw new Error('Inline images exceed the response size limit: pass outputDir.');
      }

      const result = ids.length === 1 && !validatedArgs.nodeIds
        ? { figmaInfo: { fileName, ...frames[0], exportSettings: { scale, ...(frames[0].exportSettings || {}) } } }
        : { fileName, scale, format, frames };

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) + formatSourceLine(fctx) },
          ...content
        ]
      };
    }

    if (name === "compareFigmaToElement") {
      const validatedArgs = schemas.CompareFigmaToElementSchema.parse(args);
      const fctx = figmaContext(validatedArgs);
      const v = validatedArgs;

      const t0 = Date.now();
      const step = label => debugLog(`[compareFigmaToElement] +${Date.now() - t0}ms ${label}`);
      const page = await getLastOpenPage();
      await ensureViewport(page);
      const dpr = Math.round((await page.evaluate(() => window.devicePixelRatio)) * 100) / 100;
      // Same pixel density on both sides by default
      const figmaScale = v.figmaScale || dpr;
      const threshold = v.threshold || 0.05;

      // Pairs: one (nodeId + selector) or a batch (nodeIds + selectors)
      let pairs;
      if (v.nodeIds?.length) {
        if (!v.selectors || v.selectors.length !== v.nodeIds.length) {
          throw new Error('nodeIds and selectors must have the same length: pair i compares nodeIds[i] with selectors[i].');
        }
        pairs = v.nodeIds.map((n, i) => ({ nodeId: normalizeFigmaNodeId(n), selector: v.selectors[i] }));
      } else {
        if (!v.selector) throw new Error('Pass selector (or nodeIds + selectors).');
        pairs = [{ nodeId: v.nodeId ? normalizeFigmaNodeId(v.nodeId) : null, selector: v.selector }];
      }
      const batch = pairs.length > 1;
      if (v.figmaImagePath && batch) throw new Error('figmaImagePath compares one image: use nodeId + selector.');
      if (!v.figmaImagePath && (!v.fileKey || pairs.some(p => !p.nodeId))) {
        throw new Error('Pass fileKey and nodeId, or figmaImagePath with a local PNG.');
      }
      if (batch && (v.figmaChildNodeId || v.figmaCrop || v.anchor)) {
        throw new Error('figmaChildNodeId, figmaCrop and anchor work with a single pair.');
      }

      // All renders in one request (cached ones are not requested)
      const renders = v.figmaImagePath ? {} :
        await getFigmaImages(v.fileKey, pairs.map(p => p.nodeId), { scale: figmaScale, format: 'png' }, fctx);
      step('figma renders ready');

      // Node trees: crop by a child node, align by an anchor node, and cut the render to the
      // frame bounds (strokes and shadows make the render larger: 1448x912 for a 1440x904 frame)
      const trees = {};
      if (v.figmaSpecPath) {
        const loaded = loadFigmaNodeFromFile(v.figmaSpecPath, pairs[0].nodeId);
        trees[pairs[0].nodeId || loaded.id] = loaded.data.document;
        if (!pairs[0].nodeId) pairs[0].nodeId = loaded.id;
      } else if (!v.figmaImagePath && (v.figmaChildNodeId || v.anchor || v.cropToBounds !== false)) {
        const ids = pairs.map(p => p.nodeId);
        // Cached trees cost nothing. Missing ones are requested (one /nodes call) only when needed:
        // child crop / anchor, or cropToBounds: true. Default bounds crop uses cached trees only.
        const needFetch = !!(v.figmaChildNodeId || v.anchor || v.cropToBounds === true);
        const got = needFetch
          ? await getFigmaNodes(v.fileKey, ids, fctx).catch(e => { if (v.figmaChildNodeId || v.anchor) throw e; return {}; })
          : Object.fromEntries(ids.map(id => [id, peekFigmaNode(v.fileKey, id)]).filter(([, n]) => n));
        for (const [id, n] of Object.entries(got)) trees[id] = n.document;
      }
      if ((v.figmaChildNodeId || v.anchor) && !trees[pairs[0].nodeId]) {
        throw new Error('figmaChildNodeId / anchor need the node tree: pass fileKey + nodeId, or figmaSpecPath.');
      }

      const rows = [];
      const content = [];
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        let figmaBuffer;
        if (v.figmaImagePath) {
          if (!existsSync(v.figmaImagePath)) throw new Error(`figmaImagePath not found: ${v.figmaImagePath}`);
          figmaBuffer = readFileSync(v.figmaImagePath);
          if (i === 0) fctx.notes.push(`local file ${v.figmaImagePath}`);
        } else {
          figmaBuffer = renders[pair.nodeId];
        }
        let figmaImg = await Jimp.read(figmaBuffer);
        const rootTree = trees[pair.nodeId] || null;

        // Render px of a Figma node relative to the image (render bounds include shadows)
        const toRender = (node) => {
          const root = rootTree;
          const rb = root.absoluteRenderBounds || root.absoluteBoundingBox;
          const b = node.absoluteBoundingBox;
          if (!rb || !b) throw new Error(`Node ${node.id} has no bounding box`);
          return {
            x: (b.x - rb.x) * figmaScale, y: (b.y - rb.y) * figmaScale,
            width: b.width * figmaScale, height: b.height * figmaScale
          };
        };

        // Crop the Figma image to a child node or a rectangle (Figma px, relative to the node)
        let cropOrigin = { x: 0, y: 0 };
        let cropInfo = null;
        let cropRect = null;
        if (v.figmaChildNodeId) {
          const childId = normalizeFigmaNodeId(v.figmaChildNodeId);
          const child = findFigmaNode(rootTree, childId);
          if (!child) throw new Error(`figmaChildNodeId ${childId} is not inside node ${pair.nodeId}`);
          cropRect = toRender(child);
          cropInfo = { childNodeId: childId, childName: child.name };
        } else if (v.figmaCrop) {
          cropRect = {
            x: v.figmaCrop.x * figmaScale, y: v.figmaCrop.y * figmaScale,
            width: v.figmaCrop.width * figmaScale, height: v.figmaCrop.height * figmaScale
          };
          cropInfo = { rect: v.figmaCrop };
        } else if (rootTree && !v.figmaImagePath && v.cropToBounds !== false && rootTree.absoluteBoundingBox) {
          // Render larger than the frame (outside stroke / shadow): compare the frame box only
          const b = toRender(rootTree);
          const offBy = Math.abs(figmaImg.bitmap.width - b.width) + Math.abs(figmaImg.bitmap.height - b.height);
          if (offBy >= 1 && b.x >= 0 && b.y >= 0) {
            cropRect = b;
            cropInfo = { toFrameBounds: true, renderSize: `${figmaImg.bitmap.width}x${figmaImg.bitmap.height}` };
          }
        }
        if (cropRect) {
          const x = Math.max(0, Math.round(cropRect.x)), y = Math.max(0, Math.round(cropRect.y));
          const w = Math.min(figmaImg.bitmap.width - x, Math.round(cropRect.width));
          const h = Math.min(figmaImg.bitmap.height - y, Math.round(cropRect.height));
          if (w < 1 || h < 1) throw new Error('Crop area is outside the Figma image');
          figmaImg = figmaImg.crop(x, y, w, h);
          cropOrigin = { x, y };
          cropInfo.renderPx = { x, y, width: w, height: h };
        }

        // Page element
        const element = await page.$(pair.selector);
        if (!element) throw new Error(`Selector not found: ${pair.selector}`);
        // hideSelectors: widgets over the layout (chat button, cookie banner) hidden for the shot
        const pageBuffer = await withHiddenElements(page, v.hideSelectors, () => capture(page, () => element.screenshot()));
        step(`element screenshot ${i}`);
        const pageImg = await Jimp.read(pageBuffer);

        // Optional: scale Figma to the element width
        let fitRatio = 1;
        if (v.scaleToFit && figmaImg.bitmap.width !== pageImg.bitmap.width) {
          fitRatio = pageImg.bitmap.width / figmaImg.bitmap.width;
          figmaImg = figmaImg.resize(pageImg.bitmap.width, Math.round(figmaImg.bitmap.height * fitRatio));
        }

        // Page boxes relative to the element, in image px
        const boxesInElement = (selectors) => element.evaluate((el, sels, scale) => {
          const r0 = el.getBoundingClientRect();
          const out = [];
          for (const sel of sels) {
            let list = [];
            try { list = [...document.querySelectorAll(sel)]; } catch (e) { list = []; }
            out.push(list.map(n => {
              const r = n.getBoundingClientRect();
              return { x: (r.left - r0.left) * scale, y: (r.top - r0.top) * scale, width: r.width * scale, height: r.height * scale };
            }));
          }
          return out;
        }, selectors, dpr);

        // Alignment by an anchor: Figma node and page element that must coincide
        let offset = null;
        let alignment = { mode: 'top-left' };
        if (v.anchor) {
          const anchorNode = findFigmaNode(rootTree, normalizeFigmaNodeId(v.anchor.figmaNodeId));
          if (!anchorNode) throw new Error(`anchor.figmaNodeId ${v.anchor.figmaNodeId} is not inside node ${pair.nodeId}`);
          const fa = toRender(anchorNode);
          const [[pa]] = await boxesInElement([v.anchor.selector]);
          if (!pa) throw new Error(`anchor.selector not found: ${v.anchor.selector}`);
          offset = {
            x: pa.x - (fa.x - cropOrigin.x) * fitRatio,
            y: pa.y - (fa.y - cropOrigin.y) * fitRatio
          };
          alignment = {
            mode: 'anchor', figmaNodeId: anchorNode.id, figmaName: anchorNode.name, selector: v.anchor.selector,
            offsetPx: { x: Math.round(offset.x), y: Math.round(offset.y) }
          };
        }

        // Ignored areas
        const masks = [];
        const ignore = v.ignore || [];
        const ignoreSelectors = ignore.filter(m => m.selector).map(m => m.selector);
        if (ignoreSelectors.length) {
          for (const list of await boxesInElement(ignoreSelectors)) masks.push(...list);
        }
        for (const m of ignore.filter(m => !m.selector && m.width && m.height)) {
          masks.push({ x: m.x * dpr, y: m.y * dpr, width: m.width * dpr, height: m.height * dpr });
        }

        const figmaPng = await figmaImg.getBufferAsync(Jimp.MIME_PNG);
        const cmp = await compareImages(figmaPng, pageBuffer, { offset, masks });
        step(`compared ${cmp.width}x${cmp.height}`);
        const { diffPixels } = cmp;
        const differencePercent = cmp.comparedPixels > 0 ? (diffPixels / cmp.comparedPixels) * 100 : 0;
        const sameSize = cmp.figmaSize.width === cmp.pageSize.width && cmp.figmaSize.height === cmp.pageSize.height;

        const notes = [];
        if (!sameSize && !offset) {
          notes.push('Sizes differ: images are aligned top-left without scaling, area covered by only one image counts as difference. Use anchor, figmaChildNodeId / figmaCrop, or scaleToFit.');
        }
        if (Math.abs(figmaScale - dpr) > 0.01 && !v.figmaImagePath) {
          notes.push(`figmaScale ${figmaScale} differs from page devicePixelRatio ${dpr}: pixel densities differ.`);
        }
        if (offset && cmp.outsidePixels > 0) {
          notes.push(`${cmp.outsidePixels} px outside the overlap of the aligned images are not compared.`);
        }

        const analysis = {
          ...(batch ? { nodeId: pair.nodeId, selector: pair.selector } : {}),
          figmaVsPage: {
            identical: diffPixels === 0 && sameSize,
            withinThreshold: differencePercent <= (threshold * 100),
            pixelDifferences: diffPixels,
            differencePercent: Math.round(differencePercent * 100) / 100,
            ssim: Math.round(cmp.ssim * 10000) / 10000,
            recommendation: differencePercent < 1 ? 'Pixel-perfect match' :
              differencePercent < 3 ? 'Very close to design' :
                differencePercent < 10 ? 'Minor differences detected' :
                  'Significant differences from design'
          },
          dimensions: {
            figma: cmp.figmaSize,
            page: cmp.pageSize,
            comparedRegion: cmp.region,
            sameSize,
            figmaScale,
            pageDevicePixelRatio: dpr
          },
          alignment,
          ...(cropInfo ? { figmaCrop: cropInfo } : {}),
          ...(fitRatio !== 1 ? { scaleToFit: Math.round(fitRatio * 10000) / 10000 } : {}),
          ...(masks.length ? { ignored: { areas: masks.length, pixels: cmp.maskedPixels } } : {}),
          ...(notes.length ? { notes } : {})
        };

        const [diffBuffer, overlayBuffer] = await Promise.all([
          cmp.diff.getBufferAsync(Jimp.MIME_PNG),
          cmp.overlay.getBufferAsync(Jimp.MIME_PNG)
        ]);

        if (v.outputDir) {
          const base = path.resolve(v.outputDir);
          const dir = batch ? path.join(base, `${i + 1}-${pair.nodeId.replace(/[:;]/g, '-')}`) : base;
          mkdirSync(dir, { recursive: true });
          const files = {
            figma: path.join(dir, 'figma.png'),
            page: path.join(dir, 'page.png'),
            diff: path.join(dir, 'diff.png'),
            overlay: path.join(dir, 'overlay.png')
          };
          writeFileSync(files.figma, figmaPng);
          writeFileSync(files.page, pageBuffer);
          writeFileSync(files.diff, diffBuffer);
          writeFileSync(files.overlay, overlayBuffer);
          analysis.files = files;
        }
        rows.push(analysis);

        // Inline images only for a single pair
        if (!batch) {
          const shrink = buf => processScreenshot(buf, {
            maxWidth: null, maxHeight: null, quality: 85, format: 'auto', maxFileSize: 3 * 1024 * 1024
          });
          const imgs = [figmaPng, pageBuffer, overlayBuffer];
          if (diffPixels > 0) imgs.push(diffBuffer);
          for (const buf of imgs) {
            const pr = await shrink(buf);
            content.push({ type: 'image', data: pr.buffer.toString('base64'), mimeType: pr.mimeType });
          }
        }
      }
      step('done');

      const text = batch
        ? JSON.stringify({
          pairs: rows.length,
          summary: rows.map(r => ({
            nodeId: r.nodeId, selector: r.selector, differencePercent: r.figmaVsPage.differencePercent,
            ssim: r.figmaVsPage.ssim, sameSize: r.dimensions.sameSize, withinThreshold: r.figmaVsPage.withinThreshold
          })),
          details: rows
        }, null, 2) + (v.outputDir ? '' : '\nImages are not inlined for several pairs: pass outputDir to save them.')
        : JSON.stringify(rows[0], null, 2) + '\nImages: figma, page, overlay (page + 50% figma)' + (rows[0].figmaVsPage.pixelDifferences > 0 ? ', diff map' : '');

      return { content: [{ type: 'text', text: text + formatSourceLine(fctx) }, ...content] };
    }

    if (name === "getFigmaSpecs") {
      const validatedArgs = schemas.GetFigmaSpecsSchema.parse(args);
      const fctx = figmaContext(validatedArgs);

      let node;
      if (validatedArgs.figmaSpecPath) {
        // Saved node JSON: no API at all
        node = loadFigmaNodeFromFile(validatedArgs.figmaSpecPath, validatedArgs.nodeId).data.document;
        fctx.notes.push(`local file ${validatedArgs.figmaSpecPath}`);
      } else {
        if (!validatedArgs.fileKey || !validatedArgs.nodeId) {
          throw new Error('Pass fileKey and nodeId, or figmaSpecPath with a saved node JSON.');
        }
        // Normalize node ID (convert URL format like "123-456" to API format "123:456")
        const nodeId = normalizeFigmaNodeId(validatedArgs.nodeId);
        node = (await getFigmaNodes(validatedArgs.fileKey, [nodeId], fctx))[nodeId].document;
      }

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
          { type: 'text', text: JSON.stringify(specs, null, 2) + formatSourceLine(fctx) }
        ]
      };
    }

    if (name === "getFontReport") {
      const validatedArgs = schemas.GetFontReportSchema.parse(args);
      const page = await getLastOpenPage();
      const report = await fontReport(page, {
        selector: validatedArgs.selector || 'body',
        maxElements: validatedArgs.maxElements || 300
      });
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    }

    if (name === "compareFigmaSpecs") {
      const validatedArgs = schemas.CompareFigmaSpecsSchema.parse(args);
      const fctx = figmaContext(validatedArgs);
      let root;
      if (validatedArgs.figmaSpecPath) {
        root = loadFigmaNodeFromFile(validatedArgs.figmaSpecPath, validatedArgs.nodeId).data.document;
        fctx.notes.push(`local file ${validatedArgs.figmaSpecPath}`);
      } else {
        if (!validatedArgs.fileKey || !validatedArgs.nodeId) throw new Error('Pass fileKey + nodeId, or figmaSpecPath.');
        const id = normalizeFigmaNodeId(validatedArgs.nodeId);
        root = (await getFigmaNodes(validatedArgs.fileKey, [id], fctx))[id].document;
      }
      const page = await getLastOpenPage();
      const ctx = await getTargetFrame(page);
      const result = await compareSpecs(page, ctx, root, validatedArgs);
      const head = `Figma "${root.name}" [${root.id}] vs ${validatedArgs.selector}\n` +
        JSON.stringify(result.summary) + '\n\n' + (result.text || 'No differences in matched elements.');
      const more = (list, total) => (total > list.length ? `; ... ${total - list.length} more` : '');
      const uc = result.unmatchedCounts;
      const tail = [
        result.unmatchedFigmaTexts.length ? `\n\nFigma texts without a page match (${uc.figmaTexts}): ${result.unmatchedFigmaTexts.join('; ')}${more(result.unmatchedFigmaTexts, uc.figmaTexts)}` : '',
        result.unmatchedPageTexts.length ? `\nPage texts without a Figma match (${uc.pageTexts}): ${result.unmatchedPageTexts.join('; ')}${more(result.unmatchedPageTexts, uc.pageTexts)}` : '',
        result.unmatchedFigmaBlocks.length ? `\nFigma components without a page match (${uc.figmaBlocks}): ${result.unmatchedFigmaBlocks.join('; ')}${more(result.unmatchedFigmaBlocks, uc.figmaBlocks)}` : '',
        result.mixedStyleTexts.length ? `\nFigma texts with mixed styles (base style compared): ${result.mixedStyleTexts.join('; ')}` : ''
      ].join('');
      return { content: [{ type: 'text', text: head + tail + formatSourceLine(fctx) }] };
    }

    if (name === "getFigmaNodeTree") {
      const validatedArgs = schemas.GetFigmaNodeTreeSchema.parse(args);
      const fctx = figmaContext(validatedArgs);
      const opts = {
        depth: validatedArgs.depth ?? 6,
        includeHidden: !!validatedArgs.includeHidden,
        textOnly: !!validatedArgs.textOnly
      };
      let roots;
      if (validatedArgs.figmaSpecPath) {
        const loaded = loadFigmaNodeFromFile(validatedArgs.figmaSpecPath, validatedArgs.nodeId);
        roots = { [loaded.id]: loaded.data.document };
        fctx.notes.push(`local file ${validatedArgs.figmaSpecPath}`);
      } else {
        const ids = validatedArgs.nodeIds?.length ? validatedArgs.nodeIds : (validatedArgs.nodeId ? [validatedArgs.nodeId] : []);
        if (!validatedArgs.fileKey || !ids.length) throw new Error('Pass fileKey + nodeId / nodeIds, or figmaSpecPath.');
        const nodes = await getFigmaNodes(validatedArgs.fileKey, ids, fctx);
        roots = Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, n.document]));
      }
      const budget = Math.floor(60000 / Object.keys(roots).length);
      const trees = Object.values(roots).map(r => compactTree(r, { ...opts, maxBytes: budget }));
      const result = trees.length === 1 ? trees[0] : { trees };
      const truncatedNote = trees.some(t => t.truncated)
        ? '\nTruncated at ~60 KB: request a deeper child node, lower depth, or textOnly.' : '';
      return {
        content: [{
          type: 'text',
          text: 'Boxes: [x, y, width, height] relative to the requested node. padding: [top, right, bottom, left].\n' +
            JSON.stringify(result) + truncatedNote + formatSourceLine(fctx)
        }]
      };
    }

    if (name === "prefetchFigma") {
      const validatedArgs = schemas.PrefetchFigmaSchema.parse(args);
      const fctx = figmaContext(validatedArgs);
      const fileKey = parseFigmaUrl(validatedArgs.fileKey).fileKey;
      const result = await prefetchFigmaData(fileKey, validatedArgs.nodeIds, {
        scales: validatedArgs.scales || [2],
        format: validatedArgs.format || 'png',
        tree: validatedArgs.tree !== false
      }, fctx);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) + formatSourceLine(fctx) }]
      };
    }

    if (name === "importFigmaCache") {
      const validatedArgs = schemas.ImportFigmaCacheSchema.parse(args);
      const fileKey = parseFigmaUrl(validatedArgs.fileKey).fileKey;
      const result = importFigmaNodesFile(fileKey, validatedArgs.path);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2) +
            '\nNested nodes are found by id: getFigmaSpecs / compareFigmaSpecs / getFigmaNodeTree with fileKey + nodeId and offline: true.'
        }]
      };
    }

    if (name === "importFigmaRender") {
      const validatedArgs = schemas.ImportFigmaRenderSchema.parse(args);
      const fileKey = parseFigmaUrl(validatedArgs.fileKey).fileKey;
      const result = importFigmaRenderFile(fileKey, validatedArgs.nodeId, validatedArgs.path, {
        scale: validatedArgs.scale ?? 1,
        format: validatedArgs.format || null
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "figmaCacheStatus") {
      const validatedArgs = schemas.FigmaCacheStatusSchema.parse(args);
      const fileKey = validatedArgs.fileKey ? parseFigmaUrl(validatedArgs.fileKey).fileKey : null;
      return {
        content: [{ type: 'text', text: JSON.stringify(figmaCacheStatus(fileKey), null, 2) }]
      };
    }

    if (name === "figmaCacheClear") {
      const validatedArgs = schemas.FigmaCacheClearSchema.parse(args);
      const fileKey = validatedArgs.fileKey ? parseFigmaUrl(validatedArgs.fileKey).fileKey : null;
      const result = figmaCacheClear({ fileKey, nodeIds: validatedArgs.nodeIds || null, kind: validatedArgs.kind || null });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
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
      const fctx = figmaContext(validatedArgs);

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const fileData = await getFigmaFileData(fileKey, fctx);
      const result = listFigmaPages(fileData);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) + formatSourceLine(fctx) }
        ]
      };
    }

    if (name === "searchFigmaFrames") {
      const validatedArgs = schemas.SearchFigmaFramesSchema.parse(args);
      const fctx = figmaContext(validatedArgs);

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const fileData = await getFigmaFileData(fileKey, fctx);
      const result = searchFigmaFrames(fileData, validatedArgs.searchQuery);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) + formatSourceLine(fctx) }
        ]
      };
    }

    if (name === "getFigmaComponents") {
      const validatedArgs = schemas.GetFigmaComponentsSchema.parse(args);
      const fctx = figmaContext(validatedArgs);

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const fileData = await getFigmaFileData(fileKey, fctx);
      const result = getFigmaComponents(fileData);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) + formatSourceLine(fctx) }
        ]
      };
    }

    if (name === "getFigmaStyles") {
      const validatedArgs = schemas.GetFigmaStylesSchema.parse(args);
      const fctx = figmaContext(validatedArgs);

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const fileData = await getFigmaFileData(fileKey, fctx);
      const result = getFigmaStyles(fileData);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) + formatSourceLine(fctx) }
        ]
      };
    }

    if (name === "getFigmaColorPalette") {
      const validatedArgs = schemas.GetFigmaColorPaletteSchema.parse(args);
      const fctx = figmaContext(validatedArgs);

      // Parse fileKey from URL if needed
      const parsed = parseFigmaUrl(validatedArgs.fileKey);
      const fileKey = parsed.fileKey;

      const fileData = await getFigmaFileData(fileKey, fctx);
      const result = getFigmaColorPalette(fileData);

      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) + formatSourceLine(fctx) }
        ]
      };
    }

    if (name === "convertFigmaToCode") {
      const validatedArgs = schemas.ConvertFigmaToCodeSchema.parse(args);
      const fctx = figmaContext(validatedArgs);

      // Normalize node ID
      const nodeId = normalizeFigmaNodeId(validatedArgs.nodeId);
      const framework = validatedArgs.framework || 'react';
      const includeComments = validatedArgs.includeComments !== false; // default true

      // Node structure and render at 2x: cache first
      const nodeInfo = (await getFigmaNodes(validatedArgs.fileKey, [nodeId], fctx))[nodeId];
      const designImage = (await getFigmaImages(validatedArgs.fileKey, [nodeId], { scale: 2, format: 'png' }, fctx))[nodeId];
      const processedDesign = await processScreenshot(designImage, {
        maxWidth: null, maxHeight: null, quality: 85, format: 'png', maxFileSize: 3 * 1024 * 1024
      });

      // Simplify node structure
      const simplifiedNode = simplifyNode(nodeInfo.document);

      // Build AI instruction based on framework
      const frameworkInstructions = {
        'react': 'React (JavaScript) with Tailwind CSS',
        'react-typescript': 'React (TypeScript) with Tailwind CSS',
        'html': 'Pure HTML with Tailwind CSS classes'
      };

      const instruction = `# Figma to Code Conversion

## Design Image
Attached below (rendered at 2x).

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
        content: [
          { type: "text", text: instruction + formatSourceLine(fctx) },
          { type: "image", data: processedDesign.buffer.toString('base64'), mimeType: processedDesign.mimeType }
        ],
      };
    }

    // New AI optimization tools
    if (name === "smartFindElement") {
      const validatedArgs = schemas.SmartFindElementSchema.parse(args);
      const page = await getLastOpenPage();
      const ctx = await getTargetFrame(page); // search inside active frame (P0-1)
      const maxResults = validatedArgs.maxResults || 5;
      const minConfidence = validatedArgs.minConfidence != null ? validatedArgs.minConfidence : 0.6;

      // Execute smart search in page context
      const results = await ctx.evaluate((description, maxResults, utilsCode, selectorResolverCode) => {
        // Inject utilities into page context
        eval(utilsCode);
        if (typeof registerElement === 'undefined') {
          eval(selectorResolverCode);
        }

        // Determine element type from description
        const elementType = determineElementType(description);

        // Build candidate selectors based on element type.
        // Dedup with a Set — broadened selectors overlap (a button can match
        // several queries) and we don't want the same element scored twice.
        const candidateSet = new Set();
        const add = (sel) => { try { document.querySelectorAll(sel).forEach(el => candidateSet.add(el)); } catch (e) {} };

        if (elementType.type === 'input' || elementType.type === 'any') {
          add('input');
          add('textarea');
        }

        if (elementType.type === 'button' || elementType.type === 'any') {
          add('button');
          add('input[type="submit"]');
          add('input[type="button"]');
          add('[role="button"]');
          // P1-3: broaden to non-semantic clickables that QA hit on real apps —
          // menu items rendered as div/span[onclick], nav links, tabs.
          add('[onclick]');
          add('[role="menuitem"]');
          add('[role="tab"]');
          add('nav a');
          add('[role="navigation"] a');
          add('[role="menu"] [role="menuitem"]');
        }

        if (elementType.type === 'link' || elementType.type === 'any') {
          add('a');
        }

        const candidates = Array.from(candidateSet);

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
        const filtered = analyzed
          .filter(r => r.score > 5) // Minimum threshold
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);

        // Register found elements in APOM registry and assign IDs
        filtered.forEach((result, idx) => {
          const apomId = `smart_${result.type}_${idx}`;
          result.id = apomId;
          if (typeof registerElement === 'function') {
            registerElement(apomId, result.selector, { source: 'smartFindElement' });
          }
        });

        return filtered;

      }, validatedArgs.description, maxResults, elementFinderUtils, selectorResolver);

      const hints = {
        totalCandidates: results.length,
        bestMatch: results[0] || null,
        suggestion: results.length > 0
          ? `Use id: "${results[0].id}" or selector: ${results[0].selector}`
          : 'No good matches found. Try a different description.',
      };

      const response = {
        candidates: results,
        hints
      };

      // Execute action if provided — but only when we're confident (P1-3).
      // Previously results[0] was clicked unconditionally, so a high-scoring form
      // submit could be auto-clicked when the user asked for something else.
      // Guard on minConfidence AND a clear gap over the runner-up.
      if (validatedArgs.action && results.length > 0) {
        const bestMatch = results[0];
        const runnerUp = results[1];
        const gapOk = !runnerUp || (bestMatch.score - runnerUp.score) >= 10;
        const confident = bestMatch.confidence >= minConfidence && gapOk;

        if (!confident) {
          response.actionSkipped = {
            reason: bestMatch.confidence < minConfidence
              ? `bestMatch confidence ${bestMatch.confidence.toFixed(2)} < minConfidence ${minConfidence}`
              : `ambiguous: top-2 score gap (${bestMatch.score - runnerUp.score}) too small`,
            hint: 'Refine the description, pass an explicit id/selector to click, or lower minConfidence.',
          };
        } else {
        try {
          const actionResult = await executeElementAction(page, bestMatch.selector, validatedArgs.action, ctx);
          response.actionExecuted = actionResult;

          // If screenshot was captured, add it to content
          if (actionResult && actionResult.screenshot) {
            return {
              content: [
                { type: 'text', text: JSON.stringify(response, null, 2) },
                { type: 'image', data: actionResult.screenshot, mimeType: actionResult.screenshotMimeType || 'image/png' }
              ]
            };
          }
        } catch (error) {
          response.actionError = error.message;
        }
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }]
      };
    }

    // Store previous analysis for diff calculation
    if (!global.previousApomAnalysis) {
      global.previousApomAnalysis = new Map(); // pageUrl -> analysis data
    }

    if (name === "analyzePage") {
      const validatedArgs = schemas.AnalyzePageSchema.parse(args);
      const page = await getLastOpenPage();
      // Analyze the active frame (P0-1) — defaults to main frame. `frameList` is
      // surfaced in the output so the agent can discover/switch frames.
      const ctx = await getTargetFrame(page);
      const frameList = listFramesForPage(page);
      const pageUrl = ctx.url() || page.url();

      // Check for non-HTML pages (JSON, plain text, XML) — return raw content instead of empty tree
      const contentType = await ctx.evaluate(() => document.contentType || '');
      if (contentType && !contentType.includes('html')) {
        const rawContent = await page.evaluate(() => {
          // For JSON/text pages, browser wraps content in <pre> inside <body>
          const pre = document.querySelector('pre');
          const text = pre ? pre.textContent : document.body?.innerText || '';
          // Truncate large content
          const maxSize = 50000;
          return text.length > maxSize ? text.substring(0, maxSize) + `\n... [truncated, total ${text.length} chars]` : text;
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              pageId: `page_${Buffer.from(pageUrl).toString('base64').substring(0, 20)}_${Date.now()}`,
              url: pageUrl,
              contentType,
              rawContent,
              metadata: { totalElements: 0, interactiveCount: 0, nonHtmlPage: true }
            })
          }]
        };
      }

      // APOM Tree format (default) - v2 with tree structure and positioning
      const apomResult = await ctx.evaluate(async (apomTreeConverterCode, selectorResolverCode, modelsCode, shouldRegister, includeAll, viewportOnly, portalOpts) => {
        // Inject utilities if not already loaded
        if (typeof buildAPOMTree === 'undefined') {
          eval(apomTreeConverterCode);
        }
        if (typeof resolveSelector === 'undefined') {
          eval(selectorResolverCode);
        }
        if (typeof ElementModel === 'undefined') {
          eval(modelsCode);
        }

        // Wait for Angular stability before DOM traversal (like Protractor's whenStable).
        // Prevents reading intermediate DOM state during Angular change detection.
        // whenStable() resolves immediately if Angular is already stable (zero overhead).
        if (typeof window.getAllAngularTestabilities === 'function') {
          try {
            const testabilities = window.getAllAngularTestabilities();
            if (testabilities && testabilities.length > 0) {
              await Promise.race([
                new Promise(resolve => testabilities[0].whenStable(resolve)),
                new Promise(resolve => setTimeout(resolve, 3000))
              ]);
            }
          } catch (e) {
            // Angular testability API not available or errored — proceed without waiting
          }
        }

        // Clear stale element registry before building new tree.
        // Old IDs from previous analyses may point to elements that no longer exist.
        if (typeof clearRegistry === 'function') {
          clearRegistry();
        }

        // Build APOM tree
        // interactiveOnly = !includeAll (if includeAll is true, we want ALL elements)
        const apomData = buildAPOMTree(!includeAll, viewportOnly, portalOpts);

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
      }, apomTreeConverter, selectorResolver, elementModelBase + '\n' + elementModels + '\n' + modelRegistry, validatedArgs.registerElements !== false, validatedArgs.includeAll || false, validatedArgs.viewportOnly || false, {
        include: validatedArgs.includePortals !== false,
        selectors: validatedArgs.portalSelectors || undefined
      });

      // Surface frames so the agent can discover/switch into iframes (P0-1).
      // Only when there's more than the main frame — keeps single-frame output lean.
      if (frameList.length > 1) {
        apomResult.frames = frameList;
        apomResult.activeFrame = ctx === page.mainFrame() ? null : (ctx.url() || true);
      }

      // Handle diff mode
      if (validatedArgs.diff) {
        const previousAnalysis = global.previousApomAnalysis.get(pageUrl);

        if (previousAnalysis) {
          // Calculate diff
          const diff = calculateApomDiff(previousAnalysis, apomResult);

          // Store current analysis for next diff
          global.previousApomAnalysis.set(pageUrl, apomResult);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                mode: 'diff',
                pageId: apomResult.pageId,
                url: apomResult.url,
                timestamp: apomResult.timestamp,
                previousTimestamp: previousAnalysis.timestamp,
                diff,
                metadata: apomResult.metadata,
                alerts: apomResult.alerts,
                frames: frameList.length > 1 ? frameList : undefined
              })
            }]
          };
        } else {
          // No previous analysis, return full result with note
          global.previousApomAnalysis.set(pageUrl, apomResult);
          apomResult._note = 'First analysis for this page, no diff available';
        }
      } else {
        // Store for future diff
        global.previousApomAnalysis.set(pageUrl, apomResult);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(apomResult)
        }]
      };
    }

    /**
     * Calculate diff between two APOM analyses
     */
    function calculateApomDiff(previous, current) {
      const previousElements = flattenApomTree(previous.tree);
      const currentElements = flattenApomTree(current.tree);

      const previousIds = new Set(previousElements.map(e => e.id));
      const currentIds = new Set(currentElements.map(e => e.id));

      const added = currentElements.filter(e => !previousIds.has(e.id));
      const removed = previousElements.filter(e => !currentIds.has(e.id));

      // Find changed elements (same ID but different content)
      const changed = [];
      for (const curr of currentElements) {
        if (previousIds.has(curr.id)) {
          const prev = previousElements.find(e => e.id === curr.id);
          if (prev && JSON.stringify(prev.metadata) !== JSON.stringify(curr.metadata)) {
            changed.push({
              id: curr.id,
              type: curr.type,
              before: prev.metadata,
              after: curr.metadata
            });
          }
        }
      }

      return {
        added: added.length > 0 ? added : undefined,
        removed: removed.length > 0 ? removed : undefined,
        changed: changed.length > 0 ? changed : undefined,
        summary: {
          addedCount: added.length,
          removedCount: removed.length,
          changedCount: changed.length
        }
      };
    }

    /**
     * Flatten APOM tree to array of elements
     */
    function flattenApomTree(node, result = []) {
      if (!node) return result;

      // Handle compact format: { "tag_id": [children] }
      if (typeof node === 'object' && !node.id && !node.tag) {
        const keys = Object.keys(node);
        for (const key of keys) {
          if (Array.isArray(node[key])) {
            node[key].forEach(child => flattenApomTree(child, result));
          }
        }
        return result;
      }

      // Interactive element with id
      if (node.id) {
        result.push({
          id: node.id,
          tag: node.tag,
          type: node.type,
          metadata: node.metadata
        });
      }

      // Process children
      if (node.children) {
        node.children.forEach(child => flattenApomTree(child, result));
      }

      return result;
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
          value: element.type === 'password' && element.value ? '***' : (element.value || null),
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
      const ctx = await getTargetFrame(page); // search inside active frame (P0-1)

      const elements = await ctx.evaluate((text, exact, caseSensitive, utilsCode, selectorResolverCode) => {
        eval(utilsCode);
        if (typeof registerElement === 'undefined') {
          eval(selectorResolverCode);
        }

        const results = [];
        const MAX_RESULTS = 40; // Collect up to 40 to allow visible/hidden sorting, cap expensive selector generation
        const searchText = caseSensitive ? text : text.toLowerCase();

        document.querySelectorAll('*').forEach(el => {
          if (results.length >= MAX_RESULTS) return; // Stop expensive selector generation after enough results
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
            const selector = getUniqueSelectorInPage(el);
            const type = el.tagName.toLowerCase();
            const apomId = `text_${type}_${results.length}`;
            if (typeof registerElement === 'function') {
              registerElement(apomId, selector, { source: 'findElementsByText' });
            }
            results.push({
              id: apomId,
              selector,
              type,
              text: elementText.substring(0, 100), // Only first 100 chars for preview
              visible: el.offsetParent !== null, // Add visibility check
            });
          }
        });

        return results;
      }, validatedArgs.text, validatedArgs.exact || false, validatedArgs.caseSensitive || false, elementFinderUtils, selectorResolver);

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

      // Execute action if provided and elements found.
      // Pass `ctx` so the raw selector resolves inside the active frame (P0-1) —
      // the FIND ran in the frame, so the ACTION must too, otherwise page.$
      // looks in the main frame and "Element not found for action".
      if (validatedArgs.action && elements.length > 0) {
        const firstMatch = elements[0];
        try {
          const actionResult = await executeElementAction(page, firstMatch.selector, validatedArgs.action, ctx);
          response.actionExecuted = actionResult;

          // If screenshot was captured, add it to content
          if (actionResult && actionResult.screenshot) {
            return {
              content: [
                { type: 'text', text: JSON.stringify(response, null, 2) },
                { type: 'image', data: actionResult.screenshot, mimeType: actionResult.screenshotMimeType || 'image/png' }
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

      // Always log connection state for debugging
      console.error(`[chrometools-mcp] enableRecorder check: bridgeConnected=${debugInfo.bridgeConnected}, extensionConnected=${extensionConnected}, wsState=${debugInfo.readyState}`);

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

      // Resolve pageObjectMode (backward compat: generatePageObject: true -> 'generate')
      const pageObjectMode = args.pageObjectMode || (args.generatePageObject ? 'generate' : 'none');

      // Select generator based on language
      const options = {
        cleanSelectors: args.cleanSelectors !== false, // default true
        includeComments: args.includeComments !== false, // default true
      };

      // Resolve POM elements for integrated modes
      let pomElements = null;
      let pomClassName = null;
      let pomImportPath = null;
      let pageObjectData = null;

      if (pageObjectMode === 'generate-integrated' || pageObjectMode === 'generate') {
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
              const extension = args.language.includes('typescript') ? '.ts' :
                               args.language.includes('java') ? '.java' : '.py';
              pageObjectData = {
                code: pageObjectResult.code,
                className: pageObjectResult.className,
                suggestedFileName: `${pageObjectResult.className}${extension}`,
                elementCount: pageObjectResult.elementCount
              };

              if (pageObjectMode === 'generate-integrated') {
                pomElements = pageObjectResult.elements;
                pomClassName = pageObjectResult.className;
              }
            }
          }
        } catch (error) {
          // Page Object generation failed, continue without it
        }
      } else if (pageObjectMode === 'use-existing') {
        if (!args.pageObjectFile) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: "pageObjectFile is required for 'use-existing' mode"
              }, null, 2)
            }],
            isError: true
          };
        }

        try {
          const pomContent = FileAppender.readFile(args.pageObjectFile);
          const parsed = parsePomFile(pomContent, args.language);
          pomElements = parsed.elements;
          pomClassName = parsed.className;
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Failed to parse POM file: ${error.message}`
              }, null, 2)
            }],
            isError: true
          };
        }
      }

      // Add POM options to generator
      if (pomElements && pomClassName) {
        options.pomElements = pomElements;
        options.pomClassName = pomClassName;
        options.pomImportPath = pomImportPath;
      }

      let generator;
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

        // Return JSON with instructions for Claude Code to append the test
        const result = {
          action: 'append_test',
          targetFile: args.targetFile,
          testCode: testOnly,
          testName: args.testName || scenario.metadata?.name,
          insertPosition: appendOptions.insertPosition,
          referenceTestName: appendOptions.referenceTestName,
          instruction: `Read file '${args.targetFile}', append the testCode at position '${appendOptions.insertPosition}', then write the file back.`
        };

        if (pomClassName) {
          result.pomIntegration = { className: pomClassName, mode: pageObjectMode };
        }

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

      // Resolve pageObjectMode (backward compat: generatePageObject: true -> 'generate')
      const pageObjectMode = args.pageObjectMode || (args.generatePageObject ? 'generate' : 'none');

      const options = {
        cleanSelectors: args.cleanSelectors !== false, // default true
        includeComments: args.includeComments !== false, // default true
      };

      // Resolve POM elements for integrated modes
      let pomElements = null;
      let pomClassName = null;
      let pageObjectData = null;
      const entryUrl = scenario.metadata?.entryUrl;

      if (pageObjectMode === 'generate-integrated' || pageObjectMode === 'generate') {
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

        try {
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
            const poExtension = args.language.includes('typescript') ? '.ts' :
                               args.language.includes('java') ? '.java' : '.py';
            pageObjectData = {
              code: pageObjectResult.code,
              className: pageObjectResult.className,
              suggestedFileName: `${pageObjectResult.className}${poExtension}`,
              elementCount: pageObjectResult.elementCount
            };

            if (pageObjectMode === 'generate-integrated') {
              pomElements = pageObjectResult.elements;
              pomClassName = pageObjectResult.className;
            }
          }
        } catch (error) {
          // Page Object generation failed, continue without it
        }
      } else if (pageObjectMode === 'use-existing') {
        if (!args.pageObjectFile) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: "pageObjectFile is required for 'use-existing' mode"
              }, null, 2)
            }],
            isError: true
          };
        }

        try {
          const pomContent = FileAppender.readFile(args.pageObjectFile);
          const parsed = parsePomFile(pomContent, args.language);
          pomElements = parsed.elements;
          pomClassName = parsed.className;
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Failed to parse POM file: ${error.message}`
              }, null, 2)
            }],
            isError: true
          };
        }
      }

      // Add POM options to generator
      if (pomElements && pomClassName) {
        options.pomElements = pomElements;
        options.pomClassName = pomClassName;
      }

      let generator;
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

      // Build result
      const result = {
        action: 'create_new_file',
        suggestedFileName: suggestedFileName,
        testCode: testCode,
        instruction: `Create a new test file '${suggestedFileName}' with the testCode.`
      };

      if (pomClassName) {
        result.pomIntegration = { className: pomClassName, mode: pageObjectMode };
      }

      if (pageObjectData) {
        result.pageObject = pageObjectData;
        result.instruction = `Create a new test file '${suggestedFileName}' with the testCode. Also create a Page Object file '${pageObjectData.suggestedFileName}' with the pageObject.code.`;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
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
    if (name === "resetBrowser") {
      const validatedArgs = schemas.ResetBrowserSchema.parse(args);
      // Forget pages and the CDP connection; Chrome and user tabs stay open
      resetPageState();
      await resetBrowserConnection();
      lastReportedPage = null;
      let text = 'Browser connection reset (Chrome and its tabs stay open). Next tool call connects again.';
      if (validatedArgs.url) {
        vaultClient.assertNotExtensionUrl(validatedArgs.url);
        const page = await getOrCreatePage(validatedArgs.url);
        const { title } = await waitForSpaSettle(page);
        text = `Browser connection reset, opened ${validatedArgs.url}\nPage title: ${title}` +
          formatViewportNote(await ensureViewport(page));
      }
      return { content: [{ type: 'text', text }] };
    }

    if (name === "listTabs") {
      const validatedArgs = schemas.ListTabsSchema.parse(args || {});
      // Prefer extension tabs if connected (sees ALL tabs including manually opened)
      let tabs = [];
      let source = 'puppeteer';
      let hiddenTabs = 0;

      if (isExtensionConnected()) {
        const extTabs = getTabsFromExtension();
        if (extTabs.length > 0) {
          // The extension sees the user's own tabs too: by default list only tabs chrometools works with
          const ours = new Set();
          for (const pg of openPages.values()) {
            try { if (!pg.isClosed()) ours.add(pg.url()); } catch { /* ignore */ }
          }
          try { if (pageState.lastPage) ours.add(pageState.lastPage.url()); } catch { /* ignore */ }
          const all = extTabs.map((t, index) => ({
            index, // index for switchTab (position among all tabs)
            url: t.url,
            title: t.title,
            isActive: t.active,
            chrometools: ours.has(t.url)
          }));
          if (validatedArgs.all) {
            tabs = all.map(t => (t.chrometools ? t : { index: t.index, url: t.url, isActive: t.isActive, chrometools: false }));
          } else {
            tabs = all.filter(t => t.chrometools);
            hiddenTabs = all.length - tabs.length;
          }
          source = 'extension';
        }
      }

      // Fallback to Puppeteer if extension not connected or has no tabs
      if (tabs.length === 0 && source !== 'extension') {
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
        extensionConnected,
        ...(hiddenTabs ? { hiddenTabs, note: `${hiddenTabs} other tab(s) of the user are hidden. Pass all: true to list them (without titles).` } : {})
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
          // Also connect Puppeteer to this tab: tools work only through it
          let page = await connectToTabByUrl(tab.url, { loose: true }).catch(() => null);
          if (!page) {
            // Stale CDP connection does not see the tab: reconnect once
            await resetBrowserConnection();
            page = await connectToTabByUrl(tab.url, { loose: true }).catch(() => null);
          }
          if (page) lastReportedPage = page;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(page ? {
                success: true,
                switchedTo: {
                  url: tab.url,
                  title: tab.title
                },
                message: `Switched to tab: ${tab.title || tab.url}`,
                source: 'extension',
                puppeteerConnected: true
              } : {
                success: false,
                switchedTo: { url: tab.url, title: tab.title },
                message: 'The tab was activated in Chrome, but chrometools could not attach to it: other tools would not work on it. ' +
                  'Call resetBrowser, or navigateTo the URL.',
                source: 'extension',
                puppeteerConnected: false
              }, null, 2)
            }],
            ...(page ? {} : { isError: true })
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

    // ========== API / Swagger Tools ==========

    if (name === "loadSwagger") {
      const validatedArgs = schemas.LoadSwaggerSchema.parse(args);
      const parser = await OpenAPIParser.load(validatedArgs.source, validatedArgs.format || 'auto');
      const summary = parser.getSummary();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            ...summary,
            instruction: 'Use generateApiModels to generate typed models from these schemas.'
          }, null, 2)
        }]
      };
    }

    if (name === "generateApiModels") {
      const validatedArgs = schemas.GenerateApiModelsSchema.parse(args);
      const parser = await OpenAPIParser.load(validatedArgs.source, validatedArgs.format || 'auto');
      let schemasObj = parser.getSchemas();

      // Filter schemas if specified
      if (validatedArgs.schemas && validatedArgs.schemas.length > 0) {
        const filtered = {};
        for (const schemaName of validatedArgs.schemas) {
          if (schemasObj[schemaName]) filtered[schemaName] = schemasObj[schemaName];
        }
        schemasObj = filtered;
      }

      const metadata = {
        title: parser.spec.info?.title || '',
        source: validatedArgs.source,
        version: parser.version
      };

      let code, suggestedFileName;

      if (validatedArgs.language === 'typescript') {
        const generator = new ApiModelsTypeScriptGenerator(schemasObj, {
          style: validatedArgs.style || 'interface',
          includeEnums: validatedArgs.includeEnums !== false,
          includeValidation: validatedArgs.includeValidation || false,
        });
        code = generator.generate(metadata);
        const titleSlug = (metadata.title || 'api').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        suggestedFileName = `${titleSlug}.models.ts`;
      } else {
        const generator = new ApiModelsPythonGenerator(schemasObj, {
          style: validatedArgs.pythonStyle || 'dataclass',
          includeEnums: validatedArgs.includeEnums !== false,
          includeValidation: validatedArgs.includeValidation || false,
        });
        code = generator.generate(metadata);
        const titleSlug = (metadata.title || 'api').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        suggestedFileName = `${titleSlug}_models.py`;
      }

      const schemaCount = Object.keys(schemasObj).length;
      const enumCount = Object.values(schemasObj).filter(s => s.enum && s.type === 'string').length;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            action: 'create_new_file',
            suggestedFileName,
            code,
            schemaCount,
            enumCount,
            language: validatedArgs.language,
            source: validatedArgs.source,
            instruction: `Create file '${suggestedFileName}' with the generated code.`
          }, null, 2)
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
  FIGMA_TOKEN_FILE=path    File with a FIGMA_TOKEN=xxx line (read on every call)
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

  // Connect to Bridge Service (if running — optional, for Chrome Extension integration)
  await startWebSocketServer();

  // Register handler for syncing active tab when user switches tabs
  // User clicked a tab: follow it only if chrometools already works with that tab
  setActiveTabSyncHandler(url => connectToTabByUrl(url, { trackedOnly: true }));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("chrometools-mcp server running on stdio");
  console.error("Browser will be initialized on first openBrowser call");

  // Pre-warm Jimp AFTER server is connected (non-blocking)
  // Jimp v0.22 constructor is thenable - awaiting it before server.connect()
  // would block transport and cause MCP client timeout
  (async () => {
    try {
      const img = await new Jimp(1, 1, 0x000000ff);
      await img.getBufferAsync(Jimp.MIME_JPEG);
      console.error("[chrometools-mcp] Jimp pre-warmed");
    } catch (e) {
      console.error("[chrometools-mcp] Jimp pre-warm failed:", e.message);
    }
  })();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

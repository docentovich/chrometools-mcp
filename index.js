#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import puppeteer from "puppeteer";

// Global browser instance (persists between requests)
let browserPromise = null;
const openPages = new Map();
let lastPage = null;

// Console logs storage
const consoleLogs = [];

// Initialize browser (singleton)
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    console.error("[chrometools-mcp] Browser initialized (GUI mode)");
  }
  return browserPromise;
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
  return lastPage;
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
    version: "1.0.0",
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
        description: "Capture a PNG screenshot of a specific element. Perfect for visual documentation, design reviews, and debugging. Supports optional padding to include surrounding context.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to screenshot" },
            padding: { type: "number", description: "Padding around element in pixels (default: 0)" },
          },
          required: ["selector"],
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

      return {
        content: [
          {
            type: "text",
            text: `Browser opened successfully!\nURL: ${validatedArgs.url}\nPage title: ${title}\n\nBrowser remains open for interaction.`,
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

      const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

      return {
        content: [
          { type: "text", text: `Clicked: ${validatedArgs.selector}` },
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

      const screenshot = await page.screenshot({ clip, encoding: 'base64' });

      return {
        content: [
          {
            type: "image",
            data: screenshot,
            mimeType: "image/png"
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

      return {
        content: [{
          type: "text",
          text: `Navigated to: ${validatedArgs.url}\nPage title: ${title}`
        }],
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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("chrometools-mcp server running on stdio");
  console.error("Browser will be initialized on first openBrowser call");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

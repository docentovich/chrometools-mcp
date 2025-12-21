/**
 * server/tool-definitions.js
 *
 * MCP tool definitions for ListTools handler
 */

export const toolDefinitions = [
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
        description: "Inject recorder UI widget. Visual recording with start/stop/save controls. Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/. Use global index at ~/.config/chrometools-mcp/index.json to discover available projects and scenarios.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "executeScenario",
        description: "Execute recorded scenario by name. Runs actions with dependency resolution. Scenarios are organized by domain in ~/.config/chrometools-mcp/projects/{domain}/scenarios/. If multiple scenarios have the same name across different domains, specify projectId to disambiguate.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario name" },
            projectId: { type: "string", description: "Optional: Project ID (domain) to disambiguate scenarios with same name. Examples: 'google', 'localhost-3000'" },
            parameters: { type: "object", description: "Execution parameters" },
            executeDependencies: { type: "boolean", description: "Execute dependencies (default: true)" },
          },
          required: ["name"],
        },
      },
      {
        name: "listScenarios",
        description: "List all scenarios with metadata. Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/. Use global index at ~/.config/chrometools-mcp/index.json to discover available projects and scenarios.",
        inputSchema: {
          type: "object",
          properties: {
            allProjects: { type: "boolean", description: "List scenarios from all projects (default: false, shows only current project)" },
          },
        },
      },
      {
        name: "searchScenarios",
        description: "Search scenarios by text or tags. Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/. Use global index at ~/.config/chrometools-mcp/index.json to discover available projects and scenarios.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Search text" },
            tags: { type: "array", items: { type: "string" }, description: "Filter tags" },
            allProjects: { type: "boolean", description: "Search in all projects (default: false, searches only current project)" },
          },
        },
      },
      {
        name: "getScenarioInfo",
        description: "Get scenario details: actions, parameters, dependencies. Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/. Use global index at ~/.config/chrometools-mcp/index.json to discover available projects and scenarios.",
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
        description: "Delete scenario and secrets. Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/. Use global index at ~/.config/chrometools-mcp/index.json to discover available projects and scenarios.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario name" },
          },
          required: ["name"],
        },
      },
      {
        name: "exportScenarioAsCode",
        description: "Export recorded scenario as executable test code for various frameworks. Automatically cleans unstable selectors (CSS modules, styled-components). Optionally generates Page Object class for the page. Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/. Use global index at ~/.config/chrometools-mcp/index.json to discover available projects and scenarios.",
        inputSchema: {
          type: "object",
          properties: {
            scenarioName: {
              type: "string",
              description: "Name of scenario to export"
            },
            language: {
              type: "string",
              enum: ["playwright-typescript", "playwright-python", "selenium-python", "selenium-java"],
              description: "Target test framework and language"
            },
            cleanSelectors: {
              type: "boolean",
              description: "Remove unstable CSS classes (default: true)"
            },
            includeComments: {
              type: "boolean",
              description: "Include descriptive comments (default: true)"
            },
            generatePageObject: {
              type: "boolean",
              description: "Also generate Page Object class for the page (default: false)"
            },
            pageObjectClassName: {
              type: "string",
              description: "Page Object class name (optional, auto-generated if not provided)"
            },
          },
          required: ["scenarioName", "language"],
        },
      },
      {
        name: "generatePageObject",
        description: "Generate Page Object Model (POM) class from current page analysis. Analyzes page structure, extracts interactive elements (inputs, buttons, links), groups them by sections (header, nav, form, etc.), and generates framework-specific code. Supports Playwright (TypeScript/Python) and Selenium (Python/Java). Auto-generates smart element names and helper methods.",
        inputSchema: {
          type: "object",
          properties: {
            className: {
              type: "string",
              description: "Page Object class name (optional, auto-generated from page title/URL if not provided)"
            },
            framework: {
              type: "string",
              enum: ["playwright-typescript", "playwright-python", "selenium-python", "selenium-java"],
              description: "Target test framework (default: playwright-typescript)"
            },
            includeComments: {
              type: "boolean",
              description: "Include descriptive comments in generated code (default: true)"
            },
            groupElements: {
              type: "boolean",
              description: "Group elements by page sections (default: true)"
            },
          },
        },
      },
];

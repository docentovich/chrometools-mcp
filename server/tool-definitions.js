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
        description: "PRIMARY tool for clicking elements. PREFERRED: Use APOM ID (e.g., id: 'button_45') from analyzePage for reliable element targeting. ALTERNATIVE: CSS selector for ad-hoc usage. Works correctly with React/Vue/Angular synthetic events. DO NOT use executeScript for clicks - use this tool instead. Waits for animations and navigation.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "APOM element ID from analyzePage (e.g., 'button_45'). Either id or selector required." },
            selector: { type: "string", description: "CSS selector (e.g., '.submit-btn'). Either id or selector required." },
            waitAfter: { type: "number", description: "Wait ms (default: 1500)" },
            screenshot: { type: "boolean", description: "Screenshot (default: false)" },
            timeout: { type: "number", description: "Max wait ms (default: 30000)" },
          },
        },
      },
      {
        name: "type",
        description: "PRIMARY tool for filling input fields. PREFERRED: Use APOM ID (e.g., id: 'input_20') from analyzePage for reliable element targeting. ALTERNATIVE: CSS selector for ad-hoc usage. Works correctly with React/Vue/Angular state management. DO NOT use executeScript for typing - use this tool instead. Automatically updates framework state (React hooks, Vue reactive data).",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "APOM element ID from analyzePage (e.g., 'input_20'). Either id or selector required." },
            selector: { type: "string", description: "CSS selector (e.g., '#email'). Either id or selector required." },
            text: { type: "string", description: "Text to type" },
            delay: { type: "number", description: "Keystroke delay ms (default: 0)" },
            clearFirst: { type: "boolean", description: "Clear first (default: true)" },
          },
          required: ["text"],
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
        description: "⚠️ LAST RESORT tool - use ONLY when ALL specialized tools failed. NEVER use for: clicking (use click), typing (use type), reading page (use analyzePage), finding elements (use findElementsByText). May break React/Vue/Angular synthetic events. ALWAYS try specialized tools first.",
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
        description: "Hover over element. PREFERRED: Use APOM ID from analyzePage. ALTERNATIVE: CSS selector. For testing hover effects, tooltips, and CSS :hover states.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "APOM element ID from analyzePage. Either id or selector required." },
            selector: { type: "string", description: "CSS selector. Either id or selector required." },
          },
        },
      },
      {
        name: "selectOption",
        description: "Select option in dropdown. PREFERRED: Use APOM ID from analyzePage. ALTERNATIVE: CSS selector. Works with HTML select elements. Specify value, text, or index to choose option.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "APOM element ID from analyzePage for select element. Either id or selector required." },
            selector: { type: "string", description: "CSS selector for select element. Either id or selector required." },
            value: { type: "string", description: "Option value attribute (priority 1)" },
            text: { type: "string", description: "Option text content (priority 2)" },
            index: { type: "number", description: "Option index, 0-based (priority 3)" },
          },
        },
      },
      {
        name: "drag",
        description: "Drag element by mouse (click-hold-move-release). Simulates real mouse drag in any direction. Works with interactive maps, Gantt charts, SVG diagrams, canvas, sliders. Does NOT work with standard overflow scrollbars - use scrollTo/scrollHorizontal instead.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to drag" },
            direction: { type: "string", enum: ["up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"], description: "Drag direction" },
            distance: { type: "number", description: "Distance in pixels (default: 100)" },
            duration: { type: "number", description: "Drag duration in ms (default: 500)" },
          },
          required: ["selector", "direction"],
        },
      },
      {
        name: "scrollHorizontal",
        description: "Scroll element horizontally. For tables, carousels, and horizontally scrollable containers. Can scroll by pixels or to the end.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for element to scroll" },
            direction: { type: "string", enum: ["left", "right"], description: "Scroll direction" },
            amount: { description: "Pixels to scroll or 'full' for end" },
            behavior: { type: "string", enum: ["auto", "smooth"], description: "Scroll behavior (default: auto)" },
          },
          required: ["selector", "direction", "amount"],
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
        name: "convertFigmaToCode",
        description: "Convert Figma design to React/Tailwind code. Fetches node structure and rendered image, returns simplified design data with AI instructions for generating clean, semantic code. Focuses on React components with Tailwind CSS styling.",
        inputSchema: {
          type: "object",
          properties: {
            figmaToken: { type: "string", description: "API token (optional)" },
            fileKey: { type: "string", description: "File key" },
            nodeId: { type: "string", description: "Frame/component ID (formats: '123:456' or '123-456')" },
            framework: { type: "string", enum: ["react", "react-typescript", "html"], description: "Target framework (default: react)" },
            includeComments: { type: "boolean", description: "Include comments (default: true)" },
          },
          required: ["fileKey", "nodeId"],
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
        description: "PRIMARY tool for reading page state. Returns APOM (Agent Page Object Model) format by default with unique element IDs. Use element IDs with click/type tools instead of CSS selectors. Use refresh:true after clicks/submissions to see updated state. Efficient: 2-5k tokens vs screenshot 15-25k. Set useLegacyFormat:true for old format.",
        inputSchema: {
          type: "object",
          properties: {
            refresh: { type: "boolean", description: "Refresh cache (default: false)" },
            includeAll: { type: "boolean", description: "Include all elements on page, not just interactive ones (default: false)" },
            useLegacyFormat: { type: "boolean", description: "Return legacy format instead of APOM (default: false - APOM is now default)" },
            registerElements: { type: "boolean", description: "Auto-register elements in selector resolver (default: true)" },
            groupBy: { type: "string", description: "Group elements: 'type' or 'flat' (default: 'type')", enum: ["type", "flat"] },
          },
        },
      },
      {
        name: "getElementByApomId",
        description: "Get detailed information about element by its APOM ID from analyzePage. Returns full element details including bounds, position, attributes, computed styles. Use this to inspect specific elements without re-analyzing entire page.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "APOM element ID (e.g., 'input_20', 'button_45') from analyzePage result" },
          },
          required: ["id"],
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
        description: "Find elements by visible text content and get their selectors. Use this INSTEAD of executeScript when you need to find elements. Returns working selectors that can be used with click/type tools. Can optionally perform actions directly.",
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
        name: "selectFromGroup",
        description: "Select option(s) from radio or checkbox group by name attribute. For radio groups: selects one option. For checkbox groups: supports multi-select with modes (set/add/remove/toggle). Use 'name' to identify the group, and 'value'/'text' to select by value or label. See groups in analyzePage output for available options.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name attribute of the radio/checkbox group (e.g., 'size', 'topping')" },
            value: { type: "string", description: "Single value to select (for radio or single checkbox)" },
            values: { type: "array", items: { type: "string" }, description: "Multiple values to select (for checkbox group)" },
            text: { type: "string", description: "Label text to match (alternative to value)" },
            texts: { type: "array", items: { type: "string" }, description: "Multiple label texts to match (for checkbox group)" },
            mode: { type: "string", enum: ["set", "add", "remove", "toggle"], description: "For checkboxes: 'set' (replace all), 'add', 'remove', 'toggle' (default: 'set')" },
            by: { type: "string", enum: ["value", "text", "auto"], description: "Match by value, label text, or auto-detect (default: 'auto')" },
          },
          required: ["name"],
        },
      },
      {
        name: "enableRecorder",
        description: "Check ChromeTools Extension connection status for scenario recording. Recording is now handled via Chrome Extension popup (click CT icon in Chrome toolbar). Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/.",
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
        description: "Export recorded scenario as executable test code for creating a NEW test file. Automatically cleans unstable selectors (CSS modules, styled-components). Optionally generates Page Object class. Returns JSON with code and suggested filename - Claude Code will create the file. To add tests to EXISTING files, use 'appendScenarioToFile' instead. Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/. Use global index at ~/.config/chrometools-mcp/index.json to discover available projects and scenarios.",
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
        name: "appendScenarioToFile",
        description: "Append recorded scenario as test code to an EXISTING test file. Automatically cleans unstable selectors (CSS modules, styled-components). Optionally generates Page Object class. Returns JSON with test code and target file - Claude Code will append to the file without overwriting existing tests. To create NEW test files, use 'exportScenarioAsCode' instead. Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/. Use global index at ~/.config/chrometools-mcp/index.json to discover available projects and scenarios.",
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
            targetFile: {
              type: "string",
              description: "Path to existing test file to append to (REQUIRED)"
            },
            testName: {
              type: "string",
              description: "Override test name (default: from scenario name)"
            },
            insertPosition: {
              type: "string",
              enum: ["end", "before", "after"],
              description: "Where to insert test: 'end' (default - after all tests), 'before' (before reference test), or 'after' (after reference test)"
            },
            referenceTestName: {
              type: "string",
              description: "Reference test name for 'before'/'after' insertion. Required when insertPosition is 'before' or 'after'"
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
          required: ["scenarioName", "language", "targetFile"],
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
      {
        name: "listTabs",
        description: "List all open browser tabs with their URLs, titles, and active status. Use this to see all tabs opened manually or via window.open/target='_blank'. Returns tab index for use with switchTab.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "switchTab",
        description: "Switch active browser tab by index or URL pattern. After switch, all subsequent commands will target the new active tab. Use listTabs first to see available tabs.",
        inputSchema: {
          type: "object",
          properties: {
            tab: {
              oneOf: [
                { type: "number", minimum: 0, description: "Tab index (0-based)" },
                { type: "string", description: "URL pattern to match (partial match)" }
              ],
              description: "Tab identifier: index number or URL pattern to match"
            },
          },
          required: ["tab"],
        },
      },
];

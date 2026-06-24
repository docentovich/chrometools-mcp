/**
 * server/tool-schemas.js
 *
 * Zod schemas for all MCP tools
 */

import { z } from 'zod';

// Basic tools
export const PingSchema = z.object({
  message: z.string().optional().describe("Optional message to send"),
});

export const OpenBrowserSchema = z.object({
  url: z.string().describe("URL to open in the browser"),
});

export const ClickSchema = z.object({
  id: z.string().optional().describe("APOM element ID from analyzePage (e.g., 'button_45', 'link_7'). Mutually exclusive with selector."),
  selector: z.string().optional().describe("CSS selector for element to click. Mutually exclusive with id."),
  waitAfter: z.number().optional().describe("Milliseconds to wait after click (default: 1500)"),
  screenshot: z.boolean().optional().describe("Capture screenshot after click (default: false for performance)"),
  timeout: z.number().optional().describe("Maximum time to wait for operation in ms (default: 30000)"),
  skipNetworkWait: z.boolean().optional().describe("Skip waiting for network requests (default: false). Use for forms with long-polling/WebSockets to avoid timeouts."),
  networkWaitTimeout: z.number().optional().describe("Maximum time to wait for network requests in ms (default: 3000). Only used if skipNetworkWait is false."),
  waitForSelector: z.string().optional().describe("CSS selector to wait for after click — atomic click+wait. Useful for dropdowns/popups in portals (e.g. '#menu-popup-root > div') that otherwise race against the next MCP call."),
  waitTimeoutMs: z.number().optional().describe("Timeout for waitForSelector in ms (default: 2000)."),
  waitForRouteChange: z.boolean().optional().describe("For SPAs (React Router etc.): after click, wait for location.pathname+search to change relative to before. Surfaces 'routeChanged:true/false' so success means the view actually navigated, not just that the click was delivered. Does not fail the click on timeout. For content that renders without a URL change, prefer waitForSelector."),
  autoAnalyzeAfter: z.boolean().optional().describe("After click, automatically diff APOM state and append a delta to the result: '+N appeared: id1:\"text\", id2:\"text\"'. New ids are re-registered so callers can use them directly in the next click/type call without an extra analyzePage. Use for dropdowns and menus that reveal new options on click."),
}).refine(data => (data.id && !data.selector) || (!data.id && data.selector), {
  message: "Either 'id' or 'selector' must be provided, but not both"
});

export const TypeSchema = z.object({
  id: z.string().optional().describe("APOM element ID from analyzePage (e.g., 'input_20', 'input_33'). Mutually exclusive with selector."),
  selector: z.string().optional().describe("CSS selector for input element. Mutually exclusive with id."),
  text: z.string().describe("Text to type"),
  delay: z.number().optional().describe("Delay between keystrokes in ms (default: 30)"),
  clearFirst: z.boolean().optional().describe("Clear field before typing (default: true)"),
  timeout: z.number().optional().describe("Maximum time to wait for operation in ms (default: 30000)"),
}).refine(data => (data.id && !data.selector) || (!data.id && data.selector), {
  message: "Either 'id' or 'selector' must be provided, but not both"
});

export const HoverSchema = z.object({
  id: z.string().optional().describe("APOM element ID from analyzePage. Mutually exclusive with selector."),
  selector: z.string().optional().describe("CSS selector for element to hover. Mutually exclusive with id."),
}).refine(data => (data.id && !data.selector) || (!data.id && data.selector), {
  message: "Either 'id' or 'selector' must be provided, but not both"
});

export const PressKeySchema = z.object({
  id: z.string().optional().describe("APOM element ID to focus before pressing. Optional."),
  selector: z.string().optional().describe("CSS selector to focus before pressing. Optional."),
  key: z.string().describe("Key to press: 'Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Space'"),
  modifiers: z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta'])).optional()
    .describe("Modifier keys to hold: ['Control'], ['Shift', 'Alt'], etc."),
});

export const SelectOptionSchema = z.object({
  id: z.string().optional().describe("APOM element ID from analyzePage for select element. Mutually exclusive with selector."),
  selector: z.string().optional().describe("CSS selector for select element. Mutually exclusive with id."),
  value: z.string().optional().describe("Value of option to select (option's value attribute)"),
  text: z.string().optional().describe("Text content of option to select"),
  index: z.number().min(0).optional().describe("Index of option to select (0-based)"),
}).refine(data => (data.id && !data.selector) || (!data.id && data.selector), {
  message: "Either 'id' or 'selector' must be provided, but not both"
});

export const ExecuteModelActionSchema = z.object({
  id: z.string().optional().describe("Element APOM ID (e.g., 'input_20', 'button_5') from analyzePage. Mutually exclusive with selector."),
  selector: z.string().optional().describe("CSS selector (alternative to id). Mutually exclusive with id."),
  action: z.string().describe("Action name to execute (e.g., 'type', 'click', 'SetDate', 'selectOption'). See element's model in analyzePage 'models' map for available actions for each model type."),
  params: z.record(z.any()).optional().describe("Action parameters (depends on action). Examples: {text: 'hello'} for type, {date: '2024-03-15'} for SetDate, {value: 'US'} for selectOption, {checked: true} for check"),
}).refine(data => (data.id && !data.selector) || (!data.id && data.selector), {
  message: "Either 'id' or 'selector' must be provided, but not both"
});

export const DragSchema = z.object({
  selector: z.string().describe("CSS selector for element to drag"),
  direction: z.enum(['up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right'])
    .describe("Direction to drag: vertical (up, down), horizontal (left, right), or diagonal (up-left, up-right, down-left, down-right)"),
  distance: z.number().min(1).optional().describe("Distance to drag in pixels (default: 100)"),
  duration: z.number().min(100).optional().describe("Duration of drag operation in milliseconds (default: 500)"),
  mode: z.enum(['native', 'synthetic']).optional().describe("Drag mode: 'native' uses Puppeteer mouse API (default, faster), 'synthetic' dispatches DOM events (better compatibility with JS libraries like frappe-gantt, jQuery UI)"),
});

export const ScrollHorizontalSchema = z.object({
  selector: z.string().describe("CSS selector for element to scroll"),
  direction: z.enum(['left', 'right']).describe("Direction to scroll horizontally"),
  amount: z.union([z.number().min(1), z.literal('full')]).describe("Amount to scroll in pixels, or 'full' to scroll to the end"),
  behavior: z.enum(['auto', 'smooth']).optional().describe("Scroll behavior (default: auto)"),
});

// CSS tools
export const GetComputedCssSchema = z.object({
  selector: z.string().optional().describe("CSS selector (optional, defaults to body)"),
  category: z.enum(['all', 'layout', 'typography', 'colors', 'visual']).optional().describe("Filter by CSS category: 'layout' (sizing, positioning), 'typography' (fonts, text), 'colors' (color schemes), 'visual' (effects, transforms), 'all' (default)"),
  properties: z.array(z.string()).optional().describe("Specific CSS properties to return (e.g., ['color', 'font-size']). Overrides category filter."),
  includeDefaults: z.boolean().optional().describe("Include properties with default values (default: false)"),
});

export const GetBoxModelSchema = z.object({
  selector: z.string().describe("CSS selector for element"),
});

export const SetStylesSchema = z.object({
  selector: z.string().describe("CSS selector for element to modify"),
  styles: z.array(z.object({
    name: z.string().describe("CSS property name (e.g., 'color')"),
    value: z.string().describe("CSS property value (e.g., 'red')")
  })).describe("Array of CSS property name-value pairs"),
});

// Screenshot tools
export const ScreenshotSchema = z.object({
  id: z.string().optional().describe("APOM element ID from analyzePage (e.g., 'div_20'). Mutually exclusive with selector. If neither id nor selector is provided, captures full viewport."),
  selector: z.string().optional().describe("CSS selector for element to screenshot. Mutually exclusive with id. If neither id nor selector is provided, captures full viewport."),
  padding: z.number().optional().describe("Padding around element in pixels (default: 0). Ignored for viewport screenshot."),
  maxWidth: z.number().nullable().optional().describe("Maximum width in pixels, auto-scales if larger (default: 1024, set to null for original size)"),
  maxHeight: z.number().nullable().optional().describe("Maximum height in pixels, auto-scales if larger (default: 8000 for API limit, set to null for original size)"),
  quality: z.number().min(1).max(100).optional().describe("JPEG quality 1-100 (default: 40)"),
  format: z.enum(['png', 'jpeg', 'auto']).optional().describe("Image format (default: 'jpeg')"),
}).refine(data => !(data.id && data.selector), {
  message: "Provide only one of 'id' or 'selector' (or neither for a viewport screenshot)"
});

export const SaveScreenshotSchema = z.object({
  selector: z.string().describe("CSS selector for element to screenshot"),
  filePath: z.string().describe("Absolute path where to save file"),
  padding: z.number().optional().describe("Padding around element in pixels (default: 0)"),
  maxWidth: z.number().nullable().optional().describe("Maximum width in pixels, auto-scales if larger (default: 1024, set to null for original size)"),
  maxHeight: z.number().nullable().optional().describe("Maximum height in pixels, auto-scales if larger (default: 8000 for API limit, set to null for original size)"),
  quality: z.number().min(1).max(100).optional().describe("JPEG quality 1-100 (default: 80, only applies to JPEG format)"),
  format: z.enum(['png', 'jpeg', 'auto']).optional().describe("Image format: 'png', 'jpeg', or 'auto' (default: 'auto' - chooses based on size)"),
});

// Navigation tools
export const ScrollToSchema = z.object({
  id: z.string().optional().describe("APOM element ID from analyzePage. Mutually exclusive with selector."),
  selector: z.string().optional().describe("CSS selector for element to scroll to. Mutually exclusive with id."),
  behavior: z.enum(['auto', 'smooth']).optional().describe("Scroll behavior (default: auto)"),
}).refine(data => (data.id && !data.selector) || (!data.id && data.selector), {
  message: "Either 'id' or 'selector' must be provided, but not both"
});

export const WaitForElementSchema = z.object({
  selector: z.string().describe("CSS selector to wait for"),
  timeout: z.number().optional().describe("Maximum time to wait in milliseconds (default: 5000)"),
  visible: z.boolean().optional().describe("Wait for element to be visible (default: true)"),
});

export const NavigateToSchema = z.object({
  url: z.string().describe("URL to navigate to"),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2'])
    .optional()
    .describe("Wait until event (default: networkidle2)"),
});

export const ListFramesSchema = z.object({});

export const SwitchFrameSchema = z.object({
  frameUrl: z.string().optional().describe("Substring matched against each frame's URL (e.g. 'app.example.com'). Selects the first matching frame, including cross-origin iframes (resolved via CDP, so Same-Origin Policy does not block access). Mutually exclusive with frameSelector."),
  frameSelector: z.string().optional().describe("CSS selector of the <iframe> element in the current document; its content frame becomes active. Mutually exclusive with frameUrl."),
}).describe("Set the active frame for subsequent click/type/hover/analyzePage/find/executeScript/waitForElement. Call with NO arguments to reset back to the main frame. Active frame is also reset automatically on navigateTo. Use listFrames() to discover available frames.");

export const SetViewportSchema = z.object({
  width: z.number().min(320).max(4000).describe("Viewport width in pixels (320-4000)"),
  height: z.number().min(200).max(3000).describe("Viewport height in pixels (200-3000)"),
  deviceScaleFactor: z.number().min(0.5).max(3).optional().describe("Device pixel ratio (0.5-3, default: 1)"),
});

export const GetViewportSchema = z.object({});

// Script execution
export const ExecuteScriptSchema = z.object({
  script: z.string().describe("JavaScript code to execute in page context"),
  waitAfter: z.number().optional().describe("Milliseconds to wait after execution (default: 500)"),
  screenshot: z.boolean().optional().describe("Capture screenshot after execution (default: false for performance)"),
  timeout: z.number().optional().describe("Maximum time to wait for operation in ms (default: 30000)"),
});

// Network monitoring tools
export const GetConsoleLogsSchema = z.object({
  types: z.array(z.enum(['log', 'warn', 'error', 'info', 'debug', 'verbose', 'warning']))
    .optional()
    .describe("Filter by log types (default: all)"),
  clear: z.boolean().optional().describe("Clear logs after reading (default: false)"),
});

export const ListNetworkRequestsSchema = z.object({
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

export const GetNetworkRequestSchema = z.object({
  requestId: z.string().describe("Request ID to get details for"),
});

export const FilterNetworkRequestsSchema = z.object({
  urlPattern: z.string().describe("URL pattern to filter by (regex or partial match)"),
  types: z.array(z.enum(['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Script', 'XHR', 'Fetch', 'WebSocket', 'Other']))
    .optional()
    .default(['Fetch', 'XHR'])
    .describe("Filter by request types (default: Fetch, XHR)"),
  clear: z.boolean().optional().describe("Clear requests after reading (default: false)"),
});

// Figma tools
export const GetFigmaFrameSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key (from URL: figma.com/file/FILE_KEY/...)"),
  nodeId: z.string().describe("Figma node ID (frame/component ID)"),
  scale: z.number().min(0.1).max(4).optional().describe("Export scale (0.1-4, default: 2)"),
  format: z.enum(['png', 'jpg', 'svg']).optional().describe("Export format (default: png)")
});

export const CompareFigmaToElementSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key"),
  nodeId: z.string().describe("Figma frame/component ID"),
  selector: z.string().describe("CSS selector for page element"),
  threshold: z.number().min(0).max(1).optional().describe("Difference threshold (0-1, default: 0.05)"),
  figmaScale: z.number().min(0.1).max(4).optional().describe("Figma export scale (default: 2)")
});

export const GetFigmaSpecsSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key"),
  nodeId: z.string().describe("Figma frame/component ID")
});

export const ParseFigmaUrlSchema = z.object({
  url: z.string().describe("Full Figma URL or fileKey")
});

export const ListFigmaPagesSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL")
});

export const SearchFigmaFramesSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL"),
  searchQuery: z.string().describe("Search query")
});

export const GetFigmaComponentsSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL")
});

export const GetFigmaStylesSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL")
});

export const GetFigmaColorPaletteSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key or full Figma URL")
});

export const ConvertFigmaToCodeSchema = z.object({
  figmaToken: z.string().optional().describe("Figma API token (optional if FIGMA_TOKEN env var is set)"),
  fileKey: z.string().describe("Figma file key (from URL: figma.com/file/FILE_KEY/...)"),
  nodeId: z.string().describe("Figma node ID (frame/component ID, formats: '123:456' or '123-456')"),
  framework: z.enum(['react', 'react-typescript', 'html']).optional().describe("Target framework (default: react)"),
  includeComments: z.boolean().optional().describe("Include descriptive comments in generated code (default: true)")
});

// Page analysis tools
export const SmartFindElementSchema = z.object({
  description: z.string().describe("Natural language description of element to find (e.g., 'login button', 'email field')"),
  maxResults: z.number().min(1).max(20).optional().describe("Maximum number of candidates to return (default: 5)"),
  minConfidence: z.number().min(0).max(1).optional().describe("Confidence threshold (0-1, default: 0.6) for auto-executing `action`. If the best match scores below this, OR is too close to the runner-up, the action is SKIPPED and candidates are returned with an 'actionSkipped' reason — prevents auto-clicking the wrong control (e.g. a primary form submit when you asked for a menu item). Lower it to act on weaker matches."),
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

export const AnalyzePageSchema = z.object({
  refresh: z.boolean().optional().describe("Force refresh of cached analysis (default: false)"),
  includeAll: z.boolean().optional().describe("Include all elements on page, not just interactive ones (default: false). When false (default), returns compact format: containers as \"tag_id\":[children], interactive elements without selectors. When true, returns full format with selectors for debugging."),
  useLegacyFormat: z.boolean().optional().describe("Return legacy format instead of APOM (default: false - APOM is now the default format)"),
  registerElements: z.boolean().optional().describe("Automatically register elements in selector resolver (default: true)"),
  groupBy: z.enum(['type', 'flat']).optional().describe("Group elements by type or return flat structure (default: 'type')"),
  viewportOnly: z.boolean().optional().describe("Only analyze elements visible in current viewport (default: false). Reduces output for long pages."),
  diff: z.boolean().optional().describe("Return only changes since last analysis: {added, removed, changed} (default: false). Useful after clicks to see what changed."),
  includePortals: z.boolean().optional().describe("Include contents of React Portal containers that live outside main React root (default: true). Covers menus, tooltips, popovers rendered via portals — without this, dropdown contents are invisible to analyzePage."),
  portalSelectors: z.array(z.string()).optional().describe("CSS selectors of portal root containers to scan (default: ['#modal-root', '#menu-popup-root', '#tooltip-root', '#popover-root', '[data-portal]']). Provide custom list when the app uses different portal element ids."),
});

export const GetElementDetailsSchema = z.object({
  id: z.string().describe("APOM element ID (e.g., 'input_20', 'button_45') from analyzePage result"),
  analyzeChildren: z.boolean().optional().describe("Analyze children elements tree structure (default: false)"),
  includeAll: z.boolean().optional().describe("When analyzing children, include all elements, not just interactive ones (default: false)"),
  refresh: z.boolean().optional().describe("Force refresh of cached analysis (default: false)"),
});

export const FindElementsByTextSchema = z.object({
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

// Group selection tools
export const SelectFromGroupSchema = z.object({
  name: z.string().describe("Name attribute of the radio/checkbox group"),
  value: z.string().optional().describe("Single value to select (for radio or single checkbox)"),
  values: z.array(z.string()).optional().describe("Multiple values to select (for checkbox group)"),
  text: z.string().optional().describe("Label text to match (alternative to value)"),
  texts: z.array(z.string()).optional().describe("Multiple label texts to match (for checkbox group)"),
  mode: z.enum(['set', 'add', 'remove', 'toggle']).optional().describe("For checkboxes: 'set' (replace), 'add', 'remove', 'toggle' (default: 'set')"),
  by: z.enum(['value', 'text', 'auto']).optional().describe("Match by value, text, or auto-detect (default: 'auto')"),
});

// Recorder tools (schemas created from inline definitions)
export const EnableRecorderSchema = z.object({
  directory: z.string().optional().describe("Directory to save scenarios (optional, defaults to auto-detected project root)")
});

export const ExecuteScenarioSchema = z.object({
  name: z.string().describe("Scenario name"),
  projectId: z.string().optional().describe("Optional: Project ID (domain) to disambiguate scenarios with same name"),
  parameters: z.record(z.any()).optional().describe("Execution parameters"),
  executeDependencies: z.boolean().optional().describe("Execute dependencies (default: true)")
});

export const ListScenariosSchema = z.object({
  directory: z.string().optional().describe("Directory where scenarios are stored (optional)")
});

export const SearchScenariosSchema = z.object({
  text: z.string().optional().describe("Search text"),
  tags: z.array(z.string()).optional().describe("Filter tags"),
  directory: z.string().optional().describe("Directory where scenarios are stored (optional)")
});

export const GetScenarioInfoSchema = z.object({
  name: z.string().describe("Scenario name"),
  includeSecrets: z.boolean().optional().describe("Include secrets (default: false)"),
  directory: z.string().optional().describe("Directory where scenarios are stored (optional)")
});

export const DeleteScenarioSchema = z.object({
  name: z.string().describe("Scenario name"),
  directory: z.string().optional().describe("Directory where scenarios are stored (optional)")
});

export const ExportScenarioAsCodeSchema = z.object({
  scenarioName: z.string().describe("Name of scenario to export"),
  language: z.enum(['playwright-typescript', 'playwright-python', 'selenium-python', 'selenium-java']).describe("Target test framework and language"),
  cleanSelectors: z.boolean().optional().describe("Remove unstable CSS classes (default: true)"),
  includeComments: z.boolean().optional().describe("Include descriptive comments (default: true)"),
  generatePageObject: z.boolean().optional().describe("Also generate Page Object class for the page (default: false)"),
  pageObjectClassName: z.string().optional().describe("Page Object class name (optional, auto-generated if not provided)"),
  pageObjectMode: z.enum(['none', 'generate', 'generate-integrated', 'use-existing']).optional()
    .describe("POM integration: 'none' (default), 'generate' (separate POM, current behavior), 'generate-integrated' (POM + test using it), 'use-existing' (test uses existing POM file)"),
  pageObjectFile: z.string().optional()
    .describe("Path to existing POM file (for 'use-existing' mode)"),
  directory: z.string().optional().describe("Directory where scenarios are stored (optional)"),
  appendToFile: z.string().optional().describe("Path to existing test file to append to (enables append mode)"),
  testName: z.string().optional().describe("Override test name (default: from scenario name)"),
  insertPosition: z.enum(['end', 'before', 'after']).optional().describe("Where to insert test: 'end' (default), 'before', or 'after' a reference test"),
  referenceTestName: z.string().optional().describe("Reference test name for 'before'/'after' insertion")
});

export const GeneratePageObjectSchema = z.object({
  className: z.string().optional().describe("Page Object class name (optional, auto-generated from page title/URL if not provided)"),
  framework: z.enum(['playwright-typescript', 'playwright-python', 'selenium-python', 'selenium-java']).optional().describe("Target test framework (default: playwright-typescript)"),
  includeComments: z.boolean().optional().describe("Include descriptive comments in generated code (default: true)"),
  groupElements: z.boolean().optional().describe("Group elements by page sections (default: true)")
});

// Tab management tools
export const ListTabsSchema = z.object({});

export const SwitchTabSchema = z.object({
  tab: z.union([
    z.number().min(0).describe("Tab index (0-based)"),
    z.string().describe("URL pattern to match (partial match)")
  ]).describe("Tab identifier: index number or URL pattern to match"),
});

// API / Swagger tools
export const LoadSwaggerSchema = z.object({
  source: z.string().describe("URL (http/https) or local file path to swagger.json / openapi.yaml"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format. 'auto' (default) detects from extension/content"),
});

export const GenerateApiModelsSchema = z.object({
  source: z.string().describe("URL or file path to OpenAPI spec"),
  language: z.enum(['typescript', 'python']).describe("Target language for models"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format (default: auto)"),
  style: z.enum(['interface', 'type']).optional()
    .describe("TypeScript only: 'interface' (default) or 'type' aliases"),
  pythonStyle: z.enum(['dataclass', 'pydantic', 'typeddict']).optional()
    .describe("Python only: 'dataclass' (default), 'pydantic', or 'typeddict'"),
  includeEnums: z.boolean().optional()
    .describe("Generate enum types (default: true)"),
  includeValidation: z.boolean().optional()
    .describe("Include validation constraints as comments (default: false)"),
  schemas: z.array(z.string()).optional()
    .describe("Generate only these schemas (default: all)"),
});


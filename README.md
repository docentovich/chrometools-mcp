# chrometools-mcp

MCP server for Chrome automation using Puppeteer with persistent browser sessions.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [AI Optimization Features](#ai-optimization-features) ⭐ **NEW**
- [Scenario Recorder](#scenario-recorder) ⭐ **NEW** - Visual UI-based recording with smart optimization
- [Available Tools](#available-tools) - **44+ Tools Total**
  - [AI-Powered Tools](#ai-powered-tools) ⭐ **NEW** - smartFindElement, analyzePage, getAllInteractiveElements, findElementsByText
  - [Core Tools](#1-core-tools) - ping, openBrowser
  - [Interaction Tools](#2-interaction-tools) - click, type, scrollTo, selectOption, dragScroll, scrollHorizontal
  - [Inspection Tools](#3-inspection-tools) - getElement, getComputedCss, getBoxModel, screenshot
  - [Advanced Tools](#4-advanced-tools) - executeScript, getConsoleLogs, listNetworkRequests, getNetworkRequest, filterNetworkRequests, hover, setStyles, setViewport, getViewport, navigateTo
  - [Recorder Tools](#6-recorder-tools) ⭐ **NEW** - enableRecorder, executeScenario, listScenarios, searchScenarios, getScenarioInfo, deleteScenario, exportScenarioAsCode, appendScenarioToFile, generatePageObject
- [Typical Workflow Example](#typical-workflow-example)
- [Tool Usage Tips](#tool-usage-tips)
- [Configuration](#configuration)
- [WSL Setup Guide](#wsl-setup-guide) → [Full WSL Guide](WSL_SETUP.md)
- [Development](#development)
- [Features](#features)
- [Architecture](#architecture)

## Installation

```bash
npx -y chrometools-mcp
```

## Usage

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "chrometools": {
      "command": "npx",
      "args": ["-y", "chrometools-mcp"]
    }
  }
}
```

## AI Optimization Features

⭐ **NEW**: Dramatically reduce AI agent request cycles with intelligent element finding and page analysis.

### Why This Matters

Traditional browser automation with AI requires many trial-and-error cycles:
```
AI: "Find login button"
→ Try selector #1: Not found
→ Try selector #2: Not found
→ Try selector #3: Found! (3 requests, 15-30 seconds)
```

**With AI optimization:**
```
AI: smartFindElement("login button")
→ Returns ranked candidates with confidence scores (1 request, 2 seconds)
```

### Key Features

1. **`analyzePage`** - 🔥 **USE FREQUENTLY** - Get current page state after loads, clicks, submissions (cached, use refresh:true)
2. **`smartFindElement`** - Natural language element search with multilingual support
3. **AI Hints** - Automatic context in all tools (page type, available actions, suggestions)
4. **Batch helpers** - `getAllInteractiveElements`, `findElementsByText`

**Performance:** 3-5x faster, 5-10x fewer requests

**Best Practice:**
- Use `analyzePage()` after page loads AND after interactions (clicks, submissions)
- Use `analyzePage({ refresh: true })` after page changes to see current state
- Prefer `analyzePage` over `screenshot` for debugging form data

📚 [Full AI Optimization Guide](AI_OPTIMIZATION.md)

## Scenario Recorder

⭐ **NEW**: Visual UI-based recorder for creating reusable test scenarios with automatic secret detection.

### Features

- **Visual Widget** - Floating recorder UI with compact mode (50x50px minimize button)
- **Auto-Reinjection** - Recorder persists across page reloads/navigation automatically with duplicate prevention ⭐ **IMPROVED**
- **Smart Click Detection** - Finds actual clickable parent elements with event listeners ⭐ **NEW**
- **Smart Waiters** - 2s minimum + animation/network/DOM change detection after clicks ⭐ **NEW**
- **Detailed Error Reports** - Comprehensive failure analysis with context and suggestions ⭐ **NEW**
- **Smart Recording** - Captures clicks, typing, navigation with intelligent optimization
- **Secret Detection** - Auto-detects passwords/emails and stores them securely
- **Action Optimization** - Combines sequential actions, removes duplicates
- **Scenario Management** - Save, load, execute, search, and delete scenarios
- **Dependencies** - Chain scenarios together with dependency resolution
- **Multi-Instance Protection** - Prevents multiple recorder instances from interfering ⭐ **NEW**

### Quick Start

```javascript
// 1. Enable recorder UI
enableRecorder()

// 2. Click "Start" in widget, perform actions, click "Stop & Save"
// 3. Execute saved scenario
executeScenario({ name: "login_flow", parameters: { email: "user@test.com" } })
```

📚 [Full Recorder Guide](RECORDER_QUICKSTART.md) | [Recorder Spec](RECORDER_SPEC.md)

## Available Tools

### ⚠️ Tool Usage Priority

**CRITICAL: Always use specialized tools first. Never jump to `executeScript` as first choice.**

#### For Clicking/Interaction
1. ✅ **`click()`** - PRIMARY tool for all clicks
   - Works correctly with React/Vue/Angular synthetic events
   - Handles button clicks, link navigation, form submissions
2. ✅ **`findElementsByText()` + action** - When selector is unknown, find by text
3. ⚠️ **`executeScript()`** - LAST RESORT, only if above failed

#### For Filling Forms
1. ✅ **`type()`** - PRIMARY tool for all text input
   - Properly updates React hooks, Vue reactive data
   - Auto-clears field before typing (configurable)
2. ⚠️ **`executeScript()`** - LAST RESORT, only if above failed

#### For Reading Page State
1. ✅ **`analyzePage()`** - PRIMARY tool for reading page content
   - Gets forms, inputs, buttons, links with current values
   - Use `refresh: true` after interactions to see updated state
   - Efficient: 2-5k tokens vs screenshot 15-25k
2. ✅ **`findElementsByText()`** - Find specific elements by visible text
3. ✅ **`getElement()`** - Get HTML of specific element
4. ⚠️ **`executeScript()`** - LAST RESORT, only if above failed

**Why specialized tools matter:**
- ✅ Trigger proper browser events (click, input, change)
- ✅ Work with React/Vue/Angular synthetic event systems
- ✅ Update framework state correctly (React hooks, Vue reactivity)
- ✅ Handle animations, navigation, and async updates
- ❌ `executeScript` bypasses framework events and may fail silently

### AI-Powered Tools

#### smartFindElement ⭐
Find elements using natural language descriptions instead of CSS selectors.
- **Parameters**:
  - `description` (required): Natural language (e.g., "login button", "email field")
  - `maxResults` (optional): Max candidates to return (default: 5)
- **Use case**: When you don't know the exact selector
- **Returns**: Ranked candidates with confidence scores, selectors, and reasoning
- **Example**:
  ```json
  {
    "description": "submit button",
    "maxResults": 3
  }
  ```
  Returns:
  ```json
  {
    "candidates": [
      { "selector": "button.login-btn", "confidence": 0.95, "text": "Login", "reason": "type=submit, in form, matching keyword" },
      { "selector": "#submit", "confidence": 0.7, "text": "Send", "reason": "submit class" }
    ],
    "hints": { "suggestion": "Use selector: button.login-btn" }
  }
  ```

#### analyzePage ⭐ **USE FREQUENTLY**
Get current page state and structure. Returns complete map of forms (with values), inputs, buttons, links with selectors.
- **When to use**:
  - After opening/navigating to page (initial analysis)
  - **After clicking buttons** (see what changed)
  - **After form submissions** (check results, errors)
  - **After AJAX updates** (dynamic content loaded)
  - When debugging (see actual form values, not just visual)
  - **Layout/styling work** - use `includeAll: true` to get ALL page elements with selectors
- **Parameters**:
  - `refresh` (optional): Force refresh cache to get CURRENT state after changes (default: false)
  - `includeAll` (optional): Include ALL page elements, not just interactive ones (default: false). Useful for layout work - find any element, get its selector, then use `getComputedCss` or `setStyles` on it.
- **Why better than screenshot**:
  - Shows actual data (form values, validation errors) not just visual
  - Uses 2-5k tokens vs screenshot 15-25k tokens
  - Returns structured data with selectors
  - **Detects UI frameworks** (MUI, Ant Design, Chakra, Bootstrap, Vuetify, Semantic UI) ⭐ **NEW**
  - **Extracts dropdown options** from both native `<select>` and custom UI components ⭐ **NEW**
- **Returns**:
  - By default: Complete map of forms (with current values), inputs, buttons, links, navigation with selectors
  - **Each element includes `uiFramework` info** (name, version, component type) ⭐ **NEW**
  - **Select elements include `options` array** with value, text, index, selected, disabled, group ⭐ **NEW**
  - With `includeAll: true`: Also includes `allElements` array with ALL visible page elements (divs, spans, headings, etc.) - each with selector, tag, text, classes, id
- **Example workflow**:
  1. `openBrowser({ url: "..." })`
  2. `analyzePage()` ← Initial analysis
  3. `click({ selector: "submit-btn" })`
  4. **`analyzePage({ refresh: true })`** ← See what changed after click!
- **Layout work example**:
  1. `analyzePage({ includeAll: true })` ← Get all elements
  2. Find element you want to style (e.g., `div.header`)
  3. `getComputedCss({ selector: "div.header" })` ← Get current styles
  4. `setStyles({ selector: "div.header", styles: [...] })` ← Apply new styles

#### getAllInteractiveElements
Get all clickable/fillable elements with their selectors.
- **Parameters**:
  - `includeHidden` (optional): Include hidden elements (default: false)
- **Returns**: Array of all interactive elements with selectors and metadata

#### findElementsByText
Find elements by their visible text content.
- **Parameters**:
  - `text` (required): Text to search for
  - `exact` (optional): Exact match only (default: false)
  - `caseSensitive` (optional): Case sensitive search (default: false)
- **Returns**: Elements containing the text with their selectors

### 1. Core Tools

#### ping
Test MCP connection with a simple ping-pong response.
- **Parameters**: `message` (optional)
- **Example**: `{ "name": "ping", "arguments": { "message": "hello" } }`
- **Returns**: `pong: hello`

#### openBrowser
Opens browser and navigates to URL. Browser stays open for further interactions.
- **Parameters**: `url` (required)
- **Use case**: First step before other tools
- **Returns**: Page title + confirmation

### 2. Interaction Tools

#### click
Click an element with optional result screenshot.
- **Parameters**:
  - `selector` (required): CSS selector
  - `waitAfter` (optional): Wait time in ms (default: 1500)
  - `screenshot` (optional): Capture screenshot (default: false for performance) ⚡
  - `timeout` (optional): Max operation time in ms (default: 30000)
- **Use case**: Buttons, links, form submissions
- **Returns**: Confirmation text + optional screenshot
- **Performance**: 2-10x faster without screenshot

#### type
Type text into input fields with optional clearing and typing delay.
- **Parameters**:
  - `selector` (required): CSS selector
  - `text` (required): Text to type
  - `delay` (optional): Delay between keystrokes in ms
  - `clearFirst` (optional): Clear field first (default: true)
- **Use case**: Filling forms, search boxes, text inputs
- **Returns**: Confirmation text

#### scrollTo
Scroll page to bring element into view.
- **Parameters**:
  - `selector` (required): CSS selector
  - `behavior` (optional): "auto" or "smooth"
- **Use case**: Lazy loading, sticky elements, visibility checks
- **Returns**: Final scroll position

#### selectOption
Select option in dropdown (HTML select elements). Automatically detected by analyzePage with all available options.
- **Parameters**:
  - `selector` (required): CSS selector for select element
  - `value` (optional): Option value attribute (priority 1)
  - `text` (optional): Option text content (priority 2)
  - `index` (optional): Option index, 0-based (priority 3)
- **Use case**: Form dropdowns, filtering, selection menus
- **Returns**: Selected option details (value, text, index)
- **Selection priority**: If multiple parameters specified, tries value → text → index
- **AI Integration**: Use `analyzePage` to see all available options with their values, text, and indices

#### drag
Drag element by mouse (click-hold-move-release). Simulates real mouse drag, not scrollbar scrolling.
- **Parameters**:
  - `selector` (required): CSS selector for element to drag
  - `direction` (required): 'up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right'
  - `distance` (optional): Distance in pixels (default: 100)
  - `duration` (optional): Drag duration in milliseconds (default: 500)
- **Use case**: Interactive maps (Google Maps, Leaflet), Gantt charts, SVG diagrams, canvas elements, sliders, drag-to-pan interfaces
- **How it works**: Moves mouse to element center, presses mouse button, drags to target position, releases button
- **NOT for**: Standard overflow scrollbars (use `scrollTo` or `scrollHorizontal` instead)
- **Returns**: Start/end mouse positions and drag delta

#### scrollHorizontal
Scroll element horizontally (for tables, carousels, wide content).
- **Parameters**:
  - `selector` (required): CSS selector for element to scroll
  - `direction` (required): 'left' or 'right'
  - `amount` (required): Number of pixels to scroll, or 'full' to scroll to the end
  - `behavior` (optional): 'auto' or 'smooth' (default: 'auto')
- **Use case**: Wide tables, image carousels, horizontally scrollable containers
- **Returns**: Scroll state (position, total width, visible width, scroll availability)

### 3. Inspection Tools

#### getElement
Get HTML markup of element (defaults to body if no selector).
- **Parameters**: `selector` (optional)
- **Use case**: Inspecting structure, debugging markup
- **Returns**: Complete outerHTML

#### getComputedCss
Get computed CSS styles for an element with intelligent filtering to reduce token usage.
- **Parameters**:
  - `selector` (optional): CSS selector (defaults to body)
  - `category` (optional): Filter by category - 'layout', 'typography', 'colors', 'visual', or 'all' (default)
  - `properties` (optional): Array of specific properties to return (e.g., `['color', 'font-size']`) - overrides category filter
  - `includeDefaults` (optional): Include properties with default values (default: false)
- **Use case**: Debugging layout, verifying styles, design comparison
- **Returns**: JSON object with filtered CSS properties, metadata about filtering
- **Performance**: Without filters returns ~300 properties (~14k tokens). With filtering returns 10-50 properties (~1-2k tokens)
- **Example usage**:
  - Layout only: `{ selector: ".header", category: "layout" }`
  - Specific properties: `{ selector: ".title", properties: ["color", "font-size", "font-weight"] }`
  - Typography without defaults: `{ selector: "h1", category: "typography", includeDefaults: false }`

#### getBoxModel
Get precise dimensions, positioning, margins, padding, and borders.
- **Parameters**: `selector` (required)
- **Use case**: Pixel-perfect measurements, layout analysis
- **Returns**: Box model data + metrics

#### screenshot
Capture optimized screenshot of specific element with smart compression and automatic 3 MB limit.
- **Parameters**:
  - `selector` (required)
  - `padding` (optional): Padding in pixels (default: 0)
  - `maxWidth` (optional): Max width for auto-scaling (default: 1024, null for original size)
  - `maxHeight` (optional): Max height for auto-scaling (default: 8000, null for original size)
  - `quality` (optional): JPEG quality 1-100 (default: 80)
  - `format` (optional): 'png', 'jpeg', or 'auto' (default: 'auto')
- **Use case**: Visual documentation, bug reports
- **Returns**: Optimized image with metadata
- **Default behavior**: Auto-scales to 1024px width and 8000px height (API limit) and uses smart compression to reduce AI token usage
- **Automatic compression**: If image exceeds 3 MB, automatically reduces quality or scales down to fit within limit
- **For original quality**: Set `maxWidth: null`, `maxHeight: null` and `format: 'png'` (still enforces 3 MB limit)

#### saveScreenshot
Save optimized screenshot to filesystem without returning in context, with automatic 3 MB limit.
- **Parameters**:
  - `selector` (required)
  - `filePath` (required): Absolute path to save file
  - `padding` (optional): Padding in pixels (default: 0)
  - `maxWidth` (optional): Max width for auto-scaling (default: 1024, null for original)
  - `maxHeight` (optional): Max height for auto-scaling (default: 8000, null for original)
  - `quality` (optional): JPEG quality 1-100 (default: 80)
  - `format` (optional): 'png', 'jpeg', or 'auto' (default: 'auto')
- **Use case**: Baseline screenshots, file storage
- **Returns**: File path and metadata (not image data)
- **Default behavior**: Auto-scales and compresses to save disk space
- **Automatic compression**: If image exceeds 3 MB, automatically reduces quality or scales down to fit within limit

### 4. Advanced Tools

#### executeScript
Execute arbitrary JavaScript in page context with optional screenshot.
- **Parameters**:
  - `script` (required): JavaScript code
  - `waitAfter` (optional): Wait time in ms (default: 500)
  - `screenshot` (optional): Capture screenshot (default: false for performance) ⚡
  - `timeout` (optional): Max operation time in ms (default: 30000)
- **Use case**: Complex interactions, custom manipulations
- **Returns**: Execution result + optional screenshot
- **Performance**: 2-10x faster without screenshot

#### getConsoleLogs
Retrieve browser console logs (log, warn, error, etc.).
- **Parameters**:
  - `types` (optional): Array of log types to filter
  - `clear` (optional): Clear logs after reading (default: false)
- **Use case**: Debugging JavaScript errors, tracking behavior
- **Returns**: Array of log entries with timestamps

#### Network Monitoring (3 specialized tools)

**Auto-captures across page navigations**. All network requests are monitored automatically.

##### listNetworkRequests
Get compact summary of network requests with **pagination support** - minimal token usage.
- **Parameters**:
  - `types` (optional): Array of request types (default: `['Fetch', 'XHR']`)
  - `status` (optional): Filter by status (pending, completed, failed, all)
  - `limit` (optional): Maximum number of requests to return (default: 50, max: 500)
  - `offset` (optional): Number of requests to skip (default: 0)
  - `clear` (optional): Clear requests after reading (default: false)
- **Returns**: Object with `totalCount`, `returnedCount`, `hasMore`, `offset`, `limit`, and paginated `requests` array
- **Use case**: Quick overview of API calls with pagination for large request lists
- **Example**:
  - `listNetworkRequests()` → first 50 requests
  - `listNetworkRequests({ limit: 20, offset: 20 })` → requests 21-40
  - Response: `{ totalCount: 150, returnedCount: 50, hasMore: true, offset: 0, limit: 50, requests: [...] }`

##### getNetworkRequest
Get full details of a single request by ID.
- **Parameters**:
  - `requestId` (required): Request ID from listNetworkRequests
- **Returns**: Complete request/response with headers, payload, timing, mime type
- **Use case**: Deep dive into specific request after identifying it in list
- **Example**: `getNetworkRequest({ requestId: "123" })` → full details with headers, body, timing

##### filterNetworkRequests
Filter requests by URL pattern with full details.
- **Parameters**:
  - `urlPattern` (required): URL pattern (regex or partial match)
  - `types` (optional): Array of request types (default: `['Fetch', 'XHR']`)
  - `clear` (optional): Clear requests after reading (default: false)
- **Returns**: Array of full request details matching pattern
- **Use case**: Get all API calls to specific endpoint with complete data
- **Example**: `filterNetworkRequests({ urlPattern: "api/users" })` → all requests to /api/users with full details

**Workflow**:
1. `listNetworkRequests()` - see all requests (compact)
2. `getNetworkRequest({ requestId: "..." })` - inspect specific request
3. `filterNetworkRequests({ urlPattern: "api/..." })` - get all matching requests with details

#### hover
Simulate mouse hover over element.
- **Parameters**: `selector` (required)
- **Use case**: Testing hover effects, tooltips, dropdown menus
- **Returns**: Confirmation text

#### setStyles
Apply inline CSS styles to element for live editing.
- **Parameters**:
  - `selector` (required)
  - `styles` (required): Array of {name, value} pairs
- **Use case**: Testing design changes, rapid prototyping
- **Returns**: Applied styles confirmation

#### setViewport
Change viewport dimensions for responsive testing.
- **Parameters**:
  - `width` (required): 320-4000px
  - `height` (required): 200-3000px
  - `deviceScaleFactor` (optional): 0.5-3 (default: 1)
- **Use case**: Testing mobile, tablet, desktop layouts
- **Returns**: Actual viewport dimensions

#### getViewport
Get current viewport size and device pixel ratio.
- **Parameters**: None
- **Use case**: Checking current screen dimensions
- **Returns**: Viewport metrics (width, height, DPR)

#### navigateTo
Navigate to different URL while keeping browser instance.
- **Parameters**:
  - `url` (required)
  - `waitUntil` (optional): load event type
- **Use case**: Moving between pages in workflow
- **Returns**: New page title

### 5. Figma Tools ⭐ ENHANCED

Design-to-code validation, file browsing, design system extraction, and comparison tools with automatic 3 MB compression.

#### parseFigmaUrl ⭐ NEW
Parse Figma URL to extract fileKey and nodeId automatically.
- **Parameters**:
  - `url` (required): Full Figma URL or just fileKey
- **Supported formats**:
  - `https://www.figma.com/file/ABC123/Title?node-id=1-2`
  - `https://www.figma.com/design/ABC123/Title?node-id=1-2`
  - `ABC123` (just fileKey)
- **Use case**: No need to manually extract fileKey and nodeId from URLs
- **Returns**: `{ fileKey, nodeId }` object

#### listFigmaPages ⭐ NEW
Browse entire Figma file structure: all pages and frames with IDs.
- **Parameters**:
  - `figmaToken` (optional): Figma API token
  - `fileKey` (required): Figma file key or full URL
- **Use case**: **Use FIRST** to discover what's in the Figma file before requesting specific nodes
- **Returns**: Hierarchical structure with:
  - File metadata (name, version, lastModified)
  - All pages with names and IDs
  - All frames in each page with names, IDs, types, dimensions
- **Example output**:
  ```json
  {
    "fileName": "Design System",
    "pagesCount": 3,
    "pages": [
      {
        "name": "🎨 Components",
        "framesCount": 25,
        "frames": [
          { "id": "123:456", "name": "Button/Primary", "type": "FRAME" }
        ]
      }
    ]
  }
  ```

#### searchFigmaFrames ⭐ NEW
Search frames/components by name across entire Figma file.
- **Parameters**:
  - `figmaToken` (optional): Figma API token
  - `fileKey` (required): Figma file key or full URL
  - `searchQuery` (required): Search text (case-insensitive)
- **Use case**: Find specific frames/components without browsing manually
- **Returns**: All matching nodes with IDs, names, types, pages, dimensions
- **Example**: Search for "login" returns all frames containing "login" in name

#### getFigmaComponents ⭐ NEW
Extract all components from Figma file (Design System).
- **Parameters**:
  - `figmaToken` (optional): Figma API token
  - `fileKey` (required): Figma file key or full URL
- **Use case**: Get complete list of design system components
- **Returns**: All COMPONENT and COMPONENT_SET nodes with names, descriptions, dimensions

#### getFigmaStyles ⭐ NEW
Get all shared styles from Figma file (color, text, effect, grid styles).
- **Parameters**:
  - `figmaToken` (optional): Figma API token
  - `fileKey` (required): Figma file key or full URL
- **Use case**: Extract design tokens and shared styles for CSS/Tailwind generation
- **Returns**: Categorized styles:
  - Fill styles (colors)
  - Text styles (typography)
  - Effect styles (shadows, blur)
  - Grid styles

#### getFigmaColorPalette ⭐ NEW
Extract complete color palette with usage statistics.
- **Parameters**:
  - `figmaToken` (optional): Figma API token
  - `fileKey` (required): Figma file key or full URL
- **Use case**: Generate CSS color variables, understand color usage
- **Returns**: All unique colors with:
  - Hex and RGBA values
  - Usage count
  - Usage examples (where the color is used)
  - Sorted by usage frequency

#### convertFigmaToCode ⭐ NEW
Convert Figma designs to React/Tailwind code with AI assistance.
- **Parameters**:
  - `figmaToken` (optional): Figma API token
  - `fileKey` (required): Figma file key
  - `nodeId` (required): Frame/component ID (formats: '123:456' or '123-456')
  - `framework` (optional): 'react', 'react-typescript', or 'html' (default: 'react')
  - `includeComments` (optional): Include code comments (default: true)
- **Use case**: Rapid prototyping, design-to-code workflow, implementing Figma designs
- **How it works**:
  1. Fetches design structure (layout, colors, typography, spacing)
  2. Gets rendered design image at 2x resolution
  3. Returns AI-optimized instructions with simplified JSON structure
  4. AI generates clean React/Tailwind code matching the design
- **Returns**: Formatted instruction prompt containing:
  - Design image reference
  - Simplified JSON structure with layout, styling, text properties
  - Framework-specific guidelines (React components, TypeScript types, Tailwind classes)
  - Quality requirements (semantic HTML, accessibility, accurate spacing)
- **Best for**: UI components, landing pages, card designs, navigation bars

#### getFigmaFrame
Export and download a Figma frame as PNG/JPG image with automatic compression.
- **Parameters**:
  - `figmaToken` (optional): Figma API token (can use FIGMA_TOKEN env var)
  - `fileKey` (required): Figma file key from URL
  - `nodeId` (required): Figma frame/component ID
  - `scale` (optional): Export scale 0.1-4 (default: 2)
  - `format` (optional): 'png', 'jpg', 'svg' (default: 'png')
- **Use case**: Getting design references from Figma for comparison
- **Returns**: Figma frame metadata and compressed image
- **Automatic compression**: Images exceeding 3 MB are automatically compressed by reducing quality or scaling down

#### compareFigmaToElement
The GOLD STANDARD for design-to-code validation. Compares Figma design pixel-perfect with browser implementation.
- **Parameters**:
  - `figmaToken` (optional): Figma API token (can use FIGMA_TOKEN env var)
  - `fileKey` (required): Figma file key
  - `nodeId` (required): Figma frame ID
  - `selector` (required): CSS selector for page element to compare
  - `figmaScale` (optional): Figma export scale (default: 2)
  - `threshold` (optional): Difference threshold 0-1 (default: 0.05)
- **Use case**: Validating implementation matches design specifications
- **Returns**: Comparison analysis with SSIM score, difference percentage, and three images (Figma, Page, Diff map)
- **Automatic compression**: All three images are automatically compressed if they exceed 3 MB

#### getFigmaSpecs
Extract detailed design specifications from Figma including text content, colors, fonts, dimensions, and spacing.
- **Parameters**:
  - `figmaToken` (optional): Figma API token
  - `fileKey` (required): Figma file key
  - `nodeId` (required): Figma frame/component ID
- **Use case**: Getting exact design specifications and text content for implementation
- **Returns**: Complete design specs with:
  - **Text content**: All text from TEXT nodes (buttons, labels, headings, paragraphs)
  - **textContent**: Direct text for TEXT nodes
  - **allTextContent**: Array of all text nodes with names and visibility
  - **textSummary**: Total text nodes count, visible count, combined text
  - **Styling**: Colors (fills, strokes), typography (fonts, sizes, weights), effects (shadows, blur)
  - **Dimensions**: Width, height, x, y coordinates
  - **Children**: Recursive tree with text extraction from all child elements

### 6. Recorder Tools ⭐ NEW

**URL-Based Storage (v2.1+)**: Scenarios are automatically organized by website domain in `~/.config/chrometools-mcp/projects/{domain}/scenarios/`.

**Automatic Domain Detection**: Project ID is extracted from the URL where recording starts:
- `https://www.google.com` → `google`
- `https://dev.example.com:8080` → `example-8080`
- `http://localhost:3000` → `localhost-3000`
- `file:///test.html` → `local`

**Domain Organization Rules**:
1. Main domain only (subdomains stripped): `mail.google.com` → `google`
2. Ports included for ALL domains: `example.com:8080` → `example-8080`
3. Protocol ignored: `http` and `https` both → same project

**Global Scenario Access**: All tools (`listScenarios`, `searchScenarios`) return scenarios from **all projects**. Agent can filter by:
- `projectId`: Domain-based identifier (e.g., "google", "localhost-3000")
- `entryUrl`: URL where recording started
- `exitUrl`: URL where recording ended

**Example**:
```javascript
// Record scenario on google.com
enableRecorder()  // Saves to ~/.config/chrometools-mcp/projects/google/scenarios/

// List ALL scenarios from all websites
listScenarios()
// Returns: [
//   { name: "search", projectId: "google", entryUrl: "https://google.com" },
//   { name: "login", projectId: "localhost-3000", entryUrl: "http://localhost:3000" }
// ]

// Agent filters by projectId or URL
scenarios.filter(s => s.projectId === "google")
scenarios.filter(s => s.entryUrl.includes("localhost"))

// Execute scenario (searches all projects automatically)
executeScenario({ name: "login" })  // Finds scenario in any project
```

---

#### enableRecorder
Inject visual recorder UI widget into the current page. Scenarios are automatically saved to `~/.config/chrometools-mcp/projects/{domain}/scenarios/` based on the website URL.
- **Parameters**: None
- **Use case**: Start recording user interactions visually
- **Returns**: Success status with storage location
- **Features**:
  - Floating widget with compact mode (minimize to 50x50px)
  - Visual recording indicator (red pulsing border)
  - Start/Pause/Stop/Stop & Save/Clear controls
  - Real-time action list display
  - Metadata fields (name, description, tags)
  - Automatic domain-based project detection from URL

#### executeScenario
Execute a previously recorded scenario by name. Searches all projects automatically via global index.
- **Parameters**:
  - `name` (required): Scenario name
  - `projectId` (optional): Project ID (domain) to disambiguate when multiple scenarios have the same name. Examples: `"google"`, `"localhost-3000"`
  - `parameters` (optional): Runtime parameters (e.g., { email: "user@test.com" })
  - `executeDependencies` (optional): Execute dependencies before running scenario (default: true)
- **Use case**: Run automated test scenarios across projects
- **Returns**: Execution result with success/failure status
- **Features**:
  - Automatic dependency resolution (enabled by default)
  - Cross-project dependency support
  - Secret parameter injection
  - Fallback selector retry logic
  - Name collision detection with helpful error messages
- **Example**:
  ```javascript
  // Execute with dependencies (default)
  executeScenario({ name: "create_post" })

  // Execute without dependencies
  executeScenario({ name: "create_post", executeDependencies: false })

  // Disambiguate when multiple scenarios have same name
  executeScenario({ name: "login", projectId: "google" })
  executeScenario({ name: "login", projectId: "localhost-3000" })
  ```

- **Name Collision Handling**:
  If multiple scenarios with the same name exist across different projects, you'll get an error:
  ```json
  {
    "success": false,
    "error": "Multiple scenarios named 'login' found. Please specify projectId.",
    "availableProjectIds": ["google", "localhost-3000"],
    "hint": "Use: executeScenario({ name: \"login\", projectId: \"one-of-the-above\" })"
  }
  ```

#### listScenarios
Get all available scenarios with metadata from **all websites**. Agent can filter by `projectId`, `entryUrl`, or `exitUrl`.
- **Parameters**: None
- **Use case**: Browse recorded scenarios across all websites
- **Returns**: Array of scenarios with names, descriptions, tags, timestamps, `projectId`, `entryUrl`, `exitUrl`
- **Example**:
  ```javascript
  // List all scenarios from all websites
  const scenarios = await listScenarios()

  // Agent filters by projectId
  const googleScenarios = scenarios.filter(s => s.projectId === "google")

  // Agent filters by URL
  const localhostScenarios = scenarios.filter(s => s.entryUrl.includes("localhost"))
  ```

#### searchScenarios
Search scenarios by text or tags across **all websites**. Agent can further filter results by `projectId` or URLs.
- **Parameters**:
  - `text` (optional): Search in name/description
  - `tags` (optional): Array of tags to filter
- **Use case**: Find specific scenarios across all websites
- **Returns**: Matching scenarios with `projectId`, `entryUrl`, `exitUrl` metadata
- **Example**:
  ```javascript
  // Search across all websites
  const results = await searchScenarios({ text: "login" })

  // Search by tags
  const authScenarios = await searchScenarios({ tags: ["auth"] })

  // Agent filters results by domain
  const googleLogins = results.filter(s => s.projectId === "google")
  ```

#### getScenarioInfo
Get detailed information about a scenario. Searches all projects automatically.
- **Parameters**:
  - `name` (required): Scenario name
  - `includeSecrets` (optional): Include secret values (default: false)
- **Use case**: Inspect scenario actions and dependencies
- **Returns**: Full scenario details (actions, metadata, dependencies, project info)

#### deleteScenario
Delete a scenario and its associated secrets. Searches all projects to find the scenario.
- **Parameters**:
  - `name` (required): Scenario name
- **Use case**: Clean up unused scenarios
- **Returns**: Success confirmation

#### exportScenarioAsCode ⭐ **NEW**
Export recorded scenario as executable test code for creating a **NEW** test file. Automatically cleans unstable selectors (CSS Modules, styled-components, Emotion). Optionally generates Page Object class. Returns JSON with code and suggested filename - Claude Code will create the file. To add tests to **EXISTING** files, use `appendScenarioToFile` instead.

- **Parameters**:
  - `scenarioName` (required): Name of scenario to export
  - `language` (required): Target framework - `"playwright-typescript"`, `"playwright-python"`, `"selenium-python"`, `"selenium-java"`
  - `cleanSelectors` (optional): Remove unstable CSS classes (default: true)
  - `includeComments` (optional): Include descriptive comments (default: true)
  - `generatePageObject` (optional): Also generate Page Object class for the page (default: false)
  - `pageObjectClassName` (optional): Custom Page Object class name (auto-generated if not provided)

- **Use case**: Create new test files from recorded scenarios with optional Page Objects

- **Returns**: JSON with:
  - `action`: `"create_new_file"`
  - `suggestedFileName`: Suggested test filename
  - `testCode`: Full test code with imports
  - `instruction`: Instructions for Claude Code
  - `pageObject` (if `generatePageObject=true`): Page Object code and metadata

- **Example 1 - Test only**:
  ```javascript
  // Export scenario as new Playwright TypeScript file
  exportScenarioAsCode({
    scenarioName: "checkout_flow",
    language: "playwright-typescript"
  })

  // Returns JSON:
  {
    "action": "create_new_file",
    "suggestedFileName": "checkout_flow.spec.ts",
    "testCode": "import { test, expect } from '@playwright/test';\n\ntest('checkout_flow', async ({ page }) => {\n  await page.goto('https://example.com');\n  await page.locator('button[data-testid=\"add-to-cart\"]').click();\n  await expect(page).toHaveURL(/checkout/);\n});",
    "instruction": "Create a new test file 'checkout_flow.spec.ts' with the testCode."
  }
  ```

- **Example 2 - Test + Page Object**:
  ```javascript
  // Export with Page Object class
  exportScenarioAsCode({
    scenarioName: "login_test",
    language: "playwright-typescript",
    generatePageObject: true,
    pageObjectClassName: "LoginPage"
  })

  // Returns JSON with both files:
  {
    "action": "create_new_file",
    "suggestedFileName": "login_test.spec.ts",
    "testCode": "import { test } from '@playwright/test';\nimport { LoginPage } from './LoginPage';\n\ntest('login_test', async ({ page }) => {\n  const loginPage = new LoginPage(page);\n  await loginPage.goto();\n  await loginPage.fillEmailInput('user@test.com');\n  await loginPage.clickLoginButton();\n});",
    "pageObject": {
      "code": "import { Page, Locator } from '@playwright/test';\n\nexport class LoginPage { ... }",
      "className": "LoginPage",
      "suggestedFileName": "LoginPage.ts",
      "elementCount": 12
    },
    "instruction": "Create a new test file 'login_test.spec.ts' with the testCode. Also create a Page Object file 'LoginPage.ts' with the pageObject.code."
  }
  ```

- **Selector Cleaning**: Automatically removes unstable patterns:
  - CSS Modules: `Button_primary__2x3yZ` → removed
  - Styled-components: `sc-AbCdEf-0` → removed
  - Emotion: `css-1a2b3c4d` → removed
  - Hash suffixes: `component_a1b2c3d` → removed
  - Prefers stable selectors: `data-testid`, `role`, `aria-label`, semantic attributes

#### appendScenarioToFile ⭐ **NEW v2.3.0**
Append recorded scenario as test code to an **EXISTING** test file. Automatically cleans unstable selectors (CSS Modules, styled-components, Emotion). Optionally generates Page Object class. Returns JSON with test code (without imports) - Claude Code will read the file, append the test, and write back. To create **NEW** test files, use `exportScenarioAsCode` instead.

- **Parameters**:
  - `scenarioName` (required): Name of scenario to export
  - `language` (required): Target framework - `"playwright-typescript"`, `"playwright-python"`, `"selenium-python"`, `"selenium-java"`
  - `targetFile` (required): Path to existing test file to append to
  - `testName` (optional): Override test name (default: from scenario name)
  - `insertPosition` (optional): Where to insert: `'end'` (default), `'before'`, `'after'`
  - `referenceTestName` (optional): Reference test name for 'before'/'after' insertion
  - `cleanSelectors` (optional): Remove unstable CSS classes (default: true)
  - `includeComments` (optional): Include descriptive comments (default: true)
  - `generatePageObject` (optional): Also generate Page Object class for the page (default: false)
  - `pageObjectClassName` (optional): Custom Page Object class name (auto-generated if not provided)

- **Use case**: Add tests to existing test files without overwriting current tests

- **Architecture**: MCP server generates only test code (without imports). Claude Code reads the target file, appends the test at the specified position, and writes the file back. This separation ensures MCP doesn't need file system access to test files.

- **Returns**: JSON with:
  - `action`: `"append_test"`
  - `targetFile`: Path to file to update
  - `testCode`: Test code only (without imports/headers)
  - `testName`: Name of test to append
  - `insertPosition`: Where to insert test
  - `referenceTestName`: Reference test for 'before'/'after' positioning
  - `instruction`: Instructions for Claude Code to read/append/write
  - `pageObject` (if `generatePageObject=true`): Page Object code and metadata

- **Example 1 - Append to end**:
  ```javascript
  // Append test to end of existing file
  appendScenarioToFile({
    scenarioName: "new_feature_test",
    language: "playwright-typescript",
    targetFile: "./tests/features.spec.ts"
  })

  // Returns JSON:
  {
    "action": "append_test",
    "targetFile": "./tests/features.spec.ts",
    "testCode": "test('new_feature_test', async ({ page }) => {\n  // Test implementation\n  await page.click('#submit');\n  await expect(page.locator('.result')).toBeVisible();\n});",
    "testName": "new_feature_test",
    "insertPosition": "end",
    "referenceTestName": null,
    "instruction": "Read file './tests/features.spec.ts', append the testCode at position 'end', then write the file back."
  }
  ```

- **Example 2 - Insert before specific test**:
  ```javascript
  // Insert test before specific test
  appendScenarioToFile({
    scenarioName: "setup_test",
    language: "selenium-python",
    targetFile: "./tests/test_suite.py",
    insertPosition: "before",
    referenceTestName: "test_main",
    testName: "test_setup_data"
  })
  ```

- **Example 3 - Append with Page Object**:
  ```javascript
  // Append test and generate Page Object
  appendScenarioToFile({
    scenarioName: "login_test",
    language: "playwright-typescript",
    targetFile: "./tests/auth.spec.ts",
    generatePageObject: true,
    pageObjectClassName: "LoginPage"
  })

  // Returns JSON with both test code and Page Object:
  {
    "action": "append_test",
    "targetFile": "./tests/auth.spec.ts",
    "testCode": "test('login_test', async ({ page }) => {\n  await page.fill('#username', 'user');\n  await page.fill('#password', 'pass');\n  await page.click('button[type=\"submit\"]');\n});",
    "testName": "login_test",
    "insertPosition": "end",
    "referenceTestName": null,
    "pageObject": {
      "code": "export class LoginPage { ... }",
      "className": "LoginPage",
      "suggestedFileName": "LoginPage.ts",
      "elementCount": 8
    },
    "instruction": "Read file './tests/auth.spec.ts', append the testCode at position 'end', then write the file back. Also create a Page Object file 'LoginPage.ts' with the provided pageObject.code."
  }
  ```

#### generatePageObject ⭐ **NEW**
Generate Page Object Model (POM) class from current page structure. Analyzes page, extracts interactive elements, and generates framework-specific code with smart naming and helper methods.

- **Parameters**:
  - `className` (optional): Page Object class name (auto-generated from page title/URL if not provided)
  - `framework` (optional): Target framework - `"playwright-typescript"` (default), `"playwright-python"`, `"selenium-python"`, `"selenium-java"`
  - `includeComments` (optional): Include descriptive comments (default: true)
  - `groupElements` (optional): Group elements by page sections (default: true)

- **Features**:
  - **Smart Selector Generation**: Prioritizes id > name > data-testid > unique class > CSS path
  - **Intelligent Naming**: Auto-generates element names from labels, placeholders, text, attributes
  - **Section Grouping**: Groups elements by semantic sections (header, nav, form, footer, main, etc.)
  - **Helper Methods**: Auto-generates fill() and click() methods for common actions
  - **Multi-Framework**: Supports Playwright (TS/Python) and Selenium (Python/Java)

- **Use cases**:
  - Generate POM classes for test automation
  - Create maintainable test structure from existing pages
  - Bootstrap test framework setup quickly
  - Extract page structure for documentation

- **Returns**: Page Object code with metadata (className, url, title, elementCount, framework)

- **Example**:
  ```javascript
  // 1. Navigate to page
  openBrowser({ url: "https://example.com/login" })

  // 2. Generate Page Object
  generatePageObject({
    className: "LoginPage",
    framework: "playwright-typescript",
    includeComments: true,
    groupElements: true
  })

  // Returns:
  {
    "success": true,
    "className": "LoginPage",
    "url": "https://example.com/login",
    "title": "Login - Example Site",
    "elementCount": 12,
    "framework": "playwright-typescript",
    "code": "import { Page, Locator } from '@playwright/test';\n\nexport class LoginPage {\n  readonly page: Page;\n  \n  /** Email input field */\n  readonly emailInput: Locator;\n  /** Password input field */\n  readonly passwordInput: Locator;\n  /** Login button */\n  readonly loginButton: Locator;\n  \n  constructor(page: Page) {\n    this.page = page;\n    this.emailInput = page.locator('#email');\n    this.passwordInput = page.locator('#password');\n    this.loginButton = page.locator('button[type=\"submit\"]');\n  }\n  \n  async goto() {\n    await this.page.goto('https://example.com/login');\n  }\n  \n  async fillEmailInput(text: string) {\n    await this.emailInput.fill(text);\n  }\n  \n  async fillPasswordInput(text: string) {\n    await this.passwordInput.fill(text);\n  }\n  \n  async clickLoginButton() {\n    await this.loginButton.click();\n  }\n}"
  }
  ```

- **Supported Frameworks**:
  - `playwright-typescript`: Playwright with TypeScript (locators, async/await, Page Object pattern)
  - `playwright-python`: Playwright with Python (sync API, snake_case naming)
  - `selenium-python`: Selenium with Python (WebDriver, explicit waits, By locators)
  - `selenium-java`: Selenium with Java (WebDriver, Page Factory compatible)

#### registerPageObject ⭐ **NEW**
Register Page Object elements for use with IDs instead of CSS selectors. Enables backward-compatible dual selector mode: all interaction tools accept BOTH Page Object IDs and regular CSS selectors.

- **Parameters**:
  - `elements` (required): Array of elements to register, each with:
    - `id` (required): Unique element ID (e.g., `"login_email_input"`)
    - `selector` (required): CSS selector for the element
    - `metadata` (optional): Additional element info (type, label, options, uiFramework, etc.)
  - `clearExisting` (optional): Clear existing registry before registering (default: false)

- **Why use Page Object IDs?**
  - **More maintainable**: IDs are meaningful (`"login_submit_button"` vs `"button[type='submit']"`)
  - **Less fragile**: CSS selectors can break when UI changes; centralized IDs are easier to update
  - **Better for AI**: Descriptive IDs help AI understand page structure
  - **Backward compatible**: Tools still accept regular CSS selectors

- **After registration, use IDs in all interaction tools**:
  - `click({ selector: "login_submit_button" })` ← Page Object ID
  - `type({ selector: "email_input", text: "user@test.com" })` ← Page Object ID
  - `selectOption({ selector: "country_dropdown", value: "US" })` ← Page Object ID
  - Or still use CSS: `click({ selector: "button[type='submit']" })` ← Still works!

- **Returns**: Success confirmation with count of registered elements

- **Example workflow**:
  ```javascript
  // 1. Generate Page Object (gets element IDs and selectors)
  const pageObject = generatePageObject({ className: "LoginPage" })

  // 2. Extract elements from generated Page Object
  const elements = [
    { id: "login_email_input", selector: "#email", metadata: { type: "email" } },
    { id: "login_password_input", selector: "#password", metadata: { type: "password" } },
    { id: "login_submit_button", selector: "button[type='submit']" }
  ]

  // 3. Register elements
  registerPageObject({ elements })

  // 4. Now use IDs instead of selectors
  type({ selector: "login_email_input", text: "user@example.com" })  // ← ID!
  type({ selector: "login_password_input", text: "secret123" })      // ← ID!
  click({ selector: "login_submit_button" })                          // ← ID!
  ```

- **UI Framework Detection Integration**:
  - When using with `analyzePage`, elements include `uiFramework` in metadata
  - For dropdowns, metadata includes `options` array with all available choices
  - Works with MUI, Ant Design, Chakra UI, Bootstrap, Vuetify, Semantic UI

---

## Typical Workflow Example

```javascript
// 1. Open page
openBrowser({ url: "https://example.com/form" })

// 2. Fill form
type({ selector: "input[name='email']", text: "user@example.com" })
type({ selector: "input[name='password']", text: "secret123" })

// 3. Submit
click({ selector: "button[type='submit']" })

// 4. Verify
getElement({ selector: ".success-message" })
screenshot({ selector: ".dashboard", padding: 20 })
```

---

## Tool Usage Tips

**Persistent Browser:**
- Browser windows remain open after each command
- Manual interaction possible between AI requests
- All tools work with currently open page

**Best Practices:**
- Start with `openBrowser` to establish context
- Use `screenshot` to verify visual results
- Combine tools for complex workflows
- Tools use CDP (Chrome DevTools Protocol) for precision

## Configuration

### Basic Configuration (Linux, macOS, Windows)

Add the MCP server to your MCP client configuration file:

**Claude Desktop** (`~/.claude/mcp_config.json` or `~/AppData/Roaming/Claude/mcp_config.json` on Windows):

```json
{
  "mcpServers": {
    "chrometools": {
      "command": "npx",
      "args": ["-y", "chrometools-mcp"]
    }
  }
}
```

**Claude Code** (`~/.claude.json`):

```json
{
  "mcpServers": {
    "chrometools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrometools-mcp"],
      "env": {}
    }
  }
}
```

### GUI Mode vs Headless Mode

The MCP server runs Chrome with `headless: false` by default, which means:
- ✅ Browser windows are visible on your screen
- ✅ You can interact with pages between AI requests
- ✅ You can see what the automation is doing in real-time

**Requirements for GUI Mode:**
- **Linux/macOS**: X server (usually available by default)
- **WSL (Windows Subsystem for Linux)**: Requires X server setup (see WSL Setup Guide below)
- **Windows**: No additional setup needed

**Alternative: Headless Mode with Virtual Display (xvfb)**

If you don't need to see the browser window, you can use xvfb (virtual X server):

```json
{
  "mcpServers": {
    "chrometools": {
      "type": "stdio",
      "command": "xvfb-run",
      "args": ["-a", "npx", "-y", "chrometools-mcp"],
      "env": {}
    }
  }
}
```

This runs Chrome in GUI mode but on a virtual display (window is not visible).

### Tool Filtering with ENABLED_TOOLS

By default, all tools are enabled. You can selectively enable only specific tool groups using the `ENABLED_TOOLS` environment variable.

**Why filter tools?**

Each tool definition is sent to the AI in every request, consuming context tokens. All 43 tools consume ~28k tokens (~14% of context window). By enabling only the groups you need, you can significantly reduce token usage:

- **Save tokens:** Fewer tools = less context consumed per request
- **Reduce costs:** Lower token usage means lower API costs
- **Improve focus:** AI sees only relevant tools for your workflow
- **Security/compliance:** Restrict available capabilities when needed

**Available Tool Groups:**

| Group | Description | Tools (count) |
|-------|-------------|---------------|
| `core` | Basic tools | `ping`, `openBrowser` (2) |
| `interaction` | User interaction | `click`, `type`, `scrollTo`, `waitForElement`, `hover` (5) |
| `inspection` | Page inspection | `getElement`, `getComputedCss`, `getBoxModel`, `screenshot`, `saveScreenshot` (5) |
| `debug` | Debugging & network | `getConsoleLogs`, `listNetworkRequests`, `getNetworkRequest`, `filterNetworkRequests` (4) |
| `advanced` | Advanced automation & AI | `executeScript`, `setStyles`, `setViewport`, `getViewport`, `navigateTo`, `smartFindElement`, `analyzePage`, `getAllInteractiveElements`, `findElementsByText` (9) |
| `recorder` | Scenario recording | `enableRecorder`, `executeScenario`, `listScenarios`, `searchScenarios`, `getScenarioInfo`, `deleteScenario`, `exportScenarioAsCode`, `appendScenarioToFile`, `generatePageObject` (9) |
| `figma` | Figma integration | `getFigmaFrame`, `compareFigmaToElement`, `getFigmaSpecs`, `parseFigmaUrl`, `listFigmaPages`, `searchFigmaFrames`, `getFigmaComponents`, `getFigmaStyles`, `getFigmaColorPalette`, `convertFigmaToCode` (10) |

**Total:** 44 tools across 7 groups

**Configuration:**

**Claude Desktop** (`~/.claude/mcp_config.json`):

```json
{
  "mcpServers": {
    "chrometools": {
      "command": "npx",
      "args": ["-y", "chrometools-mcp"],
      "env": {
        "ENABLED_TOOLS": "core,interaction,inspection"
      }
    }
  }
}
```

**Claude Code** (`~/.claude.json`):

```json
{
  "mcpServers": {
    "chrometools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrometools-mcp"],
      "env": {
        "ENABLED_TOOLS": "core,interaction,advanced"
      }
    }
  }
}
```

**Format:**
- Comma-separated list of group names (e.g., `"core,interaction,advanced"`)
- Spaces are automatically trimmed
- If not set or empty, all tools are enabled (default behavior)

**Example configurations:**

**Basic automation only:**
```json
"ENABLED_TOOLS": "core,interaction,inspection"
```

**Advanced automation with AI:**
```json
"ENABLED_TOOLS": "core,interaction,advanced"
```

**With debugging tools:**
```json
"ENABLED_TOOLS": "core,interaction,inspection,debug"
```

**Figma design validation:**
```json
"ENABLED_TOOLS": "core,figma"
```

**Full automation with recording:**
```json
"ENABLED_TOOLS": "core,interaction,inspection,debug,advanced,recorder"
```

**All tools (default):**
```json
"env": {}
```
or omit the `env` field entirely.

### Figma API Token Setup

To use Figma tools, you need to configure your Figma Personal Access Token.

**How to get your Figma token:**
1. Go to your Figma account settings: https://www.figma.com/settings
2. Scroll down to "Personal access tokens"
3. Click "Create a new personal access token"
4. Give it a name (e.g., "chrometools-mcp")
5. Copy the generated token

**Add token to MCP configuration:**

**Claude Desktop** (`~/.claude/mcp_config.json` or `~/AppData/Roaming/Claude/mcp_config.json` on Windows):

```json
{
  "mcpServers": {
    "chrometools": {
      "command": "npx",
      "args": ["-y", "chrometools-mcp"],
      "env": {
        "FIGMA_TOKEN": "your-figma-token-here"
      }
    }
  }
}
```

**Claude Code** (`~/.claude.json`):

```json
{
  "mcpServers": {
    "chrometools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrometools-mcp"],
      "env": {
        "FIGMA_TOKEN": "your-figma-token-here"
      }
    }
  }
}
```

**Note:** Alternatively, you can pass the token directly in each Figma tool call using the `figmaToken` parameter, but using the environment variable is more convenient.

---

## WSL Setup Guide

If you're using **Windows Subsystem for Linux (WSL)**, special configuration is required to display Chrome GUI windows.

📖 **See the complete WSL Setup Guide:** [WSL_SETUP.md](WSL_SETUP.md)

The guide includes:
- Step-by-step VcXsrv installation and configuration
- MCP server configuration for WSL (3 different options)
- Testing and troubleshooting procedures
- Solutions for common issues
- All reference links and resources

**Quick Summary for WSL Users:**
1. Install VcXsrv on Windows ([Download](https://sourceforge.net/projects/vcxsrv/))
2. Enable "Disable access control" in VcXsrv settings ⚠️ (Critical!)
3. Configure MCP server with `DISPLAY=<your-windows-ip>:0` environment variable
4. Fully restart your MCP client

For detailed instructions, see [WSL_SETUP.md](WSL_SETUP.md).

---

## Development

```bash
# Install dependencies
npm install

# Run locally
npm start

# Test with MCP inspector
npx @modelcontextprotocol/inspector node index.js
```

## Features

- **28+ Powerful Tools**: Complete toolkit for browser automation
  - Core: ping, openBrowser
  - Interaction: click, type, scrollTo, selectOption, drag, scrollHorizontal
  - Inspection: getElement, getComputedCss, getBoxModel, screenshot
  - Advanced: executeScript, getConsoleLogs, getNetworkRequests, hover, setStyles, setViewport, getViewport, navigateTo
  - AI-Powered: smartFindElement, analyzePage, getAllInteractiveElements, findElementsByText
  - Page Object: generatePageObject, registerPageObject ⭐ **NEW**
  - Recorder: enableRecorder, executeScenario, listScenarios, searchScenarios, getScenarioInfo, deleteScenario
  - Figma: getFigmaFrame, compareFigmaToElement, getFigmaSpecs
- **UI Framework Detection**: Automatic detection of MUI, Ant Design, Chakra UI, Bootstrap, Vuetify, Semantic UI ⭐ **NEW**
- **Smart Dropdown Handling**: Extracts options from both native `<select>` and custom UI framework components ⭐ **NEW**
- **Page Object ID Support**: Use meaningful IDs instead of fragile CSS selectors (backward compatible) ⭐ **NEW**
- **Console Log Capture**: Automatic JavaScript console monitoring
- **Network Request Monitoring**: Track all HTTP/API requests (XHR, Fetch, etc.)
- **Persistent Browser Sessions**: Browser tabs remain open between requests
- **Visual Browser (GUI Mode)**: See automation in real-time
- **Cross-platform**: Works on Windows/WSL, Linux, macOS
- **Simple Installation**: One command with npx
- **CDP Integration**: Uses Chrome DevTools Protocol for precision
- **AI-Friendly**: Detailed descriptions optimized for AI agents
- **Responsive Testing**: Built-in viewport control for mobile/tablet/desktop

## Architecture

- Uses Puppeteer for Chrome automation
- MCP Server SDK for protocol implementation
- Zod for schema validation
- Stdio transport for communication

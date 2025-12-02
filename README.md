# chrometools-mcp

MCP server for Chrome automation using Puppeteer with persistent browser sessions.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [AI Optimization Features](#ai-optimization-features) ⭐ **NEW**
- [Scenario Recorder](#scenario-recorder) ⭐ **NEW** - Visual UI-based recording with smart optimization
- [Available Tools](#available-tools) - **33+ Tools Total**
  - [AI-Powered Tools](#ai-powered-tools) ⭐ **NEW** - smartFindElement, analyzePage, getAllInteractiveElements, findElementsByText
  - [Core Tools](#1-core-tools) - ping, openBrowser
  - [Interaction Tools](#2-interaction-tools) - click, type, scrollTo
  - [Inspection Tools](#3-inspection-tools) - getElement, getComputedCss, getBoxModel, screenshot
  - [Advanced Tools](#4-advanced-tools) - executeScript, getConsoleLogs, listNetworkRequests, getNetworkRequest, filterNetworkRequests, hover, setStyles, setViewport, getViewport, navigateTo
  - [Angular Tools](#6-angular-tools) ⭐ **NEW** - listAngularComponents, getAngularComponent, callAngularMethod, getAngularForm, submitAngularForm
  - [Recorder Tools](#7-recorder-tools) ⭐ **NEW** - enableRecorder, executeScenario, listScenarios, searchScenarios, getScenarioInfo, deleteScenario
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
- **Parameters**:
  - `refresh` (optional): Force refresh cache to get CURRENT state after changes (default: false)
- **Why better than screenshot**:
  - Shows actual data (form values, validation errors) not just visual
  - Uses 2-5k tokens vs screenshot 15-25k tokens
  - Returns structured data with selectors
- **Returns**: Complete map of forms (with current values), inputs, buttons, links, navigation with selectors
- **Example workflow**:
  1. `openBrowser({ url: "..." })`
  2. `analyzePage()` ← Initial analysis
  3. `click({ selector: "submit-btn" })`
  4. **`analyzePage({ refresh: true })`** ← See what changed after click!

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
Get compact summary of network requests - **minimal token usage**.
- **Parameters**:
  - `types` (optional): Array of request types (default: `['Fetch', 'XHR']`)
  - `status` (optional): Filter by status (pending, completed, failed, all)
  - `clear` (optional): Clear requests after reading (default: false)
- **Returns**: Array with `requestId`, `method`, `url`, `status`, `statusCode`, `type`
- **Use case**: Quick overview of API calls, identify requests of interest
- **Example**: `listNetworkRequests()` → `[{ requestId: "123", method: "POST", url: "/api/login", status: "completed", statusCode: 200 }]`

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

### 5. Figma Tools

Design-to-code validation and comparison tools with automatic 3 MB compression for all images.

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

### 6. Angular Tools ⭐ NEW

Specialized tools for Angular applications. Much better than `executeScript` for Angular-specific operations.

#### listAngularComponents
List all Angular components on the page with their available methods and properties.
- **Parameters**:
  - `includeHidden` (optional): Include components in hidden tabs/panels (default: false)
- **Returns**: Array of components with selector, component name, methods, properties count
- **Use case**: **Use this FIRST** to discover what Angular components are available before trying to call methods
- **Example**:
  ```javascript
  listAngularComponents()
  → {
    "components": [
      {
        "selector": "kp-admin-create-notifications",
        "componentName": "CreateNotificationsComponent",
        "methods": ["resetForm", "loadData"],
        "sampleProperties": ["notificationForm", "isLoading"]
      }
    ]
  }
  ```

#### getAngularComponent
Get detailed information about a specific Angular component.
- **Parameters**:
  - `selector` (required): CSS selector for the component
  - `includePrivate` (optional): Include private methods/properties (default: false)
- **Returns**: Component name, all methods, all properties with types and values
- **Use case**: Inspect specific component to see available methods and current state
- **Example**: `getAngularComponent({ selector: "kp-admin-chat-notifications" })`

#### callAngularMethod
Call a public method on an Angular component.
- **Parameters**:
  - `selector` (required): CSS selector for the component
  - `method` (required): Method name to call
  - `args` (optional): Array of method arguments (default: [])
- **Returns**: Method return value
- **Use case**: Reliably call component methods without executeScript. Automatically triggers change detection.
- **Example**:
  ```javascript
  callAngularMethod({
    selector: "kp-admin-notifications",
    method: "sendNotification",
    args: []
  })
  ```

#### getAngularForm
Get Angular reactive form data, validation state, and errors. Returns both `value` and `rawValue` - use `rawValue` to see disabled controls.
- **Parameters**:
  - `selector` (required): CSS selector for component containing the form
  - `formProperty` (optional): Form property name (auto-detects if omitted)
- **Returns**: Form validity, `value`, `rawValue` (includes disabled controls), errors (all fields), status
- **Use case**: Check form state before submission, debug validation errors, inspect disabled controls
- **Example**:
  ```javascript
  getAngularForm({ selector: "kp-admin-chat-notifications" })
  → {
    "valid": false,
    "value": { "message": "", "recipients": [] },
    "rawValue": { "message": "", "recipients": [], "recipients_by_selected_filters": [...] },
    "errors": {
      "message": { "required": true },
      "recipients.0": { "minLength": {...} }
    },
    "note": "rawValue includes disabled controls that are excluded from value"
  }
  ```

  **Important**: If a form control is disabled, it won't appear in `value` but WILL appear in `rawValue`. This is Angular's default behavior - use `rawValue` when debugging why data is "missing".

#### submitAngularForm
Submit Angular form programmatically with automatic fallback strategies.
- **Parameters**:
  - `selector` (required): CSS selector for component containing the form
  - `formProperty` (optional): Form property name (auto-detects if omitted)
  - `waitForResponse` (optional): Wait for network request after submit (default: true)
- **Returns**: Success status and which strategy worked
- **Automatic strategies** (tries in order):
  1. Component submit methods (submit, submitForm, onSubmit, save, send, submitNotificationForm)
  2. Form.submit() if form property specified
  3. Click submit button
  4. Dispatch native submit event
- **Use case**: Most reliable way to submit Angular forms - tries multiple methods automatically
- **Example**: `submitAngularForm({ selector: "kp-admin-create-notifications" })`

**Workflow for Angular apps**:
```javascript
1. listAngularComponents() → see all components and their methods
2. getAngularForm({ selector: "..." }) → check form is valid
3. submitAngularForm({ selector: "..." }) → submit with auto fallbacks
```

### 7. Recorder Tools ⭐ NEW

#### enableRecorder
Inject visual recorder UI widget into the current page.
- **Parameters**: None
- **Use case**: Start recording user interactions visually
- **Returns**: Success status
- **Features**:
  - Floating widget with compact mode (minimize to 50x50px)
  - Visual recording indicator (red pulsing border)
  - Start/Pause/Stop/Stop & Save/Clear controls
  - Real-time action list display
  - Metadata fields (name, description, tags)

#### executeScenario
Execute a previously recorded scenario by name.
- **Parameters**:
  - `name` (required): Scenario name
  - `parameters` (optional): Runtime parameters (e.g., { email: "user@test.com" })
  - `executeDependencies` (optional): Execute dependencies before running scenario (default: true)
- **Use case**: Run automated test scenarios
- **Returns**: Execution result with success/failure status
- **Features**:
  - Automatic dependency resolution (enabled by default)
  - Secret parameter injection
  - Fallback selector retry logic
- **Example**:
  ```javascript
  // Execute with dependencies (default)
  executeScenario({ name: "create_post" })

  // Execute without dependencies
  executeScenario({ name: "create_post", executeDependencies: false })
  ```

#### listScenarios
Get all available scenarios with metadata.
- **Parameters**: None
- **Use case**: Browse recorded scenarios
- **Returns**: Array of scenarios with names, descriptions, tags, timestamps

#### searchScenarios
Search scenarios by text or tags.
- **Parameters**:
  - `text` (optional): Search in name/description
  - `tags` (optional): Array of tags to filter
- **Use case**: Find specific scenarios
- **Returns**: Matching scenarios

#### getScenarioInfo
Get detailed information about a scenario.
- **Parameters**:
  - `name` (required): Scenario name
  - `includeSecrets` (optional): Include secret values (default: false)
- **Use case**: Inspect scenario actions and dependencies
- **Returns**: Full scenario details (actions, metadata, dependencies)

#### deleteScenario
Delete a scenario and its associated secrets.
- **Parameters**: `name` (required)
- **Use case**: Clean up unused scenarios
- **Returns**: Success confirmation

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

- **27+ Powerful Tools**: Complete toolkit for browser automation
  - Core: ping, openBrowser
  - Interaction: click, type, scrollTo
  - Inspection: getElement, getComputedCss, getBoxModel, screenshot
  - Advanced: executeScript, getConsoleLogs, getNetworkRequests, hover, setStyles, setViewport, getViewport, navigateTo
  - AI-Powered: smartFindElement, analyzePage, getAllInteractiveElements, findElementsByText
  - Recorder: enableRecorder, executeScenario, listScenarios, searchScenarios, getScenarioInfo, deleteScenario
  - Figma: getFigmaFrame, compareFigmaToElement, getFigmaSpecs
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

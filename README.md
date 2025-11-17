# chrometools-mcp

MCP server for Chrome automation using Puppeteer with persistent browser sessions.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [AI Optimization Features](#ai-optimization-features) ⭐ **NEW**
- [Scenario Recorder](#scenario-recorder) ⭐ **NEW** - Visual UI-based recording with smart optimization
- [Available Tools](#available-tools) - **26+ Tools Total**
  - [AI-Powered Tools](#ai-powered-tools) ⭐ **NEW** - smartFindElement, analyzePage, getAllInteractiveElements, findElementsByText
  - [Core Tools](#1-core-tools) - ping, openBrowser
  - [Interaction Tools](#2-interaction-tools) - click, type, scrollTo
  - [Inspection Tools](#3-inspection-tools) - getElement, getComputedCss, getBoxModel, screenshot
  - [Advanced Tools](#4-advanced-tools) - executeScript, getConsoleLogs, hover, setStyles, setViewport, getViewport, navigateTo
  - [Recorder Tools](#5-recorder-tools) ⭐ **NEW** - enableRecorder, executeScenario, listScenarios, searchScenarios, getScenarioInfo, deleteScenario
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

1. **`smartFindElement`** - Natural language element search with multilingual support
2. **`analyzePage`** - Complete page structure in one request (cached)
3. **AI Hints** - Automatic context in all tools (page type, available actions, suggestions)
4. **Batch helpers** - `getAllInteractiveElements`, `findElementsByText`

**Performance:** 3-5x faster, 5-10x fewer requests

📚 [Full AI Optimization Guide](AI_OPTIMIZATION.md)

## Scenario Recorder

⭐ **NEW**: Visual UI-based recorder for creating reusable test scenarios with automatic secret detection.

### Features

- **Visual Widget** - Floating recorder UI with compact mode (50x50px minimize button)
- **Auto-Reinjection** - Recorder persists across page reloads/navigation automatically
- **Smart Click Detection** - Finds actual clickable parent elements with event listeners ⭐ **NEW**
- **Smart Waiters** - 2s minimum + animation/network/DOM change detection after clicks ⭐ **NEW**
- **Detailed Error Reports** - Comprehensive failure analysis with context and suggestions ⭐ **NEW**
- **Smart Recording** - Captures clicks, typing, navigation with intelligent optimization
- **Secret Detection** - Auto-detects passwords/emails and stores them securely
- **Action Optimization** - Combines sequential actions, removes duplicates
- **Scenario Management** - Save, load, execute, search, and delete scenarios
- **Dependencies** - Chain scenarios together with dependency resolution

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

#### analyzePage ⭐
Get complete page structure in one request. Results are cached per URL.
- **Parameters**:
  - `refresh` (optional): Force refresh cache (default: false)
- **Use case**: Understanding page structure before planning actions
- **Returns**: Complete map of forms, inputs, buttons, links, navigation with selectors
- **Example**: Returns structured data for all interactive elements on the page

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
Click an element and capture result screenshot.
- **Parameters**:
  - `selector` (required): CSS selector
  - `waitAfter` (optional): Wait time in ms (default: 1500)
- **Use case**: Buttons, links, form submissions
- **Returns**: Confirmation text + screenshot

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
Get all computed CSS styles for an element.
- **Parameters**: `selector` (optional)
- **Use case**: Debugging layout, verifying styles
- **Returns**: JSON object with CSS properties

#### getBoxModel
Get precise dimensions, positioning, margins, padding, and borders.
- **Parameters**: `selector` (required)
- **Use case**: Pixel-perfect measurements, layout analysis
- **Returns**: Box model data + metrics

#### screenshot
Capture optimized screenshot of specific element with smart compression.
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
- **For original quality**: Set `maxWidth: null`, `maxHeight: null` and `format: 'png'`

#### saveScreenshot
Save optimized screenshot to filesystem without returning in context.
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

### 4. Advanced Tools

#### executeScript
Execute arbitrary JavaScript in page context.
- **Parameters**:
  - `script` (required): JavaScript code
  - `waitAfter` (optional): Wait time in ms (default: 500)
- **Use case**: Complex interactions, custom manipulations
- **Returns**: Execution result + screenshot

#### getConsoleLogs
Retrieve browser console logs (log, warn, error, etc.).
- **Parameters**:
  - `types` (optional): Array of log types to filter
  - `clear` (optional): Clear logs after reading (default: false)
- **Use case**: Debugging JavaScript errors, tracking behavior
- **Returns**: Array of log entries with timestamps

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

### 5. Recorder Tools ⭐ NEW

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
- **Use case**: Run automated test scenarios
- **Returns**: Execution result with success/failure status
- **Features**:
  - Automatic dependency resolution
  - Secret parameter injection
  - Fallback selector retry logic

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

- **16 Powerful Tools**: Complete toolkit for browser automation
  - Core: ping, openBrowser
  - Interaction: click, type, scrollTo
  - Inspection: getElement, getComputedCss, getBoxModel, screenshot
  - Advanced: executeScript, getConsoleLogs, hover, setStyles, setViewport, getViewport, navigateTo
- **Console Log Capture**: Automatic JavaScript console monitoring
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

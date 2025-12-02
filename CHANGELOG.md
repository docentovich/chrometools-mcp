# Changelog

All notable changes to this project will be documented in this file.

## [1.5.0] - 2025-12-02

### Added
- **6 new Figma tools** - Major enhancement to Figma integration (total: 9 Figma tools)
  - `parseFigmaUrl` - Parse full Figma URLs to extract fileKey and nodeId automatically
  - `listFigmaPages` - Browse entire file structure: all pages and frames with IDs
  - `searchFigmaFrames` - Search frames/components by name across entire file
  - `getFigmaComponents` - Extract all components (Design System)
  - `getFigmaStyles` - Get all shared styles (colors, text, effects, grids)
  - `getFigmaColorPalette` - Extract complete color palette with usage statistics
- **figma-tools.js module** - All Figma functionality moved to dedicated module for better organization
- **URL support for all Figma tools** - All tools now accept full Figma URLs or fileKeys
- **Automatic URL parsing** - No need to manually extract fileKey and nodeId from Figma links

### Changed
- **Figma code refactored** - Moved all Figma functions to separate figma-tools.js module
- **Improved Figma workflow** - Use `listFigmaPages` → `searchFigmaFrames` → specific tool workflow

### Use Cases
- Browse Figma files without opening Figma UI
- Extract design system components and styles
- Generate CSS variables from color palette
- Find frames by name across all pages
- Copy-paste Figma URLs directly into tools

## [1.4.0] - 2025-12-02

### Added
- **getFigmaSpecs text extraction** - Extract all text content from Figma designs (buttons, labels, headings, paragraphs)
  - `textContent`: Direct text for TEXT nodes with character count
  - `allTextContent`: Array of all text nodes (name, text, visibility) from entire tree
  - `textSummary`: Statistics (total nodes, visible nodes, combined text)
  - Recursive extraction from all child elements
  - Example use: Get button labels, form placeholders, UI copy from designs
- **getComputedCss filtering** - Intelligent CSS property filtering to reduce token usage from ~14k to ~1-2k tokens
  - `category` parameter: Filter by 'layout', 'typography', 'colors', 'visual', or 'all' (default)
  - `properties` parameter: Request specific CSS properties (e.g., `['color', 'font-size']`)
  - `includeDefaults` parameter: Optionally include/exclude properties with default values (default: false)
  - Returns metadata: total properties, filtered count, applied filters
  - Example: `{ selector: ".header", category: "layout" }` returns only layout-related properties

### Changed
- **getFigmaSpecs children structure enhanced** - Now includes text content and dimensions for all child elements

### Performance
- **getComputedCss now 7-14x more efficient** - Filtering reduces output from ~300 properties to 10-50 properties
- Default behavior (no filters) filters out default values, reducing typical response from ~14k to ~3-5k tokens

## [1.3.8] - 2025-12-02

### Added
- **Automatic image compression to 3 MB limit** - All screenshots and Figma images are now automatically compressed if they exceed 3 MB
- Images are first compressed by reducing JPEG quality (from 85 to 10 in steps of 10)
- If quality reduction is insufficient, images are scaled down to fit within the size limit
- PNG images that exceed 3 MB are automatically converted to JPEG and compressed
- Compression metadata includes: final file size, quality level, compression ratio, number of compression attempts

### Changed
- `processScreenshot` function now includes `maxFileSize` parameter (default: 3 MB)
- `getFigmaFrame` now applies automatic compression to exported Figma images
- `compareFigmaToElement` now compresses all three images (Figma design, page screenshot, difference map)
- All image processing preserves original dimensions by default, only scaling down if necessary to meet size limits

## [1.3.7] - 2025-12-01

### Added
- **Angular-specific tools** - 5 new tools for working with Angular applications
- `listAngularComponents` - Discover all Angular components on page with methods/properties
- `getAngularComponent` - Get detailed info about specific component (methods, properties, state)
- `callAngularMethod` - Call component methods reliably with auto change detection
- `getAngularForm` - Get form data, validation state, errors (ReactiveFormsModule & Template-driven)
- `submitAngularForm` - Submit forms with automatic fallback strategies (method → button → event)
- **`waitForElement`** - Wait for elements to appear (autocomplete, lazy loading, dynamic content)

### Fixed (additional)
- **`findElementsByText` token overflow** - removed `fullText`, added visibility check, limit 20 results
- Prioritizes visible elements over hidden ones
- Now returns `truncated: true` when results are limited

### Fixed
- **Auto-reconnection after Chrome closure**
- Browser now automatically reconnects when Chrome is closed and reopened with debug port
- Added `browser.isConnected()` check before reusing cached browser instance
- Added `disconnected` event handler to reset browser state
- Fixes "Connection closed" error when Chrome debug session is manually restarted
- **scrollTo tool now works correctly**
- Fixed incorrect usage of `element.scrollIntoView()` method (not available in Puppeteer ElementHandle)
- Now uses `page.evaluate()` to properly execute `scrollIntoView()` in browser context
- Added `block: 'center'` for better element positioning
- Increased wait time to 500ms for smooth scrolling completion

### Changed
- **Angular tools descriptions updated** - emphasize use BEFORE executeScript
- `getAngularComponent` - marked as PREFERRED over executeScript with ng.getComponent
- `getAngularForm` - now returns both value and rawValue (shows disabled controls!)
- `executeScript` - explicit warnings: DO NOT use for Angular (use specialized tools instead)
- **`analyzePage` description updated** - clarified use AFTER page changes (clicks, submissions, AJAX)
- Now emphasizes `refresh:true` to get current state after interactions
- Compares favorably to screenshot for debugging (2-5k vs 15-25k tokens, actual data vs visual)
- **`screenshot` description updated** - clarified when NOT to use (debugging data, after clicks)
- Emphasizes use for visual comparison only, not for inspecting form values or state
- **Network monitoring split into 3 specialized tools** (massive token reduction)
- `listNetworkRequests` - compact summary (requestId, method, URL, status only)
- `getNetworkRequest` - full details of single request by requestId
- `filterNetworkRequests` - filter by URL pattern with full details
- Replaces monolithic `getNetworkRequests` with targeted workflow
- **`analyzePage` description emphasizes REQUIRED usage on every page**
- Tool descriptions updated to prioritize `analyzePage` over manual element searching
- `executeScript` description clarified as last resort after `analyzePage`
- `smartFindElement` now recommends `analyzePage` first for better performance
- `getElement` now recommends `analyzePage` for bulk element inspection
- `getBrowser()` now validates connection status before returning cached browser
- Browser promise is reset on disconnect for automatic reconnection
- `scrollTo` implementation rewritten to use proper Puppeteer API

### Removed
- `getNetworkRequests` tool (replaced by 3 specialized tools above)

## [1.3.6] - 2025-12-01

### Changed
- **Optimized getNetworkRequests output for reduced token usage**
- Default filter now Fetch/XHR only (excludes images, scripts, stylesheets, etc.)
- Minified JSON payloads (request/response bodies now compact, no whitespace)
- Essential headers only (content-type, authorization, x-api-key, set-cookie)
- Conditional fields (error details only on failure, cache flag only when true)
- Duration calculation instead of separate timestamp fields

### Performance
- Significantly reduced output size (50-80% reduction typical)
- Better for AI context windows with large API traces
- Essential data preserved, noise eliminated

## [1.3.5] - 2025-01-26

### Added
- **Request/Response payload and headers now included in getNetworkRequests**
- `postData` - POST request body (e.g., form data, JSON payload)
- `requestHeaders` - Request headers
- `responseHeaders` - Response headers

### Changed
- `getNetworkRequests` now returns complete request/response details
- Essential for debugging API calls with payloads

### Example
```javascript
getNetworkRequests({ urlPattern: 'send_otp' })

// Now returns:
{
  "url": "http://localhost:4200/api/auth/send_otp/",
  "method": "POST",
  "postData": "{\"phone\":\"+79001234567\"}",  // ← NEW!
  "requestHeaders": {                           // ← NEW!
    "content-type": "application/json",
    "authorization": "Bearer ..."
  },
  "responseHeaders": {                          // ← NEW!
    "content-type": "application/json"
  },
  "status": 200,
  ...
}
```

## [1.3.4] - 2025-01-26

### Fixed
- **Network monitoring now persists across page navigations** - auto-reinitializes on navigation
- Network requests are now captured correctly after form submissions, link clicks, and redirects
- Added WeakSet tracking to prevent duplicate CDP session setup
- Added 100ms debounce on navigation to ensure stability

### Changed
- Refactored network monitoring into `setupNetworkMonitoring()` helper function
- Network monitoring automatically re-enables on framenavigated events
- Global `networkRequests[]` array preserves history across all navigations

### Technical Details
- CDP (Chrome DevTools Protocol) session is recreated on each navigation
- Network.enable is automatically re-sent after navigation completes
- Request history accumulates across multiple pages in the same session
- Use `getNetworkRequests({ clear: true })` to reset history when needed

### Example Use Case
```javascript
// 1. Open login page
openBrowser({ url: 'https://app.com/login' })
// Network monitoring: ✅ active

// 2. Fill form and submit (navigates to /dashboard)
click({ selector: 'button[type="submit"]' })
// Network monitoring: ✅ auto-reinitialized
// Captures POST /api/login, GET /dashboard, etc.

// 3. Check all requests from both pages
getNetworkRequests({ types: ['XHR', 'Fetch'] })
// Returns requests from /login AND /dashboard
```

## [1.3.3] - 2025-01-26

### Added
- `getNetworkRequests` tool - monitor all network requests (XHR, Fetch, API calls, resources)
- Network monitoring via Chrome DevTools Protocol (CDP)
- Automatic capture of all HTTP/HTTPS requests from page load
- Filter requests by type (XHR, Fetch, Script, Document, etc.)
- Filter by status (pending, completed, failed)
- Filter by URL pattern (regex support)
- Request details include: URL, method, status, headers, timing, cache info, errors

### Changed
- Network.enable added to CDP session setup in getOrCreatePage
- Global networkRequests array for request storage

### Examples
```javascript
// Get all network requests
getNetworkRequests()

// Get only XHR and Fetch requests (API calls)
getNetworkRequests({
  types: ['XHR', 'Fetch']
})

// Get failed requests
getNetworkRequests({
  status: 'failed'
})

// Get requests to specific API
getNetworkRequests({
  urlPattern: 'api\\.example\\.com'
})

// Get requests and clear history
getNetworkRequests({
  types: ['XHR', 'Fetch'],
  clear: true
})
```

## [1.3.2] - 2025-01-26

### Added
- `action` parameter for `smartFindElement` - perform actions (click, type, scrollTo, screenshot, hover, setStyles) on the best match immediately
- `action` parameter for `findElementsByText` - perform actions on the first matching element immediately
- New helper function `executeElementAction` for unified action execution

### Changed
- `smartFindElement` can now execute actions on found elements in a single call
- `findElementsByText` can now execute actions on found elements in a single call
- Reduces need for separate find + action calls, improving performance

### Examples
```javascript
// Find and click in one call
smartFindElement({
  description: 'login button',
  action: { type: 'click' }
})

// Find and type in one call
findElementsByText({
  text: 'Email',
  action: { type: 'type', text: 'user@example.com' }
})

// Find, style and screenshot
smartFindElement({
  description: 'submit button',
  action: {
    type: 'setStyles',
    styles: [{ name: 'background', value: 'red' }],
    screenshot: true
  }
})
```

## [1.3.1] - 2025-01-26

### Performance Improvements
- **BREAKING BEHAVIOR CHANGE**: `click` and `executeScript` commands no longer capture screenshots by default
  - Screenshots were causing significant performance overhead (2-10x slowdown)
  - Add `screenshot: true` parameter to explicitly request screenshots when needed
  - This is backward compatible but changes default behavior for better performance

### Added
- `screenshot` parameter for `click` command (boolean, default: `false`)
- `screenshot` parameter for `executeScript` command (boolean, default: `false`)
- `timeout` parameter for `click` command (number, default: `30000ms`)
- `timeout` parameter for `executeScript` command (number, default: `30000ms`)

### Changed
- `click` command now executes 2-10x faster without screenshots
- `executeScript` command now executes 2-10x faster without screenshots
- Both commands now have 30-second timeout by default to prevent hanging

### Fixed
- Commands no longer hang indefinitely if operations fail
- Reduced memory usage by not capturing unnecessary screenshots

### Migration
If you relied on automatic screenshots, add `screenshot: true` to your calls:
```javascript
// Before (v1.3.0 and earlier)
await click({ selector: 'button' })  // Always included screenshot

// After (v1.3.1+)
await click({ selector: 'button', screenshot: true })  // Explicitly request screenshot
await click({ selector: 'button' })  // Fast mode (no screenshot)
```

## [1.3.0] - Previous version
- Scenario recorder with auto-reinjection
- Smart element finder
- Page analysis tools
- Figma integration

## Earlier versions
See git history for details.

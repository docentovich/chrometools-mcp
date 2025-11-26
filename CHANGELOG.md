# Changelog

All notable changes to this project will be documented in this file.

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

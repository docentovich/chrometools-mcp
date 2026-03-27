# Changelog

All notable changes to this project will be documented in this file.

## [3.5.5] - 2026-03-27

### Added
- **getNetworkRequest responseBody** — Response body now included via CDP `Network.getResponseBody` using the same session that captured the request. JSON auto-minified, large bodies truncated at 50KB
- **analyzePage non-HTML support** — JSON, XML, and plain text pages now return `rawContent` field instead of an empty APOM tree. Detects `document.contentType` and extracts text content
- **async executeScript** — Async IIFEs and Promises are now automatically awaited. Previously returned `{}`, now returns actual resolved values
- **Click diagnostics** — Click tool output now shows which method was used (`[cdp-coordinates]`, `[dom-sequence-intercepted]`, `[dom-sequence-fallback]`) for non-default click paths

### Changed
- **Click fallback event sequence** — Path A (intercepted) and Tier 3 (last resort) now dispatch full `pointerdown → mousedown → focus → pointerup → mouseup → click` sequence instead of bare `el.click()`. Improves compatibility with UI Kit components using Pointer Events API
- **executeScript description** — Added `scrollTo`, `listNetworkRequests`, `getNetworkRequest` to the "don't use for" guidance

## [3.5.4] - 2026-02-16

### Fixed
- **Angular stale DOM in analyzePage** — Added `whenStable()` wait (Protractor-style) before DOM traversal. Prevents reading intermediate DOM state during Angular change detection after user interactions. Zero overhead when Angular is already stable; 3s timeout safety net
- **Stale element registry** — `window.__ELEMENT_REGISTRY__` is now cleared before each `analyzePage` call. Old APOM IDs from previous analyses no longer point to non-existent elements
- **False "ELEMENT DETACHED" warning on click** — Click tool no longer reports "handler did NOT fire" when Angular re-renders DOM after a successful click. The scary warning with executeScript workaround suggestions is replaced with a neutral "Click was successful" note

## [3.5.3] - 2026-02-16

### Fixed
- **Bridge connection errors flooding stderr** — Bridge client no longer prints `console.error` on connection failures (ECONNREFUSED). All bridge connection errors are now debug-level only (visible with `DEBUG=1`). Fixes MCP clients showing scary error messages for users without Chrome Extension
- **Unwanted auto-reconnect on startup** — `scheduleReconnect` now only triggers when a previously established connection is lost, not on initial connection failure. Eliminates 5 retry attempts when bridge service is simply not running
- **Removed auto-install bridge from startup** — Bridge auto-installation via `reg add` (Windows registry) was running on every server start, which is intrusive and unnecessary for users without Chrome Extension. Bridge installation remains available via `npx chrometools-mcp --install-bridge`

## [3.5.2] - 2026-02-16

### Added
- **Modal/Dialog detection (React Portals)** — `analyzePage` now detects modals rendered via React Portals (antd, MUI, Bootstrap, Chakra, Element UI, Headless UI, Radix, Mantine). ModalModel class in Element Model system with `role="dialog"` / `aria-modal="true"` matching. Portal wrapper ancestors are force-included in APOM tree with compact format. Modal metadata includes title and action buttons
- **TxtInp `clear` action** — TextInput model now supports `executeModelAction(action: "clear")` for clearing pre-filled form fields

### Fixed
- **React controlled input clearing** — `type(clearFirst: true)` now works correctly with React/Vue/Angular controlled inputs (antd `<Input>`, MUI `<TextField>`, etc.). Uses native `HTMLInputElement.prototype.value` setter to bypass framework value trackers that ignored programmatic `el.value = ''` changes. Applied to both TextInputModel and TextareaModel
- **"ModelRegistry is not defined" error** — Fixed sporadic ReferenceError when calling `executeModelAction` or `click` after page navigation. Bare `ModelRegistry` identifier was inaccessible after `eval()` in strict mode contexts; changed to `window.ModelRegistry` reference
- **Modal output bloat** — ModalModel now only matches actual dialog elements (`role="dialog"`), not framework wrapper divs (`ant-modal-root`, `ant-modal-wrap`). Reduces `modalCount` from 3 to 1 per modal and forces wrapper ancestors to compact container format

## [3.5.1] - 2026-02-16

### Fixed
- **APOM selector uniqueness** — `generateSelector()` in APOM tree converter now verifies CSS selector uniqueness against the entire document instead of just parent element. Fixes critical bug where `click(id: "button_X")` could click the wrong element (e.g., navigation button instead of action button) when multiple elements shared the same class like `.ant-btn`
- **findElementsByText click timeout** — `executeElementAction` click now uses adaptive strategy with 5s timeout and JS fallback instead of raw Puppeteer `element.click()` which could hang indefinitely on elements inside complex layouts (antd Tabs, scrollable containers)
- **findElementsByText non-unique selectors** — `getUniqueSelectorInPage` fallback now checks selector uniqueness at each level of path building (max depth 5→8), preventing clicks on wrong elements when multiple matches exist

### Changed
- **Screenshot defaults optimized** — Default format changed from PNG/auto to JPEG quality 40 for all screenshot tools, reducing token usage from ~15-25k to ~5-10k tokens per screenshot
- **Action screenshots compressed** — Screenshots from click/findElementsByText/hover with `screenshot: true` now use lightweight JPEG (quality 40, maxWidth 800) instead of raw PNG, dramatically reducing context consumption
- **Jimp warmup** — Pre-warms Jimp image processor at server startup (non-blocking, after transport connect) to avoid cold-start delays on first screenshot

## [3.5.0] - 2026-02-16

### Added
- **Element Model System with Strategy Pattern** — Extensible architecture for custom UI components
  - Base `ElementModel` class with interface for model definition
  - `ModelRegistry` for automatic model selection and action routing
  - 13 concrete models: TextInput, Checkbox, Radio, Button, Select, TextArea, Link, Range, DatePicker, DateInput, FileInput, ColorInput, Default
  - Models integrated into APOM analyzer — elements now show model name and available actions

- **executeModelAction tool** — Universal tool for model-specific actions
  - Supports APOM ID (`id` parameter) and CSS selector (`selector` parameter)
  - Automatic routing via ModelRegistry.getActionHandler()
  - Framework-specific actions (e.g., DatePicker SetDate, Checkbox toggle)

- **pressKey tool** — Keyboard key press with modifier support
  - Press Enter, Escape, Tab, Arrow keys, Backspace, Delete, etc.
  - Modifier keys: Control, Shift, Alt, Meta (e.g., Ctrl+A)
  - Optional element targeting via APOM ID or CSS selector

- **executeDatePickerAction handler** — Generic date picker interaction
  - Supports SetDate, SetDateTime, SetTime, and clear actions
  - Finds inner input and types value with change/blur event dispatch
  - Tested on Ant Design DatePicker

- **State-aware checkbox actions** — check/uncheck/toggle with skip logic
  - `check` skips if already checked, `uncheck` skips if already unchecked
  - `toggle` and `select` always click
  - Returns descriptive message with final state (e.g., "check (already checked)")

- **TextArea append and clear** — New actions via executeModelAction
  - `append` types text without clearing existing content
  - `clear` empties the field completely
  - Tested on Angular Material, Ant Design, MUI

### Fixed
- **TextArea/TextInput append destroying existing text** — Verification in setValue() compared exact value on append, falling through to JS fallback that replaced all content. Now uses `endsWith()` check for append mode, and JS fallback appends instead of replacing.
- **Checkboxes with opacity:0 not appearing in APOM tree** — Updated `isVisible()` to allow stylable inputs (checkbox, radio, file) with `opacity:0`

## [3.4.1] - 2026-02-12

### Fixed
- **Extension "not connected" after install** — Bridge connection now auto-retries after Chrome launches (previously MCP exhausted all reconnect attempts before Chrome even started)
- **Bridge auto-install on first run** — Native Messaging Host is automatically registered on MCP startup if not yet installed, eliminating the need to manually run `--install-bridge`
- **Browser autocomplete corrupting text input** — Temporarily suppresses autocomplete during typing to prevent stale data from overwriting input fields

## [3.4.0] - 2026-02-08

### Added
- **Adaptive click strategy with elementFromPoint pre-check** — Before each click, verifies the target element is topmost via `document.elementFromPoint()`. If covered by another element (e.g. small button under `<a routerLink>`), uses DOM dispatch to bypass coordinate hit-testing. Fixes clicks on absolutely-positioned elements over links.
- **Auth redirect detection** — `navigateTo`, `openBrowser`, and `click` now warn when landing on a login page with returnUrl parameter. Broad login detection: password forms, phone/OTP forms, URL path (`/login`, `/signin`, `/auth`), CSS class matching.
- **Post-click element detachment detection** — Detects when clicked element is removed from DOM during click (Angular `*ngFor` + Zone.js pattern). Shows actionable hint with app fix (trackBy) and executeScript workaround.
- **Auth redirect in post-click diagnostics** — `formatDiagnosticsForAI` detects navigation to login pages with returnUrl and shows targeted warning.

### Performance
- **findElementsByText early exit** — Stops DOM traversal at 40 results, preventing 120s timeout on heavy Angular Material pages with CDK overlay.

## [3.3.9] - 2026-02-08

### Added
- **AI Hints: modal content extraction** — Modals now show title, body text (200 chars), and action buttons
  - Expanded selectors: mat-dialog-container, cdk-overlay-pane, `[class*="dialog"]`
  - Topmost modal dedup for pages with multiple modals
  - Actions extracted from `.modal-footer` / `[mat-dialog-actions]` (limit 5)

- **AI Hints: dropdown/menu item extraction** — Overlays now list actual option texts
  - 11 overlay selectors: Angular CDK/Material, PrimeNG, Ant Design, custom `select-options`
  - Menu vs dropdown auto-classification (role="menu", role="listbox", menuitem detection)
  - Item text extraction (limit 10 items, shows total count)
  - Deduplication of nested overlay elements

- **AI Hints: page heading in navigation** — `navigateTo` and `openBrowser` now show page heading
  - Extracts h1 or `.page-title` / `[class*="page-title"]` fallback for SPAs
  - Filters sr-only/visually-hidden elements (clip, 1px size, opacity)
  - 500ms SPA render delay for Angular/React/Vue frameworks

- **Swagger/OpenAPI tools** — `loadSwagger` and `generateApiModels` (Phase 1)
  - `loadSwagger`: Parse OpenAPI 2.0/3.x specs from URL or file (JSON/YAML)
  - `generateApiModels`: Generate TypeScript interfaces or Python models (dataclass/pydantic/TypedDict)
  - $ref resolution, enum generation, snake_case conversion for Python
  - Supports filtering specific schemas

- **Page Object Model integration in exported tests** — `pageObjectMode` parameter
  - `generate-integrated`: Generate POM + test using it
  - `use-existing`: Generate test referencing existing POM file
  - Works with `exportScenarioAsCode` and `appendScenarioToFile`

- **Synthetic drag mode** — `drag` tool now supports `mode: 'synthetic'`
  - Better compatibility with JS libraries (frappe-gantt, jQuery UI, Sortable.js)
  - Native mode (default) for standard HTML drag operations

- **analyzePage: framework click handler detection** — Detect addEventListener-based handlers
  - APOM IDs returned from `smartFindElement` and `findElementsByText`

### Fixed
- Swagger Phase 1 code review fixes (error handling, edge cases)

## [3.3.8] - 2026-02-03

### Added
- **analyzePage: addEventListener tracking for Angular/React/Vue** — Monkey-patch detection
  - Injects tracker via `evaluateOnNewDocument` before page load
  - Catches `addEventListener('click', ...)` calls from any framework
  - Solves Angular detection (compiled `(click)` bindings now visible)
  - WeakMap storage prevents memory leaks
  - `hasExplicitClickBinding()` now checks `window.__hasClickListener()`

- **analyzePage: viewportOnly flag** — Filter to visible elements only
  - Reduces output by 30-56% on large pages
  - Useful for data-heavy pages with content below fold

- **analyzePage: diff mode** — Show only changes since last analysis
  - Returns `{added, removed, changed}` structure
  - ~80-90% size reduction for incremental updates

- **analyzePage: clickTarget legend** — Clarified in tool description
  - Format: `"tag:id"` (e.g., `"div:container_19"`)
  - No clickTarget = element handles its own click

## [3.3.7] - 2026-02-03

### Performance
- **analyzePage: 26% output size reduction** — Optimized JSON structure
  - Removed `position` for static elements (default, no need to include)
  - Removed `zIndex: "auto"` (default value)
  - Removed `isStacking`, `hasBackdrop`, `isFullscreen` from position object
  - Removed empty `children: []` arrays
  - Filtered out `null`, `undefined`, empty string, and `false` values from metadata
  - Google Search benchmark: ~38 KB → ~28 KB

### Added
- **CLAUDE.md: analyzePage benchmark requirement** — Mandatory performance check
  - Test URL: `https://www.google.com/search?q=puppeteer+mcp+server`
  - Baseline: ~28 KB, threshold: < 40 KB
  - Must run after any changes to analyzePage tool

## [3.3.6] - 2026-02-03

### Added
- **Chrome Extension: POST request tracking** — Track POST requests via webRequest API
  - Extension now captures POST/PUT/PATCH requests that Puppeteer may miss
  - Shows in "Browser-level requests (via Extension)" section
  - Useful for SPA apps with complex async request patterns

## [3.3.5] - 2026-01-30

### Fixed
- **type/click: Intermittent timeout fix** — Added timeouts to internal operations
  - `resolveSelector` now has 5s timeout (was unbounded)
  - `getElementInfo` now has 5s timeout (was unbounded)
  - `TextInputModel.setValue` operations have individual 5s timeouts
  - Prevents indefinite hanging on unstable CDP sessions
  - Error messages now show which specific operation timed out

## [3.3.4] - 2026-01-30

### Added
- **click: Form submit detection for non-SPA apps** — Detect classic form submissions with page reload
  - Tracks URL before and after click to detect page navigation
  - Reports "Page navigation detected (form submit)" when URL changes
  - Solves issue where POST requests were lost during page reload
  - Works for Django, Rails, PHP and other server-rendered apps
  - Example output: `🔄 Page navigation detected (form submit): /form → /success`

## [3.3.3] - 2026-01-30

### Fixed
- **click: Post-click diagnostics timeout** — Fixed 30s timeout caused by network wait logic
  - Now waits only for mutation requests (POST/PUT/PATCH) started within 200ms after click
  - Ignores GET requests completely (were causing unnecessary waits)
  - Hard 10s timeout limit enforced (never hangs indefinitely)
  - Always returns success even if requests still pending after 10s
  - Shows pending requests status instead of reporting timeout
  - Changed output from "Form submission" to "Mutation requests"
  - Example output:
    ```
    📡 Mutation requests detected (2 POST/PUT/PATCH):
      1. ✓ POST /admin/tenant/.../change/ → 302 Found
      2. ⏳ POST /api/slow-endpoint/ → pending

    ⏳ 1 request(s) still pending after 10000ms timeout
    ```

### Performance
- **click: Removed unnecessary delays** — Removed 100ms waits after scrollIntoView and retry clicks
  - Click operations now complete instantly when no mutation requests detected
  - Typical click time: <50ms (was 500-10000ms with old diagnostics)

## [3.3.2] - 2026-01-30

### Fixed
- **click/type: Viewport scrolling** — Always scrolls to element before interaction
  - Prevents 30s timeout when elements are outside viewport
  - Moves scrollIntoView BEFORE first click/type attempt (was in fallback)
  - Fixes Django admin forms hanging after multiple navigations
  - Pattern: scroll → wait 100ms → interact
  - Applied to both click and type tools

## [3.3.1] - 2026-01-30

### Added
- **click: All network requests visibility** — Shows ALL requests started within 200ms after click
  - AI agent now sees complete network activity picture after every click
  - Shows: method, URL, and status code for each request
  - Example output:
    ```
    📡 Network requests started within 200ms after click (15 total):
      1. ✓ GET /api/auth/ws_token/ → 200 OK
      2. ✓ GET /static/css/app.css → 200 OK
      3. ✓ POST /admin/tenant/.../change/ → 302 Found
    ```
  - Helps AI understand what happened after click (form submission, navigation, polling, etc.)
  - 200ms window captures both mutation requests and side-effect requests

### Changed
- **Enhanced diagnostics output** — Restructured to show all requests first, then mutation tracking
  - Section 1: All requests in 200ms window (complete visibility)
  - Section 2: Form submission status (POST/PATCH/PUT tracking)
  - Clear icons: ✓ (success), ✗ (error), ⏳ (pending)
  - Agent can immediately see if any requests occurred or not

## [3.3.0] - 2026-01-30

### Added
- **click: skipNetworkWait parameter** — Skip network wait for forms with long-polling/WebSockets
  - New parameter: `skipNetworkWait: boolean` (default: false)
  - Use case: Pages with continuous long-polling to get instant response
  - Example: `click({ selector: 'button[type="submit"]', skipNetworkWait: true })`
- **click: networkWaitTimeout parameter** — Custom network wait timeout
  - New parameter: `networkWaitTimeout: number` (default: 10000ms)
  - Configurable per-click timeout for network requests
  - Example: `click({ selector: '.save-btn', networkWaitTimeout: 5000 })`
- **type: timeout parameter** — Explicit timeout for type operations
  - New parameter: `timeout: number` (default: 30000ms)
  - Prevents infinite hangs on input fields
  - Example: `type({ selector: 'input[name="url"]', text: 'value', timeout: 10000 })`

### Changed
- **Smart form submission tracking** — Only tracks POST/PATCH/PUT requests in 100ms window
  - Filters mutation requests (POST/PATCH/PUT) that started within 100ms after click
  - Waits ONLY for these mutation requests (up to 10s)
  - Ignores all other requests (GET, polling, analytics, etc.)
  - Shows form submission status: `✓ POST /admin/tenant/.../change/ → 302 Found`
  - Example: Django form with 50 polling requests → only 1 POST tracked
- **Type operation timeout protection** — Wrapped in Promise.race with configurable timeout
  - Prevents 120s hangs on problematic input fields
  - Returns clear error message: "Type operation timed out after Xms"
  - Django forms: type now fails fast instead of hanging

### Fixed
- **Django form timeout issues** — Fixed 30s click timeout and 120s type timeout
  - Root cause: Long-polling/WebSockets created noise in network tracking
  - Solution: Track only POST/PATCH/PUT requests within 100ms detection window
  - Type operations now have explicit timeout protection
  - Example: Django Admin forms now show reliable form submission status

## [3.2.11] - 2026-01-30

### Fixed
- **Tailwind CSS selector escape** — Fixed `analyzePage` failing on pages with Tailwind CSS
  - Tailwind classes with colons (e.g., `hover:text-gray-800`) broke `querySelectorAll`
  - Added filtering for classes containing special characters (`:`, `/`, `[`, `]`)
  - Applied `CSS.escape()` to class names when building CSS selectors
  - Fixed in: APOM tree builder, Angular tools, hints generator, content script
  - Example: Page with Tailwind → no more "not a valid selector" errors

## [3.2.10] - 2026-01-29

### Fixed
- **Network request deduplication** — Fixed duplicate pending requests in diagnostics
  - Prevented same requestId from being added multiple times during redirects/retries
  - Added deduplication check in Network.requestWillBeSent event handler
  - Updates existing request instead of creating duplicate entry
  - Example: example.com showed 4 pending (2 URLs × 2 duplicates) → now shows 2 pending (correct count)
- **Memory leak prevention** — Limited networkRequests array growth
  - Keeps maximum 500 most recent network requests in memory
  - Automatically removes oldest requests when limit exceeded
  - Prevents unbounded memory growth during long browser sessions
  - Example: After 100 page navigations, memory stays bounded

## [3.2.9] - 2026-01-29

### Added
- **navigateTo diagnostics** — Post-navigation diagnostics for navigateTo tool
  - Detects chrome-error:// pages (unreachable servers, DNS failures)
  - Waits 20s for slow page loads and network requests
  - Reports JS console errors and network errors after navigation
  - Shows pending requests if page loads slowly
  - Same comprehensive diagnostics as click tool
  - Example: Navigate to offline backend → instant error report instead of silent failure
- **openBrowser diagnostics** — Post-navigation diagnostics for openBrowser tool
  - Same comprehensive diagnostics as navigateTo and click
  - Critical for first action in session - shows errors immediately
  - Detects chrome-error:// pages on initial load
  - Reports network errors, console errors, pending requests
  - Example: Open unreachable backend → instant error report with details

### Changed
- **Diagnostics naming** — Renamed for clarity and universal use
  - "POST-CLICK DIAGNOSTICS" → "POST-ACTION DIAGNOSTICS"
  - Function parameters: beforeClickTimestamp → beforeActionTimestamp
  - Comments updated to reflect use in both click and navigate actions
  - File remains post-click-diagnostics.js for backward compatibility

## [3.2.8] - 2026-01-29

### Changed
- **Network wait timeout** — Increased from 5s to 20s for slow APIs
  - Gives slow backend APIs time to complete before timeout
  - AI gets complete success/error status instead of "pending unknown"
  - Pending requests after 20s are reported with details (URL, method, runtime)
  - Clear warning: "Status unknown - may complete successfully or fail"

### Fixed
- **Click timeout on network errors** — No more 30s timeout when backend unreachable
  - Detects chrome-error:// pages (ERR_CONNECTION_REFUSED, DNS_PROBE_FINISHED_NXDOMAIN, etc.)
  - Returns error details immediately after 500ms diagnostic wait
  - Shows error code and suggestion: "Backend likely not running or unreachable"
  - Reduces diagnosis from 3 API calls to 1
  - Example: Form submits to localhost:8001 (not running) → instant error report instead of 30s timeout
- **Network request tracking** — Now tracks ALL requests triggered by click, not just pending at 500ms
  - Filters requests by timestamp (only those started AFTER click)
  - Catches slow-starting requests that begin after initial 500ms wait
  - Shows accurate count: completed/pending/total requests
  - Prevents false "No network requests triggered" when requests start late
- **Delayed error collection** — Errors from requests that complete during maxWait are now captured
  - Added 100ms delay after network wait before collecting errors
  - Catches errors from requests that finish right as timeout expires
  - Network summary shows: "⚠️ Network: 2 OK, 1 failed" when errors present
  - Ensures AI sees errors even if request completes at edge of timeout window
- **Pending request reporting** — AI now sees details about slow/hanging requests
  - Lists pending requests with URL, method, and elapsed time
  - Suggests backend performance check or network connectivity issues
  - Example: "POST /api/slow - Running for: 20145ms"

## [3.2.7] - 2026-01-29

### Added
- **Post-click diagnostics** — Click tool now automatically detects and reports errors
  - Waits 500ms after click to capture async events
  - Detects pending network requests and waits for completion (up to 5s)
  - Collects JavaScript console errors and network errors
  - **Error limit**: Max 15 console errors + 15 network errors to prevent spam
  - Shows omitted error count if limit exceeded
  - Returns diagnostics in click response for immediate AI feedback
  - Prevents AI from making blind follow-up requests when errors occur
  - New module: `utils/post-click-diagnostics.js`

### Changed
- **Click behavior** — Enhanced UX for AI agents
  - Click now includes network activity summary (requests completed, timing)
  - Errors displayed immediately in click response
  - AI can see what broke without additional tool calls
  - Better error context: timestamp, location, status codes
  - Smart error limiting prevents overwhelming AI with hundreds of errors

## [3.2.6] - 2026-01-28

### Removed
- **getAllInteractiveElements tool** — Removed redundant tool, fully replaced by analyzePage (54 → 53 tools)
  - `analyzePage` provides superior functionality: hierarchical tree, element registration, APOM IDs, metadata
  - `getAllInteractiveElements` only returned flat list with CSS selectors
  - Affected files: `index.js`, `server/tool-definitions.js`, `server/tool-schemas.js`, `server/tool-groups.js`, `README.md`

### Fixed
- **analyzePage visibility detection** — Fixed critical bug where analyzePage returned tree: null with interactiveCount: 0 on Angular Material pages
  - Changed `isVisible()` check from `offsetParent` to `offsetWidth/offsetHeight > 0`
  - Now correctly detects elements inside `position: fixed` containers (Angular Material overlays, dialogs, selects)
  - Handles `position: sticky` elements properly
  - Testing on my-autotests.segmento.ru: interactiveCount increased from 0 → 329 elements
  - Affected file: `pom/apom-tree-converter.js`
- **type() text corruption** — Fixed text input corruption (duplicated/swapped characters)
  - Changed default keystroke delay from 0ms to 30ms
  - Prevents character corruption on fast-reacting inputs (Google Search, autocomplete fields)
  - Example: "puppeteer automation" no longer becomes "ppuuppppeetteeeerr baruotwosmeart"
  - Affected file: `index.js:454`

## [3.2.5] - 2026-01-28

### Fixed
- **CSS selector validation** — Fixed analyzePage crash when elements have numeric IDs
  - Added validation to skip IDs starting with digits (e.g., `id="301178"`)
  - CSS selectors don't support IDs starting with numbers (per CSS specification)
  - Added try-catch for invalid selector edge cases
  - Affected file: `pom/apom-tree-converter.js`

## [3.2.4] - 2026-01-27

### Performance
- **Compact APOM format** — Reduced analyzePage output size by ~70%
  - Containers now use `"tag_id": [children]` format (instead of `{id, tag, selector, children}`)
  - Selectors removed from output (registered internally for getElementDetails/click/type)
  - Bottom-up pruning removes container branches without interactive elements
  - Example: Google Search reduced from ~33K tokens (281 elements) to ~10K tokens (~80 elements)
  - `includeAll: true` retains full format with selectors for debugging

### Removed
- **getElement tool** — Redundant tool replaced by analyzePage (55 → 54 tools)

## [3.2.3] - 2026-01-27

### Removed
- **Reverted experimental features** — Removed `resolveComponentPaths` and `detectFrameworks` due to technical limitations
  - Component path resolution was unreliable across different build configurations
  - Framework detection removed from analyzePage tool
  - Simplified codebase and improved performance

## [3.2.2] - 2026-01-27

### Fixed
- **APOM ID resolution** — Fixed element ID lookup in `click` and `type` tools
  - Added CSS selector generation to APOM tree elements
  - Both interactive and container elements now include `selector` field
  - APOM IDs (e.g., `textarea_25`, `button_45`) now work correctly with click/type tools
- **Improved click reliability** — Enhanced click method with fallback strategies
  - Primary method: standard Puppeteer click
  - Fallback 1: scroll element into view and retry click
  - Fallback 2: JavaScript click for hidden/overlapping elements
  - Fixes issues with Google Search button and similar elements

## [3.2.1] - 2026-01-27

### Changed
- **Unified element analysis tools** — Merged `analyzeElementById` into `getElementDetails`
  - `getElementDetails` now has optional `analyzeChildren` parameter
  - Set `analyzeChildren: true` to get children tree structure
  - Simplified API reduces tool count and improves consistency
  - Children analysis includes same `includeAll` and `refresh` options

### Removed
- **`getElementByApomId`** — Removed deprecated method (use `getElementDetails` instead)
- **`analyzeElementById`** — Merged into `getElementDetails` with `analyzeChildren` parameter

## [3.2.0] - 2026-01-27

### Added
- **New tool: `getElementDetails`** — Get comprehensive details about element by APOM ID
  - Returns bounds, CSS selector, position, attributes, computed styles
  - Use when `analyzePage` output is simplified and full element info is needed
- **New tool: `analyzeElementById`** — Analyze children elements starting from specific APOM ID
  - Useful for analyzing specific page sections without re-analyzing entire page
  - Supports `includeAll` and `refresh` parameters

### Changed
- **Optimized `analyzePage` output** — Significantly reduced token usage
  - Parent/container elements now show only `tag` and `id` (minimal info)
  - Interactive elements no longer include `bounds` and `selector` in main output
  - Use `getElementDetails` to get full information when needed
  - ~50-70% reduction in output size for typical pages
- **Improved cursor:pointer detection** — Only detects explicitly set cursor, not inherited
  - Filters out inherited `cursor:pointer` from parent elements
  - Reduces false positives in interactive element detection
  - More accurate identification of clickable elements

### Deprecated
- **`getElementByApomId`** — Use `getElementDetails` instead (same functionality, clearer name)
  - Filters out Angular dynamic classes (e.g., `_ng*`)
  - Prefers stable class names for more reliable selectors across page loads

## [3.1.8] - 2026-01-27

### Changed
- **Enhanced interactivity detection in analyzePage** — Improved detection of JavaScript-enabled interactive elements
  - Added detection of elements with `cursor: pointer` CSS property
  - Added detection of elements with JavaScript `addEventListener('click')`
  - Added detection of elements with `onclick` property set via JavaScript
  - DIV and SPAN elements with click handlers now correctly detected as interactive
  - Added `interactivityReason` metadata field showing why element was marked interactive
  - Reasons: `native-html`, `aria-role`, `onclick-attr`, `onclick-prop`, `cursor-pointer`, `event-listener`, `tabindex`, `contenteditable`

### Performance
- Optimized `markInteractiveElements` to skip event listener checks during bulk scan (performance)
- Event listener detection only runs for individual element type determination

## [3.1.7] - 2026-01-27

### Fixed
- **Claude Code installation command** — Corrected to proper `claude mcp add` syntax
  - Fixed to use: `claude mcp add chrometools -- npx -y chrometools-mcp`
  - Format: `claude mcp add <name> -- <command> [args...]`
  - Added `--scope user` option for global installation

## [3.1.6] - 2026-01-27

### Fixed
- **Claude Code installation command** — Incorrect syntax attempt

## [3.1.5] - 2026-01-27

### Fixed
- **Cursor installation instructions** — Corrected to show proper mcpServers JSON format
  - Changed to use `mcpServers` object wrapper (not individual server object)
  - Added example showing how to add to existing MCP configuration
  - Updated with correct JSON structure matching Cursor's MCP configuration format
  - Settings → Cursor Settings → MCP (edit JSON directly)

## [3.1.4] - 2026-01-27

### Fixed
- **Cursor installation instructions** — Corrected to show JSON configuration format
  - Changed from individual fields to complete JSON object
  - Added proper JSON format with name, type, command, and args fields
  - Settings → Cursor Settings → MCP → Add New MCP Server (paste JSON)
  - Added test instructions to verify installation in Cursor Agent mode

## [3.1.3] - 2026-01-27

### Changed
- **README.md installation section reorganization** — Improved installation documentation
  - Moved Installation section to the top for better visibility
  - Added Claude Code (CLI) installation with `claude mcp add chrometools-mcp` command
  - Separated installation instructions by client type (Claude Code, Claude Desktop, Cursor, Antigravity, Other MCP Clients)
  - Added detailed step-by-step instructions for Cursor IDE (Settings → Cursor Settings → MCP → Add New MCP Server)
  - Added detailed step-by-step instructions for Google Antigravity (MCP Store → Manage → View raw config)
  - Added configuration file paths for Claude Desktop (macOS/Linux/Windows)
  - Added notes about Antigravity's 100-tool limit and optimal configuration
  - Removed duplicate Installation/Usage sections

## [3.1.2] - 2026-01-26

### Added
- **Multi-tab scenario recording** — Automatic recording of tab switches during scenario capture
  - When user switches tabs during recording, an `openTab` action is automatically recorded
  - Records tab URL, title, and switch reason for accurate playback
  - Only records if switching to a different tab (ignores same-tab activations)
  - Location: `extension/background.js` (chrome.tabs.onActivated listener)

### Changed
- **openTab navigation strategy** — Changed from `networkidle2` to `domcontentloaded` in scenario executor
  - Prevents timeout errors when opening tabs with continuous ad/tracking loading
  - Consistent with other navigation improvements in 3.1.1
  - Location: `recorder/scenario-executor.js:979`

### Fixed
- **openTab with empty URL uses look-ahead to next action's URL** — Smart URL detection for tab switches
  - When openTab has empty URL, executor looks at next action's tabUrl
  - If next action has real URL, uses it for tab opening/switching
  - Fixes scenarios where new tab was opened but URL loaded immediately after
  - Empty URLs without look-ahead match are still skipped (prevents about:blank tabs)
  - Location: `recorder/scenario-executor.js:168-176, 987-990`

- **Added 500ms delay before tab switch** — Prevents race conditions during scenario playback
  - Allows previous tab's pending processes (navigation, AJAX, form submissions) to complete
  - Ensures stable state before switching to new tab
  - Location: `recorder/scenario-executor.js:990-992`

## [3.1.1] - 2026-01-26

### Fixed
- **Scenario recording and saving flow** — Fixed critical bugs preventing scenario recording
  - Fixed Extension → Bridge → MCP communication flow for recording control
  - `startRecording` now properly sends command to Extension via Bridge WebSocket
  - `stopRecording` correctly retrieves recorded actions from Extension state
  - `saveScenario` now successfully saves scenarios to correct project directory
  - Recording state properly synchronized between Extension popup and MCP tools
  - Location: `index.js` (startRecording/stopRecording/saveScenario handlers)

- **Navigation timeout for slow websites** — Fixed timeout errors on sites with continuous loading
  - Increased navigation timeout from 30s to 60s
  - Changed wait strategy from `networkidle2` to `domcontentloaded` (less strict)
  - Fixes timeout errors on sites like Yahoo that continuously load ads and tracking scripts
  - Location: `browser/page-manager.js:188-193`

### Changed
- **Improved WebSocket message handling** — Better error reporting and state management
  - Bridge now properly forwards recording commands to Extension
  - MCP server correctly receives recording state updates from Bridge
  - Clear error messages when Extension is not connected or recording fails

## [3.1.0] - 2026-01-26

### Added
- **Native Messaging Bridge Architecture** — complete rewrite of Extension ↔ MCP communication
  - Bridge Service runs as Native Messaging Host (launched by Chrome with Extension)
  - MCP servers connect as WebSocket clients (not servers)
  - Supports 0-8 simultaneous MCP clients connecting/disconnecting at any time
  - Full state (tabs, recordings) sent immediately on client connect
  - No more scanning delays — instant connection to persistent Bridge

- **CLI commands for Bridge management**
  - `--install-bridge` — Install Native Messaging Bridge (one-time setup)
  - `--uninstall-bridge` — Remove Bridge installation
  - `--check-bridge` — Verify Bridge is installed
  - `--help` — Show all CLI options

- **Stable Extension ID** via manifest key
  - Extension ID is now deterministic: `dmehkibmncgphijnigkahhlekgajhpbl`
  - Required for Native Messaging Host registration

- **New extension icons** — Chrome/robot themed design (16, 48, 128px)

### Changed
- **Extension is now Event Producer** — sends all events to Bridge, doesn't manage WebSocket connections
- **MCP is now Event Consumer** — connects to Bridge as client, receives state on demand
- **Bridge lifecycle** — starts with Chrome Extension, stops when Chrome closes
- Removed port scanning (9223-9227) — Bridge uses single fixed port 9223

### Architecture
```
Chrome Extension (producer) → Native Messaging → Bridge Service (:9223) ← WebSocket ← MCP clients (0-8)
```

### Migration
1. Run `npx chrometools-mcp --install-bridge` once
2. Reload Extension in chrome://extensions
3. Use normally — MCP auto-connects to Bridge

## [3.0.4] - 2026-01-26

### Added
- **Smart tab tracking for scenario recording**
  - Recording automatically follows the active tab
  - When user switches tabs during recording, an `openTab` action is recorded
  - When user opens new tab, an `openTab` action is recorded
  - Actions from non-active tabs are automatically filtered out
  - `openTab` action ensures tab exists during playback (opens tab with URL if not exists)
  - Scenario executor supports `openTab` with automatic tab reuse and creation
- **MCP tools for programmatic recording control**
  - `startRecording` - Start recording from AI/code
  - `stopRecording` - Stop and retrieve recorded actions
  - `getRecorderState` - Query current recording state
  - `saveScenario` - Save recorded actions as scenario
  - AI agents can now fully control recording without manual interaction

### Changed
- Recording now tracks `currentTabId` instead of being locked to `startTabId`
- Content scripts only send actions when their tab is the active recording target
- Replaced `switchTab`/`newTab` with unified `openTab` action type
- `openTab` intelligently checks if tab already exists before creating new one
- `enableRecorder` now mentions programmatic control tools

## [3.0.3] - 2026-01-25

### Added
- **Multi-instance MCP server support** via dynamic port allocation
  - MCP server automatically finds available port from range 9223-9227
  - Chrome Extension scans for running MCP instances every 20 seconds (port scanning)
  - Extension connects to multiple MCP servers simultaneously (broadcast pattern)
  - Enables multiple AI clients (Claude Desktop, Telegram bot, etc.) to work in parallel
  - Graceful handling of ungraceful shutdowns (kill -9) via WebSocket.onclose

### Changed
- **Auto-sync active tab when user switches tabs manually**
  - MCP server now syncs Puppeteer's `lastPage` when extension reports `tab_activated`
  - Callback pattern avoids circular dependencies between websocket-bridge and page-manager
  - MCP commands automatically target the user's currently active tab

### Fixed
- **Input recording deduplication** in Chrome Extension
  - Extension now records only final text value after blur/Enter or 1.5s pause
  - Eliminated intermediate keystroke recordings (e.g., "test" → "test1" recorded as one action)
  - Improved debouncing with `inputStartValues` tracking

## [3.0.2] - 2026-01-25

### Added
- **Extension installation instructions for AI agents**
  - `listTabs`, `switchTab`, `enableRecorder` now include install steps when extension not connected
  - `openBrowser` shows warning when connected to existing Chrome (extension needs manual install)
  - Clear step-by-step instructions with extension path for manual installation
  - Alternative fix: close all Chrome windows and restart MCP for auto-install

### Changed
- Improved extension status reporting with `extensionConnected` flag in responses

## [3.0.1] - 2026-01-25

### Fixed
- **Multi-tab support** - Fixed extension-based tab switching
  - `switchTab` now uses Chrome Extension for reliable tab switching
  - Auto-connects Puppeteer to switched tab (fixes `analyzePage` after tab switch)
  - `puppeteerConnected: true` in response confirms Puppeteer sync

## [3.0.0] - 2026-01-25

### BREAKING CHANGES
- **Chrome Extension for Recording** - Scenario recording now requires Chrome Extension
  - Old HTML-injection recorder (`injectRecorder`) removed
  - Extension auto-loads when Chrome is started by chrometools-mcp
  - Recording controlled via Extension popup (click CT icon in toolbar)

### Added
- **ChromeTools Chrome Extension** (`extension/` folder)
  - Full tab tracking via Chrome tabs API (catches ALL new tabs including Ctrl+T, context menu)
  - Scenario recording via content script (works across all domains)
  - Popup UI for recording control
  - WebSocket connection to MCP server for real-time communication

- **WebSocket Bridge** (`server/websocket-bridge.js`)
  - Bidirectional communication between Extension and MCP server
  - Port 9223 (CHROME_DEBUG_PORT + 1)
  - Tab state sync, recorder commands, scenario save/list

- **Auto-load Extension** - Chrome launched with `--load-extension` flag
  - Extension automatically installed when Chrome starts
  - No manual installation required

### Changed
- `enableRecorder` tool now checks Extension connection status instead of injecting HTML
- Tab tracking improved: Extension provides complete tab list including manually opened tabs
- Recording state persisted in `chrome.storage.local` (survives cross-domain navigation)

### Removed
- `recorder-script.js` HTML injection functionality (still exists for reference)
- `pagesWithRecorder` tracking (Extension handles this now)
- `setupRecorderAutoReinjection` function (Extension handles this now)

## [2.9.0] - 2026-01-25

### Added
- **Automatic new tab detection** - Tracks tabs opened via `window.open()`, `target="_blank"`, or user actions
  - New tabs automatically become the active page
  - Network monitoring, console capture, and recorder auto-injection enabled on new tabs
  - New tab events queued for AI notification via `listTabs`

- **`listTabs` tool** - List all open browser tabs
  - Returns: `{ tabs: [{ index, url, title, isActive }], totalCount }`
  - Includes `newTabsDetected` array when new tabs were opened since last check
  - Use tab index with `switchTab` to change active tab

- **`switchTab` tool** - Switch between browser tabs
  - Parameters: `tab` - Tab index (number) or URL pattern (string, partial match)
  - Makes the specified tab active for subsequent commands
  - Returns: `{ success, switchedTo: { url, title } }`

### Changed
- `openPages` Map now tracks all tabs including those opened externally
- Browser `targetcreated` event handler added for automatic tab tracking

## [2.8.0] - 2026-01-25

### Added
- **`getElementByApomId` tool** - Get detailed element information by APOM ID
  - Parameters: `id` (required) - APOM element ID from analyzePage (e.g., `"input_20"`)
  - Returns: Full element details including bounds, attributes, computed styles, visibility
  - Use case: Inspect specific elements without re-analyzing entire page

### Changed
- **APOM format optimization** - ~82% token reduction
  - Tree-structured output with hierarchical parent-child relationships
  - Minified JSON output (no pretty printing)
  - Parent nodes contain only position info (no bounds/metadata)
  - Interactive elements retain full details (bounds, type, metadata)
  - Groups section for radio/checkbox groups with options

- **Separate `id` and `selector` parameters** for click, type, hover, selectOption
  - **PREFERRED**: Use `id` parameter with APOM ID from analyzePage (e.g., `click({ id: "button_45" })`)
  - **ALTERNATIVE**: Use `selector` parameter with CSS selector (e.g., `click({ selector: ".submit" })`)
  - Parameters are mutually exclusive (use one or the other)
  - Makes API clearer: agent knows exactly what it's passing
  - Updated tool descriptions with PREFERRED/ALTERNATIVE guidance

### Removed
- **`registerPageObject` tool** - No longer needed
  - `analyzePage()` now automatically registers elements with unique IDs
  - Use APOM IDs directly with click/type/hover/selectOption tools
  - Simplifies workflow: just call `analyzePage()` and use the returned IDs

### Performance
- APOM token usage reduced from ~31,000 to ~5,684 tokens on typical pages
- Tree structure eliminates redundant parent information
- Minified JSON further reduces output size

## [2.7.0] - 2026-01-25

### 🔄 BREAKING CHANGE
- **`analyzePage` now returns APOM format by default**
  - Previous default was legacy format, now APOM is default
  - Use `useLegacyFormat: true` to get old format if needed
  - Migration: `analyzePage()` now returns APOM instead of legacy
  - Rationale: APOM is superior - provides unique IDs, better structure, automatic registration

### Added
- **🎉 Agent Page Object Model (APOM) - Now Default Format**
  - `analyzePage()` returns structured APOM format (no parameters needed!)
  - New parameter: `useLegacyFormat` - Return old format (default: false)
  - Parameter: `registerElements` - Auto-register elements (default: true)
  - Parameter: `groupBy: 'type' | 'flat'` - Control element grouping
  - Returns: `{ pageId, url, title, timestamp, elements, groups, metadata }`
  - Each element gets unique ID: `input_0`, `button_1`, `form_0`, `radio_0`, `checkbox_0`
  - Elements automatically registered in persistent `window.__ELEMENT_REGISTRY__`
  - **Use IDs instead of CSS selectors**: `type({ id: "input_0", text: "..." })`
  - **Backward compatible**: Set `useLegacyFormat: true` for old format
  - **Tested**: Fully functional with real-world forms

- **New POM Modules**
  - `pom/element-id-generator.js` (171 lines) - Smart ID generation
    - Priority: data-testid > id attribute > semantic path + index
    - Supports: input, button, link, form, textarea, select, radio, checkbox
  - `pom/apom-converter.js` (294 lines) - Convert analyzePage to APOM
    - Transforms legacy format to structured model
    - Groups elements by type (forms, inputs, buttons, links)
    - Generates pageId, metadata

- **Input Models Architecture** - Modular input handling system
  - New `models/` directory with specialized input handlers
  - `BaseInputModel` - Abstract base class with common interface (setValue, getValue, clear, focus)
  - `TextInputModel` - Default for text-like inputs (text, email, password, search, tel, url)
  - `TimeInputModel` - Correct handling for `input[type="time"]` via JavaScript value assignment
  - `DateInputModel` - Handles date, datetime-local, month, week inputs
  - `ColorInputModel` - Color picker input handling
  - `RangeInputModel` - Slider/range input handling
  - `SelectModel` - HTML `<select>` element handling
  - `CheckboxModel` - Single checkbox toggle
  - `TextareaModel` - Multi-line text input
  - `InputModelFactory` - Factory pattern for selecting appropriate model
  - Fixes issue where keyboard input didn't work for time inputs (only minutes showed)

- **Radio/Checkbox Group Models** - Abstract group-level operations
  - `RadioGroupModel` - Select single option from radio group by name, value, or label text
  - `CheckboxGroupModel` - Multi-select from checkbox group with modes:
    - `set` - Replace all selections
    - `add` - Check additional values
    - `remove` - Uncheck specific values
    - `toggle` - Flip specific values

- **`selectFromGroup` tool** - New MCP tool for radio/checkbox group selection
  - Parameters: `name` (required), `value`, `values`, `text`, `texts`, `mode`, `by`
  - Works with radio groups (single selection) and checkbox groups (multi-selection)
  - Match by value attribute or label text (`by: 'value' | 'text' | 'auto'`)
  - Example: `selectFromGroup({ name: "size", value: "large" })`
  - Example: `selectFromGroup({ name: "toppings", values: ["cheese", "bacon"], mode: "add" })`

- **Radio/Checkbox Groups in `analyzePage`**
  - APOM output now includes `groups` section with radio and checkbox groups
  - Each group shows: name, all options with values, labels, checked state
  - Labels extracted from: parent `<label>`, `<label for="id">`, aria-label attribute
  - Example output:
    ```json
    "groups": {
      "radio": {
        "size": {
          "options": [
            { "value": "small", "label": "Small", "checked": false },
            { "value": "large", "label": "Large", "checked": true }
          ]
        }
      },
      "checkbox": { ... }
    }
    ```

### Fixed
- **Critical Bug**: Variable shadowing in analyzePage APOM conversion (commit e1e63e2)
  - Fixed `const analysis` shadowing in else block causing undefined analysis
- **Critical Bug**: Element registry not persisting across page.evaluate calls (commit faadd0e)
  - Changed `const elementRegistry = new Map()` to `window.__ELEMENT_REGISTRY__`
  - Registry now persists between tool calls
  - All selector-resolver functions exported to window
- **API Error**: `oneOf` not supported at top level in tool schemas
  - Removed `oneOf` blocks from click, type, hover, selectOption tool definitions
  - Both `id` and `selector` parameters now optional with description indicating one is required
  - Fixes error: `tools.19.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level`

### Changed
- **`analyzePage` enhanced with APOM support**
  - Now supports both legacy and APOM formats
  - Cache logic updated to handle generateIds parameter
  - Elements automatically registered when generateIds=true
  - Radio/checkbox elements now include label text

- **`utils/selector-resolver.js` updated for persistence**
  - Registry stored in `window.__ELEMENT_REGISTRY__` instead of local const
  - All functions (registerElement, resolveSelector, etc.) exported to window
  - Survives across multiple page.evaluate contexts

- **`navigateTo` auto-opens browser** - No longer throws error when no page is open
  - Automatically opens browser at specified URL if no page is currently open
  - Eliminates need to manually call `openBrowser` before navigation
  - Falls back gracefully with informative message

- **`type` tool uses Input Models** - Automatically selects appropriate model based on input type
  - Time inputs now correctly set full value (e.g., "18:30" not just "30")
  - Date inputs work without keyboard simulation issues
  - All specialized inputs handled by their respective models

### Technical Details
- APOM conversion happens in browser context via page.evaluate
- Element IDs remain stable across page refreshes (based on testid/id/structure)
- Dual selector mode: all tools accept both IDs and CSS selectors
- Input models use JavaScript value assignment with proper event dispatching

## [2.6.0] - 2026-01-25

### Added
- **UI Framework Detection** - Automatic detection of UI component libraries (MUI, Ant Design, Chakra UI, Bootstrap, Vuetify, Semantic UI)
  - New utility: `utils/ui-framework-detector.js`
  - Detects framework name, version, and component type for each element
  - Integrated into `analyzePage` - all elements now include `uiFramework` field
  - Extracts options from both native `<select>` and custom framework dropdowns

- **Enhanced Select/Dropdown Options Extraction** - Smart extraction of dropdown options from various UI libraries
  - Native HTML `<select>` with `<optgroup>` support
  - Material-UI (MUI) Select components
  - Ant Design Select components
  - Chakra UI, Bootstrap, Vuetify, Semantic UI dropdowns
  - Options include: value, text, index, selected, disabled, group
  - Handles cases where options aren't rendered until dropdown opens (with informative notes)

- **Page Object ID Support** - Use element IDs instead of CSS selectors
  - New utility: `utils/selector-resolver.js` - Registry for Page Object element IDs
  - New tool: `registerPageObject` - Register elements from Page Object for use with IDs
  - **Backward compatible**: All interaction tools (click, type, selectOption, hover, etc.) now accept BOTH:
    - Page Object IDs (e.g., `"login_email_input"`)
    - CSS selectors (e.g., `"input[name='email']"`)
  - Element registry persists in page context between tool calls

- **`registerPageObject` tool** - Register Page Object elements for ID-based interaction
  - Parameters:
    - `elements` (required) - Array of {id, selector, metadata}
    - `clearExisting` (optional) - Clear registry before registering
  - Enables using meaningful IDs instead of fragile CSS selectors
  - Example: After registering, use `click("login_submit_button")` instead of `click("button[type='submit']")`

- **Enhanced Page Object Generation** - Page Objects now include comprehensive element information
  - Each element gets unique ID: `{name}_{timestamp}_{random}`
  - Select elements include full options array with groups
  - UI framework detection for all elements
  - Metadata includes: type, label, placeholder, required, validation hints

### Changed
- **`analyzePage` enhanced with UI framework detection**
  - All form fields and inputs now include `uiFramework` field
  - Select elements use smart extraction: works with both vanilla HTML and UI frameworks
  - Better handling of MUI, Ant Design, and other component libraries

- **All interaction tools now support dual selector mode**
  - Tools affected: `click`, `type`, `selectOption`, `hover`, `scrollTo`, `drag`, `setStyles`
  - Automatically resolves Page Object IDs to CSS selectors
  - Error messages indicate whether identifier was Page Object ID or CSS selector
  - No breaking changes - existing CSS selector usage works unchanged

### Technical Details
- Selector resolution happens in page context using injected `selector-resolver.js`
- UI framework detection uses class names, data attributes, and DOM structure analysis
- Element registry stored in browser page context (survives navigation within same page)
- New helper function `resolveSelector(page, identifier)` in `index.js`

## [2.5.0] - 2026-01-21

### Added
- **`selectOption` tool** - Select options in HTML dropdown elements with intelligent priority-based selection
  - Parameters: `selector` (required), `value`, `text`, or `index` (specify at least one)
  - Selection priority: value → text → index (tries value first, falls back to text, then index)
  - Automatically triggers `input` and `change` events for React and other frameworks
  - Returns selected option details (value, text, index)
  - Location: `index.js:911-979`, schemas in `server/tool-schemas.js:40-45`, definitions in `server/tool-definitions.js:234-247`, tool group in `server/tool-groups.js:10`

- **`drag` tool** - Drag element by mouse (click-hold-move-release) in any direction
  - Parameters: `selector` (required), `direction` (required: 'up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right'), `distance` (optional, default: 100), `duration` (optional, default: 500ms)
  - Emulates real mouse drag: moves to element center, presses button, drags, releases button
  - Supports 8 directions including 4 diagonal directions for maximum flexibility
  - Use for: interactive maps (Google Maps, Leaflet), Gantt charts, SVG diagrams, canvas, drag-to-pan interfaces
  - NOT for: standard overflow scrollbars (use `scrollTo` or `scrollHorizontal` instead)
  - Location: `index.js:982-1091`, schemas in `server/tool-schemas.js:47-53`, definitions in `server/tool-definitions.js:248-261`, tool group in `server/tool-groups.js:10`

- **`scrollHorizontal` tool** - Scroll element horizontally for tables, carousels, and wide content
  - Parameters: `selector` (required), `direction` (required: 'left' or 'right'), `amount` (required: pixels or 'full'), `behavior` (optional: 'auto' or 'smooth')
  - Supports precise pixel-based scrolling or 'full' to scroll to the end
  - Returns detailed scroll state: position, total width, visible width, and scroll availability (canScrollLeft, canScrollRight)
  - Uses native `scrollTo` API with smooth/auto behavior options
  - Location: `index.js:1055-1117`, schemas in `server/tool-schemas.js:55-60`, definitions in `server/tool-definitions.js:262-275`, tool group in `server/tool-groups.js:10`

### Fixed
- **🔥 CRITICAL: Fixed `drag` tool implementation** - Now correctly emulates mouse drag instead of changing scrollLeft/scrollTop
  - Problem: Previous implementation used `scrollLeft`/`scrollTop` animation which only works for `overflow: auto/scroll` containers
  - Impact: **Did not work with custom drag-to-scroll interfaces** like:
    - ❌ Interactive maps (Google Maps, Leaflet, Mapbox)
    - ❌ Gantt charts and timeline diagrams (SVG-based)
    - ❌ Canvas elements with pan/zoom
    - ❌ Custom drag handlers (React DnD, interact.js)
  - Solution: Complete rewrite using Puppeteer's `page.mouse` API:
    1. Finds element center position
    2. Moves mouse to center (`page.mouse.move`)
    3. Presses mouse button (`page.mouse.down`)
    4. Drags to target position with smooth motion (`page.mouse.move` with steps)
    5. Releases mouse button (`page.mouse.up`)
  - Result: **Now works with ANY drag-scrollable element** including SVG diagrams, maps, and custom implementations
  - Location: `index.js:982-1091`, updated description in `README.md:277-285`
  - Reported by: User testing on Gantt chart with `<svg class="gantt">` element

- **Fixed `analyzePage` crash with `includeAll: true` on SVG elements** - Now handles both HTML and SVG className types
  - Problem: `className.split is not a function` error when page contains SVG elements
  - Cause: SVG elements have `className` as `SVGAnimatedString` object (with `.baseVal` property), not a string
  - Solution: Added type checking - uses `className.baseVal` for SVG elements, direct string for HTML
  - Location: `index.js:2126-2137`

- **🔥 CRITICAL: Fixed Tailwind CSS selector generation bug** - `getUniqueSelectorInPage` now works correctly with Tailwind/utility-first CSS frameworks
  - Problem: Generated invalid CSS selectors like `button.hover:bg-blue-700` containing special characters (`:`, `/`, `[]`)
  - Impact: **ALL AI-powered tools failed** with `SyntaxError: invalid selector` on Tailwind/styled-components apps:
    - ❌ `analyzePage` - couldn't read page state
    - ❌ `findElementsByText` - couldn't find elements by text
    - ❌ `smartFindElement` - couldn't find elements by description
    - ❌ `getAllInteractiveElements` - couldn't list interactive elements
  - Solution: Complete rewrite of selector generation logic with intelligent filtering:
    1. **New priority hierarchy** (most reliable first):
       - `#id` (ID attribute)
       - `[data-testid="..."]` (test IDs, very common in modern apps)
       - `[data-*="..."]` (other data attributes)
       - `[aria-label="..."]` (accessibility labels)
       - `[role="..."]` (ARIA roles)
       - `[name="..."]` (form element names)
       - `tag.semantic-class` (non-Tailwind classes only)
       - `tag:nth-of-type(n)` (fallback with path)
    2. **Tailwind class filtering** - New `isTailwindClass()` function detects and excludes:
       - Variant classes with `:` (hover:, focus:, md:, lg:, etc.)
       - Fraction classes with `/` (w-1/2, space-x-1/2)
       - Arbitrary values with `[]` (bg-[#1da1f2], w-[500px])
       - 60+ common Tailwind prefixes (bg-, text-, p-, m-, flex-, etc.)
    3. **CSS.escape() integration** - All selectors properly escaped (with fallback for old browsers)
    4. **Semantic attribute prioritization** - Prefers stable, meaningful selectors over utility classes
  - Result: **Unblocks testing of ALL modern apps** using Tailwind, styled-components, CSS modules, Emotion, etc.
  - Location: `element-finder-utils.js:316-509` (complete rewrite, ~200 lines)
  - Reported by: AI agent encountering `SyntaxError` on every tool call in React+Tailwind app

### Changed
- **Improved tool descriptions for better AI agent behavior** - Prevents premature use of `executeScript`
  - `click` - Emphasized as PRIMARY tool for clicking, works with React/Vue/Angular synthetic events
  - `type` - Emphasized as PRIMARY tool for input, updates React hooks and Vue reactive data correctly
  - `executeScript` - ⚠️ Marked as LAST RESORT with strict warnings, never use for clicking/typing/reading
  - `findElementsByText` - Highlighted as alternative to executeScript for finding elements
  - `analyzePage` - Emphasized as PRIMARY tool for reading page state, more efficient than executeScript
  - Location: `server/tool-definitions.js:31,45,162,510,489`

- **Added "Tool Usage Priority" section to README** - Clear hierarchy preventing executeScript abuse
  - Three workflows: Clicking/Interaction, Filling Forms, Reading Page State
  - Each shows specialized tools first (click, type, analyzePage), executeScript last
  - Explains why specialized tools work with React/Vue/Angular while executeScript may fail
  - Location: `README.md:116-147`

- **`analyzePage` enhancement** - Now detects and reports HTML select elements with all available options
  - Select fields in forms and inputs sections now include `options` array with value, text, index, selected, and disabled status
  - Includes `selectedIndex`, `selectedValue`, and `selectedText` for current selection
  - Enables AI agents to see all dropdown options without additional queries
  - Makes `selectOption` tool usage more intelligent and reliable
  - Location: `index.js:1632-1660` (forms), `index.js:1691-1713` (inputs)

- **Tool groups** - Added 3 new tools to `interaction` group: `selectOption`, `dragScroll`, `scrollHorizontal`
  - Total interaction tools: 8 (was 5)
  - Total tools in project: 44+ (was 40+)
  - Location: `server/tool-groups.js:10`

- **`convertFigmaToCode` tool** - Convert Figma designs to React/Tailwind code with AI assistance
  - Parameters: `figmaToken` (optional), `fileKey` (required), `nodeId` (required), `framework` (optional: 'react', 'react-typescript', 'html'), `includeComments` (optional, default: true)
  - Fetches design structure (layout, colors, typography, spacing) and rendered image at 2x scale
  - Returns AI-optimized instruction prompt with simplified JSON structure and framework-specific guidelines
  - Supports React (JavaScript), React (TypeScript), and pure HTML with Tailwind CSS
  - Generates clean, semantic code with proper spacing, accessibility, and component structure
  - Uses existing Figma token mechanism (from parameter or FIGMA_TOKEN env var)
  - Location: `index.js:1676-1779`, schemas in `server/tool-schemas.js:225-231`, definitions in `server/tool-definitions.js:448-462`, tool group in `server/tool-groups.js:53`, helper in `figma-tools.js:381-499`

- **`simplifyNode` helper** - New function in figma-tools.js for code generation
  - Recursively extracts essential design properties from Figma node structure
  - Captures: layout (flexbox), dimensions, padding/gaps, colors (fills/strokes), effects (shadows), typography, border radius
  - Filters out invisible elements and rounds numeric values for cleaner output
  - Used by `convertFigmaToCode` to provide AI with actionable design data
  - Location: `figma-tools.js:381-499`

## [2.4.2] - 2026-01-05

### Added
- **`analyzePage` - `includeAll` parameter** - New optional parameter to get ALL page elements, not just interactive ones
  - Set `includeAll: true` to get complete page structure with selectors for all visible elements
  - Returns new `allElements` array containing divs, spans, headings, and all other visible elements
  - Each element includes: selector, tag, text, classes, id, and attributes (role, aria-label)
  - Useful for layout work and styling - find any element, get its selector, then use `getComputedCss` or `setStyles`
  - Example workflow: `analyzePage({ includeAll: true })` → find element → `getComputedCss({ selector })` or `setStyles({ selector })`
  - Skips hidden elements and non-visual tags (SCRIPT, STYLE, META, etc.)
  - Location: `index.js:1613-1751`, schemas in `tools/tool-schemas.js:215`, `server/tool-schemas.js:221`

### Changed
- **Tool Groups reorganization** - Moved `executeScript` and `navigateTo` from `advanced` to `core` group
  - These are fundamental navigation and scripting tools that should be available in basic configurations
  - Core group now includes: `ping`, `openBrowser`, `executeScript`, `navigateTo` (4 tools)
  - Advanced group now has: `setStyles`, `setViewport`, `getViewport`, `smartFindElement`, `analyzePage`, `getAllInteractiveElements`, `findElementsByText` (7 tools)
  - Location: `server/tool-groups.js:8,21-29`

## [2.4.0] - 2025-12-29

### Added
- **Tool Filtering by Groups** - New `ENABLED_TOOLS` environment variable for selective group enabling
  - Configure via `env.ENABLED_TOOLS` in MCP client config (comma-separated list of group names)
  - Available groups: `core`, `interaction`, `inspection`, `debug`, `advanced`, `recorder`, `figma`
  - Group structure optimized:
    - `debug` - NEW group for debugging tools (console logs, network monitoring)
    - `advanced` - Combined with AI tools (now includes smartFindElement, analyzePage, etc.)
  - If not set, all tools are enabled (default behavior)
  - If set, only tools from specified groups are available to AI
  - Primary benefit: **Token optimization** - all 43 tools consume ~28k tokens (~14% of context). Enable only needed groups to reduce token usage and costs
  - Additional use cases: security/compliance restrictions, workflow simplification, improved AI focus
  - Examples:
    - Basic automation: `ENABLED_TOOLS=core,interaction,inspection`
    - Advanced with AI: `ENABLED_TOOLS=core,interaction,advanced`
    - With debugging: `ENABLED_TOOLS=core,interaction,inspection,debug`
    - Figma validation: `ENABLED_TOOLS=core,figma`
  - Location:
    - `server/tool-groups.js` - group definitions (7 groups, 43 tools total)
    - `index.js:36` - import groups module
    - `index.js:77-92` - parsing and filtering logic
    - `index.js:195-203` - apply filter to ListTools handler
  - Documentation: README.md section "Tool Filtering with ENABLED_TOOLS"

## [2.3.2] - 2025-12-25

### Changed
- **appendScenarioToFile** - Simplified architecture: MCP server no longer reads test files
  - Removed `FileAppender.validateFile()` and `FileAppender.readFile()` calls
  - Removed `generator.appendTest()` call - no longer merges content server-side
  - Returns only test code (without imports) via `testCode` field
  - Changed `action: "write_file"` → `action: "append_test"` (more accurate description)
  - Claude Code now responsible for reading file, appending test, and writing back
  - Clearer separation of concerns: MCP generates code, Claude Code handles file I/O
  - Location: `index.js:2126-2215`

## [2.3.1] - 2024-12-25

### Fixed
- **executeScenario** - Fixed scenario execution when current page URL doesn't match scenario's entryUrl
  - Added automatic navigation to entryUrl before executing scenario
  - Normalizes URLs for comparison (ignores trailing slashes, query params like `nr`, `redirect_ts`)
  - Prevents timeout errors when scenario expects different page than currently open
  - Example: If scenario recorded on `ya.ru` but current page is `ya.ru/search/`, automatically navigates to `ya.ru`
  - Logs navigation events to console for debugging
  - Location: `index.js:1951-1987`

- **appendScenarioToFile** - Unified response format with exportScenarioAsCode for better Claude Code compatibility
  - Changed `action: "append_to_file"` → `action: "write_file"` (clearer action)
  - Changed `updatedContent` → `testCode` (same field name as exportScenarioAsCode)
  - Added `content` field (duplicate of testCode for compatibility)
  - Simplified instruction: single-step "Write the testCode..." instead of two-step "Read... then write..."
  - Improved error message when file not found: now suggests using exportScenarioAsCode instead
  - Location: `index.js:2191-2229`

## [2.3.0] - 2024-12-25

### Breaking Changes
- **exportScenarioAsCode** - Removed append-to-file functionality to eliminate confusion
  - **REMOVED** parameters: `appendToFile`, `testName`, `insertPosition`, `referenceTestName`
  - Now exclusively creates NEW test files (returns JSON with `action: "create_new_file"`)
  - Returns JSON format with `action`, `suggestedFileName`, `testCode`, `instruction` fields
  - Claude Code writes files based on returned JSON (MCP server no longer writes files directly)
  - Migration: Use new `appendScenarioToFile` tool instead of `appendToFile` parameter

### Added
- **appendScenarioToFile** - NEW tool for appending tests to existing files
  - Parameters: `scenarioName`, `language`, `targetFile` (required)
  - Optional: `testName`, `insertPosition`, `referenceTestName`, `cleanSelectors`, `includeComments`, `generatePageObject`, `pageObjectClassName`
  - Returns JSON with `action: "append_to_file"`, `targetFile`, `updatedContent`, `instruction`
  - Safely appends tests without overwriting existing tests
  - Claude Code writes updated file content based on returned JSON
  - Location: `index.js:2041-2186`, `server/tool-definitions.js:577-628`

### Changed
- **exportScenarioAsCode** - Changed return format from plain text to structured JSON
  - Returns: `{action, suggestedFileName, testCode, instruction, pageObject?}`
  - Suggests filename based on scenario name and language
  - Includes clear instructions for Claude Code to create files
  - Location: `index.js:2188-2357`, `server/tool-definitions.js:542-576`
- **File writing responsibility** - Moved from MCP server to Claude Code
  - MCP tools now return JSON with file content + instructions
  - Claude Code uses Write tool to create/update files
  - Eliminates risk of MCP server directly overwriting files

### Documentation
- **README.md** - Split exportScenarioAsCode documentation into two sections
  - exportScenarioAsCode: For creating new test files
  - appendScenarioToFile: For appending to existing files
  - Updated tool count: 39+ → 40+ tools
  - Added clear examples for both tools with JSON response formats
  - Location: `README.md:11,17,652-806`

## [2.2.1] - 2024-12-24

### Improved
- **exportScenarioAsCode** - Clarified tool description to prevent accidental test file overwrites
  - Added explicit warning: default mode (without `appendToFile`) returns code for NEW file
  - Emphasized that `appendToFile` parameter is **REQUIRED** to safely add tests to existing files
  - Updated `appendToFile` parameter description to highlight safety aspect
  - Updated `insertPosition` and `referenceTestName` descriptions to clarify they only work with `appendToFile`
  - Added warning section in README.md documentation
  - Location: `server/tool-definitions.js:544,575-589`, `README.md:667-669`

## [2.2.0] - 2025-12-21

### Added
- **Page Object Model (POM) Generator** - New `generatePageObject` MCP tool for automated Page Object creation
  - Analyzes current page and extracts interactive elements (inputs, buttons, links, etc.)
  - Smart selector generation: prioritizes id > name > data-testid > unique class > CSS path
  - Auto-generates meaningful element names from labels, placeholders, text content
  - Groups elements by semantic sections (header, nav, form, footer, etc.)
  - Supports 4 frameworks: Playwright TypeScript/Python, Selenium Python/Java
  - Generates helper methods automatically (fill/click methods for common actions)
  - Example: `generatePageObject({ framework: 'playwright-typescript' })`
  - Location: `recorder/page-object-generator.js`, `index.js:46,2098-2136`

- **Page Object Integration in exportScenarioAsCode** - Optional Page Object generation when exporting scenarios
  - New parameter `generatePageObject` (default: false) to generate both test code and Page Object class
  - New parameter `pageObjectClassName` for custom Page Object class names
  - Opens scenario's entry URL and analyzes page structure automatically
  - Returns JSON with both `testCode` and `pageObjectCode` when enabled
  - Example: `exportScenarioAsCode({ scenarioName: "login", language: "playwright-typescript", generatePageObject: true })`
  - Location: `index.js:2090-2186`, `server/tool-schemas.js:281-282`, `server/tool-definitions.js:565-572`

- **Append Mode for exportScenarioAsCode** - Ability to append generated tests to existing test files
  - New parameter `appendToFile`: Path to existing test file to append to (enables append mode)
  - New parameter `testName`: Override test name (default: from scenario name)
  - New parameter `insertPosition`: Where to insert test - 'end' (default), 'before', or 'after' a reference test
  - New parameter `referenceTestName`: Reference test name for 'before'/'after' insertion
  - Supports all 4 frameworks: Playwright TypeScript/Python, Selenium Python/Java
  - Automatic file validation (extension must match language)
  - Automatic backup before file modification (.backup extension)
  - Smart test name conversion (camelCase for Java, snake_case for Python, kebab-case for TypeScript)
  - Framework-specific parsing: brace counting for TypeScript/Java, indentation-based for Python
  - PEP 8 compliance: 2 blank lines between Python functions
  - Example: `exportScenarioAsCode({ scenarioName: "new_test", language: "playwright-typescript", appendToFile: "./tests/suite.spec.ts" })`
  - Location: `utils/code-generators/file-appender.js` (new 177 lines), `index.js:2044-2116`, `server/tool-schemas.js:283-286`, `utils/code-generators/*.js`

### Fixed
- **Dependency Resolution with projectId** - Fixed collision errors when executing scenarios with dependencies
  - Dependencies now correctly inherit parent scenario's projectId when not explicitly specified
  - Explicit dependency projectId in metadata takes precedence over inherited value
  - Fixes error: "Dependency 'test': Multiple scenarios named 'test' found"
  - Location: `recorder/scenario-executor.js:63-119`

## [2.1.1] - 2025-12-21

### Fixed
- **executeScenario Timeout Fix** - Prevents hanging when no browser tab is attached
  - Auto-opens browser at scenario's entryUrl if no page is open
  - Added timeout protection (1s) for page state checks to prevent hanging on `isClosed()`
  - Added 30s timeout for browser opening operation
  - Added 5min timeout for scenario execution with clear error messages
  - Location: `browser/page-manager.js:255-290`, `index.js:1875-1955`

- **URL Validation Fix** - Fixed false negative in scenario exit URL validation
  - Added 500ms wait before URL check to allow navigation/redirects to complete
  - Changed from `page.url()` to `page.evaluate(() => window.location.href)` for more reliable current URL
  - Fixes issue where correct URL was reported as wrong due to timing
  - Location: `recorder/scenario-executor.js:186-191`

- **Global Timeout Protection** - All MCP tools now protected from hanging
  - Added `executeToolWithTimeout()` wrapper for all tool calls
  - Default timeout: 2 minutes for regular tools, 6 minutes for executeScenario
  - Tools return clear error messages instead of hanging indefinitely
  - Location: `index.js:183-217`

### Changed
- **Code Refactoring** - Reduced index.js from 3761 to 2093 lines (-44%)
  - Extracted tool schemas to `server/tool-schemas.js` (34 schemas, 282 lines)
  - Extracted tool definitions to `server/tool-definitions.js` (41 tools, 569 lines)
  - Extracted browser management to `browser/browser-manager.js` (207 lines)
  - Extracted page management to `browser/page-manager.js` (268 lines)
  - Extracted image processing to `utils/image-processing.js` (254 lines)
  - Extracted CSS utilities to `utils/css-utils.js` (163 lines)
  - Extracted platform utilities to `utils/platform-utils.js` (63 lines)
  - Better code organization and maintainability

## [2.1.0] - 2025-12-21

### Added
- **Name Collision Detection** - Smart handling of scenarios with same name across different projects
  - `executeScenario` now detects when multiple scenarios share the same name
  - Returns helpful error with list of available `projectId` values
  - Optional `projectId` parameter to disambiguate: `executeScenario({ name: "login", projectId: "google" })`
  - Location: `recorder/scenario-storage.js:111-163`, `recorder/scenario-executor.js:33,49-61,86-90`, `index.js:1677,3558-3571,3597-3600`

### Changed
- **URL-Based Scenario Organization** - Scenarios now organized by website domain instead of file system project
  - Project ID automatically extracted from URL where recording starts: `https://google.com` → `google`
  - Main domain only (subdomains stripped): `mail.google.com` → `google`
  - Ports included for ALL domains: `localhost:3000` → `localhost-3000`, `example.com:8080` → `example-8080`
  - Protocol ignored: `http` and `https` both map to same projectId
  - File URLs: `file:///` → `local`
  - Location: `utils/url-to-project.js`, `recorder/recorder-script.js:30-78`

- **Global Scenario Access** - All tools now return scenarios from ALL websites
  - `listScenarios()` returns ALL scenarios with `projectId`, `entryUrl`, `exitUrl` metadata
  - `searchScenarios()` searches ALL scenarios across all websites
  - Agent can filter results by `projectId`, `entryUrl`, or `exitUrl` as needed
  - Removed `allProjects` parameter (no longer needed, always returns all)
  - Location: `index.js:3586-3610`

- **Simplified API** - Recorder no longer depends on file system project detection
  - `injectRecorder()` signature changed from `(page, projectDir, projectId, projectPath)` to `(page)`
  - Project ID determined automatically from page URL in browser context
  - Removed dependency on `utils/project-detector.js`
  - Location: `recorder/recorder-script.js:1710-1763`, `index.js:3512-3533`

### Added
- **URL Normalization Utilities** - New module for extracting project ID from URLs
  - `urlToProjectId(url)` - Extract and sanitize domain-based project ID
  - `sanitizeProjectId(id)` - Clean project IDs (lowercase, alphanumeric, hyphens)
  - Browser-compatible version injected into recorder widget
  - Location: `utils/url-to-project.js`

### Migration
- **Automatic v2.1.0 Migration** - Old project-based scenarios removed on first run
  - Deletes `~/.config/chrometools-mcp/projects/` directory from v2.0
  - Deletes old global index
  - Creates `.migration-v2.1.0-done` flag file
  - One-time migration, starts fresh with URL-based organization
  - Location: `index.js:780-811`

### Removed
- **Removed `utils/project-detector.js`** - No longer needed for URL-based organization
- **Removed helper functions** - `getProjectId()`, `getProjectDir()`, `getCurrentProjectDir()`
- **Removed old scenarios** - All v2.0 scenarios deleted during migration

### Documentation
- **Updated README.md** - Complete rewrite of Recorder Tools section
  - Explained URL-based storage approach with examples
  - Updated all tool descriptions and examples
  - Documented domain extraction rules
  - Added filtering examples for agents
  - Location: `README.md:507-618`

## [2.0.2] - 2025-12-21

### Fixed
- **Project Detection for VS Code** - Improved project root detection for IDE environments
  - Added support for `INIT_CWD` and `npm_config_local_prefix` environment variables
  - Added `findProjectRootByMarkers()` to detect project by package.json, pom.xml, etc.
  - Walks up parent directories to find Git root when cwd is IDE installation
  - Now correctly detects `C:\prj\automation` instead of `Microsoft VS Code` when running in VS Code
  - Location: `utils/project-detector.js:38-68`, `utils/project-detector.js:85-140`

### Added
- **Enhanced Project Detection Strategy** - Multiple fallback mechanisms for project root detection
  - Priority: CLAUDE_PROJECT_DIR → PROJECT_DIR → INIT_CWD → npm prefix → Git root → markers → parent Git → cwd
  - Supports 8+ project markers: package.json, pom.xml, build.gradle, Cargo.toml, go.mod, etc.
  - Better logging with `console.error` for debugging project detection

### Documentation
- **VS Code Setup Guide** - Add instructions for setting PROJECT_DIR in MCP config for VS Code users

## [2.0.1] - 2025-12-21

### Fixed
- **Recorder Auto-Reinjection** - Fixed critical bug where recorder widget didn't reinject after page navigation
  - Updated `setupRecorderAutoReinjection()` to use new v2.0 API signature
  - Fixed both navigation (`framenavigated`) and reload (`load`) event handlers
  - Recorder now correctly passes `projectDir`, `projectId`, and `projectPath` instead of deprecated `baseDir`
  - Location: `index.js:483-486`, `index.js:499-502`

## [2.0.0] - 2025-12-21

### Breaking Changes
- **Project-Based Scenario Storage** - Complete restructuring of scenario storage system
  - Scenarios now stored in `~/.config/chrometools-mcp/projects/{projectName}/scenarios/`
  - Each project has its own isolated scenario storage
  - Automatic project detection via `detectProjectRoot()` (CLAUDE_PROJECT_DIR → PROJECT_DIR → git root → cwd)
  - Global index file at `~/.config/chrometools-mcp/index.json` for fast scenario discovery
  - Scenarios include `projectId` and `projectPath` in metadata
  - Old scenarios in `~/.config/chrometools-mcp/scenarios/` will no longer be accessible
  - Location: `index.js:66-159`, `recorder/scenario-storage.js`

- **Removed `directory` parameter** - All scenario tools no longer accept explicit directory parameter
  - Removed from: `enableRecorder`, `executeScenario`, `listScenarios`, `searchScenarios`, `getScenarioInfo`, `deleteScenario`, `exportScenarioAsCode`
  - Project directory is now automatically determined
  - Simplifies API and improves consistency
  - Location: `index.js:1659-1750` (tool definitions)

### Added
- **Global Scenario Index** - Fast O(1) scenario lookups without filesystem scanning
  - Location: `~/.config/chrometools-mcp/index.json`
  - Contains all projects and their scenarios
  - Enables quick discovery of scenarios across all projects
  - AI-friendly: agents can read global index to understand all available scenarios
  - Location: `index.js:103-159`, `recorder/scenario-storage.js:23-136`

- **Multi-Project Filtering** - New `allProjects` parameter for `listScenarios` and `searchScenarios`
  - `allProjects: false` (default) - shows only current project's scenarios
  - `allProjects: true` - shows scenarios from all projects
  - Enables cross-project scenario discovery and reuse
  - Location: `index.js:1685`, `index.js:1697`, `recorder/scenario-storage.js:385-453`

- **Cross-Project Dependency Support** - Scenarios can depend on scenarios from other projects
  - Dependencies automatically resolved across projects via global index
  - Enables scenario reuse between projects
  - Location: `recorder/scenario-executor.js:27-121`

- **Storage Path in Tool Descriptions** - All scenario tools now document storage location
  - Every tool description includes: "Scenarios are stored in ~/.config/chrometools-mcp/projects/{projectName}/scenarios/"
  - Helps AI agents understand where to find scenarios
  - Includes reference to global index location
  - Location: `index.js:1660`, `index.js:1668`, `index.js:1681`, etc.

### Changed
- **Scenario Storage Functions** - Updated all storage functions for new architecture
  - `saveScenario(scenario, projectId, projectPath)` - now requires project info instead of baseDir
  - `loadScenario(name, includeSecrets, projectId)` - searches globally, optional project filter
  - `listScenarios(projectId, allProjects)` - reads from global index
  - `searchScenarios(query, projectId, allProjects)` - searches global index
  - `deleteScenario(name, projectId)` - finds and deletes from correct project
  - Location: `recorder/scenario-storage.js:191-500`

- **Recorder Injection** - Updated to pass project information
  - `injectRecorder(page, projectDir, projectId, projectPath)` - now accepts project details
  - Scenarios saved with project context automatically
  - Location: `recorder/recorder-script.js:1659`

### Migration Guide
- **Old scenarios are inaccessible** - Scenarios in `~/.config/chrometools-mcp/scenarios/` will no longer be found
  - To migrate: Manually move scenarios to new structure or re-record them
  - New structure: `~/.config/chrometools-mcp/projects/{projectName}/scenarios/`
- **No code changes needed** - All changes are internal, MCP tool interface remains compatible (except removed `directory` parameter)

## [1.9.1] - 2025-12-19

### Fixed
- **MCP Protocol Errors** - Fixed "Unexpected token" JSON parsing errors caused by console output
  - Added debug mode (`CHROMETOOLS_DEBUG=true`) to control logging
  - Replaced all `console.log/error` with `debugLog` to prevent STDIO pollution
  - MCP uses STDIO for JSON-RPC, debug logs were breaking the protocol
  - Fixed errors: `"Unexpected token 'c', "[chrometool"... is not valid JSON"`
  - Fixed errors: `"Unexpected token 'S', "[Smart Wait"... is not valid JSON"`
  - Location: `index.js:21-24`, `recorder/scenario-executor.js:15-17`

- **Recorder localStorage Corruption** - Added robust error handling for corrupted state data
  - Validates JSON before parsing from localStorage
  - Validates state structure after parsing
  - Automatic cleanup of corrupted data with error logging
  - Location: `recorder/recorder-script.js:64-159`

### Added
- **Scenario Index Enhancement** - Added `entryUrl` and `exitUrl` to scenario index
  - `listScenarios` now returns entry and exit URLs for each scenario
  - Helps identify scenario flow and dependencies
  - Location: `recorder/scenario-storage.js:197-198`

### Changed
- **Code Cleanup** - Removed backup files and improved .gitignore
  - Added `*.bak`, `*.backup`, `*~`, `*.tmp` to .gitignore
  - Removed leftover `index.js.backup` file

## [1.9.0] - 2025-12-19

### Changed
- **Default Scenarios Storage Location** - Scenarios now save to `~/.config/chrometools-mcp` by default
  - Previous behavior: auto-detected project root (Git root or cwd) which could be unpredictable
  - New behavior: consistent location in user's home folder (`~/.config/chrometools-mcp`)
  - Can still override with explicit `directory` parameter on recorder tools
  - Improves reliability for AI agents and users without Git repositories
  - Location: `index.js:64`, `index.js:101-119`

## [1.8.2] - 2025-12-19

### Fixed
- **Code Generator Bugs** - Fixed multiple issues in test code generators
  - **Python generators**: Fixed comment syntax - now use `#` instead of `//`
  - **Python generators**: Moved `import re` to top of file instead of inline
  - **Java generator**: Fixed variable name conflicts - now uses unique names (`typeElement`, `hoverElement`, etc.) instead of reusing `element`
  - **Java generator**: Added missing imports (`JavascriptExecutor`, `Select`)
  - **All generators**: Implemented language-specific comment generation via `generateComment()` method
  - Location: `utils/code-generators/code-generator-base.js`, `playwright-python.js`, `selenium-python.js`, `selenium-java.js`

## [1.8.1] - 2025-12-19

### Added
- **Smart Project Directory Detection** - Scenarios now automatically save to the correct project directory
  - Auto-detection cascade: `CLAUDE_PROJECT_DIR` env var → `PROJECT_DIR` env var → Git root → current working directory
  - Optional `directory` parameter on all recorder tools (`enableRecorder`, `executeScenario`, `listScenarios`, `searchScenarios`, `getScenarioInfo`, `deleteScenario`, `exportScenarioAsCode`)
  - Session memory: once directory is set (explicitly or auto-detected), it's remembered for the entire MCP server session
  - Solves issue where scenarios were saved to unpredictable locations based on where MCP process was launched
  - Location: `utils/project-detector.js`, `index.js:97-115`

### Changed
- **All recorder storage functions now accept `baseDir` parameter** - Breaking change for direct API usage
  - Updated: `saveScenario()`, `loadScenario()`, `listScenarios()`, `searchScenarios()`, `deleteScenario()`, `loadIndex()`, and all other storage functions
  - MCP tool users: no breaking changes, just new optional `directory` parameter
  - Location: `recorder/scenario-storage.js`, `recorder/scenario-executor.js`, `recorder/recorder-script.js`

## [1.8.0] - 2025-12-19

### Added
- **Test Code Generation** - New MCP tool `exportScenarioAsCode` for generating executable test code from recorded scenarios
  - Supports 4 test frameworks: Playwright (TypeScript/Python), Selenium (Python/Java)
  - Automatic selector cleaning - removes unstable CSS classes (CSS Modules, styled-components, Emotion, hashed classes)
  - Generates clean, readable test code with comments
  - Smart selector stability analysis with pattern-based detection
  - Fallback selector selection - chooses most stable selector from fallbacks
  - Location: `utils/code-generators/`, `utils/selector-cleaner.js`

  **Unstable patterns detected:**
  - CSS Modules: `Button_primary__2x3yZ`
  - Styled-components: `sc-AbCdEf-0`
  - Emotion: `css-1a2b3c4d`
  - Hash suffixes: `component_a1b2c3d`
  - Random hashes: `_1a2b3c4d`

  **Usage:**
  ```javascript
  exportScenarioAsCode('checkout', {
    language: 'playwright-typescript',
    cleanSelectors: true,
    includeComments: true
  })
  ```

## [1.7.4] - 2025-12-19

### Changed
- **executeScenario auto-opens browser** - No longer throws error when no page is open
  - Automatically opens browser at scenario's `entryUrl` if no page is currently open
  - Eliminates need to manually call `openBrowser` before executing scenarios
  - Improves user experience by treating browser opening as a side effect
  - Falls back gracefully: shows error only if scenario has no `entryUrl`
  - Location: `index.js:3417-3469`

## [1.7.3] - 2025-12-19

### Fixed
- **Fixed CSS selector generation crash** - `analyzePage` now handles attribute values with special characters
  - Added `isSafeSelectorValue()` function to validate attribute values before using in selectors
  - Filters out attributes containing problematic characters: `["'\\[]{}()]`
  - Added try-catch blocks to prevent selector syntax errors
  - Example: `button[data-counter="["b"]"]` (invalid) is now skipped
  - Location: `element-finder-utils.js:302-360`

### Improved
- **Recorder now skips hidden elements** - Prevents recording actions on invisible elements
  - Added `isElementVisible()` function to check element visibility before recording
  - Checks: offsetWidth/Height, display, visibility, opacity
  - Applies to all event types: click, type, select, upload, hover, drag
  - Prevents scenarios with duplicate/invisible element actions (e.g., Yandex search with hidden input)
  - Console logs when skipping hidden elements for debugging
  - Location: `recorder/recorder-script.js:1173-1188`

## [1.7.2] - 2025-12-16

### Added
- **Figma API Token Setup documentation** - Added comprehensive guide on how to obtain and configure Figma Personal Access Token
  - Step-by-step instructions for getting token from Figma account settings
  - Configuration examples for both Claude Desktop and Claude Code
  - Environment variable setup (`FIGMA_TOKEN`)
  - Note about alternative parameter-based token passing

## [1.7.1] - 2025-12-15

### Performance
- **Optimized tool descriptions** - Reduced token usage by 35-45% (~1,500-2,000 tokens)
  - Shortened main tool descriptions from verbose to concise format
  - Reduced parameter descriptions (e.g., "CSS selector for element to click" → "CSS selector")
  - Standardized Figma tool parameters (7 tools optimized)
  - Pattern-based reductions across all 41 tools
  - Impact: Saves 1,500-2,000 tokens in every request to Claude
  - Examples:
    - `analyzePage`: 95 tokens → 30 tokens (68% reduction)
    - `screenshot`: 75 tokens → 25 tokens (66% reduction)
    - `listNetworkRequests`: 50 tokens → 20 tokens (60% reduction)

### Changed
- All tool descriptions now use imperative voice and remove redundancy
- Figma tools: "Figma API token (optional if FIGMA_TOKEN env var is set)" → "API token (optional)"
- Common patterns: "Milliseconds to wait" → "Wait ms", "Maximum" → "Max", etc.

## [1.7.0] - 2025-12-14

### Removed
- **Removed Angular tools** - Removed all 5 Angular-specific tools to reduce context window usage
  - Removed tools: `listAngularComponents`, `getAngularComponent`, `callAngularMethod`, `getAngularForm`, `submitAngularForm`
  - Removed from: tool definitions, handlers, Zod schemas, README documentation
  - Impact: Reduced token usage by ~2500-3000 tokens (~10 pages of context)
  - Tool count: 45 → 40 tools

### Changed
- **Simplified tool descriptions** - Removed Angular references from `screenshot` and `executeScript` descriptions
  - Cleaner, more focused descriptions for remaining tools

## [1.6.2] - 2025-12-14

### Fixed
- **Fixed JSON Schema validation error for `callAngularMethod`** - Added missing `items` field to `args` array parameter
  - Error: "array schema missing items" when using with OpenAI/OpenRouter providers
  - Impact: Tool now works correctly with all LLM providers that validate JSON Schema strictly
  - Note: This tool was subsequently removed in v1.7.0

## [1.6.1] - 2025-12-03

### Changed
- **Optimized `listNetworkRequests` with pagination** - Added `limit` and `offset` parameters
  - Default limit: 50 requests (max: 500)
  - Returns: `{ totalCount, returnedCount, hasMore, offset, limit, requests: [...] }`
  - Prevents excessive token usage when pages have hundreds of network requests
  - Example: `listNetworkRequests({ limit: 20, offset: 20 })` returns requests 21-40

### Performance
- Reduced token usage for network request inspection on pages with many requests
- AI receives pagination metadata (`hasMore`, `totalCount`) to request additional pages as needed

## [1.6.0] - 2025-12-03

### Changed
- **Code organization improved** - Major refactoring to modular architecture
  - Created `tools/` directory with `tool-schemas.js` (all Zod validation schemas)
  - Created `utils/` directory with specialized utility modules:
    - `css-helpers.js` - CSS categorization and filtering (~133 lines)
    - `screenshot-processor.js` - Screenshot processing and image comparison (~210 lines)
    - `element-actions.js` - Element interaction actions (~115 lines)
  - Total **~712 lines moved to separate modules** for better maintainability
  - Created REFACTORING.md documenting modular structure and future improvements

### Benefits
- **Better code organization** - Related functionality grouped logically
- **Improved maintainability** - Easier to find and modify specific functionality
- **Reusability** - Modules can be tested and used independently
- **Cleaner main file** - index.js reduced by ~20% (712 lines)

### Technical Details
- Backup created (index.js.backup) before refactoring
- Modules are independent with no circular dependencies
- Additional utility modules prepared for future integration (browser-manager, network-monitor, recorder-helper)

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

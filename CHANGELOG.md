# Changelog

All notable changes to this project will be documented in this file.

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

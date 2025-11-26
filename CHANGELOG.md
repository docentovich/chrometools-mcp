# Changelog

All notable changes to this project will be documented in this file.

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

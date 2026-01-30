# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**chrometools-mcp** - MCP (Model Context Protocol) server for Chrome automation using Puppeteer.

Cross-platform MCP server (Windows/WSL, Linux, macOS) that provides Chrome browser automation capabilities.

## Key Architecture Concept

**Persistent Browser Sessions**: Browser tabs remain open after command execution, allowing users to:
- Prepare pages manually between AI iterations
- Continue work from previous state
- Interact with pages between MCP server calls

This enables iterative workflows where the user and AI collaborate within the same browser session.

## Installation & Usage

Users install and run via npx (single command, no setup):

```bash
npx chrometools-mcp
```

This design makes installation automatic and simple for end users.

## Development Commands

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Development/testing
npm start
# or
node index.js
```

## Technology Stack

- **Puppeteer**: Chrome automation library
- **MCP SDK**: `@modelcontextprotocol/sdk` for server implementation
- **Transport**: stdio (standard for MCP servers)

## Core Workflow

1. User runs `npx chrometools-mcp` (or adds to MCP config)
2. MCP server launches Puppeteer with `headless: false`
3. AI sends commands via MCP tools → Server executes in Chrome
4. Browser tabs **stay open** after execution
5. User can manually interact with pages
6. Next AI request continues from current browser state

## Implementation Guidelines

### Puppeteer Configuration

```javascript
// Browser should persist between commands
const browser = await puppeteer.launch({
  headless: false,  // User needs to see and interact
  // Keep browser alive between MCP calls
});
```

### Tab Management

- **DO NOT close tabs** after command execution
- Reuse existing tabs when possible
- Allow user to open/navigate tabs manually
- Track tab state between MCP requests

### MCP Tools Design

Expected tools might include:
- Navigate to URL
- Click elements
- Fill forms
- Get page content
- Execute JavaScript
- Take screenshots
- Wait for elements

All tools should work with **current browser state**, not create new sessions.

## Important: Applying Code Changes

**⚠️ All code changes require MCP server restart to take effect!**

After modifying any code files (index.js, tool-schemas.js, tool-definitions.js, etc.):

1. **User must restart the MCP server** (or restart the MCP client like Claude Desktop/Telegram bot)
2. Only then will changes be applied
3. Testing with old server instance will show old behavior

**DO NOT** test changes without confirming the server was restarted. If testing fails unexpectedly, first verify the server was restarted.

```bash
# For development: restart the MCP client or run
npm start
```

## Testing

When testing locally:

```bash
# Test as users would install
npx .

# Or during development
npm test
```

## Cross-Platform Considerations

- Works in pure Linux/macOS
- Works in Windows WSL
- Works in native Windows
- Puppeteer handles Chrome/Chromium installation automatically
- No platform-specific code needed (Puppeteer abstracts this)

## Package Configuration

Ensure `package.json` includes:
- `bin` field for npx execution
- Proper entry point
- MCP server metadata
- Puppeteer as dependency

## MCP Configuration for Development

MCP servers are configured in `/home/user/.claude.json` file (NOT `.claude/mcp_config.json`).

For WSL development with GUI support, use xvfb-run:

```json
"mcpServers": {
  "chrometools": {
    "type": "stdio",
    "command": "xvfb-run",
    "args": ["-a", "node", "/mnt/c/prj/chrometools-mcp/index.js"],
    "env": {}
  }
}
```

xvfb provides virtual X server, allowing Chrome GUI to run without external X server (VcXsrv).

## Documentation Guidelines

When making changes to the codebase:

### What to Update (ALWAYS)

1. **CHANGELOG.md** - ALWAYS add concise entry with version, date, and changes
2. **README.md** - ALWAYS update when adding new tools or changing user-facing behavior
3. **package.json** - ALWAYS increment version number appropriately

**IMPORTANT**: For new tools/features, ALWAYS update README.md to document them. This is NOT optional.

### What NOT to Create

**DO NOT create separate documentation files** for individual changes, such as:
- ❌ `PERFORMANCE_IMPROVEMENTS.md`
- ❌ `NEW_FEATURES.md`
- ❌ `MIGRATION_GUIDE.md`
- ❌ Individual feature documentation files

### Documentation Rules

1. **CHANGELOG.md** - All change documentation goes here (version history)
2. **README.md** - MUST be updated for new tools/features with:
   - Tool description in appropriate section
   - Parameters and usage examples
   - Update tool count in Features section
   - Add to Table of Contents if needed
3. **Keep it concise** - Brief but complete summary of what changed and why
4. **No separate files** - Never create separate documentation files for features
5. **Version control** - Let git history track detailed changes

### CHANGELOG.md Format

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature description

### Changed
- Modified behavior description

### Fixed
- Bug fix description

### Performance
- Performance improvement description
```

Keep entries short and focused. Detailed explanations belong in code comments or git commit messages, not separate files.

### Example: Adding a New Tool

When adding a new tool like `getNetworkRequests`:

1. ✅ **Update README.md**:
   - Add tool to appropriate section (e.g., Advanced Tools)
   - Include parameters, use cases, examples
   - Update tool count in Features section
   - Add to Table of Contents

2. ✅ **Update CHANGELOG.md**:
   - Add new version entry
   - List the new tool under "Added"
   - Include brief examples

3. ✅ **Update package.json**:
   - Increment version (e.g., 1.3.2 → 1.3.3)

4. ✅ **Update extension/manifest.json** (if extension was modified):
   - Set version equal to package.json version (see Version Sync Rule below)

5. ❌ **DO NOT create**:
   - `NETWORK_MONITORING.md`
   - `GET_NETWORK_REQUESTS_GUIDE.md`
   - Any other separate documentation files

### Example: Changing Existing Behavior

When modifying an existing tool (e.g., making screenshots optional):

1. ✅ **Update README.md**:
   - Update the tool's parameter documentation
   - Add performance notes if relevant
   - Update examples if behavior changed

2. ✅ **Update CHANGELOG.md**:
   - Add version entry with "Changed" or "Performance" section
   - Include migration notes if breaking change

3. ✅ **Update package.json**:
   - Increment version appropriately

### Version Sync Rule: MCP and Chrome Extension

**IMPORTANT**: When updating `extension/manifest.json` version, ALWAYS set it equal to the current `package.json` version.

- The extension may not be updated for several releases
- But when it IS updated, sync the version to match MCP
- This ensures both components have matching versions when extension changes

Example:
- MCP package.json: `3.3.6`
- Extension manifest.json (before): `3.1.2`
- Extension manifest.json (after update): `3.3.6` ← sync to MCP version

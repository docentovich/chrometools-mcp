# chrometools-mcp

MCP server for Chrome automation using Puppeteer with persistent browser sessions.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Available Tools](#available-tools)
  - [ping](#ping)
  - [openBrowser](#openbrowser)
- [Configuration](#configuration)
  - [Basic Configuration](#basic-configuration-linux-macos-windows)
  - [GUI Mode vs Headless Mode](#gui-mode-vs-headless-mode)
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

## Available Tools

### ping

Simple ping-pong tool for testing MCP connection.

**Parameters:**
- `message` (optional): String message to include in response

**Example:**
```json
{
  "name": "ping",
  "arguments": {
    "message": "hello"
  }
}
```

**Response:**
```
pong: hello
```

### openBrowser

Opens a browser window and navigates to the specified URL. The browser stays open for user interaction after the command completes.

**Parameters:**
- `url` (required): URL to navigate to (e.g., `https://example.com`)

**Example:**
```json
{
  "name": "openBrowser",
  "arguments": {
    "url": "https://example.com"
  }
}
```

**Response:**
```
Browser opened successfully!
URL: https://example.com
Page title: Example Domain

Browser remains open for interaction.
```

**Important:** The browser window remains open after execution, allowing you to interact with the page between MCP commands. This enables iterative workflows where you prepare pages manually between AI requests.

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

- **Persistent Browser Sessions**: Browser tabs remain open between requests
- **Headless: false**: Visual browser for user interaction
- **Cross-platform**: Works on Windows/WSL, Linux, macOS
- **Simple Installation**: One command with npx

## Architecture

- Uses Puppeteer for Chrome automation
- MCP Server SDK for protocol implementation
- Zod for schema validation
- Stdio transport for communication

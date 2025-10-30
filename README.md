# chrometools-mcp

MCP server for Chrome automation using Puppeteer with persistent browser sessions.

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

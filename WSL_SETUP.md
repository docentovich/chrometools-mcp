# WSL Setup Guide for chrometools-mcp

If you're using **Windows Subsystem for Linux (WSL)**, follow these steps to enable visible Chrome GUI windows.

> **Note:** This setup is based on the solution from [Puppeteer Issue #8148](https://github.com/puppeteer/puppeteer/issues/8148#issuecomment-1195390456):
>
> _"I was able to partially resolve this issue using VcXsrv Windows X Server, and with the help of this guide [...] now when I enter `google-chrome` into my WSL Ubuntu terminal, it launches and works just fine."_
> — Solution tested on Ubuntu WSL2 on Windows 11

## Table of Contents

- [Why WSL Needs Special Setup?](#why-wsl-needs-special-setup)
- [Step 1: Install VcXsrv Windows X Server](#step-1-install-vcxsrv-windows-x-server)
- [Step 2: Configure VcXsrv (First Time Setup)](#step-2-configure-vcxsrv-first-time-setup)
- [Step 3: Configure MCP Server for WSL](#step-3-configure-mcp-server-for-wsl)
- [Step 4: Test the Setup](#step-4-test-the-setup)
- [Step 5: Restart MCP Client](#step-5-restart-mcp-client)
- [Troubleshooting WSL](#troubleshooting-wsl)
- [References](#references-for-wsl-setup)

---

## Why WSL Needs Special Setup?

WSL runs Linux in a separate environment from Windows. To display GUI applications (like Chrome), you need an X server running on Windows that WSL can connect to.

## Step 1: Install VcXsrv Windows X Server

VcXsrv is a free X server for Windows that allows WSL Linux applications to display GUI windows.

**Download and Install:**
1. Download VcXsrv: [https://sourceforge.net/projects/vcxsrv/](https://sourceforge.net/projects/vcxsrv/)
2. Run the installer (default settings are fine)
3. Launch **XLaunch** from Start Menu or Desktop

## Step 2: Configure VcXsrv (First Time Setup)

When you launch XLaunch for the first time, configure it as follows:

**Screen 1: Display settings**
- ✅ Select **"Multiple windows"** (recommended for WSL)
- Display number: `0` (leave default)
- Click "Next"

**Screen 2: Client startup**
- ✅ Select **"Start no client"** (recommended)
- Click "Next"

**Screen 3: Extra settings** ⚠️ **IMPORTANT**
- ☑️ **"Clipboard"** (optional, convenient for copy-paste)
- ☑️ **"Disable access control"** ✅ **MUST BE ENABLED!**
  - This allows WSL to connect to the X server
  - Without this, you'll get "Connection refused" errors
- Click "Next"

**Screen 4: Finish**
- Optionally save configuration as `.xlaunch` file for quick restart
- Place saved file in Windows Startup folder for automatic launch
- Click "Finish"

**Verify VcXsrv is Running:**
- Check for VcXsrv icon in Windows system tray (bottom-right)
- If you see the icon, VcXsrv is running

## Step 3: Configure MCP Server for WSL

**Find your Windows host IP address:**

In WSL terminal, run:
```bash
ip route show | grep -i default | awk '{print $3}'
```

You should see an IP like `172.x.x.1` (commonly `172.25.96.1` or similar).

### Option A: Using Environment Variable (Recommended)

Configure the MCP server with `DISPLAY` pointing to your Windows host:

```json
{
  "mcpServers": {
    "chrometools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrometools-mcp"],
      "env": {
        "DISPLAY": "172.25.96.1:0"
      }
    }
  }
}
```

⚠️ **Replace `172.25.96.1` with your actual Windows host IP!**

### Option B: Using Direct Node Path (For Claude Code)

If you're using Claude Code, use the full path to node:

```json
{
  "mcpServers": {
    "chrometools": {
      "type": "stdio",
      "command": "/home/user/.nvm/versions/node/v22.20.0/bin/node",
      "args": ["/path/to/chrometools-mcp/index.js"],
      "env": {
        "DISPLAY": "172.25.96.1:0"
      }
    }
  }
}
```

### Option C: Using xvfb (No VcXsrv Required)

If you don't want to install VcXsrv, you can use xvfb (virtual display):

```bash
# Install xvfb in WSL
sudo apt-get update
sudo apt-get install -y xvfb
```

Then configure:

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

**Note:** With xvfb, the browser runs but windows are **not visible**. This is useful for automation without GUI.

## Step 4: Test the Setup

### Test VcXsrv Connection (if using GUI mode)

In WSL terminal:
```bash
# Set DISPLAY variable (use your Windows host IP)
export DISPLAY=172.25.96.1:0

# Test X server connection
timeout 3 nc -zv 172.25.96.1 6000
```

Expected output: `Connection to 172.25.96.1 6000 port [tcp/x11] succeeded!`

If you get "Connection refused", check:
- VcXsrv is running (icon in system tray)
- "Disable access control" is enabled in XLaunch settings
- Windows Firewall is not blocking port 6000

### Test Chrome GUI

```bash
# Test with a simple command
DISPLAY=172.25.96.1:0 google-chrome https://example.com
```

You should see a Chrome window appear on your screen with example.com loaded!

## Step 5: Restart MCP Client

After configuring, **fully restart your MCP client** (Claude Desktop or Claude Code):
- Close the application completely
- Relaunch it
- The MCP server will now use the new configuration

## Troubleshooting WSL

### Problem: "Missing X server" error

```
Error: Missing X server to start the headful browser.
```

**Solutions:**
1. Make sure VcXsrv is running (check system tray)
2. Verify "Disable access control" is enabled in VcXsrv
3. Check DISPLAY variable is set correctly in MCP config
4. Test X server connection: `nc -zv 172.25.96.1 6000`
5. Fully restart MCP client after config changes

### Problem: Browser opens but window is not visible

**Cause:** MCP server is using xvfb (virtual display) instead of VcXsrv.

**Solution:**
1. Check your config has `"env": { "DISPLAY": "172.25.96.1:0" }`
2. Make sure you're **not** using `xvfb-run` in the command
3. Fully restart MCP client (close and reopen)
4. Check process: `ps aux | grep chrometools` - should NOT show `xvfb-run`

### Problem: Windows Firewall blocking connection

If `nc -zv 172.25.96.1 6000` fails, Windows Firewall might be blocking the connection.

**Solution:**
1. Open Windows Defender Firewall
2. Click "Allow an app or feature through Windows Defender Firewall"
3. Find "VcXsrv windows xserver" and enable it for Private networks
4. If not listed, click "Allow another app" and add `vcxsrv.exe`

### Problem: IP address changes after Windows restart

WSL assigns a new IP to Windows host after each restart.

**Solution:** Create a startup script to get current IP:

```bash
# In WSL ~/.bashrc or ~/.zshrc
export DISPLAY=$(ip route show | grep -i default | awk '{print $3}'):0
```

Or use a helper script:
```bash
#!/bin/bash
# ~/.local/bin/win-ip.sh
ip route show | grep -i default | awk '{print $3}'
```

## References for WSL Setup

These resources were instrumental in solving the WSL + Puppeteer GUI setup:

- **VcXsrv Windows X Server** (Free X server for Windows)
  [https://sourceforge.net/projects/vcxsrv/](https://sourceforge.net/projects/vcxsrv/)

- **ChromeDriver in WSL2** by Greg Brisebois (Comprehensive setup guide)
  [https://www.gregbrisebois.com/posts/chromedriver-in-wsl2/](https://www.gregbrisebois.com/posts/chromedriver-in-wsl2/)

- **Puppeteer Issue #8148** (Missing X server or $DISPLAY)
  - Main issue thread: [https://github.com/puppeteer/puppeteer/issues/8148](https://github.com/puppeteer/puppeteer/issues/8148)
  - Solution comment: [https://github.com/puppeteer/puppeteer/issues/8148#issuecomment-1195390456](https://github.com/puppeteer/puppeteer/issues/8148#issuecomment-1195390456)

- **Stack Overflow: WSL2 X Server Setup**
  [https://stackoverflow.com/a/66398613](https://stackoverflow.com/a/66398613)

**Additional Resources:**
- [WSL GUI Apps Official Documentation](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps) (Microsoft)
- [Puppeteer Troubleshooting Guide](https://pptr.dev/troubleshooting) (Official Docs)

---

## Quick Summary

**For visible Chrome windows in WSL:**
1. Install and run VcXsrv on Windows
2. Enable "Disable access control" in VcXsrv settings
3. Get Windows host IP: `ip route show | grep -i default | awk '{print $3}'`
4. Configure MCP server with `DISPLAY=<your-ip>:0` in env
5. Fully restart MCP client
6. Test: `DISPLAY=172.25.96.1:0 google-chrome https://example.com`

**For headless automation (no visible windows):**
1. Install xvfb: `sudo apt-get install xvfb`
2. Configure MCP server with `xvfb-run` command
3. Restart MCP client

[← Back to README](README.md)

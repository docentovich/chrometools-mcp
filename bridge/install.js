#!/usr/bin/env node
/**
 * install.js
 *
 * Installs the Native Messaging Host for ChromeTools Bridge.
 * Run via: npx chrometools-mcp --install-bridge
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// Configuration
// ============================================

const HOST_NAME = 'com.chrometools.bridge';
const EXTENSION_ID = 'dmehkibmncgphijnigkahhlekgajhpbl';

// Where to install bridge files
const BRIDGE_DIR = path.join(os.homedir(), '.chrometools');

// ============================================
// Installation
// ============================================

export async function installBridge(options = {}) {
  const { silent = false } = options;

  const log = silent ? () => {} : console.log;
  const error = console.error;

  try {
    log('Installing ChromeTools Bridge Service...\n');

    // 1. Create bridge directory
    log(`Creating directory: ${BRIDGE_DIR}`);
    fs.mkdirSync(BRIDGE_DIR, { recursive: true });

    // 2. Store path to project directory (where node_modules lives)
    const projectDir = path.resolve(__dirname, '..');
    const bridgeSrc = path.join(__dirname, 'bridge-service.js');

    // Save project path for reference
    const configPath = path.join(BRIDGE_DIR, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      projectDir,
      bridgeScript: bridgeSrc,
      installedAt: new Date().toISOString()
    }, null, 2));
    log(`Saved config: ${configPath}`);

    // 3. Create launcher script that runs from project directory
    let launcherPath;
    if (process.platform === 'win32') {
      launcherPath = path.join(BRIDGE_DIR, 'bridge.cmd');
      const nodePath = process.execPath;
      // Change to project directory before running (so node_modules is available)
      const cmd = `@echo off\r\ncd /d "${projectDir}"\r\n"${nodePath}" "${bridgeSrc}"\r\n`;
      fs.writeFileSync(launcherPath, cmd);
      log(`Created launcher: ${launcherPath}`);
    } else {
      launcherPath = path.join(BRIDGE_DIR, 'bridge.sh');
      const sh = `#!/bin/bash\ncd "${projectDir}"\nexec node "${bridgeSrc}"\n`;
      fs.writeFileSync(launcherPath, sh, { mode: 0o755 });
      log(`Created launcher: ${launcherPath}`);
    }

    // 4. Create Native Messaging manifest
    const manifest = {
      name: HOST_NAME,
      description: 'ChromeTools Bridge Service - Connects Chrome Extension with MCP clients',
      path: launcherPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
    };

    const manifestPath = path.join(BRIDGE_DIR, 'native-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    log(`Created manifest: ${manifestPath}`);

    // 5. Register in system
    if (process.platform === 'win32') {
      await registerWindows(manifestPath, log, error);
    } else if (process.platform === 'darwin') {
      await registerMacOS(manifestPath, log);
    } else {
      await registerLinux(manifestPath, log);
    }

    log('\n✅ Bridge installed successfully!\n');
    log('Next steps:');
    log('1. Reload the ChromeTools extension in Chrome (chrome://extensions)');
    log('2. The bridge will start automatically when Chrome opens\n');

    return { success: true, bridgeDir: BRIDGE_DIR };

  } catch (err) {
    error(`\n❌ Installation failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function registerWindows(manifestPath, log, error) {
  const regPath = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;

  log(`Registering in Windows registry: ${regPath}`);

  try {
    // Use reg.exe to add the registry key
    execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath}" /f`, {
      stdio: 'pipe'
    });
    log('Registry entry created successfully');
  } catch (err) {
    error(`Registry error: ${err.message}`);
    throw new Error('Failed to register Native Messaging Host in Windows registry');
  }
}

async function registerMacOS(manifestPath, log) {
  // Chrome looks in ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
  const chromeHostsDir = path.join(
    os.homedir(),
    'Library/Application Support/Google/Chrome/NativeMessagingHosts'
  );

  fs.mkdirSync(chromeHostsDir, { recursive: true });

  const destPath = path.join(chromeHostsDir, `${HOST_NAME}.json`);
  fs.copyFileSync(manifestPath, destPath);
  log(`Registered at: ${destPath}`);
}

async function registerLinux(manifestPath, log) {
  // Chrome looks in ~/.config/google-chrome/NativeMessagingHosts/
  const chromeHostsDir = path.join(
    os.homedir(),
    '.config/google-chrome/NativeMessagingHosts'
  );

  fs.mkdirSync(chromeHostsDir, { recursive: true });

  const destPath = path.join(chromeHostsDir, `${HOST_NAME}.json`);
  fs.copyFileSync(manifestPath, destPath);
  log(`Registered at: ${destPath}`);
}

// ============================================
// Uninstallation
// ============================================

export async function uninstallBridge(options = {}) {
  const { silent = false } = options;
  const log = silent ? () => {} : console.log;

  try {
    log('Uninstalling ChromeTools Bridge Service...\n');

    // 1. Remove registry entry (Windows)
    if (process.platform === 'win32') {
      const regPath = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
      try {
        execSync(`reg delete "${regPath}" /f`, { stdio: 'pipe' });
        log('Removed registry entry');
      } catch {
        // Key might not exist
      }
    }

    // 2. Remove Chrome config (macOS/Linux)
    const configPaths = [
      path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts', `${HOST_NAME}.json`),
      path.join(os.homedir(), '.config/google-chrome/NativeMessagingHosts', `${HOST_NAME}.json`)
    ];

    for (const p of configPaths) {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        log(`Removed: ${p}`);
      }
    }

    // 3. Remove bridge directory
    if (fs.existsSync(BRIDGE_DIR)) {
      fs.rmSync(BRIDGE_DIR, { recursive: true });
      log(`Removed: ${BRIDGE_DIR}`);
    }

    log('\n✅ Bridge uninstalled successfully!');
    return { success: true };

  } catch (err) {
    console.error(`\n❌ Uninstallation failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================
// Check Installation
// ============================================

export function isBridgeInstalled() {
  // Check if manifest exists in expected location
  if (process.platform === 'win32') {
    try {
      const result = execSync(
        `reg query "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" /ve`,
        { stdio: 'pipe', encoding: 'utf8' }
      );
      return result.includes(HOST_NAME);
    } catch {
      return false;
    }
  } else {
    const configPaths = [
      path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts', `${HOST_NAME}.json`),
      path.join(os.homedir(), '.config/google-chrome/NativeMessagingHosts', `${HOST_NAME}.json`)
    ];
    return configPaths.some(p => fs.existsSync(p));
  }
}

// ============================================
// CLI
// ============================================

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--uninstall')) {
    uninstallBridge();
  } else {
    installBridge();
  }
}

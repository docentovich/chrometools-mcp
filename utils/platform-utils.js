/**
 * utils/platform-utils.js
 *
 * Platform detection and platform-specific utilities
 */

import { readFileSync } from 'fs';

/**
 * Detect WSL environment
 * @returns {boolean} - True if running in WSL
 */
export const isWSL = (() => {
  try {
    const proc_version = readFileSync('/proc/version', 'utf8').toLowerCase();
    return proc_version.includes('microsoft') || proc_version.includes('wsl');
  } catch {
    return false;
  }
})();

/**
 * Detect Windows environment (including WSL)
 * @returns {boolean} - True if running on Windows or WSL
 */
export const isWindows = process.platform === 'win32' || isWSL;

/**
 * Get Chrome executable path based on platform
 * @returns {string} - Path to Chrome executable
 */
export function getChromePath() {
  // Explicit override wins on every platform
  if (process.env.CHROMETOOLS_CHROME_PATH) {
    return process.env.CHROMETOOLS_CHROME_PATH;
  }
  if (process.platform === 'win32') {
    // Native Windows
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  } else if (isWSL) {
    // WSL - use Windows Chrome
    return '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
  } else {
    // Linux
    return '/usr/bin/google-chrome';
  }
}

/**
 * Get temp directory based on platform
 * @returns {string} - Path to temp directory
 */
export function getTempDir() {
  if (process.platform === 'win32') {
    return process.env.TEMP || 'C:\\Windows\\Temp';
  } else if (isWSL) {
    return '/mnt/c/Windows/Temp';
  } else {
    return process.env.TMPDIR || '/tmp';
  }
}

/**
 * Get the Chrome user-data-dir used when launching a new instance.
 * Override with CHROMETOOLS_USER_DATA_DIR to point at a real/cloned profile
 * that already holds the user's login session/cookies.
 * @returns {string} - Path to Chrome user data directory
 */
export function getUserDataDir() {
  return process.env.CHROMETOOLS_USER_DATA_DIR || `${getTempDir()}/chrome-mcp-profile`;
}

/**
 * Chrome remote debugging port.
 * Override with CHROMETOOLS_DEBUG_PORT (defaults to 9222).
 */
export const CHROME_DEBUG_PORT = parseInt(process.env.CHROMETOOLS_DEBUG_PORT, 10) || 9222;

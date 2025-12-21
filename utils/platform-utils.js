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
 * Chrome remote debugging port
 */
export const CHROME_DEBUG_PORT = 9222;

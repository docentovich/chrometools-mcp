/**
 * utils/project-detector.js
 *
 * Utilities for detecting the current project root directory.
 * Uses cascade strategy: env variables → Git root → cwd fallback
 */

import { execSync } from 'child_process';
import path from 'path';

/**
 * Find Git repository root from a starting path
 * @param {string} startPath - Path to start searching from
 * @returns {string|null} - Git root path or null if not in a Git repository
 */
function findGitRoot(startPath = process.cwd()) {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd: startPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
    }).trim();

    // Normalize path separators for Windows
    return path.normalize(root);
  } catch {
    // Not in a Git repository or git command not available
    return null;
  }
}

/**
 * Detect project root directory using cascade strategy
 *
 * Priority:
 * 1. CLAUDE_PROJECT_DIR environment variable
 * 2. PROJECT_DIR environment variable (custom)
 * 3. Git repository root
 * 4. Current working directory (fallback)
 *
 * @returns {string} - Detected project root path
 */
export function detectProjectRoot() {
  // 1. Try CLAUDE_PROJECT_DIR (Claude Code specific)
  if (process.env.CLAUDE_PROJECT_DIR) {
    const claudeDir = path.normalize(process.env.CLAUDE_PROJECT_DIR);
    console.log('[chrometools-mcp] Project root from CLAUDE_PROJECT_DIR:', claudeDir);
    return claudeDir;
  }

  // 2. Try PROJECT_DIR (custom env variable)
  if (process.env.PROJECT_DIR) {
    const projectDir = path.normalize(process.env.PROJECT_DIR);
    console.log('[chrometools-mcp] Project root from PROJECT_DIR:', projectDir);
    return projectDir;
  }

  // 3. Try Git root
  const gitRoot = findGitRoot();
  if (gitRoot) {
    console.log('[chrometools-mcp] Project root from Git:', gitRoot);
    return gitRoot;
  }

  // 4. Fallback to current working directory
  const cwd = process.cwd();
  console.log('[chrometools-mcp] Project root fallback to cwd:', cwd);
  return cwd;
}

/**
 * Get scenarios directory path from base directory
 * @param {string} baseDir - Base directory
 * @returns {string} - Path to scenarios directory
 */
export function getScenariosDir(baseDir) {
  return path.join(baseDir, 'scenarios');
}

/**
 * Get secrets directory path from base directory
 * @param {string} baseDir - Base directory
 * @returns {string} - Path to secrets directory
 */
export function getSecretsDir(baseDir) {
  return path.join(baseDir, 'secrets');
}

/**
 * utils/code-generators/file-appender.js
 *
 * Utilities for appending tests to existing test files
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { extname } from 'path';

export class FileAppender {
  /**
   * Expected file extensions for each language
   */
  static EXTENSIONS = {
    'playwright-typescript': ['.ts', '.spec.ts', '.test.ts'],
    'playwright-python': ['.py'],
    'selenium-python': ['.py'],
    'selenium-java': ['.java']
  };

  /**
   * Read file with error handling
   * @param {string} filePath - Path to file
   * @returns {string} - File content
   */
  static readFile(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    try {
      return readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Write file with automatic backup
   * @param {string} filePath - Path to file
   * @param {string} content - Content to write
   * @param {boolean} backup - Create backup before writing
   */
  static writeFile(filePath, content, backup = true) {
    const backupPath = filePath + '.backup';
    let originalContent = null;

    try {
      // Create backup if file exists and backup is requested
      if (backup && existsSync(filePath)) {
        originalContent = readFileSync(filePath, 'utf-8');
        writeFileSync(backupPath, originalContent, 'utf-8');
      }

      // Write new content
      writeFileSync(filePath, content, 'utf-8');

      // Clean up backup on success
      if (backup && existsSync(backupPath)) {
        unlinkSync(backupPath);
      }
    } catch (error) {
      // Restore from backup on failure
      if (backup && originalContent !== null) {
        try {
          writeFileSync(filePath, originalContent, 'utf-8');
        } catch (restoreError) {
          throw new Error(`Failed to write file and restore backup: ${error.message}, ${restoreError.message}`);
        }
      }
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Validate file extension matches language
   * @param {string} filePath - Path to file
   * @param {string} language - Target language
   * @throws {Error} If extension doesn't match
   */
  static validateFile(filePath, language) {
    const ext = extname(filePath);
    const expectedExts = this.EXTENSIONS[language];

    if (!expectedExts) {
      throw new Error(`Unknown language: ${language}`);
    }

    const isValid = expectedExts.some(e => filePath.endsWith(e));
    if (!isValid) {
      throw new Error(
        `File extension doesn't match language: expected ${expectedExts.join(' or ')} for ${language}, got ${ext}`
      );
    }
  }

  /**
   * Create backup of file
   * @param {string} filePath - Path to file
   * @returns {string} - Backup file path
   */
  static createBackup(filePath) {
    const backupPath = filePath + '.backup';
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      writeFileSync(backupPath, content, 'utf-8');
    }
    return backupPath;
  }

  /**
   * Restore file from backup
   * @param {string} filePath - Original file path
   */
  static restoreBackup(filePath) {
    const backupPath = filePath + '.backup';
    if (existsSync(backupPath)) {
      const content = readFileSync(backupPath, 'utf-8');
      writeFileSync(filePath, content, 'utf-8');
      unlinkSync(backupPath);
    }
  }

  /**
   * Detect test framework from file content
   * @param {string} content - File content
   * @returns {string|null} - Detected framework or null
   */
  static detectFramework(content) {
    // Playwright TypeScript patterns
    if (content.includes("from '@playwright/test'") ||
        content.includes('import { test, expect } from')) {
      return 'playwright-typescript';
    }

    // Playwright Python patterns
    if (content.includes('from playwright.sync_api import') ||
        content.includes('from playwright.async_api import')) {
      return 'playwright-python';
    }

    // Selenium Python patterns
    if (content.includes('from selenium') ||
        content.includes('import selenium')) {
      return 'selenium-python';
    }

    // Selenium Java patterns
    if (content.includes('import org.openqa.selenium') ||
        content.includes('import org.junit')) {
      return 'selenium-java';
    }

    return null;
  }

  /**
   * Check if file has unmatched braces (for TS/Java)
   * @param {string} content - File content
   * @returns {boolean} - True if unmatched
   */
  static hasUnmatchedBraces(content) {
    let count = 0;
    for (const char of content) {
      if (char === '{') count++;
      if (char === '}') count--;
    }
    return count !== 0;
  }

  /**
   * Check if file is empty or contains only whitespace
   * @param {string} content - File content
   * @returns {boolean}
   */
  static isEmpty(content) {
    return content.trim() === '';
  }

  /**
   * Check if content has any test functions/methods
   * @param {string} content - File content
   * @param {string} language - Language to check for
   * @returns {boolean}
   */
  static hasTests(content, language) {
    switch (language) {
      case 'playwright-typescript':
        return /test\(['"`]/.test(content);

      case 'playwright-python':
      case 'selenium-python':
        return /def test_\w+\s*\(/.test(content);

      case 'selenium-java':
        return /@Test/.test(content);

      default:
        return false;
    }
  }
}

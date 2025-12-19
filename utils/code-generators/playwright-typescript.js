/**
 * utils/code-generators/playwright-typescript.js
 *
 * Playwright TypeScript test code generator
 */

import { CodeGeneratorBase } from './code-generator-base.js';

export class PlaywrightTypeScriptGenerator extends CodeGeneratorBase {
  /**
   * Generate import statements
   */
  generateImports() {
    return [
      "import { test, expect } from '@playwright/test';"
    ];
  }

  /**
   * Generate test header
   */
  generateTestHeader(testName, description) {
    const lines = [];

    if (description && this.options.includeComments) {
      lines.push(`// ${description}`);
    }

    lines.push(`test('${testName}', async ({ page }) => {`);

    return lines;
  }

  /**
   * Generate test footer
   */
  generateTestFooter() {
    return ['});'];
  }

  /**
   * Generate navigation code
   */
  generateNavigate(url) {
    return [
      this.indent(`await page.goto('${this.escapeString(url)}');`)
    ];
  }

  /**
   * Generate action code
   */
  generateAction(action) {
    const lines = [];
    const comment = this.generateActionComment(action);
    if (comment.length > 0) {
      lines.push(...comment);
    }

    switch (action.type) {
      case 'click':
        lines.push(...this.generateClick(action));
        break;

      case 'type':
        lines.push(...this.generateType(action));
        break;

      case 'select':
        lines.push(...this.generateSelect(action));
        break;

      case 'hover':
        lines.push(...this.generateHover(action));
        break;

      case 'scroll':
        lines.push(...this.generateScroll(action));
        break;

      case 'navigate':
        lines.push(...this.generateNavigate(action.data?.url));
        break;

      case 'wait':
        lines.push(...this.generateWait(action));
        break;

      case 'keypress':
        lines.push(...this.generateKeypress(action));
        break;

      case 'upload':
        lines.push(...this.generateUpload(action));
        break;

      case 'drag':
        lines.push(...this.generateDrag(action));
        break;

      case 'extract':
        // Skip extract actions in test code (they're for data collection)
        break;

      default:
        if (this.options.includeComments) {
          lines.push(this.indent(`// TODO: Implement action type: ${action.type}`, 1));
        }
    }

    if (lines.length > 0) {
      lines.push(''); // Add blank line after action
    }

    return lines;
  }

  /**
   * Generate click action
   */
  generateClick(action) {
    const selector = this.prepareSelector(action);
    return [this.indent(`await page.locator('${this.escapeString(selector)}').click();`)];
  }

  /**
   * Generate type action
   */
  generateType(action) {
    const selector = this.prepareSelector(action);
    const text = action.data?.text || '';

    return [this.indent(`await page.locator('${this.escapeString(selector)}').fill('${this.escapeString(text)}');`)];
  }

  /**
   * Generate select action
   */
  generateSelect(action) {
    const selector = this.prepareSelector(action);
    const value = action.data?.value || '';

    return [this.indent(`await page.locator('${this.escapeString(selector)}').selectOption('${this.escapeString(value)}');`)];
  }

  /**
   * Generate hover action
   */
  generateHover(action) {
    const selector = this.prepareSelector(action);
    return [this.indent(`await page.locator('${this.escapeString(selector)}').hover();`)];
  }

  /**
   * Generate scroll action
   */
  generateScroll(action) {
    const selector = this.prepareSelector(action);
    return [this.indent(`await page.locator('${this.escapeString(selector)}').scrollIntoViewIfNeeded();`)];
  }

  /**
   * Generate wait action
   */
  generateWait(action) {
    const duration = action.data?.duration || 1000;
    return [this.indent(`await page.waitForTimeout(${duration});`)];
  }

  /**
   * Generate keypress action
   */
  generateKeypress(action) {
    const key = action.data?.key || 'Enter';
    return [this.indent(`await page.keyboard.press('${this.escapeString(key)}');`)];
  }

  /**
   * Generate upload action
   */
  generateUpload(action) {
    const selector = this.prepareSelector(action);
    const filePath = action.data?.filePath || 'path/to/file';

    return [this.indent(`await page.locator('${this.escapeString(selector)}').setInputFiles('${this.escapeString(filePath)}');`)];
  }

  /**
   * Generate drag action
   */
  generateDrag(action) {
    const fromSelector = this.prepareSelector(action);
    const toSelector = action.data?.toSelector || action.data?.to;

    if (toSelector) {
      return [
        this.indent(`await page.locator('${this.escapeString(fromSelector)}').dragTo(page.locator('${this.escapeString(toSelector)}'));`)
      ];
    } else {
      // Drag by offset
      const offsetX = action.data?.offsetX || action.data?.toX || 0;
      const offsetY = action.data?.offsetY || action.data?.toY || 0;
      return [
        this.indent(`await page.locator('${this.escapeString(fromSelector)}').hover();`),
        this.indent(`await page.mouse.down();`),
        this.indent(`await page.mouse.move(${offsetX}, ${offsetY});`),
        this.indent(`await page.mouse.up();`)
      ];
    }
  }

  /**
   * Generate URL assertion
   */
  generateUrlAssertion(expectedUrl) {
    // Check if URL is a regex pattern
    const isRegex = expectedUrl.includes('*') || expectedUrl.includes('?') || expectedUrl.includes('[');

    if (isRegex) {
      // Convert simple wildcards to regex
      const regexPattern = expectedUrl
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
        .replace(/\\\*/g, '.*'); // Convert * to .*

      return [this.indent(`await expect(page).toHaveURL(/${regexPattern}/);`)];
    } else {
      return [this.indent(`await expect(page).toHaveURL('${this.escapeString(expectedUrl)}');`)];
    }
  }
}

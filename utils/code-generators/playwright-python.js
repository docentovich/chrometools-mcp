/**
 * utils/code-generators/playwright-python.js
 *
 * Playwright Python test code generator
 */

import { CodeGeneratorBase } from './code-generator-base.js';

export class PlaywrightPythonGenerator extends CodeGeneratorBase {
  constructor(options = {}) {
    super({...options, indentSize: 4}); // Python uses 4 spaces
  }

  /**
   * Generate import statements
   */
  generateImports() {
    return [
      'from playwright.sync_api import Page, expect',
      'import pytest',
      'import re'
    ];
  }

  /**
   * Generate test header
   */
  generateTestHeader(testName, description) {
    const lines = [];
    lines.push('');

    if (description && this.options.includeComments) {
      lines.push(`# ${description}`);
    }

    // Convert camelCase or kebab-case to snake_case for Python
    const pythonTestName = testName
      .replace(/([A-Z])/g, '_$1')
      .replace(/-/g, '_')
      .toLowerCase()
      .replace(/^_/, '');

    lines.push(`def test_${pythonTestName}(page: Page):`);

    return lines;
  }

  /**
   * Generate test footer
   */
  generateTestFooter() {
    return ['    pass'];
  }

  /**
   * Generate navigation code
   */
  generateNavigate(url) {
    return [this.indent(`page.goto("${this.escapeString(url)}")`)];
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
        // Skip extract actions
        break;

      default:
        if (this.options.includeComments) {
          lines.push(this.indent(`# TODO: Implement action type: ${action.type}`, 1));
        }
    }

    if (lines.length > 0) {
      lines.push(''); // Add blank line
    }

    return lines;
  }

  /**
   * Generate inline comment (Python style)
   */
  generateComment(text) {
    return `# ${text}`;
  }

  /**
   * Generate click action
   */
  generateClick(action) {
    const selector = this.prepareSelector(action);
    return [this.indent(`page.locator("${this.escapeString(selector)}").click()`)];
  }

  /**
   * Generate type action
   */
  generateType(action) {
    const selector = this.prepareSelector(action);
    const text = action.data?.text || '';

    return [this.indent(`page.locator("${this.escapeString(selector)}").fill("${this.escapeString(text)}")`)];
  }

  /**
   * Generate select action
   */
  generateSelect(action) {
    const selector = this.prepareSelector(action);
    const value = action.data?.value || '';

    return [this.indent(`page.locator("${this.escapeString(selector)}").select_option("${this.escapeString(value)}")`)];
  }

  /**
   * Generate hover action
   */
  generateHover(action) {
    const selector = this.prepareSelector(action);
    return [this.indent(`page.locator("${this.escapeString(selector)}").hover()`)];
  }

  /**
   * Generate scroll action
   */
  generateScroll(action) {
    const selector = this.prepareSelector(action);
    return [this.indent(`page.locator("${this.escapeString(selector)}").scroll_into_view_if_needed()`)];
  }

  /**
   * Generate wait action
   */
  generateWait(action) {
    const duration = action.data?.duration || 1000;
    return [this.indent(`page.wait_for_timeout(${duration})`)];
  }

  /**
   * Generate keypress action
   */
  generateKeypress(action) {
    const key = action.data?.key || 'Enter';
    return [this.indent(`page.keyboard.press("${this.escapeString(key)}")`)];
  }

  /**
   * Generate upload action
   */
  generateUpload(action) {
    const selector = this.prepareSelector(action);
    const filePath = action.data?.filePath || 'path/to/file';

    return [this.indent(`page.locator("${this.escapeString(selector)}").set_input_files("${this.escapeString(filePath)}")`)];
  }

  /**
   * Generate drag action
   */
  generateDrag(action) {
    const fromSelector = this.prepareSelector(action);
    const toSelector = action.data?.toSelector || action.data?.to;

    if (toSelector) {
      return [
        this.indent(`page.locator("${this.escapeString(fromSelector)}").drag_to(page.locator("${this.escapeString(toSelector)}"))`)
      ];
    } else {
      // Drag by offset
      const offsetX = action.data?.offsetX || action.data?.toX || 0;
      const offsetY = action.data?.offsetY || action.data?.toY || 0;
      return [
        this.indent(`page.locator("${this.escapeString(fromSelector)}").hover()`),
        this.indent(`page.mouse.down()`),
        this.indent(`page.mouse.move(${offsetX}, ${offsetY})`),
        this.indent(`page.mouse.up()`)
      ];
    }
  }

  // ========================================
  // POM INTEGRATION
  // ========================================

  /**
   * Generate POM import
   */
  generatePomImports(className, importPath) {
    if (importPath) {
      return [`from ${importPath} import ${className}`];
    }
    // Convert ClassName to class_name for Python module
    const moduleName = className.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    return [`from ${moduleName} import ${className}`];
  }

  /**
   * Generate POM instantiation
   */
  generatePomInstantiation(className) {
    const varName = className.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    return [this.indent(`${varName} = ${className}(page)`), ''];
  }

  /**
   * Generate POM goto
   */
  generatePomGoto(url) {
    const varName = this.options.pomClassName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    return [this.indent(`${varName}.goto()`)];
  }

  /**
   * Generate POM-based action
   */
  generatePomAction(action, pomElement) {
    const varName = this.options.pomClassName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    const lines = [];

    const comment = this.generateActionComment(action);
    if (comment.length > 0) lines.push(...comment);

    switch (action.type) {
      case 'type': {
        const text = action.data?.text || '';
        lines.push(this.indent(`${varName}.${pomElement.methodName}("${this.escapeString(text)}")`));
        break;
      }
      case 'click':
        if (pomElement.methodType === 'click') {
          lines.push(this.indent(`${varName}.${pomElement.methodName}()`));
        } else {
          lines.push(this.indent(`${varName}.${pomElement.name}.click()`));
        }
        break;
      case 'select': {
        const value = action.data?.value || '';
        lines.push(this.indent(`${varName}.${pomElement.methodName}("${this.escapeString(value)}")`));
        break;
      }
      case 'hover':
        lines.push(this.indent(`${varName}.${pomElement.name}.hover()`));
        break;
      case 'navigate':
        lines.push(this.indent(`${varName}.goto()`));
        break;
      default:
        return null;
    }

    if (lines.length > 0) lines.push('');
    return lines;
  }

  /**
   * Generate URL assertion
   */
  generateUrlAssertion(expectedUrl) {
    const lines = [];

    // Check if URL is a regex pattern
    const isRegex = expectedUrl.includes('*') || expectedUrl.includes('?') || expectedUrl.includes('[');

    if (isRegex) {
      // Convert simple wildcards to regex
      const regexPattern = expectedUrl
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*');

      lines.push(this.indent(`expect(page).to_have_url(re.compile(r"${regexPattern}"))`));
    } else {
      lines.push(this.indent(`expect(page).to_have_url("${this.escapeString(expectedUrl)}")`));
    }

    return lines;
  }

  /**
   * Append test to existing Python file
   */
  appendTest(existingContent, newTestCode, options = {}) {
    const lines = existingContent.split('\n');
    const insertPosition = options.insertPosition || 'end';
    const referenceTestName = options.referenceTestName;

    let insertIndex;

    if (insertPosition === 'end') {
      // Insert at end of file
      insertIndex = lines.length;
    } else if (insertPosition === 'before' || insertPosition === 'after') {
      if (!referenceTestName) {
        throw new Error(`referenceTestName is required for insertPosition '${insertPosition}'`);
      }

      const pythonTestName = this.pythonTestName(referenceTestName);
      insertIndex = this.findPythonTestByName(lines, pythonTestName);

      if (insertIndex === -1) {
        throw new Error(`Reference test '${referenceTestName}' not found in file`);
      }

      if (insertPosition === 'after') {
        insertIndex = this.findPythonTestEnd(lines, insertIndex);
      }
    }

    // Insert new test with proper spacing (2 blank lines before test - PEP 8)
    lines.splice(insertIndex, 0, '', '', newTestCode);

    return lines.join('\n');
  }

  /**
   * Convert test name to Python convention
   */
  pythonTestName(name) {
    return name
      .replace(/([A-Z])/g, '_$1')
      .replace(/-/g, '_')
      .replace(/ /g, '_')
      .toLowerCase()
      .replace(/^_/, '')
      .replace(/__+/g, '_');
  }

  /**
   * Find Python test function by name
   */
  findPythonTestByName(lines, testName) {
    const testRegex = new RegExp(`^def test_${testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
    return lines.findIndex(line => testRegex.test(line.trim()));
  }

  /**
   * Find end of Python function (next def/class or end of file)
   */
  findPythonTestEnd(lines, startIndex) {
    // Find next function or class definition at same or lower indentation level
    const startLine = lines[startIndex];
    const startIndent = startLine.match(/^\s*/)[0].length;

    for (let i = startIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      const currentIndent = lines[i].match(/^\s*/)[0].length;

      // If we find a def or class at same or lower indentation, function has ended
      if (currentIndent <= startIndent && (trimmed.startsWith('def ') || trimmed.startsWith('class '))) {
        return i;
      }
    }

    return lines.length;
  }
}

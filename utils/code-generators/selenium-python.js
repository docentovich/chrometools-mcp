/**
 * utils/code-generators/selenium-python.js
 *
 * Selenium Python test code generator
 */

import { CodeGeneratorBase } from './code-generator-base.js';

export class SeleniumPythonGenerator extends CodeGeneratorBase {
  constructor(options = {}) {
    super({...options, indentSize: 4}); // Python uses 4 spaces
  }

  /**
   * Generate import statements
   */
  generateImports() {
    return [
      'from selenium import webdriver',
      'from selenium.webdriver.common.by import By',
      'from selenium.webdriver.support.ui import WebDriverWait',
      'from selenium.webdriver.support import expected_conditions as EC',
      'from selenium.webdriver.common.action_chains import ActionChains',
      'from selenium.webdriver.common.keys import Keys',
      'import pytest',
      'import re'
    ];
  }

  /**
   * Generate inline comment (Python style)
   */
  generateComment(text) {
    return `# ${text}`;
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

    // Convert to snake_case
    const pythonTestName = testName
      .replace(/([A-Z])/g, '_$1')
      .replace(/-/g, '_')
      .toLowerCase()
      .replace(/^_/, '');

    lines.push(`def test_${pythonTestName}(driver):`);

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
    return [this.indent(`driver.get("${this.escapeString(url)}")`)];
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
   * Generate action comment (Python style)
   */
  generateActionComment(action, indentLevel = 1) {
    if (!this.options.includeComments) {
      return [];
    }

    const description = this.getActionDescription(action);
    return [this.indent(`# ${description}`, indentLevel)];
  }

  /**
   * Generate wait for element helper
   */
  generateWaitForElement(selector, timeout = 10) {
    return this.indent(`WebDriverWait(driver, ${timeout}).until(EC.presence_of_element_located((By.CSS_SELECTOR, "${this.escapeString(selector)}")))`);
  }

  /**
   * Generate click action
   */
  generateClick(action) {
    const selector = this.prepareSelector(action);
    return [
      this.generateWaitForElement(selector),
      this.indent(`driver.find_element(By.CSS_SELECTOR, "${this.escapeString(selector)}").click()`)
    ];
  }

  /**
   * Generate type action
   */
  generateType(action) {
    const selector = this.prepareSelector(action);
    const text = action.data?.text || '';

    return [
      this.generateWaitForElement(selector),
      this.indent(`element = driver.find_element(By.CSS_SELECTOR, "${this.escapeString(selector)}")`),
      this.indent(`element.clear()`),
      this.indent(`element.send_keys("${this.escapeString(text)}")`)
    ];
  }

  /**
   * Generate select action
   */
  generateSelect(action) {
    const selector = this.prepareSelector(action);
    const value = action.data?.value || '';

    return [
      this.indent(`from selenium.webdriver.support.ui import Select`),
      this.generateWaitForElement(selector),
      this.indent(`select = Select(driver.find_element(By.CSS_SELECTOR, "${this.escapeString(selector)}"))`),
      this.indent(`select.select_by_value("${this.escapeString(value)}")`)
    ];
  }

  /**
   * Generate hover action
   */
  generateHover(action) {
    const selector = this.prepareSelector(action);
    return [
      this.generateWaitForElement(selector),
      this.indent(`element = driver.find_element(By.CSS_SELECTOR, "${this.escapeString(selector)}")`),
      this.indent(`ActionChains(driver).move_to_element(element).perform()`)
    ];
  }

  /**
   * Generate scroll action
   */
  generateScroll(action) {
    const selector = this.prepareSelector(action);
    return [
      this.generateWaitForElement(selector),
      this.indent(`element = driver.find_element(By.CSS_SELECTOR, "${this.escapeString(selector)}")`),
      this.indent(`driver.execute_script("arguments[0].scrollIntoView();", element)`)
    ];
  }

  /**
   * Generate wait action
   */
  generateWait(action) {
    const duration = action.data?.duration || 1000;
    const seconds = (duration / 1000).toFixed(2);
    return [
      this.indent(`import time`),
      this.indent(`time.sleep(${seconds})`)
    ];
  }

  /**
   * Generate keypress action
   */
  generateKeypress(action) {
    const key = action.data?.key || 'ENTER';
    const seleniumKey = this.mapKeyToSeleniumKey(key);

    return [this.indent(`ActionChains(driver).send_keys(Keys.${seleniumKey}).perform()`)];
  }

  /**
   * Map key name to Selenium Keys constant
   */
  mapKeyToSeleniumKey(key) {
    const keyMap = {
      'Enter': 'RETURN',
      'Escape': 'ESCAPE',
      'Tab': 'TAB',
      'Backspace': 'BACK_SPACE',
      'Delete': 'DELETE',
      'ArrowUp': 'ARROW_UP',
      'ArrowDown': 'ARROW_DOWN',
      'ArrowLeft': 'ARROW_LEFT',
      'ArrowRight': 'ARROW_RIGHT'
    };

    return keyMap[key] || key.toUpperCase();
  }

  /**
   * Generate upload action
   */
  generateUpload(action) {
    const selector = this.prepareSelector(action);
    const filePath = action.data?.filePath || 'path/to/file';

    return [
      this.generateWaitForElement(selector),
      this.indent(`driver.find_element(By.CSS_SELECTOR, "${this.escapeString(selector)}").send_keys("${this.escapeString(filePath)}")`)
    ];
  }

  /**
   * Generate drag action
   */
  generateDrag(action) {
    const fromSelector = this.prepareSelector(action);
    const toSelector = action.data?.toSelector || action.data?.to;

    if (toSelector) {
      return [
        this.generateWaitForElement(fromSelector),
        this.indent(`source = driver.find_element(By.CSS_SELECTOR, "${this.escapeString(fromSelector)}")`),
        this.indent(`target = driver.find_element(By.CSS_SELECTOR, "${this.escapeString(toSelector)}")`),
        this.indent(`ActionChains(driver).drag_and_drop(source, target).perform()`)
      ];
    } else {
      // Drag by offset
      const offsetX = action.data?.offsetX || action.data?.toX || 0;
      const offsetY = action.data?.offsetY || action.data?.toY || 0;
      return [
        this.generateWaitForElement(fromSelector),
        this.indent(`element = driver.find_element(By.CSS_SELECTOR, "${this.escapeString(fromSelector)}")`),
        this.indent(`ActionChains(driver).drag_and_drop_by_offset(element, ${offsetX}, ${offsetY}).perform()`)
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
    const moduleName = className.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    return [`from ${moduleName} import ${className}`];
  }

  /**
   * Generate POM instantiation
   */
  generatePomInstantiation(className) {
    const varName = className.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    return [this.indent(`${varName} = ${className}(driver)`), ''];
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
      case 'hover': {
        lines.push(this.indent(`element = ${varName}.driver.find_element(By.CSS_SELECTOR, "${this.escapeString(pomElement.selector)}")`));
        lines.push(this.indent(`ActionChains(${varName}.driver).move_to_element(element).perform()`));
        break;
      }
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

      lines.push(this.indent(`assert re.match(r"${regexPattern}", driver.current_url), f"Expected URL to match pattern ${regexPattern}, but got {driver.current_url}"`));
    } else {
      lines.push(this.indent(`assert driver.current_url == "${this.escapeString(expectedUrl)}", f"Expected URL ${this.escapeString(expectedUrl)}, but got {driver.current_url}"`));
    }

    return lines;
  }

  /**
   * Append test to existing Python file
   * Reuses Python parsing logic similar to Playwright Python
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
    const startLine = lines[startIndex];
    const startIndent = startLine.match(/^\s*/)[0].length;

    for (let i = startIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      const currentIndent = lines[i].match(/^\s*/)[0].length;

      if (currentIndent <= startIndent && (trimmed.startsWith('def ') || trimmed.startsWith('class '))) {
        return i;
      }
    }

    return lines.length;
  }
}

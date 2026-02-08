/**
 * utils/code-generators/selenium-java.js
 *
 * Selenium Java test code generator
 */

import { CodeGeneratorBase } from './code-generator-base.js';

export class SeleniumJavaGenerator extends CodeGeneratorBase {
  /**
   * Generate import statements
   */
  generateImports() {
    return [
      'import org.openqa.selenium.By;',
      'import org.openqa.selenium.WebDriver;',
      'import org.openqa.selenium.WebElement;',
      'import org.openqa.selenium.JavascriptExecutor;',
      'import org.openqa.selenium.support.ui.WebDriverWait;',
      'import org.openqa.selenium.support.ui.ExpectedConditions;',
      'import org.openqa.selenium.support.ui.Select;',
      'import org.openqa.selenium.interactions.Actions;',
      'import org.openqa.selenium.Keys;',
      'import org.junit.jupiter.api.Test;',
      'import static org.junit.jupiter.api.Assertions.*;',
      'import java.time.Duration;'
    ];
  }

  /**
   * Generate test header
   */
  generateTestHeader(testName, description) {
    const lines = [];
    lines.push('');

    if (description && this.options.includeComments) {
      lines.push(`// ${description}`);
    }

    // Convert to camelCase
    const javaTestName = testName
      .replace(/[_-](.)/g, (_, char) => char.toUpperCase())
      .replace(/^./, char => char.toLowerCase());

    lines.push('@Test');
    lines.push(`public void ${javaTestName}() {`);

    return lines;
  }

  /**
   * Generate test footer
   */
  generateTestFooter() {
    return ['}'];
  }

  /**
   * Generate navigation code
   */
  generateNavigate(url) {
    return [this.indent(`driver.get("${this.escapeString(url)}");`)];
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
          lines.push(this.indent(`// TODO: Implement action type: ${action.type}`, 1));
        }
    }

    if (lines.length > 0) {
      lines.push(''); // Add blank line
    }

    return lines;
  }

  /**
   * Generate wait for element helper
   */
  generateWaitForElement(selector, timeout = 10) {
    return this.indent(`WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(${timeout}));`);
  }

  /**
   * Generate click action
   */
  generateClick(action) {
    const selector = this.prepareSelector(action);
    return [
      this.indent(`driver.findElement(By.cssSelector("${this.escapeString(selector)}")).click();`)
    ];
  }

  /**
   * Generate type action
   */
  generateType(action) {
    const selector = this.prepareSelector(action);
    const text = action.data?.text || '';

    return [
      this.indent(`WebElement typeElement = driver.findElement(By.cssSelector("${this.escapeString(selector)}"));`),
      this.indent(`typeElement.clear();`),
      this.indent(`typeElement.sendKeys("${this.escapeString(text)}");`)
    ];
  }

  /**
   * Generate select action
   */
  generateSelect(action) {
    const selector = this.prepareSelector(action);
    const value = action.data?.value || '';

    return [
      this.indent(`WebElement selectElement = driver.findElement(By.cssSelector("${this.escapeString(selector)}"));`),
      this.indent(`Select selectDropdown = new Select(selectElement);`),
      this.indent(`selectDropdown.selectByValue("${this.escapeString(value)}");`)
    ];
  }

  /**
   * Generate hover action
   */
  generateHover(action) {
    const selector = this.prepareSelector(action);
    return [
      this.indent(`WebElement hoverElement = driver.findElement(By.cssSelector("${this.escapeString(selector)}"));`),
      this.indent(`Actions hoverActions = new Actions(driver);`),
      this.indent(`hoverActions.moveToElement(hoverElement).perform();`)
    ];
  }

  /**
   * Generate scroll action
   */
  generateScroll(action) {
    const selector = this.prepareSelector(action);
    return [
      this.indent(`WebElement scrollElement = driver.findElement(By.cssSelector("${this.escapeString(selector)}"));`),
      this.indent(`((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView();", scrollElement);`)
    ];
  }

  /**
   * Generate wait action
   */
  generateWait(action) {
    const duration = action.data?.duration || 1000;
    return [
      this.indent(`try {`),
      this.indent(`Thread.sleep(${duration});`, 2),
      this.indent(`} catch (InterruptedException e) {`),
      this.indent(`e.printStackTrace();`, 2),
      this.indent(`}`)
    ];
  }

  /**
   * Generate keypress action
   */
  generateKeypress(action) {
    const key = action.data?.key || 'ENTER';
    const seleniumKey = this.mapKeyToSeleniumKey(key);

    return [
      this.indent(`Actions actions = new Actions(driver);`),
      this.indent(`actions.sendKeys(Keys.${seleniumKey}).perform();`)
    ];
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
      this.indent(`driver.findElement(By.cssSelector("${this.escapeString(selector)}")).sendKeys("${this.escapeString(filePath)}");`)
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
        this.indent(`WebElement dragSource = driver.findElement(By.cssSelector("${this.escapeString(fromSelector)}"));`),
        this.indent(`WebElement dragTarget = driver.findElement(By.cssSelector("${this.escapeString(toSelector)}"));`),
        this.indent(`Actions dragActions = new Actions(driver);`),
        this.indent(`dragActions.dragAndDrop(dragSource, dragTarget).perform();`)
      ];
    } else {
      // Drag by offset
      const offsetX = action.data?.offsetX || action.data?.toX || 0;
      const offsetY = action.data?.offsetY || action.data?.toY || 0;
      return [
        this.indent(`WebElement dragElement = driver.findElement(By.cssSelector("${this.escapeString(fromSelector)}"));`),
        this.indent(`Actions dragOffsetActions = new Actions(driver);`),
        this.indent(`dragOffsetActions.dragAndDropBy(dragElement, ${offsetX}, ${offsetY}).perform();`)
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
    return [`import ${importPath || 'pages'}.${className};`];
  }

  /**
   * Generate POM instantiation
   */
  generatePomInstantiation(className) {
    const varName = className.charAt(0).toLowerCase() + className.slice(1);
    return [this.indent(`${className} ${varName} = new ${className}(driver);`), ''];
  }

  /**
   * Generate POM goto
   */
  generatePomGoto(url) {
    const varName = this.options.pomClassName.charAt(0).toLowerCase() + this.options.pomClassName.slice(1);
    return [this.indent(`${varName}.goTo();`)];
  }

  /**
   * Generate POM-based action
   */
  generatePomAction(action, pomElement) {
    const varName = this.options.pomClassName.charAt(0).toLowerCase() + this.options.pomClassName.slice(1);
    const lines = [];

    const comment = this.generateActionComment(action);
    if (comment.length > 0) lines.push(...comment);

    switch (action.type) {
      case 'type': {
        const text = action.data?.text || '';
        lines.push(this.indent(`${varName}.${pomElement.methodName}("${this.escapeString(text)}");`));
        break;
      }
      case 'click':
        if (pomElement.methodType === 'click') {
          lines.push(this.indent(`${varName}.${pomElement.methodName}();`));
        } else {
          lines.push(this.indent(`${varName}.${pomElement.name}.click();`));
        }
        break;
      case 'select': {
        const value = action.data?.value || '';
        lines.push(this.indent(`${varName}.${pomElement.methodName}("${this.escapeString(value)}");`));
        break;
      }
      case 'hover': {
        lines.push(this.indent(`WebElement element = driver.findElement(By.cssSelector("${this.escapeString(pomElement.selector)}"));`));
        lines.push(this.indent(`Actions hoverActions = new Actions(driver);`));
        lines.push(this.indent(`hoverActions.moveToElement(element).perform();`));
        break;
      }
      case 'navigate':
        lines.push(this.indent(`${varName}.goTo();`));
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

      lines.push(this.indent(`String currentUrl = driver.getCurrentUrl();`));
      lines.push(this.indent(`assertTrue(currentUrl.matches("${regexPattern}"), "Expected URL to match pattern ${regexPattern}, but got " + currentUrl);`));
    } else {
      lines.push(this.indent(`assertEquals("${this.escapeString(expectedUrl)}", driver.getCurrentUrl(), "URL mismatch");`));
    }

    return lines;
  }

  /**
   * Append test to existing Java file
   */
  appendTest(existingContent, newTestCode, options = {}) {
    const lines = existingContent.split('\n');
    const insertPosition = options.insertPosition || 'end';
    const referenceTestName = options.referenceTestName;

    let insertIndex;

    if (insertPosition === 'end') {
      // Insert before closing class brace
      insertIndex = this.findLastJavaMethodEnd(lines);
    } else if (insertPosition === 'before' || insertPosition === 'after') {
      if (!referenceTestName) {
        throw new Error(`referenceTestName is required for insertPosition '${insertPosition}'`);
      }

      const javaTestName = this.javaTestName(referenceTestName);
      insertIndex = this.findJavaTestByName(lines, javaTestName);

      if (insertIndex === -1) {
        throw new Error(`Reference test '${referenceTestName}' not found in file`);
      }

      if (insertPosition === 'after') {
        insertIndex = this.findJavaMethodEnd(lines, insertIndex);
      }
    }

    // Insert new test with proper spacing
    lines.splice(insertIndex, 0, '', this.indentBlock(newTestCode, 1), '');

    return lines.join('\n');
  }

  /**
   * Convert test name to Java camelCase convention
   */
  javaTestName(name) {
    return name
      .replace(/[_-](.)/g, (_, char) => char.toUpperCase())
      .replace(/[_-]/g, '')
      .replace(/ (.)/g, (_, char) => char.toUpperCase())
      .replace(/ /g, '')
      .replace(/^./, char => char.toLowerCase());
  }

  /**
   * Find Java test method by name
   */
  findJavaTestByName(lines, testName) {
    const testRegex = new RegExp(`public\\s+void\\s+${testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
    return lines.findIndex(line => testRegex.test(line.trim()));
  }

  /**
   * Find end of Java method
   */
  findJavaMethodEnd(lines, startIndex) {
    let braceCount = 0;
    let started = false;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (started && braceCount === 0) {
        return i + 1;
      }
    }

    return lines.length;
  }

  /**
   * Find last method end (for 'end' insertion - before closing class brace)
   */
  findLastJavaMethodEnd(lines) {
    // Find last @Test annotation or public method
    let lastMethodIndex = -1;

    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('@Test') || trimmed.startsWith('public void test')) {
        lastMethodIndex = i;
        break;
      }
    }

    if (lastMethodIndex === -1) {
      // No methods found, insert before last closing brace
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() === '}') {
          return i;
        }
      }
      return lines.length;
    }

    // Find end of last method
    return this.findJavaMethodEnd(lines, lastMethodIndex);
  }

  /**
   * Indent entire code block by specified level
   */
  indentBlock(code, level = 1) {
    const lines = code.split('\n');
    return lines.map(line => {
      if (line.trim() === '') return line;
      return ' '.repeat(this.options.indentSize * level) + line;
    }).join('\n');
  }
}

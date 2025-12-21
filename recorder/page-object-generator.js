/**
 * recorder/page-object-generator.js
 *
 * Generates Page Object Model (POM) classes from page analysis
 * Supports multiple frameworks: Playwright (TS/Python), Selenium (Python/Java)
 */

/**
 * Analyze page and generate Page Object class
 * @param {Object} page - Puppeteer page instance
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} - Page object data and code
 */
export async function generatePageObject(page, options = {}) {
  const {
    className = null,
    framework = 'playwright-typescript',
    includeComments = true,
    groupElements = true
  } = options;

  // Analyze page structure
  const pageAnalysis = await analyzePage(page);

  // Generate class name from page title/URL if not provided
  const finalClassName = className || generateClassName(pageAnalysis.title, pageAnalysis.url);

  // Group elements by logical sections
  const elementGroups = groupElements
    ? groupElementsBySection(pageAnalysis.elements)
    : { main: pageAnalysis.elements };

  // Generate code based on framework
  const code = await generateCode(finalClassName, elementGroups, pageAnalysis, framework, includeComments);

  return {
    success: true,
    className: finalClassName,
    url: pageAnalysis.url,
    title: pageAnalysis.title,
    elementCount: pageAnalysis.elements.length,
    groups: Object.keys(elementGroups),
    framework,
    code
  };
}

/**
 * Analyze page structure and extract interactive elements
 * @param {Object} page - Puppeteer page instance
 * @returns {Promise<Object>} - Page analysis data
 */
async function analyzePage(page) {
  const analysis = await page.evaluate(() => {
    const elements = [];

    // Helper: Generate smart selector for element
    function generateSelector(el) {
      // Priority: id > name > data-testid > unique class > tag path

      if (el.id) {
        return `#${el.id}`;
      }

      if (el.name) {
        return `[name="${el.name}"]`;
      }

      const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
      if (testId) {
        return `[data-testid="${testId}"]`;
      }

      // Try to find unique class
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.split(' ').filter(c => c.trim());
        for (const cls of classes) {
          if (document.querySelectorAll(`.${cls}`).length === 1) {
            return `.${cls}`;
          }
        }
      }

      // Build CSS path
      const path = [];
      let current = el;
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();

        // Add nth-child if needed for uniqueness
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            child => child.tagName === current.tagName
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-child(${index})`;
          }
        }

        path.unshift(selector);
        current = parent;

        // Don't go too deep
        if (path.length >= 5) break;
      }

      return path.join(' > ');
    }

    // Helper: Generate element name from element properties
    function generateElementName(el) {
      // Try label
      const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title');
      if (label) {
        return label.toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
      }

      // Try text content for buttons/links
      if (el.tagName === 'BUTTON' || el.tagName === 'A') {
        const text = el.textContent.trim();
        if (text && text.length < 30) {
          return text.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        }
      }

      // Try name or id
      if (el.name) return el.name;
      if (el.id) return el.id;

      // Fallback to type + index
      return el.tagName.toLowerCase();
    }

    // Helper: Get element's semantic section
    function getElementSection(el) {
      // Check parents for semantic sections
      let current = el;
      while (current && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        const role = current.getAttribute('role');

        // Semantic HTML5 tags
        if (tag === 'header') return 'header';
        if (tag === 'nav') return 'navigation';
        if (tag === 'main') return 'main';
        if (tag === 'aside') return 'sidebar';
        if (tag === 'footer') return 'footer';
        if (tag === 'form') return 'form';

        // ARIA roles
        if (role === 'navigation') return 'navigation';
        if (role === 'search') return 'search';
        if (role === 'form') return 'form';
        if (role === 'banner') return 'header';
        if (role === 'contentinfo') return 'footer';
        if (role === 'complementary') return 'sidebar';

        current = current.parentElement;
      }

      return 'main';
    }

    // Extract interactive elements
    const selectors = [
      'input:not([type="hidden"])',
      'textarea',
      'select',
      'button',
      'a[href]',
      '[role="button"]',
      '[role="link"]',
      '[onclick]',
      '[contenteditable="true"]'
    ];

    const foundElements = document.querySelectorAll(selectors.join(', '));

    foundElements.forEach((el, index) => {
      // Skip hidden elements
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 ||
          styles.display === 'none' || styles.visibility === 'hidden') {
        return;
      }

      const elementInfo = {
        tag: el.tagName.toLowerCase(),
        type: el.type || 'element',
        selector: generateSelector(el),
        name: generateElementName(el),
        text: el.textContent?.trim().substring(0, 50) || '',
        section: getElementSection(el),
        attributes: {
          id: el.id || null,
          name: el.name || null,
          className: el.className || null,
          placeholder: el.getAttribute('placeholder') || null,
          ariaLabel: el.getAttribute('aria-label') || null,
          role: el.getAttribute('role') || null,
          href: el.href || null
        },
        position: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        }
      };

      elements.push(elementInfo);
    });

    return {
      url: window.location.href,
      title: document.title,
      elements
    };
  });

  return analysis;
}

/**
 * Group elements by logical sections
 * @param {Array} elements - Array of element info objects
 * @returns {Object} - Grouped elements
 */
function groupElementsBySection(elements) {
  const groups = {};

  elements.forEach(el => {
    const section = el.section || 'main';
    if (!groups[section]) {
      groups[section] = [];
    }
    groups[section].push(el);
  });

  return groups;
}

/**
 * Generate class name from page title or URL
 * @param {string} title - Page title
 * @param {string} url - Page URL
 * @returns {string} - Generated class name
 */
function generateClassName(title, url) {
  // Try title first
  if (title && title.length > 0 && title.length < 100) {
    const cleaned = title
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');

    if (cleaned) {
      return cleaned + 'Page';
    }
  }

  // Fallback to URL path
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname
      .split('/')
      .filter(p => p.length > 0 && p.length < 20)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());

    if (pathParts.length > 0) {
      return pathParts.join('') + 'Page';
    }
  } catch (e) {
    // Invalid URL
  }

  return 'Page';
}

/**
 * Generate code based on framework
 * @param {string} className - Class name
 * @param {Object} elementGroups - Grouped elements
 * @param {Object} pageAnalysis - Full page analysis
 * @param {string} framework - Target framework
 * @param {boolean} includeComments - Include comments
 * @returns {string} - Generated code
 */
function generateCode(className, elementGroups, pageAnalysis, framework, includeComments) {
  switch (framework) {
    case 'playwright-typescript':
      return generatePlaywrightTypeScript(className, elementGroups, pageAnalysis, includeComments);
    case 'playwright-python':
      return generatePlaywrightPython(className, elementGroups, pageAnalysis, includeComments);
    case 'selenium-python':
      return generateSeleniumPython(className, elementGroups, pageAnalysis, includeComments);
    case 'selenium-java':
      return generateSeleniumJava(className, elementGroups, pageAnalysis, includeComments);
    default:
      throw new Error(`Unsupported framework: ${framework}`);
  }
}

/**
 * Generate Playwright TypeScript Page Object
 */
function generatePlaywrightTypeScript(className, elementGroups, pageAnalysis, includeComments) {
  const lines = [];

  if (includeComments) {
    lines.push(`/**`);
    lines.push(` * ${className}`);
    lines.push(` * Generated from: ${pageAnalysis.url}`);
    lines.push(` * Page title: ${pageAnalysis.title}`);
    lines.push(` */`);
  }

  lines.push(`import { Page, Locator } from '@playwright/test';`);
  lines.push(``);
  lines.push(`export class ${className} {`);
  lines.push(`  readonly page: Page;`);
  lines.push(``);

  // Generate locators for all elements
  const allElements = Object.values(elementGroups).flat();
  const uniqueElements = deduplicateElements(allElements);

  uniqueElements.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name);
    if (includeComments && el.text) {
      lines.push(`  /** ${el.text.substring(0, 60)} */`);
    }
    lines.push(`  readonly ${locatorName}: Locator;`);
  });

  lines.push(``);
  lines.push(`  constructor(page: Page) {`);
  lines.push(`    this.page = page;`);

  uniqueElements.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name);
    const selector = escapeSelectorForCode(el.selector);
    lines.push(`    this.${locatorName} = page.locator('${selector}');`);
  });

  lines.push(`  }`);
  lines.push(``);

  // Generate helper methods
  lines.push(`  async goto() {`);
  lines.push(`    await this.page.goto('${pageAnalysis.url}');`);
  lines.push(`  }`);
  lines.push(``);

  // Generate action methods for common patterns
  generateActionMethods(lines, uniqueElements, 'typescript');

  lines.push(`}`);

  return lines.join('\n');
}

/**
 * Generate Playwright Python Page Object
 */
function generatePlaywrightPython(className, elementGroups, pageAnalysis, includeComments) {
  const lines = [];

  if (includeComments) {
    lines.push(`"""`);
    lines.push(`${className}`);
    lines.push(`Generated from: ${pageAnalysis.url}`);
    lines.push(`Page title: ${pageAnalysis.title}`);
    lines.push(`"""`);
  }

  lines.push(`from playwright.sync_api import Page, Locator`);
  lines.push(``);
  lines.push(`class ${className}:`);
  lines.push(`    def __init__(self, page: Page):`);
  lines.push(`        self.page = page`);

  // Generate locators
  const allElements = Object.values(elementGroups).flat();
  const uniqueElements = deduplicateElements(allElements);

  uniqueElements.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name, 'python');
    const selector = escapeSelectorForCode(el.selector);
    if (includeComments && el.text) {
      lines.push(`        # ${el.text.substring(0, 60)}`);
    }
    lines.push(`        self.${locatorName} = page.locator('${selector}')`);
  });

  lines.push(``);
  lines.push(`    def goto(self):`);
  lines.push(`        self.page.goto('${pageAnalysis.url}')`);
  lines.push(``);

  // Generate action methods
  generateActionMethods(lines, uniqueElements, 'python');

  return lines.join('\n');
}

/**
 * Generate Selenium Python Page Object
 */
function generateSeleniumPython(className, elementGroups, pageAnalysis, includeComments) {
  const lines = [];

  if (includeComments) {
    lines.push(`"""`);
    lines.push(`${className}`);
    lines.push(`Generated from: ${pageAnalysis.url}`);
    lines.push(`Page title: ${pageAnalysis.title}`);
    lines.push(`"""`);
  }

  lines.push(`from selenium.webdriver.common.by import By`);
  lines.push(`from selenium.webdriver.remote.webdriver import WebDriver`);
  lines.push(`from selenium.webdriver.support.ui import WebDriverWait`);
  lines.push(`from selenium.webdriver.support import expected_conditions as EC`);
  lines.push(``);
  lines.push(`class ${className}:`);
  lines.push(`    def __init__(self, driver: WebDriver):`);
  lines.push(`        self.driver = driver`);
  lines.push(`        self.wait = WebDriverWait(driver, 10)`);
  lines.push(``);

  // Generate locators as tuples
  const allElements = Object.values(elementGroups).flat();
  const uniqueElements = deduplicateElements(allElements);

  uniqueElements.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name, 'python').toUpperCase();
    const { by, value } = convertToSeleniumLocator(el.selector);
    if (includeComments && el.text) {
      lines.push(`    # ${el.text.substring(0, 60)}`);
    }
    lines.push(`    ${locatorName} = (By.${by}, '${escapeSelectorForCode(value)}')`);
  });

  lines.push(``);
  lines.push(`    def goto(self):`);
  lines.push(`        self.driver.get('${pageAnalysis.url}')`);
  lines.push(``);

  // Generate action methods for Selenium
  generateSeleniumActionMethods(lines, uniqueElements);

  return lines.join('\n');
}

/**
 * Generate Selenium Java Page Object
 */
function generateSeleniumJava(className, elementGroups, pageAnalysis, includeComments) {
  const lines = [];

  if (includeComments) {
    lines.push(`/**`);
    lines.push(` * ${className}`);
    lines.push(` * Generated from: ${pageAnalysis.url}`);
    lines.push(` * Page title: ${pageAnalysis.title}`);
    lines.push(` */`);
  }

  lines.push(`import org.openqa.selenium.By;`);
  lines.push(`import org.openqa.selenium.WebDriver;`);
  lines.push(`import org.openqa.selenium.WebElement;`);
  lines.push(`import org.openqa.selenium.support.ui.WebDriverWait;`);
  lines.push(`import org.openqa.selenium.support.ui.ExpectedConditions;`);
  lines.push(`import java.time.Duration;`);
  lines.push(``);
  lines.push(`public class ${className} {`);
  lines.push(`    private WebDriver driver;`);
  lines.push(`    private WebDriverWait wait;`);
  lines.push(``);

  // Generate locators as static By fields
  const allElements = Object.values(elementGroups).flat();
  const uniqueElements = deduplicateElements(allElements);

  uniqueElements.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name, 'java').toUpperCase();
    const { by, value } = convertToSeleniumLocator(el.selector);
    if (includeComments && el.text) {
      lines.push(`    /** ${el.text.substring(0, 60)} */`);
    }
    lines.push(`    private static final By ${locatorName} = By.${by.toLowerCase()}("${escapeSelectorForCode(value)}");`);
  });

  lines.push(``);
  lines.push(`    public ${className}(WebDriver driver) {`);
  lines.push(`        this.driver = driver;`);
  lines.push(`        this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    public void goTo() {`);
  lines.push(`        driver.get("${pageAnalysis.url}");`);
  lines.push(`    }`);
  lines.push(``);

  // Generate action methods for Selenium Java
  generateSeleniumJavaActionMethods(lines, uniqueElements);

  lines.push(`}`);

  return lines.join('\n');
}

/**
 * Helper: Deduplicate elements by name
 */
function deduplicateElements(elements) {
  const seen = new Map();
  const unique = [];

  elements.forEach(el => {
    const key = sanitizeIdentifier(el.name);
    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push(el);
    } else {
      // Add index to make unique
      let index = 2;
      let newKey = `${key}_${index}`;
      while (seen.has(newKey)) {
        index++;
        newKey = `${key}_${index}`;
      }
      seen.set(newKey, true);
      unique.push({ ...el, name: newKey });
    }
  });

  return unique;
}

/**
 * Helper: Sanitize identifier for code
 */
function sanitizeIdentifier(name, language = 'typescript') {
  let cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');

  // Ensure doesn't start with number
  if (/^\d/.test(cleaned)) {
    cleaned = '_' + cleaned;
  }

  // Python/Java conventions
  if (language === 'python') {
    return cleaned.toLowerCase();
  } else if (language === 'java') {
    // camelCase for Java
    return cleaned.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  // TypeScript: camelCase
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

/**
 * Helper: Escape selector for code strings
 */
function escapeSelectorForCode(selector) {
  return selector.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/**
 * Helper: Convert CSS selector to Selenium locator
 */
function convertToSeleniumLocator(selector) {
  // ID selector
  if (selector.startsWith('#')) {
    return { by: 'ID', value: selector.substring(1) };
  }

  // Name attribute
  if (selector.match(/^\[name="([^"]+)"\]$/)) {
    const match = selector.match(/^\[name="([^"]+)"\]$/);
    return { by: 'NAME', value: match[1] };
  }

  // Default to CSS_SELECTOR
  return { by: 'CSS_SELECTOR', value: selector };
}

/**
 * Generate action methods (Playwright)
 */
function generateActionMethods(lines, elements, language) {
  const inputs = elements.filter(el =>
    el.tag === 'input' || el.tag === 'textarea'
  );

  const buttons = elements.filter(el =>
    el.tag === 'button' || (el.tag === 'a' && el.attributes.href)
  );

  if (language === 'typescript') {
    // Fill methods for inputs
    inputs.forEach(el => {
      const methodName = `fill${capitalize(sanitizeIdentifier(el.name))}`;
      lines.push(`  async ${methodName}(text: string) {`);
      lines.push(`    await this.${sanitizeIdentifier(el.name)}.fill(text);`);
      lines.push(`  }`);
      lines.push(``);
    });

    // Click methods for buttons
    buttons.forEach(el => {
      const methodName = `click${capitalize(sanitizeIdentifier(el.name))}`;
      lines.push(`  async ${methodName}() {`);
      lines.push(`    await this.${sanitizeIdentifier(el.name)}.click();`);
      lines.push(`  }`);
      lines.push(``);
    });
  } else if (language === 'python') {
    // Fill methods for inputs
    inputs.forEach(el => {
      const methodName = `fill_${sanitizeIdentifier(el.name, 'python')}`;
      lines.push(`    def ${methodName}(self, text: str):`);
      lines.push(`        self.${sanitizeIdentifier(el.name, 'python')}.fill(text)`);
      lines.push(``);
    });

    // Click methods for buttons
    buttons.forEach(el => {
      const methodName = `click_${sanitizeIdentifier(el.name, 'python')}`;
      lines.push(`    def ${methodName}(self):`);
      lines.push(`        self.${sanitizeIdentifier(el.name, 'python')}.click()`);
      lines.push(``);
    });
  }
}

/**
 * Generate Selenium Python action methods
 */
function generateSeleniumActionMethods(lines, elements) {
  const inputs = elements.filter(el =>
    el.tag === 'input' || el.tag === 'textarea'
  );

  const buttons = elements.filter(el =>
    el.tag === 'button' || (el.tag === 'a' && el.attributes.href)
  );

  inputs.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name, 'python').toUpperCase();
    const methodName = `fill_${sanitizeIdentifier(el.name, 'python')}`;
    lines.push(`    def ${methodName}(self, text: str):`);
    lines.push(`        element = self.wait.until(EC.element_to_be_clickable(self.${locatorName}))`);
    lines.push(`        element.clear()`);
    lines.push(`        element.send_keys(text)`);
    lines.push(``);
  });

  buttons.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name, 'python').toUpperCase();
    const methodName = `click_${sanitizeIdentifier(el.name, 'python')}`;
    lines.push(`    def ${methodName}(self):`);
    lines.push(`        element = self.wait.until(EC.element_to_be_clickable(self.${locatorName}))`);
    lines.push(`        element.click()`);
    lines.push(``);
  });
}

/**
 * Generate Selenium Java action methods
 */
function generateSeleniumJavaActionMethods(lines, elements) {
  const inputs = elements.filter(el =>
    el.tag === 'input' || el.tag === 'textarea'
  );

  const buttons = elements.filter(el =>
    el.tag === 'button' || (el.tag === 'a' && el.attributes.href)
  );

  inputs.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name, 'java').toUpperCase();
    const methodName = `fill${capitalize(sanitizeIdentifier(el.name, 'java'))}`;
    lines.push(`    public void ${methodName}(String text) {`);
    lines.push(`        WebElement element = wait.until(ExpectedConditions.elementToBeClickable(${locatorName}));`);
    lines.push(`        element.clear();`);
    lines.push(`        element.sendKeys(text);`);
    lines.push(`    }`);
    lines.push(``);
  });

  buttons.forEach(el => {
    const locatorName = sanitizeIdentifier(el.name, 'java').toUpperCase();
    const methodName = `click${capitalize(sanitizeIdentifier(el.name, 'java'))}`;
    lines.push(`    public void ${methodName}() {`);
    lines.push(`        WebElement element = wait.until(ExpectedConditions.elementToBeClickable(${locatorName}));`);
    lines.push(`        element.click();`);
    lines.push(`    }`);
    lines.push(``);
  });
}

/**
 * Helper: Capitalize first letter
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

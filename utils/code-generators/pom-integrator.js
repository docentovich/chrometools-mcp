/**
 * utils/code-generators/pom-integrator.js
 *
 * Links POM elements with scenario actions via selector matching.
 * Also parses existing POM files to extract element metadata.
 */

/**
 * Match action selector to POM element
 * @param {string} actionSelector - Selector from recorded action
 * @param {Array} pomElements - Array of POM element metadata
 * @returns {Object|null} - Matched POM element or null
 */
export function matchActionToPomElement(actionSelector, pomElements) {
  if (!actionSelector || !pomElements || pomElements.length === 0) {
    return null;
  }

  // 1. Exact match
  const exact = pomElements.find(el => el.selector === actionSelector);
  if (exact) return exact;

  // 2. Normalized match - strip tag prefix (e.g., "input#username" -> "#username")
  const normalizedAction = normalizeSelector(actionSelector);
  const normalized = pomElements.find(el => normalizeSelector(el.selector) === normalizedAction);
  if (normalized) return normalized;

  // 3. Key-based match - compare by id, name, or data-testid values
  const actionKeys = extractSelectorKeys(actionSelector);
  if (actionKeys) {
    for (const el of pomElements) {
      const elKeys = extractSelectorKeys(el.selector);
      if (elKeys && keysMatch(actionKeys, elKeys)) {
        return el;
      }
    }
  }

  // 4. No match
  return null;
}

/**
 * Normalize selector by stripping tag prefix
 * "input#username" -> "#username"
 * "input[name='email']" -> "[name='email']"
 */
function normalizeSelector(selector) {
  // Strip leading tag name before #, ., or [
  return selector.replace(/^[a-z]+(?=[#.\[])/, '');
}

/**
 * Extract key identifiers from selector
 * Returns { type, value } or null
 */
function extractSelectorKeys(selector) {
  // ID selector: #username or input#username
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) return { type: 'id', value: idMatch[1] };

  // Name attribute: [name="email"] or input[name="email"]
  const nameMatch = selector.match(/\[name=["']([^"']+)["']\]/);
  if (nameMatch) return { type: 'name', value: nameMatch[1] };

  // Data-testid: [data-testid="submit-btn"]
  const testIdMatch = selector.match(/\[data-testid=["']([^"']+)["']\]/);
  if (testIdMatch) return { type: 'data-testid', value: testIdMatch[1] };

  // Data-test: [data-test="submit-btn"]
  const dataTestMatch = selector.match(/\[data-test=["']([^"']+)["']\]/);
  if (dataTestMatch) return { type: 'data-test', value: dataTestMatch[1] };

  return null;
}

/**
 * Compare two extracted keys
 */
function keysMatch(a, b) {
  // Same type and value
  if (a.type === b.type && a.value === b.value) return true;

  // Cross-type: id matches name if values are the same
  if (a.value === b.value) return true;

  return false;
}

/**
 * Parse existing POM file to extract element metadata
 * @param {string} fileContent - POM file content
 * @param {string} framework - Framework identifier
 * @returns {Object} - { className, elements: [{name, selector, methodName, methodType}] }
 */
export function parsePomFile(fileContent, framework) {
  switch (framework) {
    case 'playwright-typescript':
      return parsePlaywrightTypeScript(fileContent);
    case 'playwright-python':
      return parsePlaywrightPython(fileContent);
    case 'selenium-python':
      return parseSeleniumPython(fileContent);
    case 'selenium-java':
      return parseSeleniumJava(fileContent);
    default:
      throw new Error(`Unsupported framework for POM parsing: ${framework}`);
  }
}

/**
 * Parse Playwright TypeScript POM file
 * Looks for: this.X = page.locator('...')
 *            async fillX( / async clickX(
 */
function parsePlaywrightTypeScript(content) {
  const classMatch = content.match(/export\s+class\s+(\w+)/);
  const className = classMatch ? classMatch[1] : 'UnknownPage';

  const elements = [];
  // Match both: page.locator('selector') and page.locator("selector")
  // Handle selectors that contain the other type of quotes inside
  const locatorRegex = /this\.(\w+)\s*=\s*page\.locator\((?:'([^']*)'|"([^"]*)")\)/g;
  let match;

  while ((match = locatorRegex.exec(content)) !== null) {
    const name = match[1];
    const selector = match[2] || match[3]; // group 2 for single-quoted, group 3 for double-quoted
    if (name === 'page') continue;

    const methodInfo = findTypeScriptMethod(content, name);
    elements.push({
      name,
      selector,
      tag: guessTagFromSelector(selector),
      type: guessTypeFromSelector(selector),
      methodName: methodInfo.methodName,
      methodType: methodInfo.methodType
    });
  }

  return { className, elements };
}

/**
 * Find TypeScript method for element
 */
function findTypeScriptMethod(content, elementName) {
  const capName = elementName.charAt(0).toUpperCase() + elementName.slice(1);

  // Check for fill method
  const fillRegex = new RegExp(`async\\s+fill${capName}\\s*\\(`);
  if (fillRegex.test(content)) {
    return { methodName: `fill${capName}`, methodType: 'fill' };
  }

  // Check for click method
  const clickRegex = new RegExp(`async\\s+click${capName}\\s*\\(`);
  if (clickRegex.test(content)) {
    return { methodName: `click${capName}`, methodType: 'click' };
  }

  // Check for select method
  const selectRegex = new RegExp(`async\\s+select${capName}\\s*\\(`);
  if (selectRegex.test(content)) {
    return { methodName: `select${capName}`, methodType: 'select' };
  }

  // Default based on element name heuristics
  return { methodName: elementName, methodType: 'click' };
}

/**
 * Parse Playwright Python POM file
 * Looks for: self.X = page.locator('...')
 *            def fill_X( / def click_X(
 */
function parsePlaywrightPython(content) {
  const classMatch = content.match(/class\s+(\w+)/);
  const className = classMatch ? classMatch[1] : 'UnknownPage';

  const elements = [];
  const locatorRegex = /self\.(\w+)\s*=\s*page\.locator\((?:'([^']*)'|"([^"]*)")\)/g;
  let match;

  while ((match = locatorRegex.exec(content)) !== null) {
    const name = match[1];
    const selector = match[2] || match[3];
    if (name === 'page') continue;

    const methodInfo = findPythonMethod(content, name);
    elements.push({
      name,
      selector,
      tag: guessTagFromSelector(selector),
      type: guessTypeFromSelector(selector),
      methodName: methodInfo.methodName,
      methodType: methodInfo.methodType
    });
  }

  return { className, elements };
}

/**
 * Find Python method for element
 */
function findPythonMethod(content, elementName) {
  const fillRegex = new RegExp(`def\\s+fill_${elementName}\\s*\\(`);
  if (fillRegex.test(content)) {
    return { methodName: `fill_${elementName}`, methodType: 'fill' };
  }

  const clickRegex = new RegExp(`def\\s+click_${elementName}\\s*\\(`);
  if (clickRegex.test(content)) {
    return { methodName: `click_${elementName}`, methodType: 'click' };
  }

  const selectRegex = new RegExp(`def\\s+select_${elementName}\\s*\\(`);
  if (selectRegex.test(content)) {
    return { methodName: `select_${elementName}`, methodType: 'select' };
  }

  return { methodName: elementName, methodType: 'click' };
}

/**
 * Parse Selenium Python POM file
 * Looks for: X = (By.CSS_SELECTOR, '...')
 *            def fill_X( / def click_X(
 */
function parseSeleniumPython(content) {
  const classMatch = content.match(/class\s+(\w+)/);
  const className = classMatch ? classMatch[1] : 'UnknownPage';

  const elements = [];
  // Match: ELEMENT_NAME = (By.ID, 'value') or (By.CSS_SELECTOR, 'value') etc.
  const locatorRegex = /(\w+)\s*=\s*\(By\.(\w+),\s*['"]([^'"]+)['"]\)/g;
  let match;

  while ((match = locatorRegex.exec(content)) !== null) {
    const name = match[1].toLowerCase();
    const byType = match[2];
    const value = match[3];
    const selector = convertByToSelector(byType, value);

    const methodInfo = findPythonMethod(content, name);
    elements.push({
      name,
      selector,
      tag: guessTagFromSelector(selector),
      type: guessTypeFromSelector(selector),
      methodName: methodInfo.methodName,
      methodType: methodInfo.methodType
    });
  }

  return { className, elements };
}

/**
 * Parse Selenium Java POM file
 * Looks for: By X = By.cssSelector("...")
 *            void fillX( / void clickX(
 */
function parseSeleniumJava(content) {
  const classMatch = content.match(/public\s+class\s+(\w+)/);
  const className = classMatch ? classMatch[1] : 'UnknownPage';

  const elements = [];
  // Match: private static final By ELEMENT = By.id("value") or By.cssSelector("value")
  const locatorRegex = /(?:private\s+)?(?:static\s+)?(?:final\s+)?By\s+(\w+)\s*=\s*By\.(\w+)\(["']([^"']+)["']\)/g;
  let match;

  while ((match = locatorRegex.exec(content)) !== null) {
    const name = match[1].toLowerCase();
    const byMethod = match[2];
    const value = match[3];
    const selector = convertJavaByToSelector(byMethod, value);

    const methodInfo = findJavaMethod(content, match[1]);
    elements.push({
      name,
      selector,
      tag: guessTagFromSelector(selector),
      type: guessTypeFromSelector(selector),
      methodName: methodInfo.methodName,
      methodType: methodInfo.methodType
    });
  }

  return { className, elements };
}

/**
 * Find Java method for element
 */
function findJavaMethod(content, elementName) {
  // Convert UPPER_CASE to camelCase for method lookup
  // e.g., SUBMIT_BTN -> submitBtn, EMAIL -> email
  let camelName;
  if (elementName === elementName.toUpperCase()) {
    // ALL_CAPS: split by _, lowercase, then camelCase
    camelName = elementName.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  } else {
    camelName = elementName.replace(/_([a-z])/gi, (_, c) => c.toUpperCase());
  }
  const capName = camelName.charAt(0).toUpperCase() + camelName.slice(1);

  const fillRegex = new RegExp(`void\\s+fill${capName}\\s*\\(`);
  if (fillRegex.test(content)) {
    return { methodName: `fill${capName}`, methodType: 'fill' };
  }

  const clickRegex = new RegExp(`void\\s+click${capName}\\s*\\(`);
  if (clickRegex.test(content)) {
    return { methodName: `click${capName}`, methodType: 'click' };
  }

  const selectRegex = new RegExp(`void\\s+select${capName}\\s*\\(`);
  if (selectRegex.test(content)) {
    return { methodName: `select${capName}`, methodType: 'select' };
  }

  return { methodName: camelName, methodType: 'click' };
}

/**
 * Convert Selenium Python By type to CSS selector
 */
function convertByToSelector(byType, value) {
  switch (byType) {
    case 'ID': return `#${value}`;
    case 'NAME': return `[name="${value}"]`;
    case 'CLASS_NAME': return `.${value}`;
    case 'CSS_SELECTOR': return value;
    case 'TAG_NAME': return value;
    default: return value;
  }
}

/**
 * Convert Selenium Java By method to CSS selector
 */
function convertJavaByToSelector(byMethod, value) {
  switch (byMethod) {
    case 'id': return `#${value}`;
    case 'name': return `[name="${value}"]`;
    case 'className': return `.${value}`;
    case 'cssSelector': return value;
    case 'tagName': return value;
    default: return value;
  }
}

/**
 * Guess HTML tag from selector
 */
function guessTagFromSelector(selector) {
  const tagMatch = selector.match(/^(input|textarea|select|button|a)\b/);
  return tagMatch ? tagMatch[1] : 'element';
}

/**
 * Guess element type from selector
 */
function guessTypeFromSelector(selector) {
  if (selector.includes('type="password"')) return 'password';
  if (selector.includes('type="email"')) return 'email';
  if (selector.includes('type="text"')) return 'text';
  if (selector.includes('type="submit"')) return 'submit';
  return 'element';
}

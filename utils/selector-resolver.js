/**
 * Selector Resolver
 * Resolves element identifiers (ID from Page Object or CSS selector) to actual elements
 */

/**
 * Global registry for Page Object element IDs
 * Maps element IDs to their selectors
 */
const elementRegistry = new Map();

/**
 * Register element from Page Object
 * @param {string} id - Unique element ID
 * @param {string} selector - CSS selector
 * @param {Object} metadata - Additional element metadata
 */
function registerElement(id, selector, metadata = {}) {
  elementRegistry.set(id, {
    selector,
    metadata,
    registeredAt: Date.now()
  });
}

/**
 * Register multiple elements from Page Object
 * @param {Array} elements - Array of {id, selector, metadata}
 */
function registerElements(elements) {
  elements.forEach(el => {
    registerElement(el.id, el.selector, el.metadata);
  });
}

/**
 * Clear element registry
 */
function clearRegistry() {
  elementRegistry.clear();
}

/**
 * Resolve element identifier to CSS selector
 * Supports:
 * - Page Object ID (e.g., "login_email_input")
 * - CSS selector (e.g., "input[name='email']")
 *
 * @param {string} identifier - Element ID or CSS selector
 * @returns {Object} { selector, isPageObjectId, metadata }
 */
function resolveSelector(identifier) {
  // Check if it's a registered Page Object ID
  if (elementRegistry.has(identifier)) {
    const registered = elementRegistry.get(identifier);
    return {
      selector: registered.selector,
      isPageObjectId: true,
      metadata: registered.metadata,
      originalId: identifier
    };
  }

  // Otherwise, treat as CSS selector
  return {
    selector: identifier,
    isPageObjectId: false,
    metadata: {},
    originalId: null
  };
}

/**
 * Find element by ID or selector
 * @param {string} identifier - Element ID or CSS selector
 * @returns {Element|null} - Found element or null
 */
function findElement(identifier) {
  const resolved = resolveSelector(identifier);
  return document.querySelector(resolved.selector);
}

/**
 * Find all elements by ID or selector
 * @param {string} identifier - Element ID or CSS selector
 * @returns {NodeList} - Found elements
 */
function findElements(identifier) {
  const resolved = resolveSelector(identifier);
  return document.querySelectorAll(resolved.selector);
}

/**
 * Get element information
 * @param {string} identifier - Element ID or CSS selector
 * @returns {Object|null} - Element information or null
 */
function getElementInfo(identifier) {
  const resolved = resolveSelector(identifier);
  const element = document.querySelector(resolved.selector);

  if (!element) return null;

  return {
    identifier,
    selector: resolved.selector,
    isPageObjectId: resolved.isPageObjectId,
    tag: element.tagName.toLowerCase(),
    type: element.type || null,
    text: element.textContent?.trim().substring(0, 100) || '',
    visible: element.offsetWidth > 0 && element.offsetHeight > 0,
    metadata: resolved.metadata
  };
}

/**
 * Get all registered element IDs
 * @returns {Array} - Array of registered IDs
 */
function getRegisteredIds() {
  return Array.from(elementRegistry.keys());
}

/**
 * Get registry statistics
 * @returns {Object} - Registry stats
 */
function getRegistryStats() {
  return {
    count: elementRegistry.size,
    ids: Array.from(elementRegistry.keys()),
    oldestRegistration: Math.min(...Array.from(elementRegistry.values()).map(v => v.registeredAt)),
    newestRegistration: Math.max(...Array.from(elementRegistry.values()).map(v => v.registeredAt))
  };
}

/**
 * Check if identifier is a Page Object ID
 * @param {string} identifier
 * @returns {boolean}
 */
function isPageObjectId(identifier) {
  return elementRegistry.has(identifier);
}

// Export for Node.js (server-side)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    registerElement,
    registerElements,
    clearRegistry,
    resolveSelector,
    findElement,
    findElements,
    getElementInfo,
    getRegisteredIds,
    getRegistryStats,
    isPageObjectId,
    elementRegistry
  };
}

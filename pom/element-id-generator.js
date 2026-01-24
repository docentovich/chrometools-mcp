/**
 * pom/element-id-generator.js
 *
 * Генерация уникальных ID для элементов в Page Object Model
 * Используется для создания стабильных идентификаторов элементов
 */

/**
 * Generate unique element ID based on priority:
 * 1. data-testid attribute
 * 2. id attribute
 * 3. Semantic path (type + context + index)
 *
 * @param {Element} element - DOM element
 * @param {string} type - Element type (input, button, select, etc.)
 * @param {number} index - Element index among same type
 * @returns {string} Unique element ID
 */
function generateElementId(element, type, index) {
  // Priority 1: data-testid
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
  if (testId) {
    return `testid_${sanitizeId(testId)}`;
  }

  // Priority 2: id attribute
  if (element.id) {
    return `id_${sanitizeId(element.id)}`;
  }

  // Priority 3: Semantic path
  const semanticPath = getSemanticPath(element);
  const elementType = getElementType(element, type);

  return `${elementType}_${semanticPath}_${index}`;
}

/**
 * Get semantic path for element (form context, section, etc.)
 *
 * @param {Element} element - DOM element
 * @returns {string} Semantic path
 */
function getSemanticPath(element) {
  const parts = [];

  // Check if inside form
  const form = element.closest('form');
  if (form) {
    const formId = form.id || form.name || 'form';
    parts.push(sanitizeId(formId));
  }

  // Check if inside section/article/nav/header/footer
  const section = element.closest('section, article, nav, header, footer, aside, main');
  if (section && !form) {
    const sectionTag = section.tagName.toLowerCase();
    const sectionId = section.id || section.className.split(' ')[0] || sectionTag;
    parts.push(sanitizeId(sectionId));
  }

  // If no context found, use 'page'
  if (parts.length === 0) {
    parts.push('page');
  }

  return parts.join('_');
}

/**
 * Get element type string
 *
 * @param {Element} element - DOM element
 * @param {string} providedType - Type provided by caller (optional)
 * @returns {string} Element type
 */
function getElementType(element, providedType) {
  if (providedType) {
    return providedType;
  }

  const tagName = element.tagName.toLowerCase();

  // Handle input types
  if (tagName === 'input') {
    const inputType = element.type || 'text';
    // Normalize checkbox/radio
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    if (inputType === 'submit' || inputType === 'button') return 'button';
    return 'input';
  }

  // Handle other tags
  if (tagName === 'textarea') return 'textarea';
  if (tagName === 'select') return 'select';
  if (tagName === 'button') return 'button';
  if (tagName === 'a') return 'link';
  if (tagName === 'form') return 'form';

  // Role-based detection
  const role = element.getAttribute('role');
  if (role === 'button') return 'button';
  if (role === 'link') return 'link';

  return 'element';
}

/**
 * Sanitize string for use in ID
 *
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeId(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')  // Replace non-alphanumeric with underscore
    .replace(/_+/g, '_')            // Collapse multiple underscores
    .replace(/^_|_$/g, '');         // Remove leading/trailing underscores
}

/**
 * Generate element name from label, placeholder, or text
 * Used for more descriptive IDs
 *
 * @param {Element} element - DOM element
 * @returns {string} Element name
 */
function generateElementName(element) {
  // Try label
  const label = element.labels && element.labels[0];
  if (label) {
    const labelText = label.textContent.trim();
    if (labelText) {
      return sanitizeId(labelText.substring(0, 30));
    }
  }

  // Try placeholder
  const placeholder = element.placeholder;
  if (placeholder) {
    return sanitizeId(placeholder.substring(0, 30));
  }

  // Try aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return sanitizeId(ariaLabel.substring(0, 30));
  }

  // Try name attribute
  if (element.name) {
    return sanitizeId(element.name);
  }

  // Try text content for buttons/links
  const text = element.textContent?.trim();
  if (text) {
    return sanitizeId(text.substring(0, 30));
  }

  return '';
}

// Export for use in browser context (will be injected via eval)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateElementId,
    getSemanticPath,
    getElementType,
    sanitizeId,
    generateElementName
  };
}

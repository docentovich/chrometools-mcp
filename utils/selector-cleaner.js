/**
 * utils/selector-cleaner.js
 *
 * Clean unstable selectors (CSS modules, styled-components, etc.)
 * for use in automated tests.
 */

/**
 * Patterns for detecting unstable CSS classes
 */
const UNSTABLE_CLASS_PATTERNS = [
  // CSS Modules: Button_primary__2x3yZ
  /^[A-Z][a-zA-Z0-9]*_[a-zA-Z0-9]+__[a-zA-Z0-9]{5,}$/,

  // Styled-components: sc-AbCdEf-0
  /^sc-[a-zA-Z0-9]+-\d+$/,

  // Emotion: css-1a2b3c4d
  /^css-[a-zA-Z0-9]{5,}$/,

  // Hash suffix: component_a1b2c3d
  /_[a-f0-9]{5,}$/,

  // Kebab + hash: btn-a1b2c3
  /^[a-z]+-[a-f0-9]{5,}$/,

  // Underscore hash: _1a2b3c4d
  /^_[a-zA-Z0-9]{5,}$/,

  // Random looking strings (many numbers): a1b2c3d4e5
  /^[a-zA-Z0-9]*[0-9]{3,}[a-zA-Z0-9]*$/,
];

/**
 * Check if a CSS class looks unstable
 * @param {string} className - Class name to check
 * @returns {boolean} - True if class looks unstable
 */
function isUnstableClass(className) {
  for (const pattern of UNSTABLE_CLASS_PATTERNS) {
    if (pattern.test(className)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse CSS selector into components
 * @param {string} selector - CSS selector
 * @returns {Object} - Parsed selector { tag, id, classes, attributes, pseudo }
 */
function parseSelector(selector) {
  const result = {
    tag: null,
    id: null,
    classes: [],
    attributes: [],
    pseudo: null,
    combinator: null,
    parts: []
  };

  // Handle complex selectors with combinators (>, +, ~, space)
  const combinatorMatch = selector.match(/([>+~\s])/);
  if (combinatorMatch) {
    result.combinator = combinatorMatch[1];
    const parts = selector.split(/\s*[>+~\s]\s*/);
    result.parts = parts;
    return result; // Complex selector - return parts for recursive processing
  }

  let remaining = selector;

  // Extract tag
  const tagMatch = remaining.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  if (tagMatch) {
    result.tag = tagMatch[1];
    remaining = remaining.substring(tagMatch[0].length);
  }

  // Extract ID
  const idMatch = remaining.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/);
  if (idMatch) {
    result.id = idMatch[1];
    remaining = remaining.replace(idMatch[0], '');
  }

  // Extract classes
  const classMatches = remaining.matchAll(/\.([a-zA-Z0-9_-]+)/g);
  for (const match of classMatches) {
    result.classes.push(match[1]);
  }
  remaining = remaining.replace(/\.([a-zA-Z0-9_-]+)/g, '');

  // Extract attributes
  const attrMatches = remaining.matchAll(/\[([^\]]+)\]/g);
  for (const match of attrMatches) {
    result.attributes.push(match[1]);
  }
  remaining = remaining.replace(/\[([^\]]+)\]/g, '');

  // Extract pseudo-selectors
  const pseudoMatch = remaining.match(/:([a-zA-Z-]+(?:\([^)]*\))?)/);
  if (pseudoMatch) {
    result.pseudo = pseudoMatch[1];
  }

  return result;
}

/**
 * Rebuild selector from parsed components
 * @param {Object} parsed - Parsed selector
 * @returns {string} - Rebuilt CSS selector
 */
function buildSelector(parsed) {
  let selector = '';

  if (parsed.tag) {
    selector += parsed.tag;
  }

  if (parsed.id) {
    selector += `#${parsed.id}`;
  }

  if (parsed.classes.length > 0) {
    selector += parsed.classes.map(cls => `.${cls}`).join('');
  }

  if (parsed.attributes.length > 0) {
    selector += parsed.attributes.map(attr => `[${attr}]`).join('');
  }

  if (parsed.pseudo) {
    selector += `:${parsed.pseudo}`;
  }

  return selector || null;
}

/**
 * Clean a single simple selector
 * @param {string} selector - Simple CSS selector
 * @returns {string|null} - Cleaned selector or null if nothing stable remains
 */
function cleanSimpleSelector(selector) {
  const parsed = parseSelector(selector);

  // Filter out unstable classes
  const stableClasses = parsed.classes.filter(cls => !isUnstableClass(cls));

  // Rebuild with only stable classes
  parsed.classes = stableClasses;

  const cleaned = buildSelector(parsed);

  return cleaned;
}

/**
 * Clean CSS selector by removing unstable classes
 * @param {string|Object} selectorInput - CSS selector or selector object with primary/fallbacks
 * @returns {string} - Cleaned selector
 */
export function cleanSelector(selectorInput) {
  // Handle selector object (from scenarios)
  if (typeof selectorInput === 'object') {
    if (selectorInput.primary) {
      return cleanSelector(selectorInput.primary);
    }
    if (selectorInput.value) {
      return cleanSelector(selectorInput.value);
    }
    // Fallback to string representation
    selectorInput = String(selectorInput);
  }

  const selector = String(selectorInput);

  // Handle complex selectors with combinators
  const parsed = parseSelector(selector);

  if (parsed.combinator && parsed.parts.length > 0) {
    // Recursively clean each part
    const cleanedParts = parsed.parts.map(part => cleanSimpleSelector(part)).filter(Boolean);

    if (cleanedParts.length === 0) {
      // All parts were unstable - return most basic version
      return selector; // Keep original as last resort
    }

    return cleanedParts.join(` ${parsed.combinator.trim()} `);
  }

  // Clean simple selector
  const cleaned = cleanSimpleSelector(selector);

  if (!cleaned || cleaned === '') {
    // Selector became empty after cleaning - return original
    return selector;
  }

  return cleaned;
}

/**
 * Analyze selector stability and provide recommendations
 * @param {string|Object} selectorInput - Selector to analyze
 * @returns {Object} - Analysis result with score, issues, recommendations
 */
export function analyzeSelectorStability(selectorInput) {
  const originalSelector = typeof selectorInput === 'object'
    ? (selectorInput.primary || selectorInput.value || String(selectorInput))
    : String(selectorInput);

  const parsed = parseSelector(originalSelector);
  const issues = [];
  let score = 100;

  // Check for unstable classes
  const unstableClasses = parsed.classes.filter(cls => isUnstableClass(cls));
  if (unstableClasses.length > 0) {
    score -= unstableClasses.length * 30;
    issues.push({
      type: 'unstable-classes',
      classes: unstableClasses,
      severity: 'high',
      reason: 'CSS Module or hashed classes will change on rebuild'
    });
  }

  // Check for positional selectors
  if (parsed.pseudo && (parsed.pseudo.includes('nth-child') || parsed.pseudo.includes('nth-of-type'))) {
    score -= 20;
    issues.push({
      type: 'positional-selector',
      selector: `:${parsed.pseudo}`,
      severity: 'medium',
      reason: 'Position-based selectors are fragile'
    });
  }

  // Check for test-friendly attributes
  const hasTestId = parsed.attributes.some(attr =>
    attr.includes('data-testid') || attr.includes('data-test')
  );
  if (hasTestId) {
    score = Math.min(100, score + 20);
  }

  // Check for semantic attributes
  const hasSemanticAttr = parsed.attributes.some(attr =>
    attr.includes('role') || attr.includes('aria-label') || attr.includes('name')
  );
  if (hasSemanticAttr) {
    score = Math.min(100, score + 10);
  }

  // Ensure score is in valid range
  score = Math.max(0, Math.min(100, score));

  // Determine stability level
  let stability = 'stable';
  if (score < 40) {
    stability = 'unstable';
  } else if (score < 70) {
    stability = 'fragile';
  }

  const cleanedSelector = cleanSelector(originalSelector);
  const wasChanged = cleanedSelector !== originalSelector;

  const result = {
    original: originalSelector,
    cleaned: cleanedSelector,
    score,
    stability,
    issues,
    wasChanged,
    recommendations: []
  };

  // Generate recommendations
  if (wasChanged) {
    result.recommendations.push({
      selector: cleanedSelector,
      reason: 'Cleaned version with unstable classes removed',
      score: Math.min(100, score + 20)
    });
  }

  if (!hasTestId) {
    result.recommendations.push({
      selector: '[data-testid="..."]',
      reason: 'Add data-testid attribute for most stable tests',
      score: 95
    });
  }

  if (parsed.classes.length === 0 && parsed.attributes.length === 0 && !parsed.id) {
    result.recommendations.push({
      selector: `${parsed.tag || '*'}[role="..."]`,
      reason: 'Use semantic role attribute',
      score: 80
    });
  }

  return result;
}

/**
 * Get best selector from selector object (with fallbacks)
 * Prioritizes stable selectors over primary
 * @param {Object} selectorObj - Selector object with primary and fallbacks
 * @returns {string} - Best selector
 */
export function getBestSelector(selectorObj) {
  if (typeof selectorObj === 'string') {
    return cleanSelector(selectorObj);
  }

  const candidates = [];

  // Add primary
  if (selectorObj.primary || selectorObj.value) {
    candidates.push(selectorObj.primary || selectorObj.value);
  }

  // Add fallbacks
  if (selectorObj.fallbacks && Array.isArray(selectorObj.fallbacks)) {
    candidates.push(...selectorObj.fallbacks);
  }

  // Analyze each candidate
  const analyzed = candidates.map(sel => ({
    selector: sel,
    analysis: analyzeSelectorStability(sel)
  }));

  // Sort by stability score (highest first)
  analyzed.sort((a, b) => b.analysis.score - a.analysis.score);

  // Return the most stable selector
  if (analyzed.length > 0) {
    return analyzed[0].analysis.cleaned;
  }

  // Fallback to original
  return selectorObj.primary || selectorObj.value || String(selectorObj);
}

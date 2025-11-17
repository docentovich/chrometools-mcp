/**
 * utils/selector-generator.js
 *
 * Generates unique, robust CSS selectors for DOM elements.
 * Used by recorder to create selectors that remain stable across page changes.
 */

/**
 * Generate a unique CSS selector for an element
 * @param {Object} elementInfo - Element information from browser context
 * @returns {Object} - { primary: string, fallbacks: string[] }
 */
export function generateSelector(elementInfo) {
  const selectors = [];

  // Strategy 1: ID selector (most reliable if exists)
  if (elementInfo.id && !elementInfo.id.match(/^[0-9]/)) {
    selectors.push(`#${CSS.escape(elementInfo.id)}`);
  }

  // Strategy 2: Unique attribute combinations
  const uniqueAttrSelector = generateUniqueAttributeSelector(elementInfo);
  if (uniqueAttrSelector) {
    selectors.push(uniqueAttrSelector);
  }

  // Strategy 3: Data attributes (common in modern frameworks)
  if (elementInfo.dataTestId) {
    selectors.push(`[data-testid="${CSS.escape(elementInfo.dataTestId)}"]`);
  }
  if (elementInfo.dataTest) {
    selectors.push(`[data-test="${CSS.escape(elementInfo.dataTest)}"]`);
  }

  // Strategy 4: Name attribute (forms)
  if (elementInfo.name) {
    selectors.push(`${elementInfo.tagName}[name="${CSS.escape(elementInfo.name)}"]`);
  }

  // Strategy 5: Class-based selector (if unique)
  const classSelector = generateClassSelector(elementInfo);
  if (classSelector) {
    selectors.push(classSelector);
  }

  // Strategy 6: Position-based selector (last resort)
  const positionSelector = generatePositionSelector(elementInfo);
  if (positionSelector) {
    selectors.push(positionSelector);
  }

  // Return primary selector and fallbacks
  return {
    primary: selectors[0] || positionSelector,
    fallbacks: selectors.slice(1)
  };
}

/**
 * Generate selector based on unique attribute combinations
 */
function generateUniqueAttributeSelector(elementInfo) {
  const { tagName, type, role, ariaLabel, placeholder } = elementInfo;

  const parts = [tagName.toLowerCase()];

  // Add type for inputs
  if (type) {
    parts.push(`[type="${CSS.escape(type)}"]`);
  }

  // Add role
  if (role) {
    parts.push(`[role="${CSS.escape(role)}"]`);
  }

  // Add aria-label
  if (ariaLabel) {
    parts.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
  }

  // Add placeholder (for inputs)
  if (placeholder) {
    parts.push(`[placeholder="${CSS.escape(placeholder)}"]`);
  }

  // Return only if we have at least 2 attributes
  if (parts.length >= 2) {
    return parts.join('');
  }

  return null;
}

/**
 * Generate selector based on element classes
 */
function generateClassSelector(elementInfo) {
  if (!elementInfo.classes || elementInfo.classes.length === 0) {
    return null;
  }

  const { tagName, classes } = elementInfo;

  // Filter out dynamic classes (containing numbers, random strings)
  const stableClasses = classes.filter(cls => {
    // Exclude classes with numbers (likely dynamic)
    if (/\d{4,}/.test(cls)) return false;
    // Exclude very short classes (a, x, etc.)
    if (cls.length < 2) return false;
    // Exclude common utility classes that aren't unique
    if (['active', 'visible', 'hidden', 'open', 'closed'].includes(cls)) return false;
    return true;
  });

  if (stableClasses.length === 0) {
    return null;
  }

  // Use first 2-3 stable classes
  const classString = stableClasses
    .slice(0, 3)
    .map(cls => `.${CSS.escape(cls)}`)
    .join('');

  return `${tagName.toLowerCase()}${classString}`;
}

/**
 * Generate position-based selector (nth-child, nth-of-type)
 */
function generatePositionSelector(elementInfo) {
  const { tagName, parentSelector, nthChild, nthOfType } = elementInfo;

  if (!parentSelector) {
    return `${tagName.toLowerCase()}`;
  }

  // Prefer nth-of-type for same-tag siblings
  if (nthOfType !== undefined) {
    return `${parentSelector} > ${tagName.toLowerCase()}:nth-of-type(${nthOfType})`;
  }

  // Use nth-child as fallback
  if (nthChild !== undefined) {
    return `${parentSelector} > ${tagName.toLowerCase()}:nth-child(${nthChild})`;
  }

  return `${parentSelector} > ${tagName.toLowerCase()}`;
}

/**
 * Validate selector (check if it's unique on the page)
 * This function is called from browser context
 * @param {string} selector - CSS selector to validate
 * @returns {boolean} - True if selector matches exactly one element
 */
export function validateSelectorUniqueness(selector) {
  try {
    const elements = document.querySelectorAll(selector);
    return elements.length === 1;
  } catch (e) {
    return false;
  }
}

/**
 * Extract element information for selector generation
 * This function runs in browser context via page.evaluate()
 * @param {Element} element - DOM element
 * @returns {Object} - Element metadata for selector generation
 */
export function extractElementInfo(element) {
  const info = {
    tagName: element.tagName,
    id: element.id || null,
    classes: Array.from(element.classList),
    name: element.name || null,
    type: element.type || null,
    role: element.getAttribute('role') || null,
    ariaLabel: element.getAttribute('aria-label') || null,
    placeholder: element.placeholder || null,
    dataTestId: element.getAttribute('data-testid') || element.getAttribute('data-test-id') || null,
    dataTest: element.getAttribute('data-test') || null,
    text: element.textContent?.trim().substring(0, 100) || null
  };

  // Get parent information for position-based selector
  const parent = element.parentElement;
  if (parent) {
    info.parentSelector = getSimpleParentSelector(parent);

    // Calculate nth-child and nth-of-type
    const siblings = Array.from(parent.children);
    info.nthChild = siblings.indexOf(element) + 1;

    const sameTags = siblings.filter(el => el.tagName === element.tagName);
    info.nthOfType = sameTags.indexOf(element) + 1;
  }

  return info;
}

/**
 * Get simple parent selector (id or class-based)
 */
function getSimpleParentSelector(parent) {
  if (parent.id) {
    return `#${CSS.escape(parent.id)}`;
  }

  if (parent.classList.length > 0) {
    const firstClass = parent.classList[0];
    return `${parent.tagName.toLowerCase()}.${CSS.escape(firstClass)}`;
  }

  return parent.tagName.toLowerCase();
}

/**
 * Browser-side helper: Generate selector for clicked element
 * Injected into page via page.evaluate()
 */
export const browserSelectorGenerator = `
(function() {
  function generateSelectorForElement(element) {
    const info = {
      tagName: element.tagName,
      id: element.id || null,
      classes: Array.from(element.classList),
      name: element.name || null,
      type: element.type || null,
      role: element.getAttribute('role') || null,
      ariaLabel: element.getAttribute('aria-label') || null,
      placeholder: element.placeholder || null,
      dataTestId: element.getAttribute('data-testid') || element.getAttribute('data-test-id') || null,
      dataTest: element.getAttribute('data-test') || null,
      text: element.textContent?.trim().substring(0, 100) || null
    };

    // Get parent info
    const parent = element.parentElement;
    if (parent) {
      if (parent.id) {
        info.parentSelector = '#' + parent.id;
      } else if (parent.classList.length > 0) {
        info.parentSelector = parent.tagName.toLowerCase() + '.' + parent.classList[0];
      } else {
        info.parentSelector = parent.tagName.toLowerCase();
      }

      const siblings = Array.from(parent.children);
      info.nthChild = siblings.indexOf(element) + 1;

      const sameTags = siblings.filter(el => el.tagName === element.tagName);
      info.nthOfType = sameTags.indexOf(element) + 1;
    }

    // Helper: Check if selector is unique
    function isUnique(selector) {
      try {
        const matches = document.querySelectorAll(selector);
        return matches.length === 1 && matches[0] === element;
      } catch (e) {
        return false;
      }
    }

    // Generate and validate selectors by priority
    const candidates = [];

    // Priority 1: ID (if exists and unique)
    if (info.id && !/^[0-9]/.test(info.id)) {
      const idSelector = '#' + CSS.escape(info.id);
      if (isUnique(idSelector)) {
        candidates.push(idSelector);
      }
    }

    // Priority 2: data-testid (testing best practice)
    if (info.dataTestId) {
      const testIdSelector = '[data-testid="' + CSS.escape(info.dataTestId) + '"]';
      if (isUnique(testIdSelector)) {
        candidates.push(testIdSelector);
      }
    }

    // Priority 3: data-test
    if (info.dataTest) {
      const dataTestSelector = '[data-test="' + CSS.escape(info.dataTest) + '"]';
      if (isUnique(dataTestSelector)) {
        candidates.push(dataTestSelector);
      }
    }

    // Priority 4: Unique class combination
    if (info.classes.length > 0) {
      const stableClasses = info.classes.filter(cls => {
        return !/\\\\\\\\d{4,}/.test(cls) && cls.length >= 2 &&
               !['active', 'visible', 'hidden', 'open', 'closed'].includes(cls);
      });

      // Try single class first
      for (const cls of stableClasses) {
        const singleClassSelector = info.tagName.toLowerCase() + '.' + CSS.escape(cls);
        if (isUnique(singleClassSelector)) {
          candidates.push(singleClassSelector);
          break; // Found unique single class, use it
        }
      }

      // If no unique single class, try combinations
      if (candidates.length === 0 && stableClasses.length > 1) {
        for (let i = 2; i <= Math.min(stableClasses.length, 3); i++) {
          const classString = stableClasses.slice(0, i).map(cls => '.' + CSS.escape(cls)).join('');
          const multiClassSelector = info.tagName.toLowerCase() + classString;
          if (isUnique(multiClassSelector)) {
            candidates.push(multiClassSelector);
            break;
          }
        }
      }
    }

    // Priority 5: Name attribute (for forms)
    if (info.name) {
      const nameSelector = info.tagName.toLowerCase() + '[name="' + CSS.escape(info.name) + '"]';
      if (isUnique(nameSelector)) {
        candidates.push(nameSelector);
      }
    }

    // Priority 6: Attribute combinations (role, aria-label, etc.)
    if (info.role || info.ariaLabel || info.placeholder) {
      const attrParts = [info.tagName.toLowerCase()];
      if (info.role) attrParts.push('[role="' + CSS.escape(info.role) + '"]');
      if (info.ariaLabel) attrParts.push('[aria-label="' + CSS.escape(info.ariaLabel) + '"]');
      if (info.placeholder) attrParts.push('[placeholder="' + CSS.escape(info.placeholder) + '"]');

      const attrSelector = attrParts.join('');
      if (isUnique(attrSelector)) {
        candidates.push(attrSelector);
      }
    }

    // Priority 7: Position-based (last resort)
    if (info.parentSelector) {
      if (info.nthOfType) {
        const nthTypeSelector = info.parentSelector + ' > ' + info.tagName.toLowerCase() + ':nth-of-type(' + info.nthOfType + ')';
        candidates.push(nthTypeSelector);
      } else if (info.nthChild) {
        const nthChildSelector = info.parentSelector + ' > ' + info.tagName.toLowerCase() + ':nth-child(' + info.nthChild + ')';
        candidates.push(nthChildSelector);
      }
    }

    // Fallback: just tag name with nth-of-type from body
    if (candidates.length === 0) {
      const allOfType = Array.from(document.querySelectorAll(info.tagName.toLowerCase()));
      const index = allOfType.indexOf(element) + 1;
      candidates.push(info.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
    }

    return {
      primary: candidates[0],
      fallbacks: candidates.slice(1),
      elementInfo: info
    };
  }

  window.selectorGenerator = { generateSelectorForElement };
  return window.selectorGenerator;
})();
`;

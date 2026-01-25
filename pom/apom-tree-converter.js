/**
 * pom/apom-tree-converter.js
 *
 * Converts DOM to APOM Tree format with positioning information
 * APOM v2: Tree-based structure with parent-child relationships
 */

/**
 * Build DOM tree starting from root element
 * Runs in browser context via page.evaluate()
 *
 * @param {boolean} interactiveOnly - Only include interactive elements and their parents
 * @returns {Object} APOM tree structure
 */
function buildAPOMTree(interactiveOnly = true) {
  const pageId = `page_${btoa(window.location.href).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20)}_${Date.now()}`;

  const result = {
    pageId,
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    tree: null,
    metadata: {
      totalElements: 0,
      interactiveCount: 0,
      formCount: 0,
      modalCount: 0,
      maxDepth: 0
    }
  };

  // Element ID counter
  let idCounter = 0;
  const elementIds = new WeakMap();
  const interactiveElements = new WeakSet();

  // First pass: mark all interactive elements
  if (interactiveOnly) {
    markInteractiveElements(document.body);
  }

  // Build tree from body
  result.tree = buildNode(document.body, null, 0, []);

  return result;

  /**
   * Mark interactive elements and their ancestors
   */
  function markInteractiveElements(root) {
    const interactiveTags = new Set([
      'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'FORM'
    ]);

    const interactiveRoles = new Set([
      'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
      'menuitem', 'tab', 'switch', 'slider', 'searchbox'
    ]);

    // Find all interactive elements
    const elements = root.querySelectorAll('*');
    const interactiveList = [];

    elements.forEach(el => {
      const isInteractive =
        interactiveTags.has(el.tagName) ||
        interactiveRoles.has(el.getAttribute('role')) ||
        el.hasAttribute('onclick') ||
        el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1' ||
        (el.tagName === 'DIV' && el.getAttribute('contenteditable') === 'true');

      if (isInteractive && isVisible(el)) {
        interactiveList.push(el);
      }
    });

    // Mark interactive elements and all their ancestors
    interactiveList.forEach(el => {
      let current = el;
      while (current && current !== document.body) {
        interactiveElements.add(current);
        current = current.parentElement;
      }
    });

    // Always include body
    interactiveElements.add(document.body);
  }

  /**
   * Check if element is visible
   */
  function isVisible(el) {
    if (!el.offsetParent && el !== document.body) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  /**
   * Build node recursively
   */
  function buildNode(element, parentId, depth, path) {
    // Skip if in interactive-only mode and element is not marked
    if (interactiveOnly && !interactiveElements.has(element)) {
      return null;
    }

    // Skip hidden elements
    if (!isVisible(element)) {
      return null;
    }

    // Generate unique ID
    const id = generateElementId(element);
    elementIds.set(element, id);

    const currentPath = [...path, id];

    // Get positioning info
    const position = getPositionInfo(element);

    // Determine element type
    const elementType = determineElementType(element);

    // Build node - minimize non-interactive parents
    const isInteractive = elementType.isInteractive;

    const node = {
      id,
      tag: element.tagName.toLowerCase(),
      selector: generateSelector(element),
      position,
      children: []
    };

    // Add full info only for interactive elements
    if (isInteractive) {
      node.type = elementType.type;
      node.bounds = getBounds(element);

      // Add metadata based on element type
      if (elementType.metadata) {
        node.metadata = elementType.metadata;
      }
    } else {
      // For containers (parents), keep it minimal
      node.type = elementType.type;
    }

    // Update metadata counters
    result.metadata.totalElements++;
    if (elementType.isInteractive) {
      result.metadata.interactiveCount++;
    }
    if (elementType.type === 'form') {
      result.metadata.formCount++;
    }
    if (position.type === 'fixed' || position.type === 'absolute') {
      if (position.zIndex >= 100) {
        result.metadata.modalCount++;
      }
    }
    if (depth > result.metadata.maxDepth) {
      result.metadata.maxDepth = depth;
    }

    // Process children
    for (const child of element.children) {
      const childNode = buildNode(child, id, depth + 1, currentPath);
      if (childNode) {
        node.children.push(childNode);
      }
    }

    return node;
  }

  /**
   * Generate element ID
   */
  function generateElementId(element) {
    const type = determineElementType(element).type;
    const index = idCounter++;
    return `${type}_${index}`;
  }

  /**
   * Get positioning information
   */
  function getPositionInfo(element) {
    const style = window.getComputedStyle(element);
    const position = style.position;
    const zIndex = style.zIndex === 'auto' ? 'auto' : parseInt(style.zIndex, 10);

    // Check if creates stacking context
    const isStacking =
      position === 'fixed' ||
      position === 'sticky' ||
      (position === 'absolute' && zIndex !== 'auto') ||
      (position === 'relative' && zIndex !== 'auto') ||
      parseFloat(style.opacity) < 1 ||
      style.transform !== 'none' ||
      style.filter !== 'none' ||
      style.perspective !== 'none' ||
      style.clipPath !== 'none' ||
      style.mask !== 'none' ||
      style.mixBlendMode !== 'normal' ||
      style.isolation === 'isolate';

    return {
      type: position,
      zIndex: zIndex,
      isStacking: isStacking,
      // Additional positioning properties for modals/overlays detection
      hasBackdrop: style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                   (position === 'fixed' || position === 'absolute'),
      isFullscreen: element.offsetWidth >= window.innerWidth * 0.9 &&
                    element.offsetHeight >= window.innerHeight * 0.9
    };
  }

  /**
   * Get element bounds
   */
  function getBounds(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  /**
   * Determine element type and metadata
   */
  function determineElementType(element) {
    const tag = element.tagName.toLowerCase();
    const type = element.type?.toLowerCase();
    const role = element.getAttribute('role');

    // Form
    if (tag === 'form') {
      return {
        type: 'form',
        isInteractive: true,
        metadata: {
          method: element.method?.toUpperCase() || 'GET',
          action: element.action || '',
          name: element.name || null
        }
      };
    }

    // Input fields
    if (tag === 'input') {
      const inputType = type || 'text';
      return {
        type: inputType === 'submit' || inputType === 'button' ? 'button' : 'input',
        isInteractive: true,
        metadata: {
          inputType,
          name: element.name || null,
          placeholder: element.placeholder || null,
          required: element.required || false,
          disabled: element.disabled || false,
          value: element.value || '',
          checked: element.checked || undefined,
          min: element.min || undefined,
          max: element.max || undefined,
          pattern: element.pattern || undefined
        }
      };
    }

    // Textarea
    if (tag === 'textarea') {
      return {
        type: 'textarea',
        isInteractive: true,
        metadata: {
          name: element.name || null,
          placeholder: element.placeholder || null,
          required: element.required || false,
          disabled: element.disabled || false,
          rows: element.rows || undefined,
          cols: element.cols || undefined,
          maxLength: element.maxLength > 0 ? element.maxLength : undefined
        }
      };
    }

    // Select
    if (tag === 'select') {
      const options = Array.from(element.options).map(opt => ({
        value: opt.value,
        text: opt.textContent.trim(),
        selected: opt.selected
      }));

      return {
        type: 'select',
        isInteractive: true,
        metadata: {
          name: element.name || null,
          required: element.required || false,
          disabled: element.disabled || false,
          multiple: element.multiple || false,
          size: element.size || undefined,
          options,
          selectedIndex: element.selectedIndex,
          selectedValue: element.value || null
        }
      };
    }

    // Button
    if (tag === 'button' || role === 'button') {
      return {
        type: 'button',
        isInteractive: true,
        metadata: {
          buttonType: type || 'button',
          text: element.textContent?.trim() || '',
          disabled: element.disabled || false,
          ariaLabel: element.getAttribute('aria-label') || null
        }
      };
    }

    // Link
    if (tag === 'a') {
      return {
        type: 'link',
        isInteractive: true,
        metadata: {
          href: element.href || null,
          text: element.textContent?.trim() || '',
          target: element.target || null,
          rel: element.rel || null
        }
      };
    }

    // Label
    if (tag === 'label') {
      return {
        type: 'label',
        isInteractive: false,
        metadata: {
          for: element.htmlFor || null,
          text: element.textContent?.trim() || ''
        }
      };
    }

    // Modal/Dialog
    if (role === 'dialog' || role === 'alertdialog' || element.hasAttribute('aria-modal')) {
      return {
        type: 'modal',
        isInteractive: false,
        metadata: {
          ariaModal: element.getAttribute('aria-modal') === 'true',
          ariaLabel: element.getAttribute('aria-label') || null,
          role: role
        }
      };
    }

    // Container with semantic role
    if (role) {
      return {
        type: role,
        isInteractive: false,
        metadata: {
          ariaLabel: element.getAttribute('aria-label') || null
        }
      };
    }

    // Generic container
    return {
      type: 'container',
      isInteractive: false,
      metadata: null
    };
  }

  /**
   * Generate unique CSS selector
   */
  function generateSelector(element) {
    // Use ID if available and unique
    if (element.id && document.querySelectorAll(`#${element.id}`).length === 1) {
      return `#${element.id}`;
    }

    // Build path from parent
    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      // Add nth-of-type if needed
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(
          el => el.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }
}

// Export for use in both Node.js and browser context
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildAPOMTree
  };
}

// Make available globally in browser context
if (typeof window !== 'undefined') {
  window.buildAPOMTree = buildAPOMTree;
}

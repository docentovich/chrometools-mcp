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
 * @param {boolean} detectFrameworks - Detect UI frameworks (React/Vue/Angular) - can be slow on large pages
 * @returns {Object} APOM tree structure
 */
function buildAPOMTree(interactiveOnly = true, detectFrameworks = false) {
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

  // Collect radio and checkbox groups for easier agent access
  result.groups = collectInputGroups(result.tree);

  return result;

  /**
   * Collect radio and checkbox groups from the tree
   */
  function collectInputGroups(tree) {
    const radioGroups = {};
    const checkboxGroups = {};

    function traverse(node) {
      if (!node) return;

      // Check if this is a radio or checkbox input
      if (node.type === 'input' && node.metadata) {
        const { inputType, name, value, label, checked } = node.metadata;

        if (inputType === 'radio' && name) {
          if (!radioGroups[name]) {
            radioGroups[name] = { type: 'radio', options: [] };
          }
          radioGroups[name].options.push({
            id: node.id,
            value: value || '',
            label: label || value || '',
            checked: checked || false
          });
        }

        if (inputType === 'checkbox' && name) {
          if (!checkboxGroups[name]) {
            checkboxGroups[name] = { type: 'checkbox', options: [] };
          }
          checkboxGroups[name].options.push({
            id: node.id,
            value: value || '',
            label: label || value || '',
            checked: checked || false
          });
        }
      }

      // Traverse children
      if (node.children) {
        node.children.forEach(child => traverse(child));
      }
    }

    traverse(tree);

    return {
      radio: Object.keys(radioGroups).length > 0 ? radioGroups : undefined,
      checkbox: Object.keys(checkboxGroups).length > 0 ? checkboxGroups : undefined
    };
  }

  /**
   * Check if cursor:pointer is explicitly set (not inherited)
   */
  function hasCursorPointerExplicit(element) {
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.cursor !== 'pointer') {
      return false;
    }

    // Check if cursor is set via inline style
    if (element.style.cursor === 'pointer') {
      return true;
    }

    // Check if cursor is set via CSS class or direct CSS rule (not inherited)
    // If parent also has cursor:pointer computed, then it's likely inherited
    const parent = element.parentElement;
    if (parent) {
      const parentStyle = window.getComputedStyle(parent);
      if (parentStyle.cursor === 'pointer') {
        // Parent has cursor:pointer, so this is inherited
        return false;
      }
    }

    // Element has cursor:pointer but parent doesn't - it's explicitly set
    return true;
  }

  /**
   * Mark interactive elements and their ancestors
   * NOTE: This function is defined before checkInteractivity,
   * so we need to inline the checks or move function definitions
   */
  function markInteractiveElements(root) {
    // Find all interactive elements using the same logic as checkInteractivity
    const elements = root.querySelectorAll('*');
    const interactiveList = [];

    elements.forEach(el => {
      // Use inline checks (same logic as checkInteractivity)
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role');

      const isInteractive = (
        // Native HTML interactive elements
        ['a', 'button', 'input', 'select', 'textarea', 'label', 'form'].includes(tag) ||
        // Interactive ARIA roles
        (role && ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'textbox'].includes(role)) ||
        // onclick attribute
        el.hasAttribute('onclick') ||
        // onclick property
        (el.onclick !== null && el.onclick !== undefined) ||
        // cursor: pointer (only if explicitly set, not inherited)
        hasCursorPointerExplicit(el) ||
        // tabindex (except -1)
        (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') ||
        // contenteditable
        el.getAttribute('contenteditable') === 'true'
        // Note: We skip event listener check here for performance
        // as querySelectorAll can return thousands of elements
      );

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

    // Generate unique ID and CSS selector
    const id = generateElementId(element);
    const selector = generateSelector(element);
    elementIds.set(element, id);

    const currentPath = [...path, id];

    // Get positioning info
    const position = getPositionInfo(element);

    // Determine element type
    const elementType = determineElementType(element);

    // Build node - minimize non-interactive parents
    const isInteractive = elementType.isInteractive;

    // For non-interactive parent elements, keep it minimal (only tag, id, and selector)
    const node = isInteractive ? {
      id,
      tag: element.tagName.toLowerCase(),
      selector,
      position,
      type: elementType.type,
      children: []
    } : {
      id,
      tag: element.tagName.toLowerCase(),
      selector,
      children: []
    };

    // Add metadata only for interactive elements
    if (isInteractive && elementType.metadata) {
      node.metadata = elementType.metadata;
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
   * Check if element has click event listeners
   */
  function hasClickListener(element) {
    try {
      // Check for getEventListeners (available in Chrome DevTools context)
      if (typeof getEventListeners === 'function') {
        const listeners = getEventListeners(element);
        return listeners && listeners.click && listeners.click.length > 0;
      }

      // Fallback: check for common event listener markers
      // Note: This is not 100% reliable but catches common cases
      return element._events?.click ||
             element.__listeners?.click ||
             element.__eventListeners?.click;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if element is interactive based on various signals
   */
  function checkInteractivity(element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');

    // 1. Standard interactive HTML elements
    const interactiveTags = ['a', 'button', 'input', 'select', 'textarea'];
    if (interactiveTags.includes(tag)) {
      return { isInteractive: true, reason: 'native-html' };
    }

    // 2. Interactive ARIA roles
    const interactiveRoles = [
      'button', 'link', 'checkbox', 'radio', 'tab',
      'menuitem', 'option', 'switch', 'textbox'
    ];
    if (role && interactiveRoles.includes(role)) {
      return { isInteractive: true, reason: 'aria-role' };
    }

    // 3. Elements with onclick attribute
    if (element.hasAttribute('onclick')) {
      return { isInteractive: true, reason: 'onclick-attr' };
    }

    // 4. Elements with onclick property set via JavaScript
    if (element.onclick !== null && element.onclick !== undefined) {
      return { isInteractive: true, reason: 'onclick-prop' };
    }

    // 5. Elements with cursor: pointer (only if explicitly set, not inherited)
    if (hasCursorPointerExplicit(element)) {
      return { isInteractive: true, reason: 'cursor-pointer' };
    }

    // 6. Elements with click event listeners
    if (hasClickListener(element)) {
      return { isInteractive: true, reason: 'event-listener' };
    }

    // 7. Elements with tabindex (except -1)
    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null && tabindex !== '-1') {
      return { isInteractive: true, reason: 'tabindex' };
    }

    // 8. Contenteditable elements
    if (element.getAttribute('contenteditable') === 'true') {
      return { isInteractive: true, reason: 'contenteditable' };
    }

    return { isInteractive: false, reason: null };
  }

  /**
   * Detect framework-specific attributes on element
   * Returns framework info or null
   */
  function detectFramework(element) {
    // Check for React
    const reactKeys = Object.keys(element).filter(key =>
      key.startsWith('__react') || key.startsWith('_react')
    );
    if (reactKeys.length > 0) {
      return { name: 'react', version: null };
    }

    // Check for Vue
    const vueKeys = Object.keys(element).filter(key =>
      key.startsWith('__vue') || key.startsWith('_vue')
    );
    if (vueKeys.length > 0) {
      return { name: 'vue', version: null };
    }

    // Check for Angular
    const attributes = element.getAttributeNames();
    const angularAttrs = attributes.filter(attr =>
      attr.startsWith('_ngcontent-') ||
      attr.startsWith('_nghost-') ||
      attr.startsWith('ng-reflect-') ||
      attr === 'ng-version'
    );

    if (angularAttrs.length > 0) {
      const ngVersion = element.getAttribute('ng-version');
      return {
        name: 'angular',
        version: ngVersion || null,
        attributes: angularAttrs.length > 0 ? angularAttrs.slice(0, 3) : undefined // Limit to 3 for brevity
      };
    }

    return null;
  }

  /**
   * Determine element type and metadata
   */
  function determineElementType(element) {
    const tag = element.tagName.toLowerCase();
    const type = element.type?.toLowerCase();
    const role = element.getAttribute('role');

    // Detect framework-specific attributes (optional - can be slow)
    const frameworkInfo = detectFrameworks ? detectFramework(element) : null;

    // Form
    if (tag === 'form') {
      const metadata = {
        method: element.method?.toUpperCase() || 'GET',
        action: element.action || '',
        name: element.name || null
      };

      // Add framework info if detected
      if (frameworkInfo) {
        metadata.framework = frameworkInfo;
      }

      return {
        type: 'form',
        isInteractive: true,
        metadata
      };
    }

    // Input fields
    if (tag === 'input') {
      const inputType = type || 'text';

      // Get label text for radio/checkbox inputs
      let labelText = null;
      if (inputType === 'radio' || inputType === 'checkbox') {
        // Try to find label by: 1) wrapping label, 2) label[for=id], 3) aria-label
        const parentLabel = element.closest('label');
        if (parentLabel) {
          // Get text content excluding the input itself
          labelText = parentLabel.textContent?.trim() || null;
        } else if (element.id) {
          const labelFor = document.querySelector(`label[for="${element.id}"]`);
          if (labelFor) {
            labelText = labelFor.textContent?.trim() || null;
          }
        }
        if (!labelText) {
          labelText = element.getAttribute('aria-label') || null;
        }
      }

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
          label: labelText,
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
      const interactivityCheck = checkInteractivity(element);
      return {
        type: role,
        isInteractive: interactivityCheck.isInteractive,
        metadata: {
          ariaLabel: element.getAttribute('aria-label') || null,
          interactivityReason: interactivityCheck.reason || undefined
        }
      };
    }

    // Generic container - check for JavaScript interactivity
    const interactivityCheck = checkInteractivity(element);
    return {
      type: 'container',
      isInteractive: interactivityCheck.isInteractive,
      metadata: interactivityCheck.isInteractive ? {
        text: element.textContent?.trim().substring(0, 100) || '',
        interactivityReason: interactivityCheck.reason
      } : null
    };
  }

  /**
   * Generate unique CSS selector
   * Excludes framework-specific dynamic attributes (React, Vue, Angular)
   */
  function generateSelector(element) {
    // Use ID if available and unique
    if (element.id && document.querySelectorAll(`#${element.id}`).length === 1) {
      return `#${element.id}`;
    }

    // Try to find stable class name (excluding framework-specific dynamic classes)
    const stableClass = getStableClassName(element);
    if (stableClass) {
      const classSelector = `.${stableClass}`;
      // Verify it's unique within parent context
      if (element.parentElement) {
        const matches = element.parentElement.querySelectorAll(classSelector);
        if (matches.length === 1 && matches[0] === element) {
          return classSelector;
        }
      }
    }

    // Build path from parent
    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      // Add stable class if available
      const stableClass = getStableClassName(current);
      if (stableClass) {
        selector += `.${stableClass}`;
      }

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

  /**
   * Get stable class name excluding framework-specific dynamic classes
   * Returns first stable class or null
   */
  function getStableClassName(element) {
    if (!element.className || typeof element.className !== 'string') {
      return null;
    }

    const classes = element.className.split(/\s+/).filter(c => c);

    // Filter out framework-specific classes
    const stableClasses = classes.filter(className => {
      // React: CSS Modules, Styled Components, Emotion
      if (/^[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]{5,}$/.test(className)) return false;
      if (/^css-[a-z0-9]+(-[a-z0-9]+)?$/i.test(className)) return false;
      if (/^sc-[a-z0-9]+-[a-z0-9]+$/i.test(className)) return false;

      // Vue: scoped styles
      if (/^data-v-[a-f0-9]{8}$/i.test(className)) return false;

      // Angular: component styles (no classes starting with _ng)
      if (/^_ng/.test(className)) return false;

      // Generic hash patterns
      if (/^[a-z0-9]{32,}$/i.test(className)) return false;

      return true;
    });

    return stableClasses.length > 0 ? stableClasses[0] : null;
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

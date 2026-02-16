/**
 * pom/apom-tree-converter.js
 *
 * Converts DOM to APOM Tree format with positioning information
 * APOM v2: Tree-based structure with parent-child relationships
 */

/**
 * Initialize Model Registry (Strategy Pattern)
 * This is called once per page analysis
 */
function initializeModelRegistry() {
  // Check if already initialized
  if (typeof window !== 'undefined' && window.__MODEL_REGISTRY__) {
    return window.__MODEL_REGISTRY__;
  }

  // Create and populate registry
  const registry = new ModelRegistry();

  // Register all models (order doesn't matter, priority is handled internally)
  if (typeof window !== 'undefined' && window.ELEMENT_MODELS_CLASSES) {
    registry.registerAll(window.ELEMENT_MODELS_CLASSES);
  }

  // Cache in window for reuse
  if (typeof window !== 'undefined') {
    window.__MODEL_REGISTRY__ = registry;
  }

  return registry;
}

/**
 * Build DOM tree starting from root element
 * Runs in browser context via page.evaluate()
 *
 * @param {boolean} interactiveOnly - Only include interactive elements and their parents
 * @param {boolean} viewportOnly - Only include elements visible in current viewport
 * @returns {Object} APOM tree structure
 */
function buildAPOMTree(interactiveOnly = true, viewportOnly = false) {
  const pageId = `page_${btoa(window.location.href).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20)}_${Date.now()}`;

  // Initialize model registry (Strategy Pattern setup)
  const modelRegistry = initializeModelRegistry();

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
      maxDepth: 0,
      viewportOnly: viewportOnly || undefined,
      viewport: viewportOnly ? {
        width: window.innerWidth || document.documentElement.clientWidth,
        height: window.innerHeight || document.documentElement.clientHeight,
        scrollX: window.scrollX || window.pageXOffset,
        scrollY: window.scrollY || window.pageYOffset
      } : undefined
    },
    // Add models map from registry
    models: modelRegistry ? modelRegistry.getModelsMap() : undefined
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

  // Prune empty branches (containers without interactive elements)
  if (interactiveOnly && result.tree) {
    result.tree = pruneEmptyBranches(result.tree);
  }

  // Collect radio and checkbox groups for easier agent access
  result.groups = collectInputGroups(result.tree);

  // Detect page alerts, warnings, errors, and restrictions
  result.alerts = detectPageAlerts();

  return result;

  /**
   * Detect page alerts, warnings, errors, toasts, and restrictions
   * Uses heuristics to find notification elements
   */
  function detectPageAlerts() {
    const alerts = [];
    const seenTexts = new Set();
    const MIN_TEXT_LENGTH = 10;  // Ignore very short texts like "19", "OK"

    // Helper to add alert avoiding duplicates and substrings
    function addAlert(type, text, source) {
      text = text?.trim();
      if (!text || text.length < MIN_TEXT_LENGTH || text.length > 300) return;

      // Normalize text
      const normalizedText = text.substring(0, 200);

      // Skip if already seen or is substring of existing
      if (seenTexts.has(normalizedText)) return;
      for (const seen of seenTexts) {
        if (seen.includes(normalizedText) || normalizedText.includes(seen)) return;
      }

      seenTexts.add(normalizedText);
      alerts.push({ type, text: normalizedText, source });
    }

    // 1. Elements with role="alert" or aria-live (highest priority)
    document.querySelectorAll('[role="alert"], [aria-live="assertive"]').forEach(el => {
      const text = el.textContent?.trim();
      addAlert('alert', text, 'aria');
    });

    // 2. Classes containing restriction keywords (high priority - affects functionality)
    const restrictionSelector = '[class*="deactivat"], [class*="disabled"], [class*="blocked"], [class*="restrict"], [class*="suspend"], [class*="inactive"]';
    document.querySelectorAll(restrictionSelector).forEach(el => {
      if (!isVisibleForAlert(el)) return;
      const text = el.textContent?.trim();
      addAlert('restriction', text, 'class');
    });

    // 3. Error classes
    document.querySelectorAll('[class*="error"], [class*="danger"], [class*="invalid"]').forEach(el => {
      if (!isVisibleForAlert(el)) return;
      const text = el.textContent?.trim();
      addAlert('error', text, 'class');
    });

    // 4. Warning classes
    document.querySelectorAll('[class*="warning"], [class*="warn"], [class*="caution"]').forEach(el => {
      if (!isVisibleForAlert(el)) return;
      const text = el.textContent?.trim();
      addAlert('warning', text, 'class');
    });

    // 5. Toast/Snackbar notifications (usually important messages)
    document.querySelectorAll('[class*="toast"], [class*="snackbar"], [class*="alert-banner"]').forEach(el => {
      if (!isVisibleForAlert(el)) return;
      const text = el.textContent?.trim();
      addAlert('notification', text, 'toast');
    });

    // 6. SVG icons with warning colors - only for restriction/deactivated contexts
    const warningColors = ['#FF3B30', '#FAB32F', '#FFCC00', '#FF9500', '#F44336'];
    document.querySelectorAll('svg').forEach(svg => {
      const svgHtml = svg.outerHTML.toLowerCase();
      const hasWarningColor = warningColors.some(c => svgHtml.includes(c.toLowerCase()));
      if (!hasWarningColor) return;

      // Only consider if parent has restriction-related class or text
      let parent = svg.parentElement;
      let attempts = 0;
      while (parent && attempts < 3) {
        const className = parent.className?.toLowerCase() || '';
        const text = parent.textContent?.trim() || '';

        // Check if context suggests restriction/warning
        const isRestrictionContext =
          /deactivat|disabled|blocked|restrict|suspend|приостановлен|заблокирован/.test(className + ' ' + text.toLowerCase());

        if (isRestrictionContext && text.length >= MIN_TEXT_LENGTH) {
          addAlert('restriction', text, 'icon-color');
          break;
        }
        parent = parent.parentElement;
        attempts++;
      }
    });

    // 7. Elements with semantic key/name attributes
    document.querySelectorAll('[key*="error"], [key*="warning"], [key*="deactivat"], [key*="block"]').forEach(el => {
      const parent = el.closest('div, span, p');
      if (parent) {
        const text = parent.textContent?.trim();
        addAlert('warning', text, 'semantic-attr');
      }
    });

    // Return only if there are meaningful alerts
    return alerts.length > 0 ? alerts : undefined;
  }

  /**
   * Check if element is visible (for alert detection)
   */
  function isVisibleForAlert(el) {
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

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
   * Prune empty branches (containers without interactive elements)
   * Bottom-up traversal: remove container branches that don't end with interactive leaves
   */
  function pruneEmptyBranches(node) {
    if (!node) return null;

    // Handle compact format containers
    if (typeof node === 'object' && !node.id && !node.tag) {
      // Compact format: { "tag_id": [children] }
      const keys = Object.keys(node);
      if (keys.length === 1 && Array.isArray(node[keys[0]])) {
        const key = keys[0];
        const prunedChildren = node[key]
          .map(child => pruneEmptyBranches(child))
          .filter(child => child !== null);

        // If no children left after pruning, remove this container
        if (prunedChildren.length === 0) {
          return null;
        }

        return { [key]: prunedChildren };
      }
    }

    // Handle regular format (interactive elements or full-mode containers)
    if (node.children && Array.isArray(node.children)) {
      // Prune children recursively
      node.children = node.children
        .map(child => pruneEmptyBranches(child))
        .filter(child => child !== null);
    }

    // If this is a container (no type = not interactive) with no children, remove it
    if (!node.type && node.children && node.children.length === 0) {
      return null;
    }

    return node;
  }

  /**
   * Filter out null, undefined, and empty string values from object
   * to reduce JSON output size
   */
  function filterNullValues(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip null, undefined, and empty strings
      if (value === null || value === undefined || value === '') continue;
      // Skip false for boolean fields (keep true)
      if (value === false) continue;
      // Recursively filter nested objects (but not arrays)
      if (typeof value === 'object' && !Array.isArray(value)) {
        const filtered = filterNullValues(value);
        if (Object.keys(filtered).length > 0) {
          result[key] = filtered;
        }
      } else {
        result[key] = value;
      }
    }
    return result;
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
        el.getAttribute('contenteditable') === 'true' ||
        // Click event listeners (Angular, React, Vue) via monkey-patched addEventListener tracker
        hasExplicitClickBinding(el)
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
   * Check if element is in viewport
   */
  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    // Element is in viewport if any part of it is visible
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < viewportHeight &&
      rect.left < viewportWidth
    );
  }

  /**
   * Check if element is visible
   * More reliable check that works with position:fixed elements (Angular Material, etc.)
   */
  function isVisible(el) {
    // Check dimensions first (works for fixed position elements)
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;

    // Check computed styles
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    // Check opacity, but allow exceptions for inputs that are commonly styled with opacity:0
    // (checkboxes, radios, file inputs often use opacity:0 with custom visual overlay)
    const tag = el.tagName.toLowerCase();
    const isStylableInput = tag === 'input' && ['checkbox', 'radio', 'file'].includes(el.type);
    if (style.opacity === '0' && !isStylableInput) {
      return false;
    }

    // For body element, always consider visible if dimensions > 0
    if (el === document.body) return true;

    // Check viewport if viewportOnly mode is enabled
    if (viewportOnly && !isInViewport(el)) {
      return false;
    }

    // Additional check: element should be in viewport or have offsetParent
    // This handles elements inside position:fixed containers (Angular Material)
    return el.offsetParent !== null || style.position === 'fixed' || style.position === 'sticky';
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

    // Register element in selector resolver (internal only)
    if (typeof window !== 'undefined' && typeof window.registerElement === 'function') {
      const tag = element.tagName.toLowerCase();
      window.registerElement(id, selector, { tag, depth });
    }

    const currentPath = [...path, id];

    // Get positioning info
    const position = getPositionInfo(element);

    // Determine element type
    const elementType = determineElementType(element);

    // Find matching model using Model Registry (Strategy Pattern)
    let model = null;
    let modelName = null;
    if (modelRegistry) {
      try {
        model = modelRegistry.findModel(element, elementType);
        modelName = model.getName();
      } catch (e) {
        // If no model found, continue without model
      }
    }

    // Build node - minimize non-interactive parents
    const isInteractive = elementType.isInteractive;

    // Build node structure based on mode
    let node;

    if (isInteractive) {
      // Interactive elements: full structure without selector (unless includeAll)
      node = {
        id,
        tag: element.tagName.toLowerCase(),
        type: elementType.type,
        children: []
      };

      // Add model name (skip for default model to reduce output size)
      if (modelName && modelName !== 'default') {
        node.model = modelName;
      }

      // Only include position if not static (position is null for static)
      if (position) {
        node.position = position;
      }

      // Add selector only in includeAll mode
      if (!interactiveOnly) {
        node.selector = selector;
      }

      // Add metadata for interactive elements, filtering out null/undefined values
      if (elementType.metadata) {
        node.metadata = filterNullValues(elementType.metadata);
      }
    } else {
      // Containers: compact format "tag_id": [children] when interactiveOnly
      // or full format when includeAll
      if (interactiveOnly) {
        // Compact format - will be converted after processing children
        node = {
          _compact: true,
          _key: `${element.tagName.toLowerCase()}_${id}`,
          children: []
        };
      } else {
        // Full format with selector
        node = {
          id,
          tag: element.tagName.toLowerCase(),
          selector,
          children: []
        };
      }
    }

    // Update metadata counters
    result.metadata.totalElements++;
    if (elementType.isInteractive) {
      result.metadata.interactiveCount++;
    }
    if (elementType.type === 'form') {
      result.metadata.formCount++;
    }
    if (position && (position.type === 'fixed' || position.type === 'absolute')) {
      if (position.zIndex && position.zIndex >= 100) {
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

    // Convert compact containers to final format
    if (node._compact) {
      // Return compact format: { "tag_id": [children] }
      const compactNode = {};
      compactNode[node._key] = node.children;
      return compactNode;
    }

    // Remove empty children array to reduce output size
    if (node.children && node.children.length === 0) {
      delete node.children;
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
   * Returns null for static position (default) to reduce output size
   */
  function getPositionInfo(element) {
    const style = window.getComputedStyle(element);
    const position = style.position;

    // Skip static position (default) - no need to include
    if (position === 'static') {
      return null;
    }

    const zIndex = style.zIndex === 'auto' ? 'auto' : parseInt(style.zIndex, 10);

    // Only include non-default values
    const result = {
      type: position
    };

    // Only include zIndex if it's not 'auto'
    if (zIndex !== 'auto') {
      result.zIndex = zIndex;
    }

    return result;
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
   * Check if tag is a custom element (Web Component / Framework component)
   */
  function isCustomElement(tag) {
    // Custom elements must contain a hyphen
    return tag.includes('-');
  }

  /**
   * Check if element has explicit click binding (framework attributes or addEventListener)
   * Uses monkey-patched addEventListener tracker for framework detection (Angular, React, Vue)
   */
  function hasExplicitClickBinding(element) {
    // Check for framework-specific click bindings (attributes)
    const attrs = element.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const name = attrs[i].name.toLowerCase();
      // Angular: (click), Angular.js: ng-click
      // Vue: @click, v-on:click
      // React: onClick (but this is a property, not attribute)
      if (name === '(click)' || name === 'ng-click' ||
          name === '@click' || name === 'v-on:click' ||
          name.startsWith('on') && name.includes('click')) {
        return true;
      }
    }
    // Check onclick property
    if (element.onclick) return true;
    // Check onclick attribute
    if (element.hasAttribute('onclick')) return true;

    // Check for click listeners added via addEventListener (framework detection)
    // This is injected by page-manager.js via evaluateOnNewDocument
    if (typeof window.__hasClickListener === 'function' && window.__hasClickListener(element)) {
      return true;
    }

    return false;
  }

  /**
   * Find click handler for interactive elements (bubbling search)
   * Searches UP from element to find ancestor with explicit click binding
   * Returns "tag:id" format like "div:container_19" or null if not found
   */
  function findClickHandler(element) {
    const tag = element.tagName.toLowerCase();

    // Check self first - native interactive elements handle their own clicks
    if (hasExplicitClickBinding(element) ||
        ['button', 'a', 'input', 'select'].includes(tag) ||
        element.getAttribute('role') === 'button') {
      return null;  // element handles its own click, no need for clickTarget
    }

    // Search UP (like event bubbling) - find ancestor with explicit click handler
    let parent = element.parentElement;
    let depth = 0;
    const maxDepth = 5;  // limit to prevent hanging

    while (parent && depth < maxDepth) {
      if (hasExplicitClickBinding(parent)) {
        // Found real click handler
        const parentId = elementIds.get(parent);
        if (parentId) {
          const parentTag = parent.tagName.toLowerCase();
          return `${parentTag}:${parentId}`;
        }
      }
      parent = parent.parentElement;
      depth++;
    }

    // No click handler found - return null (no fallback!)
    return null;
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

    // 6. Elements with click event listeners (framework handlers: Angular, React, Vue)
    if (hasExplicitClickBinding(element)) {
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
  /**
   * Determine element type and metadata
   */
  function determineElementType(element) {
    const tag = element.tagName.toLowerCase();
    const type = element.type?.toLowerCase();
    const role = element.getAttribute('role');

    // Form
    if (tag === 'form') {
      const metadata = {
        method: element.method?.toUpperCase() || 'GET',
        action: element.action || '',
        name: element.name || null
      };

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

    // For ALL interactive elements, search for click handler (bubbling)
    // Returns "tag:id" format or null if not found
    const clickTarget = interactivityCheck.isInteractive
      ? findClickHandler(element)
      : null;

    return {
      type: 'container',
      isInteractive: interactivityCheck.isInteractive,
      metadata: interactivityCheck.isInteractive ? {
        text: element.textContent?.trim().substring(0, 100) || '',
        interactivityReason: interactivityCheck.reason,
        clickTarget: clickTarget || undefined
      } : null
    };
  }

  /**
   * Generate unique CSS selector
   * Excludes framework-specific dynamic attributes (React, Vue, Angular)
   */
  function generateSelector(element) {
    // Use ID if available, valid (not starting with digit), and unique
    // CSS selectors don't support IDs starting with digits (e.g., #301178 is invalid)
    if (element.id && !/^[0-9]/.test(element.id)) {
      try {
        const selector = `#${CSS.escape(element.id)}`;
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      } catch (e) {
        // Invalid selector, continue to other strategies
      }
    }

    // Try to find stable class name (excluding framework-specific dynamic classes)
    const stableClass = getStableClassName(element);
    if (stableClass) {
      const escapedClass = CSS.escape(stableClass);
      const classSelector = `.${escapedClass}`;
      // Verify it's unique in the ENTIRE document (not just parent)
      try {
        const matches = document.querySelectorAll(classSelector);
        if (matches.length === 1 && matches[0] === element) {
          return classSelector;
        }
      } catch (e) {
        // Invalid selector, continue to path-based approach
      }
    }

    // Build path from element to body, checking uniqueness at each level
    const path = [];
    let current = element;
    const MAX_PATH_DEPTH = 8;

    while (current && current !== document.body && path.length < MAX_PATH_DEPTH) {
      let selector = current.tagName.toLowerCase();

      // Add stable class if available (escaped for CSS selector safety)
      const cls = getStableClassName(current);
      if (cls) {
        selector += `.${CSS.escape(cls)}`;
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

      // Check if current path is already unique in the document
      try {
        const candidateSelector = path.join(' > ');
        if (document.querySelectorAll(candidateSelector).length === 1) {
          return candidateSelector;
        }
      } catch (e) { /* continue building path */ }

      current = current.parentElement;
    }

    return path.join(' > ');
  }

  /**
   * Get stable class name excluding framework-specific dynamic classes
   * and Tailwind CSS utility classes with special characters
   * Returns first stable class or null
   */
  function getStableClassName(element) {
    if (!element.className || typeof element.className !== 'string') {
      return null;
    }

    const classes = element.className.split(/\s+/).filter(c => c);

    // Filter out framework-specific classes and Tailwind utilities
    const stableClasses = classes.filter(className => {
      // Tailwind CSS: classes with special characters that break CSS selectors
      // Colons for variants (hover:, focus:, md:, etc.)
      // Slashes for fractions (w-1/2)
      // Brackets for arbitrary values (bg-[#1da1f2])
      if (/[:\/\[\]]/.test(className)) return false;

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

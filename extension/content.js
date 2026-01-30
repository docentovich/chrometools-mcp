/**
 * ChromeTools MCP Extension - Content Script
 *
 * Injected into every page to:
 * - Record user actions (click, type, select, etc.)
 * - Show recording overlay
 * - Generate selectors for elements
 * - Detect and mask secrets
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__chrometoolsContentScript) {
    return;
  }
  window.__chrometoolsContentScript = true;

  // ============================================
  // State
  // ============================================

  let isRecording = false;
  let isPaused = false;
  let overlay = null;
  let actionCount = 0;

  // Debounce timers
  const inputDebounceTimers = new Map();
  const lastInputValues = new Map();        // Value when element was last recorded
  const inputStartValues = new Map();       // Value when user started typing (before any input)
  let scrollDebounceTimer = null;
  let lastHoverTarget = null;

  // ============================================
  // Selector Generator
  // ============================================

  function generateSelector(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return { primary: 'body', fallbacks: [] };
    }

    const selectors = [];

    // 1. ID selector (highest priority)
    if (element.id && !isGeneratedId(element.id)) {
      selectors.push(`#${CSS.escape(element.id)}`);
    }

    // 2. data-testid, data-cy, data-test attributes
    const testAttrs = ['data-testid', 'data-cy', 'data-test', 'data-qa'];
    for (const attr of testAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        selectors.push(`[${attr}="${CSS.escape(value)}"]`);
      }
    }

    // 3. name attribute (for form elements)
    if (element.name) {
      const tag = element.tagName.toLowerCase();
      selectors.push(`${tag}[name="${CSS.escape(element.name)}"]`);
    }

    // 4. aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      selectors.push(`[aria-label="${CSS.escape(ariaLabel)}"]`);
    }

    // 5. Type + placeholder for inputs
    if (element.tagName === 'INPUT') {
      const type = element.type || 'text';
      const placeholder = element.placeholder;
      if (placeholder) {
        selectors.push(`input[type="${type}"][placeholder="${CSS.escape(placeholder)}"]`);
      }
    }

    // 6. Button/link text
    if (['BUTTON', 'A'].includes(element.tagName)) {
      const text = element.textContent?.trim();
      if (text && text.length < 50) {
        // Use XPath for text matching (will be converted on server side)
        selectors.push(`//${element.tagName.toLowerCase()}[contains(text(),"${text.substring(0, 30)}")]`);
      }
    }

    // 7. CSS class combination (avoid dynamic classes)
    const stableClasses = getStableClasses(element);
    if (stableClasses.length > 0) {
      const tag = element.tagName.toLowerCase();
      selectors.push(`${tag}.${stableClasses.join('.')}`);
    }

    // 8. Fallback: nth-child path
    const nthPath = getNthChildPath(element);
    if (nthPath) {
      selectors.push(nthPath);
    }

    // Validate selectors
    const validSelectors = selectors.filter(sel => {
      if (sel.startsWith('//')) return true; // XPath
      try {
        const matches = document.querySelectorAll(sel);
        return matches.length === 1 || (matches.length > 0 && matches[0] === element);
      } catch {
        return false;
      }
    });

    return {
      primary: validSelectors[0] || nthPath || 'body',
      fallbacks: validSelectors.slice(1, 4),
      elementInfo: {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        classes: Array.from(element.classList),
        text: element.textContent?.trim().substring(0, 50) || null
      }
    };
  }

  function isGeneratedId(id) {
    // Common patterns for auto-generated IDs
    const patterns = [
      /^:r[0-9a-z]+:$/i,     // React 18
      /^[a-f0-9]{8,}$/i,     // UUID-like
      /^ember\d+$/i,          // Ember
      /^ng-\d+$/i,            // Angular
      /^uid-\d+$/i,           // Generic
      /^\d+$/,                // Pure numbers
    ];
    return patterns.some(p => p.test(id));
  }

  function getStableClasses(element) {
    const unstablePatterns = [
      /^css-[a-z0-9]+$/i,           // CSS modules
      /^sc-[a-z]+$/i,               // styled-components
      /^_[a-z0-9]+_[a-z0-9]+$/i,   // CSS modules variant
      /^[a-z]+-[a-f0-9]{5,}$/i,    // Hash-based
      /^jsx-\d+$/i,                 // styled-jsx
      /^emotion-\d+$/i,             // Emotion
    ];

    return Array.from(element.classList).filter(cls => {
      if (cls.length < 2) return false;
      // Filter out Tailwind classes with special characters (colons, slashes, brackets)
      if (/[:\/\[\]]/.test(cls)) return false;
      return !unstablePatterns.some(p => p.test(cls));
    }).slice(0, 3).map(cls => CSS.escape(cls));
  }

  function getNthChildPath(element, maxDepth = 5) {
    const path = [];
    let current = element;
    let depth = 0;

    while (current && current !== document.body && depth < maxDepth) {
      const parent = current.parentElement;
      if (!parent) break;

      const siblings = Array.from(parent.children).filter(
        el => el.tagName === current.tagName
      );

      if (siblings.length === 1) {
        path.unshift(current.tagName.toLowerCase());
      } else {
        const index = siblings.indexOf(current) + 1;
        path.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
      }

      current = parent;
      depth++;
    }

    return path.length > 0 ? path.join(' > ') : null;
  }

  // ============================================
  // Secret Detection
  // ============================================

  function isSecretField(element) {
    const type = (element.type || '').toLowerCase();
    const name = (element.name || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
    const autocomplete = (element.autocomplete || '').toLowerCase();

    // Password fields
    if (type === 'password') {
      return { isSecret: true, fieldType: 'password' };
    }

    // Secret keywords
    const secretKeywords = [
      'password', 'passwd', 'pwd', 'secret', 'token', 'api_key', 'apikey',
      'api-key', 'auth', 'credential', 'private', 'ssn', 'credit', 'cvv',
      'cvc', 'pin', 'otp', 'totp', '2fa', 'mfa'
    ];

    const allText = `${name} ${id} ${placeholder} ${ariaLabel} ${autocomplete}`;

    for (const keyword of secretKeywords) {
      if (allText.includes(keyword)) {
        return { isSecret: true, fieldType: keyword };
      }
    }

    return { isSecret: false, fieldType: null };
  }

  function generateParamName(fieldType, element) {
    const name = element.name || element.id || fieldType || 'secret';
    const cleanName = name
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

    return cleanName || 'secret';
  }

  // ============================================
  // Overlay UI
  // ============================================

  function createOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'chrometools-recorder-overlay';
    overlay.innerHTML = `
      <div class="recorder-dot"></div>
      <span class="recorder-text">Recording <span class="action-count">${actionCount}</span></span>
    `;

    document.body.appendChild(overlay);

    // Make draggable
    makeDraggable(overlay);

    // Add recording indicator to body
    document.body.classList.add('chrometools-recording');
  }

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.body.classList.remove('chrometools-recording');
  }

  function updateOverlay() {
    if (!overlay) return;
    const countEl = overlay.querySelector('.action-count');
    if (countEl) {
      countEl.textContent = actionCount;
    }

    if (isPaused) {
      overlay.classList.add('paused');
      overlay.querySelector('.recorder-text').textContent = `Paused (${actionCount})`;
    } else {
      overlay.classList.remove('paused');
      overlay.querySelector('.recorder-text').innerHTML = `Recording <span class="action-count">${actionCount}</span>`;
    }
  }

  function makeDraggable(element) {
    let isDragging = false;
    let offsetX, offsetY;

    element.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - element.offsetLeft;
      offsetY = e.clientY - element.offsetTop;
      element.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();

      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;

      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      if (element) {
        element.style.cursor = 'move';
      }
    });
  }

  // ============================================
  // Event Handlers
  // ============================================

  function handleClick(e) {
    if (!isRecording || isPaused) return;
    if (e.target.closest('#chrometools-recorder-overlay')) return;

    const target = findClickableTarget(e.target);
    if (!isElementVisible(target)) return;

    const selector = generateSelector(target);

    sendAction({
      type: 'click',
      selector,
      timestamp: Date.now(),
      data: {
        text: target.textContent?.trim().substring(0, 50) || '',
        href: target.href || null,
        tagName: target.tagName.toLowerCase()
      }
    });

    highlightElement(target);
  }

  function handleInput(e) {
    if (!isRecording || isPaused) return;
    if (e.target.closest('#chrometools-recorder-overlay')) return;

    const element = e.target;
    const timerId = inputDebounceTimers.get(element);
    if (timerId) clearTimeout(timerId);

    // Capture the START value when user begins typing in this element
    // This value stays the same until we actually record the action
    if (!inputStartValues.has(element)) {
      inputStartValues.set(element, lastInputValues.get(element) || '');
    }

    // NO debounce timer - only record on blur/Enter/tab switch
    // This prevents multiple recordings when user types slowly with pauses
    // The value will be recorded when:
    // 1. User clicks elsewhere (blur)
    // 2. User presses Enter or Tab
    // 3. Recording stops
  }

  function flushAllPendingInputs() {
    // Flush all elements that have pending input values
    for (const element of inputStartValues.keys()) {
      flushInputValue(element);
    }
  }

  function flushInputValue(element) {
    // Clear any pending timer
    const timerId = inputDebounceTimers.get(element);
    if (timerId) {
      clearTimeout(timerId);
      inputDebounceTimers.delete(element);
    }

    // Get the value from when user started typing
    const startValue = inputStartValues.get(element);
    if (startValue === undefined) return; // No input session in progress

    const finalValue = element.value;

    // Only record if value actually changed
    if (finalValue === startValue) {
      inputStartValues.delete(element);
      return;
    }

    if (!isElementVisible(element)) {
      inputStartValues.delete(element);
      return;
    }

    const selector = generateSelector(element);
    const secretInfo = isSecretField(element);

    let recordedValue = finalValue;
    let paramName = null;

    if (secretInfo.isSecret) {
      paramName = generateParamName(secretInfo.fieldType, element);
      recordedValue = `{{${paramName}}}`;

      // Register secret with background
      chrome.runtime.sendMessage({
        type: 'REGISTER_SECRET',
        paramName,
        value: finalValue
      });
    }

    sendAction({
      type: 'type',
      selector,
      timestamp: Date.now(),
      data: {
        text: recordedValue,
        isSecret: secretInfo.isSecret,
        paramName,
        clearFirst: startValue === ''
      }
    });

    // Update stored value and clear the start value
    lastInputValues.set(element, finalValue);
    inputStartValues.delete(element);
    highlightElement(element);
  }

  function handleBlur(e) {
    if (!isRecording || isPaused) return;
    if (e.target.closest('#chrometools-recorder-overlay')) return;

    const element = e.target;
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      flushInputValue(element);
    }
  }

  function handleChange(e) {
    if (!isRecording || isPaused) return;
    if (e.target.closest('#chrometools-recorder-overlay')) return;

    const element = e.target;

    if (element.tagName === 'SELECT') {
      if (!isElementVisible(element)) return;

      const selector = generateSelector(element);

      sendAction({
        type: 'select',
        selector,
        timestamp: Date.now(),
        data: {
          value: element.value,
          text: element.options[element.selectedIndex]?.text
        }
      });

      highlightElement(element);
    } else if (element.type === 'file') {
      if (!isElementVisible(element)) return;

      const selector = generateSelector(element);

      sendAction({
        type: 'upload',
        selector,
        timestamp: Date.now(),
        data: {
          fileName: element.files[0]?.name,
          filePath: '{{filePath}}'
        }
      });
    } else if (element.type === 'checkbox' || element.type === 'radio') {
      if (!isElementVisible(element)) return;

      const selector = generateSelector(element);

      sendAction({
        type: 'click',
        selector,
        timestamp: Date.now(),
        data: {
          checked: element.checked,
          inputType: element.type,
          value: element.value
        }
      });

      highlightElement(element);
    }
  }

  function handleKeyDown(e) {
    if (!isRecording || isPaused) return;
    if (e.target.closest('#chrometools-recorder-overlay')) return;

    const element = e.target;

    // Flush input before Enter/Tab (these typically submit or move to next field)
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        flushInputValue(element);
      }
    }

    const specialKeys = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'];

    if (specialKeys.includes(e.key) || e.ctrlKey || e.metaKey) {
      const modifiers = [];
      if (e.ctrlKey) modifiers.push('Control');
      if (e.shiftKey) modifiers.push('Shift');
      if (e.altKey) modifiers.push('Alt');
      if (e.metaKey) modifiers.push('Meta');

      // Skip pure modifier keys
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      sendAction({
        type: 'keypress',
        selector: null,
        timestamp: Date.now(),
        data: {
          key: e.key,
          modifiers
        }
      });
    }
  }

  function handleScroll(e) {
    if (!isRecording || isPaused) return;

    if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);

    scrollDebounceTimer = setTimeout(() => {
      const target = e.target === document ? document.documentElement : e.target;
      if (target.nodeType !== 1) return;

      const selector = generateSelector(target);

      sendAction({
        type: 'scroll',
        selector,
        timestamp: Date.now(),
        data: {
          scrollTop: target.scrollTop,
          scrollLeft: target.scrollLeft
        }
      });
    }, 1000);
  }

  // ============================================
  // Helpers
  // ============================================

  function findClickableTarget(element) {
    let current = element;
    const maxDepth = 5;
    let depth = 0;

    while (current && current !== document.body && depth < maxDepth) {
      const isInteractive =
        current.tagName === 'A' ||
        current.tagName === 'BUTTON' ||
        current.getAttribute('role') === 'button' ||
        current.getAttribute('role') === 'link' ||
        current.hasAttribute('onclick') ||
        current.onclick !== null ||
        getComputedStyle(current).cursor === 'pointer';

      if (isInteractive) {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    return element;
  }

  function isElementVisible(element) {
    if (!element) return false;
    if (element.offsetWidth === 0 && element.offsetHeight === 0) return false;

    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    return true;
  }

  function highlightElement(element) {
    element.classList.add('chrometools-highlight');
    setTimeout(() => {
      element.classList.remove('chrometools-highlight');
    }, 500);
  }

  function sendAction(action) {
    actionCount++;
    updateOverlay();

    chrome.runtime.sendMessage({
      type: 'ACTION',
      action
    });
  }

  // ============================================
  // Event Listener Management
  // ============================================

  function attachEventListeners() {
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('blur', handleBlur, true);
    document.addEventListener('scroll', handleScroll, true);
  }

  function detachEventListeners() {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('change', handleChange, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('blur', handleBlur, true);
    document.removeEventListener('scroll', handleScroll, true);
  }

  // ============================================
  // Message Handling
  // ============================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'RECORDING_STARTED':
        isRecording = true;
        isPaused = false;
        // Use provided actionCount if available (e.g., when switching tabs during recording)
        actionCount = message.actionCount || actionCount || 0;
        createOverlay();
        attachEventListeners();
        sendResponse({ success: true });
        break;

      case 'RECORDING_STOPPED':
        // Flush any pending input values before stopping
        flushAllPendingInputs();
        isRecording = false;
        isPaused = false;
        removeOverlay();
        detachEventListeners();
        sendResponse({ success: true });
        break;

      case 'RECORDING_PAUSED':
        isPaused = true;
        updateOverlay();
        sendResponse({ success: true });
        break;

      case 'RECORDING_RESUMED':
        isPaused = false;
        updateOverlay();
        sendResponse({ success: true });
        break;

      case 'GET_RECORDING_STATE':
        sendResponse({
          isRecording,
          isPaused,
          actionCount
        });
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
    return false;
  });

  // ============================================
  // Initialization
  // ============================================

  async function initialize() {
    // Check if recording is already in progress
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' });
      if (response && response.isRecording) {
        isRecording = true;
        isPaused = response.isPaused;
        actionCount = response.actionCount || 0;

        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            createOverlay();
            attachEventListeners();
          });
        } else {
          createOverlay();
          attachEventListeners();
        }
      }
    } catch (error) {
      // Extension context might not be ready, that's ok
      console.log('[ChromeTools] Content script initialized (no active recording)');
    }
  }

  initialize();

})();

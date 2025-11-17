/**
 * recorder/recorder-script.js
 *
 * Browser-side recorder implementation.
 * This code is injected into the page via page.evaluate() or page.addScriptTag().
 *
 * Features:
 * 1. Floating UI widget for recording control
 * 2. Event capture (click, type, select, scroll, hover, keypress, drag, upload)
 * 3. Visual highlighting of recorded elements
 * 4. Real-time action list display
 * 5. Secret detection and masking
 * 6. Selector generation
 * 7. Action debouncing
 */

import { browserSelectorGenerator } from '../utils/selector-generator.js';
import { browserSecretDetector } from './secret-detector.js';

/**
 * Generate complete browser-side recorder script
 * This will be injected into the page
 */
export function generateRecorderScript() {
  // Note: Using template literal interpolation to inject dependencies
  return `
(function() {
  'use strict';

  // ==========================
  // RECORDER STATE
  // ==========================

  const state = {
    isRecording: false,
    isPaused: false,
    actions: [],
    secrets: {},
    lastActionTime: 0,
    isCompact: false, // Widget compact mode
    scenarioMetadata: {
      name: '',
      description: '',
      tags: [],
      dependencies: []
    }
  };

  // Selector generator (injected)
  ${browserSelectorGenerator}
  const selectorGenerator = window.selectorGenerator || {};

  // Secret detector (injected)
  ${browserSecretDetector}
  const secretDetector = window.secretDetector || {};

  // ==========================
  // UI COMPONENTS
  // ==========================

  let recorderUI = null;
  let actionsList = null;
  let highlightOverlay = null;

  function createRecorderUI() {
    // Main widget container
    recorderUI = document.createElement('div');
    recorderUI.id = 'chrometools-recorder';
    recorderUI.innerHTML = \`
      <style>
        #chrometools-recorder {
          position: fixed;
          top: 20px;
          right: 20px;
          width: 320px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: white;
          transition: all 0.3s ease;
        }

        /* Compact mode */
        #chrometools-recorder.compact {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: rgba(102, 126, 234, 0.9);
          cursor: pointer;
          overflow: hidden;
        }

        #chrometools-recorder.compact > *:not(#chrometools-recorder-compact-icon) {
          display: none;
        }

        #chrometools-recorder-compact-icon {
          display: none;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        }

        #chrometools-recorder.compact #chrometools-recorder-compact-icon {
          display: flex;
        }

        #chrometools-recorder-compact-icon::before {
          content: '⏺';
          color: #ef4444;
          animation: recording-icon-pulse 2s ease-in-out infinite;
        }

        @keyframes recording-icon-pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.1);
          }
        }

        #chrometools-recorder-header {
          padding: 16px;
          cursor: move;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }

        #chrometools-recorder-title {
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        #chrometools-recorder-status {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ef4444;
        }

        #chrometools-recorder-status.recording {
          background: #10b981;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Visual indicator for active recording */
        body.chrometools-recording {
          outline: 3px solid rgba(239, 68, 68, 0.6) !important;
          outline-offset: -3px !important;
          animation: recording-pulse 2s ease-in-out infinite !important;
        }

        @keyframes recording-pulse {
          0%, 100% {
            outline-color: rgba(239, 68, 68, 0.6);
          }
          50% {
            outline-color: rgba(239, 68, 68, 0.3);
          }
        }

        #chrometools-recorder-controls {
          padding: 16px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .recorder-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          flex: 1;
          min-width: 80px;
        }

        .recorder-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }

        .recorder-btn-primary {
          background: #10b981;
          color: white;
        }

        .recorder-btn-secondary {
          background: rgba(255, 255, 255, 0.2);
          color: white;
        }

        .recorder-btn-danger {
          background: #ef4444;
          color: white;
        }

        .recorder-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        #chrometools-recorder-actions {
          max-height: 300px;
          overflow-y: auto;
          padding: 12px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 0 0 12px 12px;
        }

        .recorder-action-item {
          padding: 8px 12px;
          margin-bottom: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          font-size: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .recorder-action-type {
          font-weight: 600;
          color: #10b981;
        }

        .recorder-action-secret {
          color: #fbbf24;
        }

        .recorder-action-details {
          font-size: 11px;
          opacity: 0.8;
          margin-top: 4px;
        }

        .recorder-highlight {
          position: absolute;
          pointer-events: none;
          border: 2px solid #10b981;
          background: rgba(16, 185, 129, 0.1);
          z-index: 999998;
          transition: all 0.2s;
        }

        #chrometools-recorder-metadata {
          padding: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }

        #chrometools-recorder-metadata input {
          width: 100%;
          padding: 12px 8px;
          margin-bottom: 8px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          min-height: 40px;
          background: rgba(255, 255, 255, 0.95);
          color: #1f2937;
        }

        #chrometools-recorder-metadata input::placeholder {
          color: #6b7280;
          opacity: 0.8;
        }

        .recorder-collapse {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s;
        }

        .recorder-collapse.expanded {
          max-height: 500px;
        }
      </style>

      <div id="chrometools-recorder-compact-icon"></div>

      <div id="chrometools-recorder-header">
        <div id="chrometools-recorder-title">
          <div id="chrometools-recorder-status"></div>
          <span>Scenario Recorder</span>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="recorder-btn recorder-btn-secondary" id="recorder-toggle-metadata" style="flex: none; min-width: auto; padding: 4px 8px;" title="Settings">⚙️</button>
          <button class="recorder-btn recorder-btn-secondary" id="recorder-toggle-compact" style="flex: none; min-width: auto; padding: 4px 8px;" title="Minimize">−</button>
        </div>
      </div>

      <div id="chrometools-recorder-metadata" class="recorder-collapse">
        <input type="text" id="recorder-scenario-name" placeholder="Scenario Name" />
        <input type="text" id="recorder-scenario-desc" placeholder="Description (optional)" />
        <input type="text" id="recorder-scenario-tags" placeholder="Tags (comma-separated)" />
      </div>

      <div id="chrometools-recorder-controls">
        <button class="recorder-btn recorder-btn-primary" id="recorder-start">Start</button>
        <button class="recorder-btn recorder-btn-secondary" id="recorder-pause" disabled>Pause</button>
        <button class="recorder-btn recorder-btn-secondary" id="recorder-stop-only" disabled>Stop</button>
        <button class="recorder-btn recorder-btn-danger" id="recorder-stop" disabled>Stop & Save</button>
        <button class="recorder-btn recorder-btn-secondary" id="recorder-clear">Clear</button>
      </div>

      <div id="chrometools-recorder-actions">
        <div style="text-align: center; opacity: 0.6; font-size: 12px;">
          No actions recorded yet
        </div>
      </div>
    \`;

    document.body.appendChild(recorderUI);

    // Make draggable
    makeDraggable(recorderUI);

    // Setup event listeners
    setupUIEventListeners();

    // Create highlight overlay
    highlightOverlay = document.createElement('div');
    highlightOverlay.className = 'recorder-highlight';
    highlightOverlay.style.display = 'none';
    document.body.appendChild(highlightOverlay);

    // Get actions list element
    actionsList = document.getElementById('chrometools-recorder-actions');
  }

  function setupUIEventListeners() {
    document.getElementById('recorder-start').addEventListener('click', startRecording);
    document.getElementById('recorder-pause').addEventListener('click', togglePause);
    document.getElementById('recorder-stop-only').addEventListener('click', stopRecording);
    document.getElementById('recorder-stop').addEventListener('click', stopAndSave);
    document.getElementById('recorder-clear').addEventListener('click', clearActions);
    document.getElementById('recorder-toggle-metadata').addEventListener('click', toggleMetadata);
    document.getElementById('recorder-toggle-compact').addEventListener('click', toggleCompactMode);

    // Click on compact icon to expand
    document.getElementById('chrometools-recorder-compact-icon').addEventListener('click', () => {
      if (state.isCompact) {
        toggleCompactMode();
      }
    });
  }

  function toggleMetadata() {
    const metadata = document.getElementById('chrometools-recorder-metadata');
    metadata.classList.toggle('expanded');
  }

  function toggleCompactMode() {
    state.isCompact = !state.isCompact;
    const widget = document.getElementById('chrometools-recorder');

    if (state.isCompact) {
      widget.classList.add('compact');
    } else {
      widget.classList.remove('compact');
    }
  }

  function makeDraggable(element) {
    const header = element.querySelector('#chrometools-recorder-header');
    let isDragging = false;
    let currentX, currentY, initialX, initialY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      initialX = e.clientX - element.offsetLeft;
      initialY = e.clientY - element.offsetTop;
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      element.style.left = currentX + 'px';
      element.style.top = currentY + 'px';
      element.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // ==========================
  // RECORDING CONTROL
  // ==========================

  function startRecording() {
    state.isRecording = true;
    state.isPaused = false;
    updateUIState();
    attachEventListeners();
  }

  function togglePause() {
    state.isPaused = !state.isPaused;
    updateUIState();
  }

  function stopRecording() {
    // Stop recording without saving
    state.isRecording = false;
    state.isPaused = false;
    updateUIState();
    detachEventListeners();
  }

  async function stopAndSave() {
    // Check if scenario name is entered BEFORE stopping
    const scenarioName = document.getElementById('recorder-scenario-name').value.trim();

    if (!scenarioName) {
      alert('Please enter a scenario name before saving!');
      // Expand metadata section to show the name field
      const metadata = document.getElementById('chrometools-recorder-metadata');
      if (!metadata.classList.contains('expanded')) {
        metadata.classList.add('expanded');
      }
      // Focus on name input
      document.getElementById('recorder-scenario-name').focus();
      return; // Don't stop recording yet!
    }

    // Only stop recording if name is provided
    state.isRecording = false;
    state.isPaused = false;
    updateUIState();
    detachEventListeners();
    await saveScenario();
  }

  function clearActions() {
    state.actions = [];
    state.secrets = {};
    updateActionsList();
  }

  function updateUIState() {
    const status = document.getElementById('chrometools-recorder-status');
    const startBtn = document.getElementById('recorder-start');
    const pauseBtn = document.getElementById('recorder-pause');
    const stopOnlyBtn = document.getElementById('recorder-stop-only');
    const stopBtn = document.getElementById('recorder-stop');

    if (state.isRecording) {
      status.classList.add('recording');
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      stopOnlyBtn.disabled = false;
      stopBtn.disabled = false;
      pauseBtn.textContent = state.isPaused ? 'Resume' : 'Pause';

      // Add visual indicator to body
      document.body.classList.add('chrometools-recording');
    } else {
      status.classList.remove('recording');
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      stopOnlyBtn.disabled = true;
      stopBtn.disabled = true;

      // Remove visual indicator from body
      document.body.classList.remove('chrometools-recording');
    }
  }

  // ==========================
  // EVENT LISTENERS
  // ==========================

  function attachEventListeners() {
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('dragstart', handleDragStart, true);
    document.addEventListener('dragend', handleDragEnd, true);
  }

  function detachEventListeners() {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('change', handleChange, true);
    document.removeEventListener('scroll', handleScroll, true);
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('dragstart', handleDragStart, true);
    document.removeEventListener('dragend', handleDragEnd, true);
    hideHighlight();
  }

  // ==========================
  // EVENT HANDLERS
  // ==========================

  function handleClick(e) {
    if (!shouldRecordEvent(e)) return;

    // Check if this is part of recorder UI
    if (e.target.closest('#chrometools-recorder')) {
      return;
    }

    // DO NOT prevent default - let clicks work normally
    // Just record them without blocking

    // Find the actual clickable element (element with click listener or interactive role)
    const actualTarget = findActualClickTarget(e.target);
    const selectorInfo = selectorGenerator.generateSelectorForElement(actualTarget);
    const form = actualTarget.closest('form');

    recordAction({
      type: 'click',
      selector: selectorInfo,
      timestamp: Date.now(),
      data: {
        text: actualTarget.textContent?.trim().substring(0, 50) || '',
        href: actualTarget.href || null,
        requiresWait: true // Flag for smart waiting during playback
      }
    });

    highlightElement(actualTarget);
  }

  // Find the actual clickable element by looking for click listeners
  function findActualClickTarget(element) {
    let current = element;
    const maxDepth = 5; // Don't go too far up the tree
    let depth = 0;

    while (current && current !== document.body && depth < maxDepth) {
      // Check if this element has event listeners
      const hasClickListener = hasEventListener(current, 'click');

      // Check if element is naturally interactive
      const isInteractive = current.tagName === 'A' ||
                           current.tagName === 'BUTTON' ||
                           current.getAttribute('role') === 'button' ||
                           current.getAttribute('role') === 'link' ||
                           current.hasAttribute('onclick') ||
                           current.style.cursor === 'pointer';

      if (hasClickListener || isInteractive) {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    // If no clickable parent found, return original element
    return element;
  }

  // Check if element has specific event listener
  function hasEventListener(element, eventType) {
    // Try to detect listeners through getEventListeners (Chrome DevTools API)
    if (typeof getEventListeners === 'function') {
      try {
        const listeners = getEventListeners(element);
        return listeners && listeners[eventType] && listeners[eventType].length > 0;
      } catch (e) {
        // getEventListeners not available
      }
    }

    // Fallback: check common indicators
    // Check onclick attribute
    if (element.hasAttribute('onclick')) return true;

    // Check for common event handler properties
    if (element.onclick) return true;

    // Check if element has data attributes that suggest it's interactive
    if (element.hasAttribute('data-action') ||
        element.hasAttribute('data-click') ||
        element.hasAttribute('data-toggle')) {
      return true;
    }

    return false;
  }

  let lastInputValue = new Map();
  let inputDebounceTimers = new Map();

  function handleInput(e) {
    if (!shouldRecordEvent(e)) return;
    if (e.target.closest('#chrometools-recorder')) return;

    const element = e.target;
    const form = element.closest('form');

    // Debounce typing
    const timerId = inputDebounceTimers.get(element);
    if (timerId) clearTimeout(timerId);

    inputDebounceTimers.set(element, setTimeout(() => {
      const value = element.value;
      const previousValue = lastInputValue.get(element) || '';

      // Only record if value changed
      if (value !== previousValue) {
        const selectorInfo = selectorGenerator.generateSelectorForElement(element);

        // Detect if secret
        const secretInfo = secretDetector.detectSecretField(element);

        let recordedValue = value;
        let isSecret = secretInfo.isSecret;
        let paramName = null;

        if (isSecret) {
          paramName = secretDetector.generateParameterName(secretInfo.fieldType, element);
          state.secrets[paramName] = value;
          recordedValue = \`{{\${paramName}}}\`;
        }

        recordAction({
          type: 'type',
          selector: selectorInfo,
          timestamp: Date.now(),
          data: {
            text: recordedValue,
            isSecret,
            paramName,
            clearFirst: previousValue === '' // Clear if field was empty
          }
        });

        lastInputValue.set(element, value);
        highlightElement(element);
      }
    }, 500)); // 500ms debounce
  }

  function handleChange(e) {
    if (!shouldRecordEvent(e)) return;
    if (e.target.closest('#chrometools-recorder')) return;

    const element = e.target;

    if (element.tagName === 'SELECT') {
      const selectorInfo = selectorGenerator.generateSelectorForElement(element);

      recordAction({
        type: 'select',
        selector: selectorInfo,
        timestamp: Date.now(),
        data: {
          value: element.value,
          text: element.options[element.selectedIndex]?.text,
          selectType: 'native'
        }
      });

      highlightElement(element);
    } else if (element.type === 'file') {
      // File upload
      const selectorInfo = selectorGenerator.generateSelectorForElement(element);

      recordAction({
        type: 'upload',
        selector: selectorInfo,
        timestamp: Date.now(),
        data: {
          fileName: element.files[0]?.name,
          // Note: actual file path needs to be set during playback
          filePath: '{{filePath}}'
        }
      });
    }
  }

  let scrollDebounceTimer = null;

  function handleScroll(e) {
    if (!shouldRecordEvent(e)) return;

    clearTimeout(scrollDebounceTimer);
    scrollDebounceTimer = setTimeout(() => {
      const target = e.target === document ? document.documentElement : e.target;

      if (target.nodeType !== 1) return; // Only elements

      const selectorInfo = selectorGenerator.generateSelectorForElement(target);

      recordAction({
        type: 'scroll',
        selector: selectorInfo,
        timestamp: Date.now(),
        data: {
          scrollTop: target.scrollTop,
          scrollLeft: target.scrollLeft
        }
      });
    }, 1000);
  }

  let lastHoverTarget = null;

  function handleMouseOver(e) {
    if (!shouldRecordEvent(e)) return;
    if (e.target.closest('#chrometools-recorder')) return;

    // Show highlight during recording
    if (state.isRecording && !state.isPaused) {
      showHighlight(e.target);
    }

    // Only record intentional hovers (elements with :hover effects)
    if (e.target !== lastHoverTarget) {
      const hasHoverEffect = hasHoverStyle(e.target);

      if (hasHoverEffect) {
        const selectorInfo = selectorGenerator.generateSelectorForElement(e.target);

        recordAction({
          type: 'hover',
          selector: selectorInfo,
          timestamp: Date.now(),
          data: {}
        });
      }

      lastHoverTarget = e.target;
    }
  }

  function hasHoverStyle(element) {
    // Check if element has CSS :hover pseudo-class rules
    const sheets = document.styleSheets;
    const selector = selectorGenerator.generateSelectorForElement(element).primary;

    for (const sheet of sheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        for (const rule of rules) {
          if (rule.selectorText && rule.selectorText.includes(':hover')) {
            if (element.matches(rule.selectorText.replace(':hover', ''))) {
              return true;
            }
          }
        }
      } catch (e) {
        // Cross-origin stylesheet
      }
    }

    return false;
  }

  function handleKeyDown(e) {
    if (!shouldRecordEvent(e)) return;
    if (e.target.closest('#chrometools-recorder')) return;

    // Only record special keys (not regular typing)
    const specialKeys = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    if (specialKeys.includes(e.key)) {
      const modifiers = [];
      if (e.ctrlKey) modifiers.push('Control');
      if (e.shiftKey) modifiers.push('Shift');
      if (e.altKey) modifiers.push('Alt');
      if (e.metaKey) modifiers.push('Meta');

      recordAction({
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

  let dragStartInfo = null;

  function handleDragStart(e) {
    if (!shouldRecordEvent(e)) return;

    dragStartInfo = {
      element: e.target,
      selector: selectorGenerator.generateSelectorForElement(e.target),
      x: e.clientX,
      y: e.clientY
    };
  }

  function handleDragEnd(e) {
    if (!shouldRecordEvent(e)) return;
    if (!dragStartInfo) return;

    recordAction({
      type: 'drag',
      selector: dragStartInfo.selector,
      timestamp: Date.now(),
      data: {
        fromX: dragStartInfo.x,
        fromY: dragStartInfo.y,
        toX: e.clientX,
        toY: e.clientY
      }
    });

    dragStartInfo = null;
  }

  // ==========================
  // HELPER FUNCTIONS
  // ==========================

  function shouldRecordEvent(e) {
    return state.isRecording && !state.isPaused;
  }

  function recordAction(action) {
    state.actions.push(action);
    updateActionsList();
  }

  function updateActionsList() {
    if (state.actions.length === 0) {
      actionsList.innerHTML = '<div style="text-align: center; opacity: 0.6; font-size: 12px;">No actions recorded yet</div>';
      return;
    }

    actionsList.innerHTML = state.actions.map((action, index) => {
      const isSecret = action.data?.isSecret;
      const details = formatActionDetails(action);

      return \`
        <div class="recorder-action-item">
          <div>
            <div>
              <span class="recorder-action-type">\${action.type}</span>
              \${isSecret ? '<span class="recorder-action-secret">🔒</span>' : ''}
            </div>
            \${details ? \`<div class="recorder-action-details">\${details}</div>\` : ''}
          </div>
          <div>\${index + 1}</div>
        </div>
      \`;
    }).join('');

    // Scroll to bottom
    actionsList.scrollTop = actionsList.scrollHeight;
  }

  function formatActionDetails(action) {
    switch (action.type) {
      case 'click':
        return action.data.text || action.data.href || action.selector.primary;
      case 'type':
        return action.data.isSecret ? '***' : action.data.text.substring(0, 20);
      case 'select':
        return action.data.text || action.data.value;
      case 'keypress':
        return action.data.modifiers.concat(action.data.key).join('+');
      default:
        return '';
    }
  }

  function showHighlight(element) {
    const rect = element.getBoundingClientRect();
    highlightOverlay.style.display = 'block';
    highlightOverlay.style.left = (rect.left + window.scrollX) + 'px';
    highlightOverlay.style.top = (rect.top + window.scrollY) + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
  }

  function hideHighlight() {
    highlightOverlay.style.display = 'none';
  }

  function highlightElement(element) {
    showHighlight(element);
    setTimeout(hideHighlight, 1000);
  }

  // ==========================
  // SAVE SCENARIO
  // ==========================

  async function saveScenario() {
    const scenarioName = document.getElementById('recorder-scenario-name').value.trim();

    if (!scenarioName) {
      alert('Please enter a scenario name');
      return;
    }

    const metadata = {
      name: scenarioName,
      description: document.getElementById('recorder-scenario-desc').value.trim(),
      tags: document.getElementById('recorder-scenario-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      dependencies: [], // Will be set via UI later
      parameters: extractParameters(),
      outputs: []
    };

    // Optimize actions before saving
    const optimizedActions = optimizeActions(state.actions);

    const scenario = {
      name: scenarioName,
      metadata,
      chain: optimizedActions,
      secrets: state.secrets
    };

    // Call MCP server via exposed function
    if (window.saveScenarioToMCP) {
      try {
        const result = await window.saveScenarioToMCP(scenario);
        if (result.success) {
          alert(\`Scenario "\${scenarioName}" saved successfully!\`);
          clearActions();
        } else {
          alert(\`Error saving scenario: \${result.error}\`);
        }
      } catch (error) {
        alert(\`Error: \${error.message}\`);
      }
    } else {
      console.error('MCP save function not available');
      alert('MCP server connection not available');
    }
  }

  // ==========================
  // ACTION OPTIMIZER (browser-side)
  // ==========================

  function optimizeActions(actions) {
    if (!actions || actions.length === 0) {
      return [];
    }

    let optimized = [...actions];

    // Remove recorder widget events
    optimized = optimized.filter(action => {
      const selector = action.selector?.primary || action.selector?.value || '';
      if (selector.includes('chrometools-recorder')) {
        return false;
      }
      const classes = action.selector?.elementInfo?.classes || [];
      if (classes.some(cls => cls.includes('chrometools-recorder'))) {
        return false;
      }
      return true;
    });

    // Combine sequential type actions on same element
    const combinedTypes = [];
    let i = 0;
    while (i < optimized.length) {
      const action = optimized[i];

      if (action.type === 'type') {
        // Collect all sequential type actions on same selector
        const typeActions = [action];
        let j = i + 1;

        while (j < optimized.length &&
               optimized[j].type === 'type' &&
               optimized[j].selector?.primary === action.selector?.primary) {
          typeActions.push(optimized[j]);
          j++;
        }

        // Combine if multiple type actions found
        if (typeActions.length > 1) {
          // Use the LAST type action as base (has correct secret info)
          const lastType = typeActions[typeActions.length - 1];
          combinedTypes.push(lastType);
          i = j;
        } else {
          combinedTypes.push(action);
          i++;
        }
      } else {
        combinedTypes.push(action);
        i++;
      }
    }
    optimized = combinedTypes;

    // Remove hover immediately before click on same element
    optimized = optimized.filter((action, index) => {
      if (action.type !== 'hover') return true;

      // Look for next non-hover action
      let nextIndex = index + 1;
      while (nextIndex < optimized.length && optimized[nextIndex].type === 'hover') {
        nextIndex++;
      }

      const nextAction = optimized[nextIndex];
      if (!nextAction) return true;

      if (nextAction.type === 'click') {
        const sameElement = action.selector?.primary === nextAction.selector?.primary;
        if (sameElement) {
          return false; // Remove this hover
        }
      }
      return true;
    });

    // Remove duplicate consecutive hovers
    const dedupHovers = [];
    let lastHover = null;
    for (const action of optimized) {
      if (action.type === 'hover') {
        if (lastHover && lastHover.selector?.primary === action.selector?.primary) {
          continue; // Skip duplicate
        }
        lastHover = action;
      }
      dedupHovers.push(action);
    }
    optimized = dedupHovers;

    // Remove duplicate consecutive scrolls on same element
    const dedupScrolls = [];
    let lastScroll = null;
    for (const action of optimized) {
      if (action.type === 'scroll') {
        if (lastScroll && lastScroll.selector?.primary === action.selector?.primary) {
          // Replace previous scroll with current (keep latest position)
          dedupScrolls.pop();
        }
        lastScroll = action;
      }
      dedupScrolls.push(action);
    }

    return dedupScrolls;
  }

  function extractParameters() {
    const params = {};

    // Extract parameters from secrets
    for (const [paramName, value] of Object.entries(state.secrets)) {
      params[paramName] = {
        type: 'string',
        required: true,
        description: \`Secret parameter: \${paramName}\`
      };
    }

    return params;
  }

  // ==========================
  // INITIALIZATION
  // ==========================

  // Check if recorder already exists
  if (document.getElementById('chrometools-recorder')) {
    console.warn('⚠️  Chrometools Recorder already initialized on this page');
    // Return existing control interface if available
    if (window.__chrometoolsRecorderInstance) {
      return window.__chrometoolsRecorderInstance;
    }
    // If widget exists but no instance, clean it up first
    const existingWidget = document.getElementById('chrometools-recorder');
    existingWidget.remove();
    const existingHighlight = document.querySelector('.recorder-highlight');
    if (existingHighlight) existingHighlight.remove();
  }

  createRecorderUI();
  console.log('✅ Chrometools Recorder initialized');

  // Return control interface and store globally
  const controlInterface = {
    start: startRecording,
    stop: stopAndSave,
    pause: togglePause,
    clear: clearActions,
    getState: () => ({ ...state }),
    getActions: () => [...state.actions]
  };

  // Store instance globally to prevent duplicates
  window.__chrometoolsRecorderInstance = controlInterface;

  return controlInterface;
})();
`;
}

/**
 * Inject recorder into page
 * @param {Object} page - Puppeteer page instance
 */
export async function injectRecorder(page) {
  try {
    // Check if recorder is already injected
    const alreadyInjected = await page.evaluate(() => {
      return document.getElementById('chrometools-recorder') !== null;
    });

    if (alreadyInjected) {
      // Remove old recorder UI before re-injecting
      await page.evaluate(() => {
        const oldRecorder = document.getElementById('chrometools-recorder');
        if (oldRecorder) oldRecorder.remove();

        const oldHighlight = document.querySelector('.recorder-highlight');
        if (oldHighlight) oldHighlight.remove();

        // Remove body class
        document.body.classList.remove('chrometools-recording');
      });
    }

    // Check if function already exists
    const functionExists = await page.evaluate(() => {
      return typeof window.saveScenarioToMCP === 'function';
    });

    // Only expose function if it doesn't exist yet
    if (!functionExists) {
      await page.exposeFunction('saveScenarioToMCP', async (scenarioData) => {
        const { saveScenario } = await import('./scenario-storage.js');
        return await saveScenario(scenarioData);
      });
    }

    // Inject recorder script immediately into current page
    await page.evaluate(generateRecorderScript());

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

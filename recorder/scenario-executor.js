/**
 * recorder/scenario-executor.js
 *
 * Executes recorded scenarios with:
 * 1. Action playback with error handling
 * 2. Parameter substitution
 * 3. Secret injection
 * 4. Dependency resolution and chaining
 * 5. Retry logic with fallback selectors
 */

import { resolveDependencies, checkDependencyCondition } from './dependency-resolver.js';
import { loadScenario, loadSecrets, loadIndex } from './scenario-storage.js';

/**
 * Execute scenario with dependencies
 * @param {string} scenarioName - Scenario to execute
 * @param {Object} page - Puppeteer page instance
 * @param {Object} params - Parameters for scenario
 * @param {Object} options - Execution options { skipConditions, maxRetries }
 * @returns {Object} - Execution result
 */
export async function executeScenario(scenarioName, page, params = {}, options = {}) {
  const {
    skipConditions = false,
    maxRetries = 3,
    timeout = 30000
  } = options;

  const result = {
    success: false,
    scenarioName,
    executedScenarios: [],
    errors: [],
    outputs: {},
    duration: 0
  };

  const startTime = Date.now();

  try {
    // Load scenario index
    const scenarioIndex = await loadIndex();

    // Resolve dependencies
    const resolution = resolveDependencies(scenarioName, scenarioIndex, { skipConditions });

    if (resolution.errors.length > 0) {
      result.errors = resolution.errors;
      return result;
    }

    const { chain } = resolution;

    // Execute chain in order
    for (const name of chain) {
      const scenario = await loadScenario(name);
      if (!scenario) {
        result.errors.push(`Scenario "${name}" not found`);
        return result;
      }

      // Check dependency conditions
      if (scenario.metadata?.dependencies) {
        for (const dep of scenario.metadata.dependencies) {
          if (dep.condition) {
            const context = { page, variables: params };
            const shouldExecute = await checkDependencyCondition(dep.condition, context);

            if (!shouldExecute) {
              console.log(`Skipping scenario "${name}" due to condition`);
              continue;
            }
          }
        }
      }

      // Load secrets
      const secrets = await loadSecrets(name);

      // Merge secrets with params
      const executionParams = { ...params, ...secrets };

      // Execute scenario
      const scenarioResult = await executeSingleScenario(scenario, page, executionParams, {
        maxRetries,
        timeout
      });

      result.executedScenarios.push(name);

      if (!scenarioResult.success) {
        result.errors.push(...scenarioResult.errors);
        return result;
      }

      // Collect outputs for next scenarios
      if (scenarioResult.outputs) {
        Object.assign(result.outputs, scenarioResult.outputs);
        Object.assign(params, scenarioResult.outputs);
      }
    }

    result.success = true;
  } catch (error) {
    result.errors.push(`Execution failed: ${error.message}`);
  } finally {
    result.duration = Date.now() - startTime;
  }

  return result;
}

/**
 * Execute single scenario (without dependencies)
 * @param {Object} scenario - Scenario data
 * @param {Object} page - Puppeteer page
 * @param {Object} params - Parameters
 * @param {Object} options - Options
 * @returns {Object} - Execution result
 */
async function executeSingleScenario(scenario, page, params = {}, options = {}) {
  const { maxRetries = 3, timeout = 30000 } = options;

  const result = {
    success: false,
    errors: [],
    outputs: {},
    actionResults: []
  };

  try {
    for (const action of scenario.chain) {
      // Substitute parameters in action
      const resolvedAction = substituteParameters(action, params);

      // Execute action with retry
      const actionResult = await executeActionWithRetry(
        resolvedAction,
        page,
        maxRetries,
        timeout
      );

      result.actionResults.push(actionResult);

      if (!actionResult.success) {
        result.errors.push(`Action failed: ${actionResult.error}`);
        return result;
      }

      // Store outputs if action produces any
      if (actionResult.output) {
        Object.assign(result.outputs, actionResult.output);
      }
    }

    result.success = true;
  } catch (error) {
    result.errors.push(`Scenario execution error: ${error.message}`);
  }

  return result;
}

/**
 * Execute action with retry and fallback selectors
 */
async function executeActionWithRetry(action, page, maxRetries, timeout) {
  const result = {
    success: false,
    action: action.type,
    error: null,
    errorDetails: {
      attempts: [],
      selector: action.selector?.value || action.selector?.primary,
      context: null
    },
    output: null,
    attempts: 0
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    result.attempts = attempt;
    const attemptInfo = {
      number: attempt,
      selector: action.selector?.value || action.selector?.primary,
      error: null,
      timestamp: new Date().toISOString()
    };

    try {
      // Execute action based on type
      const actionResult = await executeAction(action, page, timeout);

      result.success = true;
      result.output = actionResult.output;
      attemptInfo.success = true;
      result.errorDetails.attempts.push(attemptInfo);
      return result;
    } catch (error) {
      attemptInfo.error = error.message;
      attemptInfo.success = false;

      // Capture page context for error reporting
      if (attempt === maxRetries) {
        try {
          result.errorDetails.context = await capturePageContext(page, action);
        } catch (contextError) {
          console.error('Failed to capture page context:', contextError);
        }
      }

      result.errorDetails.attempts.push(attemptInfo);
      result.error = error.message;

      // If this is a selector error and we have fallbacks, try them
      if (action.selector?.fallbacks && action.selector.fallbacks.length > 0) {
        const fallback = action.selector.fallbacks[0];
        console.log(`[Retry ${attempt}] Trying fallback selector: ${fallback}`);

        action.selector.value = fallback;
        action.selector.fallbacks = action.selector.fallbacks.slice(1);
        continue;
      }

      // If we have element description, try smartFindElement
      if (action.selector?.elementInfo?.text && attempt < maxRetries) {
        console.log(`[Retry ${attempt}] Selector failed, trying smartFindElement with description: ${action.selector.elementInfo.text}`);

        try {
          // Inject element finder utilities if not already done
          await page.evaluate(elementFinderUtilsCode);

          const smartResult = await page.evaluate((description) => {
            return window.smartFindElement({ description, maxResults: 3 });
          }, action.selector.elementInfo.text);

          if (smartResult.candidates && smartResult.candidates.length > 0) {
            action.selector.value = smartResult.candidates[0].selector;
            action.selector.fallbacks = smartResult.candidates.slice(1).map(c => c.selector);
            console.log(`[Retry ${attempt}] Found alternative selector: ${action.selector.value}`);
            continue;
          }
        } catch (smartError) {
          console.error('[Retry] smartFindElement failed:', smartError.message);
        }
      }

      // Last attempt failed
      if (attempt === maxRetries) {
        // Create comprehensive error message
        result.error = formatDetailedError(action, result.errorDetails);
        return result;
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return result;
}

/**
 * Capture page context for error reporting
 */
async function capturePageContext(page, action) {
  try {
    const context = {
      url: page.url(),
      title: await page.title(),
      elementExists: false,
      elementVisible: false,
      elementInfo: null,
      pageState: null
    };

    const selector = action.selector?.value || action.selector?.primary;

    if (selector) {
      // Check if element exists
      context.elementExists = await page.evaluate((sel) => {
        return document.querySelector(sel) !== null;
      }, selector);

      // If exists, check visibility and get info
      if (context.elementExists) {
        context.elementInfo = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          const rect = el.getBoundingClientRect();
          const styles = window.getComputedStyle(el);

          return {
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            visible: rect.width > 0 && rect.height > 0 && styles.display !== 'none' && styles.visibility !== 'hidden',
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            readonly: el.readOnly || el.getAttribute('aria-readonly') === 'true',
            position: {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            },
            styles: {
              display: styles.display,
              visibility: styles.visibility,
              opacity: styles.opacity,
              pointerEvents: styles.pointerEvents
            }
          };
        }, selector);

        context.elementVisible = context.elementInfo.visible;
      }
    }

    // Get page state
    context.pageState = await page.evaluate(() => {
      return {
        readyState: document.readyState,
        hasModals: document.querySelector('[role="dialog"], .modal, .popup') !== null,
        hasOverlays: document.querySelector('.overlay, .backdrop') !== null,
        activeElement: document.activeElement ? {
          tagName: document.activeElement.tagName,
          id: document.activeElement.id,
          className: document.activeElement.className
        } : null
      };
    });

    return context;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Format detailed error message for AI agent
 */
function formatDetailedError(action, errorDetails) {
  const parts = [
    `❌ Action "${action.type}" failed after ${errorDetails.attempts.length} attempts`,
    ``,
    `📍 Selector: ${errorDetails.selector}`,
  ];

  if (errorDetails.context) {
    parts.push(``, `📄 Page Context:`);
    parts.push(`   URL: ${errorDetails.context.url}`);
    parts.push(`   Title: ${errorDetails.context.title}`);

    if (errorDetails.context.elementExists) {
      parts.push(``, `🔍 Element Found But:`);
      const info = errorDetails.context.elementInfo;

      if (!info.visible) {
        parts.push(`   ⚠️  Element is NOT VISIBLE`);
        parts.push(`   - Display: ${info.styles.display}`);
        parts.push(`   - Visibility: ${info.styles.visibility}`);
        parts.push(`   - Opacity: ${info.styles.opacity}`);
        parts.push(`   - Size: ${info.position.width}x${info.position.height}`);
      }

      if (info.disabled) {
        parts.push(`   ⚠️  Element is DISABLED`);
      }

      if (info.readonly && action.type === 'type') {
        parts.push(`   ⚠️  Element is READONLY`);
      }

      if (info.styles.pointerEvents === 'none') {
        parts.push(`   ⚠️  Element has pointer-events: none`);
      }
    } else {
      parts.push(``, `❌ Element NOT FOUND in DOM`);
    }

    if (errorDetails.context.pageState) {
      const state = errorDetails.context.pageState;
      if (state.hasModals) {
        parts.push(``, `⚠️  Page has open modal/dialog`);
      }
      if (state.hasOverlays) {
        parts.push(`⚠️  Page has overlay/backdrop`);
      }
    }
  }

  parts.push(``, `🔄 Retry History:`);
  errorDetails.attempts.forEach(attempt => {
    parts.push(`   Attempt ${attempt.number}: ${attempt.error || 'Unknown error'}`);
    if (attempt.selector !== errorDetails.selector) {
      parts.push(`      (tried selector: ${attempt.selector})`);
    }
  });

  parts.push(``, `💡 Suggestions:`);
  if (!errorDetails.context?.elementExists) {
    parts.push(`   - Check if page has fully loaded`);
    parts.push(`   - Verify the selector is correct`);
    parts.push(`   - Element might be dynamically added - add wait condition`);
  } else if (!errorDetails.context?.elementVisible) {
    parts.push(`   - Element exists but is hidden - check CSS/JS conditions`);
    parts.push(`   - Wait for element to become visible`);
    parts.push(`   - Check if element is covered by modal/overlay`);
  }

  return parts.join('\n');
}

/**
 * Execute single action
 */
async function executeAction(action, page, timeout) {
  const result = { output: null };

  switch (action.type) {
    case 'click':
      await executeClick(action, page, timeout);
      break;

    case 'type':
      await executeType(action, page, timeout);
      break;

    case 'select':
      await executeSelect(action, page, timeout);
      break;

    case 'scroll':
      await executeScroll(action, page);
      break;

    case 'hover':
      await executeHover(action, page);
      break;

    case 'keypress':
      await executeKeypress(action, page);
      break;

    case 'wait':
      await executeWait(action, page);
      break;

    case 'upload':
      await executeUpload(action, page, timeout);
      break;

    case 'drag':
      await executeDrag(action, page);
      break;

    case 'navigate':
      await executeNavigate(action, page, timeout);
      break;

    case 'extract':
      result.output = await executeExtract(action, page);
      break;

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }

  return result;
}

/**
 * Action executors
 */

async function executeClick(action, page, timeout) {
  const selector = action.selector.value || action.selector.primary || action.selector;

  try {
    await page.waitForSelector(selector, { timeout, visible: true });
    await page.click(selector);

    // Smart waiting after click
    if (action.data.requiresWait !== false) {
      await smartWaitAfterClick(page, action, timeout);
    }

    // Additional wait if specified
    if (action.data.waitAfter) {
      await new Promise(resolve => setTimeout(resolve, action.data.waitAfter));
    }
  } catch (error) {
    throw new Error(`Failed to click "${selector}": ${error.message}`);
  }
}

/**
 * Smart waiting after click - waits for animations and network requests
 */
async function smartWaitAfterClick(page, action, timeout) {
  const minWaitTime = 2000; // Minimum 2 seconds
  const startTime = Date.now();

  // Wait minimum time (2 seconds)
  await new Promise(resolve => setTimeout(resolve, minWaitTime));

  const maxWaitTime = timeout || 30000;
  const endTime = startTime + maxWaitTime;

  try {
    // Wait for animations to complete
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const checkAnimations = () => {
          // Check for CSS animations/transitions
          const elements = document.querySelectorAll('*');
          let hasAnimations = false;

          for (const el of elements) {
            const computedStyle = window.getComputedStyle(el);
            const animations = computedStyle.getPropertyValue('animation-name');
            const transitions = computedStyle.getPropertyValue('transition-property');

            if ((animations && animations !== 'none') ||
                (transitions && transitions !== 'none' && transitions !== 'all')) {
              hasAnimations = true;
              break;
            }
          }

          if (!hasAnimations) {
            resolve();
          } else {
            setTimeout(checkAnimations, 100);
          }
        };

        // Start checking after a short delay
        setTimeout(checkAnimations, 100);
        // Timeout after 3 seconds
        setTimeout(resolve, 3000);
      });
    });

    // Wait for network to be idle (no pending requests for 500ms)
    await Promise.race([
      page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }),
      new Promise(resolve => setTimeout(resolve, 5000)) // Max 5 seconds for network
    ]);

    // Wait for any DOM changes to settle
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let timeoutId;
        const observer = new MutationObserver(() => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 300); // 300ms of no DOM changes
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'disabled']
        });

        // Start the timeout
        timeoutId = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 300);

        // Max wait 3 seconds
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 3000);
      });
    });

  } catch (error) {
    // If smart wait fails, just log and continue
    console.error('[Smart Wait] Error during smart wait:', error.message);
  }

  // Ensure we don't exceed max wait time
  const elapsed = Date.now() - startTime;
  if (elapsed > maxWaitTime) {
    console.warn(`[Smart Wait] Exceeded max wait time (${maxWaitTime}ms)`);
  }
}

async function executeType(action, page, timeout) {
  const selector = action.selector.value || action.selector.primary || action.selector;

  try {
    await page.waitForSelector(selector, { timeout, visible: true });

    // Check if element is editable
    const isEditable = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;

      const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
      const isContentEditable = el.isContentEditable;

      return isInput || isContentEditable;
    }, selector);

    if (!isEditable) {
      throw new Error(`Element "${selector}" is not editable (not an input, textarea, or contenteditable)`);
    }

    // Clear field if specified
    if (action.data.clearFirst !== false) {
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press('Backspace');
    }

    // Type text with optional delay
    await page.type(selector, action.data.text, {
      delay: action.data.delay || 0
    });
  } catch (error) {
    throw new Error(`Failed to type into "${selector}": ${error.message}`);
  }
}

async function executeSelect(action, page, timeout) {
  const selector = action.selector.value || action.selector.primary || action.selector;

  try {
    if (action.data.selectType === 'custom') {
      // Custom select (multi-step)
      for (const step of action.data.steps) {
        if (step.action === 'click') {
          await page.waitForSelector(step.selector, { timeout });
          await page.click(step.selector);
        } else if (step.action === 'wait') {
          await new Promise(resolve => setTimeout(resolve, step.duration));
        }
      }
    } else {
      // Native select
      await page.waitForSelector(selector, { timeout, visible: true });

      // Verify it's a select element
      const isSelect = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el && el.tagName === 'SELECT';
      }, selector);

      if (!isSelect) {
        throw new Error(`Element "${selector}" is not a <select> element`);
      }

      await page.select(selector, action.data.value);
    }
  } catch (error) {
    throw new Error(`Failed to select option in "${selector}": ${error.message}`);
  }
}

async function executeScroll(action, page) {
  const selector = action.selector.value || action.selector.primary || action.selector;
  await page.evaluate((selector, behavior) => {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ behavior: behavior || 'auto', block: 'center' });
    }
  }, selector, action.data.behavior);
}

async function executeHover(action, page) {
  const selector = action.selector.value || action.selector.primary || action.selector;
  await page.hover(selector);
}

async function executeKeypress(action, page) {
  const key = action.data.key;
  const modifiers = action.data.modifiers || [];

  // Press modifiers
  for (const mod of modifiers) {
    await page.keyboard.down(mod);
  }

  // Press key
  await page.keyboard.press(key);

  // Release modifiers
  for (const mod of modifiers.reverse()) {
    await page.keyboard.up(mod);
  }
}

async function executeWait(action, page) {
  if (action.data.waitType === 'selector') {
    await page.waitForSelector(action.data.selector, {
      timeout: action.data.duration
    });
  } else {
    await new Promise(resolve => setTimeout(resolve, action.data.duration));
  }
}

async function executeUpload(action, page, timeout) {
  const selector = action.selector.value || action.selector.primary || action.selector;
  const fileInput = await page.waitForSelector(selector, { timeout });
  await fileInput.uploadFile(action.data.filePath);
}

async function executeDrag(action, page) {
  const { fromSelector, toSelector, fromX, fromY, toX, toY } = action.data;

  if (fromSelector && toSelector) {
    // Drag from element to element
    const from = await page.$(fromSelector);
    const to = await page.$(toSelector);

    const fromBox = await from.boundingBox();
    const toBox = await to.boundingBox();

    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2);
    await page.mouse.up();
  } else {
    // Drag by coordinates
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY);
    await page.mouse.up();
  }
}

async function executeNavigate(action, page, timeout) {
  await page.goto(action.data.url, {
    waitUntil: action.data.waitUntil || 'networkidle2',
    timeout
  });
}

async function executeExtract(action, page) {
  const { selector, attribute, multiple } = action.data;

  if (multiple) {
    return await page.$$eval(selector, (elements, attr) => {
      return elements.map(el => attr ? el.getAttribute(attr) : el.textContent.trim());
    }, attribute);
  } else {
    return await page.$eval(selector, (el, attr) => {
      return attr ? el.getAttribute(attr) : el.textContent.trim();
    }, attribute);
  }
}

/**
 * Substitute parameters in action
 * Replaces {{paramName}} with actual values
 */
function substituteParameters(action, params) {
  const resolved = JSON.parse(JSON.stringify(action));

  // Substitute in action data
  if (resolved.data) {
    for (const [key, value] of Object.entries(resolved.data)) {
      if (typeof value === 'string') {
        resolved.data[key] = substituteString(value, params);
      }
    }
  }

  return resolved;
}

/**
 * Substitute {{param}} in string
 */
function substituteString(str, params) {
  return str.replace(/\{\{(\w+)\}\}/g, (match, paramName) => {
    if (params[paramName] !== undefined) {
      return params[paramName];
    }
    return match; // Keep original if param not found
  });
}

/**
 * Element finder utils code (to be injected into page)
 * Will be loaded from utils/element-finder-utils.js
 */
const elementFinderUtilsCode = `
// This will be populated from element-finder-utils.js browser-side code
// For now, placeholder
`;

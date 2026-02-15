/**
 * Check Action Handler
 * Handles check, uncheck, toggle actions for checkboxes and radio buttons
 */

/**
 * Execute check/uncheck/toggle action
 * @param {Page} page - Puppeteer page
 * @param {ElementHandle} element - Target element
 * @param {string} action - Action name: 'check', 'uncheck', 'toggle', or 'select' (for radio)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Result with content array (same format as other handlers)
 */
export async function executeCheckAction(page, element, action = 'check', options = {}) {
  const { identifier = 'element' } = options;

  await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

  // Read current state
  const isChecked = await element.evaluate(el => el.checked);

  // Determine if click is needed
  let shouldClick = true;
  if (action === 'check' && isChecked) {
    shouldClick = false;
  } else if (action === 'uncheck' && !isChecked) {
    shouldClick = false;
  }
  // 'toggle' and 'select' always click

  if (shouldClick) {
    // Click with timeout + JS fallback
    const clickWithTimeout = async (timeoutMs = 5000) => {
      const withTimeout = (promise) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('click timeout')), timeoutMs))
      ]);

      try {
        await withTimeout(element.click());
      } catch (e) {
        // Fallback to JS click
        await element.evaluate(el => el.click());
      }
    };

    await clickWithTimeout();
  }

  // Read final state
  const finalState = await element.evaluate(el => el.checked);
  const stateStr = finalState ? 'checked' : 'unchecked';
  const actionStr = shouldClick ? action : `${action} (already ${stateStr})`;

  return {
    content: [
      { type: "text", text: `${actionStr}: ${identifier} → ${stateStr}` }
    ]
  };
}

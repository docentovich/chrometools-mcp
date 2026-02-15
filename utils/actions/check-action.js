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
  console.log('[executeCheckAction] Called with action:', action, 'element:', !!element, 'page:', !!page);

  // Scroll element into view first
  await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

  // Click with timeout
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

  return {
    content: [
      { type: "text", text: `Clicked checkbox (action: ${action})` }
    ]
  };
}

/**
 * DatePicker Action Handler
 * Generic handler for date picker components — finds inner input and types the value.
 * Covers flatpickr, pikaday, and other simple date pickers.
 */

/**
 * Execute date picker action (SetDate, SetDateTime, SetTime, clear)
 * @param {Page} page - Puppeteer page
 * @param {ElementHandle} element - Target date picker element (container or input)
 * @param {string} action - Action name: 'SetDate', 'SetDateTime', 'SetTime', 'clear'
 * @param {Object} params - Action parameters
 * @param {string} [params.date] - Date value for SetDate
 * @param {string} [params.datetime] - DateTime value for SetDateTime
 * @param {string} [params.time] - Time value for SetTime
 * @param {string} [params.identifier] - Element identifier for output message
 * @returns {Promise<Object>} Result with content array
 */
export async function executeDatePickerAction(page, element, action, params = {}) {
  const identifier = params.identifier || 'DatePicker';

  // Find inner input (date pickers often wrap an input in a container)
  const input = await element.$('input') || element;

  if (action === 'SetDate' || action === 'SetDateTime' || action === 'SetTime') {
    const value = params.date || params.datetime || params.time || '';
    if (!value) {
      throw new Error(`Missing date/time value for ${action}`);
    }

    // Select all existing text and replace with new value
    await input.click({ clickCount: 3 });
    await input.type(value, { delay: 30 });

    // Dispatch change event for framework reactivity
    await input.evaluate(el => {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    });

    return {
      content: [{ type: "text", text: `${action}: "${value}" in ${identifier}` }]
    };
  }

  if (action === 'clear') {
    await input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');

    await input.evaluate(el => {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    });

    return {
      content: [{ type: "text", text: `Cleared ${identifier}` }]
    };
  }

  throw new Error(`Unknown DatePicker action: ${action}`);
}

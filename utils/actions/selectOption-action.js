/**
 * SelectOption Action Handler
 */

import { runPostClickDiagnostics, formatDiagnosticsForAI } from '../post-click-diagnostics.js';

/**
 * Execute selectOption action on select element
 *
 * @param {Page} page - Puppeteer page instance
 * @param {ElementHandle} element - Target select element
 * @param {Object} params - Selection parameters
 * @param {string} params.value - Option value to select
 * @param {string} params.text - Option text to select
 * @param {number} params.index - Option index to select
 * @param {Object} options - Action options
 * @param {string} options.identifier - Element identifier (for output message)
 * @returns {Promise<Object>} Result with content array
 */
export async function executeSelectOptionAction(page, element, params, options = {}) {
  const { identifier = 'element' } = options;
  const { value, text, index } = params;

  // Scroll to element to ensure it's in viewport
  await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

  // Priority: value > text > index
  let selectedValue;
  if (value !== undefined) {
    await element.select(value);
    selectedValue = value;
  } else if (text !== undefined) {
    // Find option by text
    selectedValue = await element.evaluate((el, searchText) => {
      const option = Array.from(el.options).find(opt =>
        opt.textContent.trim() === searchText
      );
      if (option) {
        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return option.value;
      }
      return null;
    }, text);

    if (!selectedValue) {
      throw new Error(`Option with text "${text}" not found`);
    }
  } else if (index !== undefined) {
    selectedValue = await element.evaluate((el, idx) => {
      if (idx < 0 || idx >= el.options.length) {
        throw new Error(`Index ${idx} out of range`);
      }
      el.selectedIndex = idx;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    }, index);
  } else {
    throw new Error('Must specify value, text, or index');
  }

  // Capture timestamp AFTER selection - requests should start within 200ms
  const afterSelectTimestamp = Date.now();

  // Run diagnostics (shorter timeout for select)
  const diagnostics = await runPostClickDiagnostics(page, afterSelectTimestamp, {
    networkWaitTimeout: 3000
  });
  const diagnosticsText = formatDiagnosticsForAI(diagnostics);

  return {
    content: [
      { type: "text", text: `Selected option in ${identifier}${diagnosticsText}` }
    ]
  };
}

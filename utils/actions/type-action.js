/**
 * Type Action Handler
 * Extracted from index.js type tool for reuse in executeModelAction
 */

import { getInputModel } from '../../models/puppeteer-models.js';
import { runPostClickDiagnostics, formatDiagnosticsForAI } from '../post-click-diagnostics.js';

/**
 * Execute type action on input element
 *
 * @param {Page} page - Puppeteer page instance
 * @param {ElementHandle} element - Target input element
 * @param {string} text - Text to type
 * @param {Object} options - Type options
 * @param {string} options.identifier - Element identifier (for output message)
 * @param {number} options.delay - Delay between keystrokes in ms
 * @param {boolean} options.clearFirst - Clear field before typing
 * @returns {Promise<Object>} Result with content array
 */
export async function executeTypeAction(page, element, text, options = {}) {
  const {
    identifier = 'element',
    delay = 30,
    clearFirst = true
  } = options;

  // ALWAYS scroll to element first to ensure it's in viewport
  await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await new Promise(resolve => setTimeout(resolve, 100));

  // Use input model to handle the element appropriately
  const model = await getInputModel(element, page);
  const modelOptions = {
    delay,
    clearFirst
  };

  await model.setValue(text, modelOptions);
  const description = model.getActionDescription(text, identifier);

  // Capture timestamp AFTER typing finishes - requests should start within 200ms of this
  const afterTypeTimestamp = Date.now();

  // Run diagnostics with 3s timeout for type (shorter than click's 10s)
  const diagnostics = await runPostClickDiagnostics(page, afterTypeTimestamp, {
    networkWaitTimeout: 3000
  });
  const diagnosticsText = formatDiagnosticsForAI(diagnostics);

  return {
    content: [
      { type: "text", text: `${description}${diagnosticsText}` }
    ]
  };
}

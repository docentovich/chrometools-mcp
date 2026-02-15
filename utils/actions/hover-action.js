/**
 * Hover Action Handler
 */

/**
 * Execute hover action on element
 *
 * @param {Page} page - Puppeteer page instance
 * @param {ElementHandle} element - Target element
 * @param {Object} options - Hover options
 * @param {string} options.identifier - Element identifier (for output message)
 * @returns {Promise<Object>} Result with content array
 */
export async function executeHoverAction(page, element, options = {}) {
  const { identifier = 'element' } = options;

  // Scroll to element to ensure it's in viewport
  await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

  // Hover using Puppeteer (triggers mouse events properly)
  await element.hover();

  return {
    content: [
      { type: "text", text: `Hovered over: ${identifier}` }
    ]
  };
}

/**
 * Screenshot Action Handler
 */

/**
 * Execute screenshot action on element
 *
 * @param {Page} page - Puppeteer page instance
 * @param {ElementHandle} element - Target element
 * @param {Object} options - Screenshot options
 * @param {string} options.identifier - Element identifier (for output message)
 * @returns {Promise<Object>} Result with content array (text + image)
 */
export async function executeScreenshotAction(page, element, options = {}) {
  const { identifier = 'element' } = options;

  // Scroll to element to ensure it's in viewport
  await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

  // Capture element screenshot
  const screenshot = await element.screenshot({ encoding: 'base64' });

  return {
    content: [
      { type: "text", text: `Screenshot of: ${identifier}` },
      { type: "image", data: screenshot, mimeType: "image/png" }
    ]
  };
}

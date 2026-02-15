/**
 * ScrollTo Action Handler
 */

/**
 * Execute scrollTo action on element
 *
 * @param {Page} page - Puppeteer page instance
 * @param {ElementHandle} element - Target element
 * @param {Object} options - ScrollTo options
 * @param {string} options.identifier - Element identifier (for output message)
 * @param {string} options.behavior - Scroll behavior: 'auto' or 'smooth' (default: 'auto')
 * @returns {Promise<Object>} Result with content array
 */
export async function executeScrollToAction(page, element, options = {}) {
  const { identifier = 'element', behavior = 'auto' } = options;

  // Scroll to element
  await element.evaluate((el, b) => {
    el.scrollIntoView({ behavior: b, block: 'center' });
  }, behavior);

  // Wait for scroll to complete
  await new Promise(resolve => setTimeout(resolve, 500));

  const position = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY
  }));

  return {
    content: [
      { type: "text", text: `Scrolled to ${identifier} (position: ${position.x}, ${position.y})` }
    ]
  };
}

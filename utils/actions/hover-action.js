/**
 * Hover Action Handler
 */

/**
 * Execute hover action on element
 *
 * Uses Puppeteer's element.hover() with timeout fallback to JS mouse events.
 * element.hover() can hang at CDP level in some browser states, so a 5s
 * timeout ensures the operation always completes.
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

  // Hover with timeout + JS fallback (same pattern as click's 3-tier strategy)
  const hoverTimeout = 5000;

  try {
    // Tier 1: Puppeteer native hover (trusted CDP mouse events)
    await Promise.race([
      element.hover(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('hover timeout')), hoverTimeout))
    ]);
  } catch (e) {
    // Tier 2: CDP coordinate-based mouse move
    try {
      const box = await element.boundingBox();
      if (box) {
        await Promise.race([
          page.mouse.move(box.x + box.width / 2, box.y + box.height / 2),
          new Promise((_, reject) => setTimeout(() => reject(new Error('mouse.move timeout')), hoverTimeout))
        ]);
      } else {
        throw new Error('no bounding box');
      }
    } catch (e2) {
      // Tier 3: JS event dispatch (untrusted, last resort)
      await element.evaluate(el => {
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
      });
    }
  }

  // Wait for hover effects to apply (CSS transitions, tooltips, etc.)
  await new Promise(resolve => setTimeout(resolve, 100));

  return {
    content: [
      { type: "text", text: `Hovered over: ${identifier}` }
    ]
  };
}

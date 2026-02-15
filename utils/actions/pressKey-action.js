/**
 * PressKey Action Handler
 */

/**
 * Execute key press action, optionally on a specific element
 *
 * Uses Puppeteer's page.keyboard API for trusted key events.
 * If element is provided, focuses it first. Otherwise presses on current focus.
 *
 * @param {Page} page - Puppeteer page instance
 * @param {ElementHandle|null} element - Target element to focus (optional)
 * @param {Object} options - PressKey options
 * @param {string} options.key - Key to press (e.g., 'Enter', 'Escape', 'Tab')
 * @param {string[]} [options.modifiers] - Modifier keys to hold (e.g., ['Control', 'Shift'])
 * @param {string} [options.identifier] - Element identifier (for output message)
 * @returns {Promise<Object>} Result with content array
 */
export async function executePressKeyAction(page, element, options = {}) {
  const { key, modifiers = [], identifier } = options;

  // Focus element if provided
  if (element) {
    await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
    await element.evaluate(el => el.focus());
  }

  // Hold modifier keys
  for (const mod of modifiers) {
    await page.keyboard.down(mod);
  }

  // Press key
  await page.keyboard.press(key);

  // Release modifiers (reverse order)
  for (const mod of [...modifiers].reverse()) {
    await page.keyboard.up(mod);
  }

  const modStr = modifiers.length > 0 ? modifiers.join('+') + '+' : '';
  const target = identifier ? ` on ${identifier}` : '';
  return {
    content: [
      { type: "text", text: `Pressed ${modStr}${key}${target}` }
    ]
  };
}

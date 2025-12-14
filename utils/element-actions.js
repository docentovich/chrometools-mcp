// Helper function to execute actions on elements
export async function executeElementAction(page, selector, action) {
  if (!action || !action.type) {
    return null;
  }

  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Element not found for action: ${selector}`);
  }

  const result = {
    action: action.type,
    selector,
    success: true,
  };

  switch (action.type) {
    case 'click':
      await element.click();
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 1500));
      result.message = `Clicked on ${selector}`;

      if (action.screenshot) {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        result.screenshot = screenshot;
      }
      break;

    case 'type':
      if (!action.text) {
        throw new Error('text parameter is required for type action');
      }
      await element.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await element.type(action.text, { delay: 0 });
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 500));
      result.message = `Typed "${action.text}" into ${selector}`;

      if (action.screenshot) {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        result.screenshot = screenshot;
      }
      break;

    case 'scrollTo':
      await element.scrollIntoView({ behavior: 'auto' });
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 300));
      const position = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY
      }));
      result.message = `Scrolled to ${selector}`;
      result.position = position;
      break;

    case 'screenshot':
      const box = await element.boundingBox();
      if (!box) {
        throw new Error(`Element not visible: ${selector}`);
      }
      const clip = {
        x: Math.max(box.x, 0),
        y: Math.max(box.y, 0),
        width: Math.max(box.width, 1),
        height: Math.max(box.height, 1)
      };
      const screenshot = await page.screenshot({ clip, encoding: 'base64' });
      result.message = `Captured screenshot of ${selector}`;
      result.screenshot = screenshot;
      break;

    case 'hover':
      await element.hover();
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 100));
      result.message = `Hovered over ${selector}`;

      if (action.screenshot) {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        result.screenshot = screenshot;
      }
      break;

    case 'setStyles':
      if (!action.styles || !Array.isArray(action.styles)) {
        throw new Error('styles parameter is required for setStyles action');
      }
      const stylesObject = {};
      for (const style of action.styles) {
        stylesObject[style.name] = style.value;
      }
      await page.evaluate((sel, styles) => {
        const el = document.querySelector(sel);
        if (el) {
          Object.entries(styles).forEach(([key, value]) => {
            el.style.setProperty(key, value);
          });
        }
      }, selector, stylesObject);
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 100));
      result.message = `Applied styles to ${selector}`;

      if (action.screenshot) {
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
        result.screenshot = screenshot;
      }
      break;

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }

  return result;
}

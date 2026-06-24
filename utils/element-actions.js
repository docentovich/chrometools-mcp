import { processScreenshot } from './screenshot-processor.js';

// Lightweight action screenshot: small JPEG for confirming actions worked
// These are "report" screenshots, not for detailed analysis
async function takeActionScreenshot(page, clip) {
  const screenshotBuffer = await page.screenshot({
    encoding: 'binary',
    fullPage: false,
    ...(clip ? { clip } : {})
  });
  const processed = await processScreenshot(screenshotBuffer, {
    maxWidth: 800,
    maxHeight: 4000,
    quality: 40,
    format: 'jpeg',
  });
  return {
    data: processed.buffer.toString('base64'),
    mimeType: processed.mimeType,
  };
}

// Helper function to execute actions on elements.
// `frame` (P0-1) is the DOM context used for element resolution/evaluation —
// pass the active iframe's Frame to act inside it. Defaults to `page` (main frame).
// Page-level operations (keyboard, screenshot) always use `page`.
export async function executeElementAction(page, selector, action, frame = page) {
  if (!action || !action.type) {
    return null;
  }

  const element = await frame.$(selector);
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
      // Scroll element into view first (direct JS, avoids Puppeteer's scrollIntoViewIfNeeded hang)
      await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

      // Click with timeout + JS fallback (Puppeteer's click can hang in complex layouts)
      try {
        await Promise.race([
          element.click(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('click timeout')), 5000))
        ]);
      } catch (e) {
        // Fallback to JS click (bypasses Puppeteer's coordinate-based click)
        await element.evaluate(el => el.click());
      }

      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 1500));
      result.message = `Clicked on ${selector}`;

      if (action.screenshot) {
        const { data, mimeType } = await takeActionScreenshot(page);
        result.screenshot = data;
        result.screenshotMimeType = mimeType;
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
        const { data, mimeType } = await takeActionScreenshot(page);
        result.screenshot = data;
        result.screenshotMimeType = mimeType;
      }
      break;

    case 'scrollTo':
      await element.scrollIntoView({ behavior: 'auto' });
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 300));
      const position = await frame.evaluate(() => ({
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
      const { data: screenshotData, mimeType: screenshotMime } = await takeActionScreenshot(page, clip);
      result.message = `Captured screenshot of ${selector}`;
      result.screenshot = screenshotData;
      result.screenshotMimeType = screenshotMime;
      break;

    case 'hover':
      await element.hover();
      await new Promise(resolve => setTimeout(resolve, action.waitAfter || 100));
      result.message = `Hovered over ${selector}`;

      if (action.screenshot) {
        const { data, mimeType } = await takeActionScreenshot(page);
        result.screenshot = data;
        result.screenshotMimeType = mimeType;
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
      await frame.evaluate((sel, styles) => {
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
        const { data, mimeType } = await takeActionScreenshot(page);
        result.screenshot = data;
        result.screenshotMimeType = mimeType;
      }
      break;

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }

  return result;
}

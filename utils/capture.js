/**
 * utils/capture.js
 *
 * Screenshots wait for Chrome to render a frame. A minimized window or a
 * background tab renders nothing, so the capture would hang until the MCP
 * client gives up. capture() makes the tab renderable first and bounds the wait.
 */

import { ensureViewport } from '../browser/page-manager.js';

const CAPTURE_TIMEOUT_MS = Number(process.env.CHROMETOOLS_CAPTURE_TIMEOUT_MS) || 15000;
const STEP_TIMEOUT_MS = 2000;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Restore a minimized window and bring a hidden tab to front.
 * Best effort: never throws.
 * @param {import('puppeteer').Page} page
 */
export async function prepareForCapture(page) {
  try {
    const session = await page.browser().target().createCDPSession();
    try {
      const { windowId, bounds } = await withTimeout(
        session.send('Browser.getWindowForTarget', { targetId: page.target()._targetId }),
        STEP_TIMEOUT_MS, 'getWindowForTarget timeout');
      if (bounds?.windowState === 'minimized') {
        await withTimeout(session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }),
          STEP_TIMEOUT_MS, 'setWindowBounds timeout');
      }
    } finally {
      await session.detach().catch(() => {});
    }
  } catch {
    // Not available (e.g. some remote browsers): rely on bringToFront below
  }

  const visibility = () => withTimeout(page.evaluate(() => document.visibilityState), STEP_TIMEOUT_MS, 'timeout')
    .catch(() => null);
  if (await visibility() === 'visible') return;

  await withTimeout(page.bringToFront(), STEP_TIMEOUT_MS, 'timeout').catch(() => {});
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await visibility() === 'visible') return;
    await sleep(100);
  }
}

/**
 * Run a screenshot function after making the tab renderable, with a timeout.
 * @param {import('puppeteer').Page} page
 * @param {() => Promise<any>} fn - e.g. () => page.screenshot(...)
 */
export async function capture(page, fn) {
  await prepareForCapture(page);
  // A screenshot at the wrong viewport is useless for layout checks
  await ensureViewport(page);
  return withTimeout(fn(), CAPTURE_TIMEOUT_MS,
    `Screenshot timed out after ${CAPTURE_TIMEOUT_MS}ms: Chrome is not rendering this tab. ` +
    'Make sure the Chrome window is not minimized and the tab is visible, then retry.');
}

/**
 * Hide elements (visibility: hidden, layout kept) while fn runs: widgets such as a
 * chat button or cookie banner that cover the layout in screenshots.
 * @param {import('puppeteer').Page} page
 * @param {string[]|undefined} selectors
 * @param {() => Promise<any>} fn
 */
export async function withHiddenElements(page, selectors, fn) {
  if (!selectors || !selectors.length) return fn();
  const id = `__ct_hide_${Date.now()}`;
  const invalid = await page.evaluate((styleId, sels) => {
    const bad = [];
    const ok = sels.filter(sel => { try { document.querySelector(sel); return true; } catch (e) { bad.push(sel); return false; } });
    const st = document.createElement('style');
    st.id = styleId;
    st.textContent = ok.map(sel => `${sel} { visibility: hidden !important; }`).join('\n');
    document.documentElement.appendChild(st);
    return bad;
  }, id, selectors);
  if (invalid.length) {
    await page.evaluate(styleId => document.getElementById(styleId)?.remove(), id).catch(() => {});
    throw new Error(`Invalid hideSelectors: ${invalid.join(', ')}`);
  }
  try {
    return await fn();
  } finally {
    await page.evaluate(styleId => document.getElementById(styleId)?.remove(), id).catch(() => {});
  }
}

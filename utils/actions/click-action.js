/**
 * Click Action Handler
 * Extracted from index.js click tool for reuse in executeModelAction
 */

import { runPostClickDiagnostics, formatDiagnosticsForAI } from '../post-click-diagnostics.js';
import { generateClickHints } from '../hints-generator.js';
import { processScreenshot } from '../screenshot-processor.js';

/**
 * Execute click action on element with adaptive strategy
 *
 * @param {Page} page - Puppeteer page instance
 * @param {ElementHandle} element - Target element to click
 * @param {Object} options - Click options
 * @param {string} options.identifier - Element identifier (for output message)
 * @param {boolean} options.screenshot - Whether to capture screenshot after click
 * @param {boolean} options.skipNetworkWait - Skip waiting for network requests
 * @param {number} options.networkWaitTimeout - Network wait timeout in ms
 * @param {string} options.waitForSelector - CSS selector to wait for after click (e.g., dropdown menu opening)
 * @param {number} options.waitTimeoutMs - Timeout for waitForSelector in ms (default: 2000)
 * @returns {Promise<Object>} Result with content array
 */
export async function executeClickAction(page, element, options = {}) {
  const {
    identifier = 'element',
    screenshot = false,
    skipNetworkWait = false,
    networkWaitTimeout = 3000,
    waitForSelector = null,
    waitTimeoutMs = 2000,
    waitForRouteChange = false
  } = options;

  // Capture timestamp and URL BEFORE click for diagnostics
  const beforeClickTimestamp = Date.now();
  const urlBeforeClick = page.url();

  // ALWAYS scroll to element first to ensure it's in viewport
  await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

  // Click with adaptive fallback strategy:
  //
  // Pre-check: elementFromPoint() determines if element is the topmost at its center.
  // This decides the click path — Puppeteer's click() doesn't always throw on interception.
  //
  // Path A (element covered by another, e.g. small button under <a routerLink>):
  //   → Full DOM event sequence — bypasses coordinate hit-testing, fires pointer+mouse+click
  //
  // Path B (element is topmost — normal case):
  //   Tier 1: Puppeteer native click (trusted CDP events)
  //   Tier 2: page.mouse.click at coordinates (trusted CDP, no interception check)
  //   Tier 3: Full DOM event sequence (untrusted, last resort)
  //   Trusted CDP events (Tier 1 & 2) are critical for Angular/Zone.js apps where
  //   untrusted .click() triggers change detection mid-dispatch, destroying *ngFor elements.
  let clickMethod = 'unknown';

  const clickWithTimeout = async (timeoutMs = 5000) => {
    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('click timeout')), timeoutMs))
    ]);

    // Pre-check: is another element covering our target at its center coordinates?
    const intercepted = await element.evaluate(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      // topEl is our element or a child of it — not intercepted
      return topEl !== el && !el.contains(topEl);
    });

    if (intercepted) {
      // Path A: Element is covered (e.g., small button under <a routerLink>)
      // Coordinate clicks would hit the covering element — dispatch full event sequence
      // directly on the element to bypass hit-testing while still triggering framework handlers
      clickMethod = 'dom-sequence-intercepted';
      await element.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const common = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
        const pOpts = { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', pOpts));
        el.dispatchEvent(new MouseEvent('mousedown', common));
        if (el.focus) el.focus();
        el.dispatchEvent(new PointerEvent('pointerup', pOpts));
        el.dispatchEvent(new MouseEvent('mouseup', common));
        el.dispatchEvent(new MouseEvent('click', common));
      });
      return;
    }

    // Path B: Element is topmost — use trusted CDP events
    // Tier 1: Puppeteer native click
    try {
      await withTimeout(element.click());
      clickMethod = 'puppeteer-native';
      return;
    } catch (e) { /* fall through to Tier 2 */ }

    // Tier 2: CDP coordinate click — trusted events, bypasses Puppeteer's own checks
    try {
      const box = await element.boundingBox();
      if (box) {
        await withTimeout(page.mouse.click(box.x + box.width / 2, box.y + box.height / 2));
        clickMethod = 'cdp-coordinates';
        return;
      }
    } catch (e) { /* fall through to Tier 3 */ }

    // Tier 3: Full DOM event sequence — untrusted, last resort
    // Dispatches pointer+mouse+click events for compatibility with UI frameworks
    // that rely on the full browser event sequence (e.g., components with pressed states)
    clickMethod = 'dom-sequence-fallback';
    await element.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const common = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      const pOpts = { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', pOpts));
      el.dispatchEvent(new MouseEvent('mousedown', common));
      if (el.focus) el.focus();
      el.dispatchEvent(new PointerEvent('pointerup', pOpts));
      el.dispatchEvent(new MouseEvent('mouseup', common));
      el.dispatchEvent(new MouseEvent('click', common));
    });
  };

  await clickWithTimeout();

  // Atomic click + wait: if caller asked to wait for a selector to appear after click,
  // do it BEFORE diagnostics. Useful for dropdowns/popups that render into a portal —
  // without atomic wait, the next MCP call may race against the popup closing.
  let waitResult = null;
  if (waitForSelector) {
    const waitStart = Date.now();
    try {
      await page.waitForSelector(waitForSelector, { timeout: waitTimeoutMs, visible: true });
      waitResult = { appeared: true, selector: waitForSelector, appearedInMs: Date.now() - waitStart };
    } catch (e) {
      waitResult = {
        appeared: false,
        selector: waitForSelector,
        timedOutAfterMs: Date.now() - waitStart,
        timeoutMs: waitTimeoutMs
      };
    }
  }

  // SPA route-change wait (P1-5): SPAs navigate via history.pushState, so page.url()
  // diagnostics below may not register a "navigation". Wait for location.pathname+search
  // to actually change relative to before. Best-effort — a timeout never fails the click.
  let routeChangeResult = null;
  if (waitForRouteChange) {
    let pathBefore;
    try {
      pathBefore = await page.evaluate(() => location.pathname + location.search);
    } catch (e) {
      pathBefore = null;
    }
    if (pathBefore !== null) {
      const routeStart = Date.now();
      try {
        await page.waitForFunction(
          (before) => (location.pathname + location.search) !== before,
          { timeout: waitTimeoutMs },
          pathBefore
        );
        const pathAfter = await page.evaluate(() => location.pathname + location.search);
        routeChangeResult = { routeChanged: true, from: pathBefore, to: pathAfter, changedInMs: Date.now() - routeStart };
      } catch (e) {
        routeChangeResult = { routeChanged: false, from: pathBefore, timeoutMs: waitTimeoutMs };
      }
    }
  }

  // Check if element was detached from DOM during click (Angular *ngFor + Zone.js pattern)
  let elementDetached = false;
  try {
    elementDetached = await element.evaluate(el => !el.parentNode);
  } catch (e) {
    // Element handle may be invalid if page navigated — not a detachment issue
  }

  // NEW POST-CLICK PATTERN:
  // 1. Run post-click diagnostics (waits for network requests within 200ms, max 10s timeout)
  let diagnostics;
  try {
    diagnostics = await runPostClickDiagnostics(page, beforeClickTimestamp, {
      skipNetworkWait,
      networkWaitTimeout,
      urlBeforeAction: urlBeforeClick
    });
  } catch (diagError) {
    // Diagnostics may fail if page navigated - create minimal diagnostics
    diagnostics = {
      networkActivity: { trackedRequests: [], bridgeRequests: [], stillPending: 0, pendingRequests: [] },
      navigation: { from: urlBeforeClick, to: page.url(), likelyFormSubmit: true },
      errors: { consoleErrors: [], networkErrors: [], totalErrors: 0 },
      hasErrors: false
    };
  }

  // 2. Generate AI hints after click
  let hints;
  try {
    hints = await generateClickHints(page, identifier);
  } catch (hintsError) {
    hints = { modalOpened: false, newElements: [], suggestedNext: [] };
  }

  // 3. Format output with hints and diagnostics
  let hintsText = '\n\n** AI HINTS **';

  // Modal: show title, body text, and actions
  if (hints.modalOpened && hints.newElements.some(e => e.type === 'modal')) {
    const modal = hints.newElements.find(e => e.type === 'modal');
    let modalText = 'Modal opened';
    if (modal.title) modalText += `: "${modal.title}"`;
    if (modal.text) modalText += `\n  ${modal.text}`;
    if (modal.actions?.length) modalText += `\n  Actions: [${modal.actions.join('] [')}]`;
    hintsText += '\n' + modalText;
  } else if (hints.modalOpened) {
    hintsText += '\nModal opened - interact with it or close';
  }

  // Overlay: show items
  const overlay = hints.newElements.find(e => e.type === 'dropdown' || e.type === 'menu');
  if (overlay?.items?.length) {
    const label = overlay.type === 'menu' ? 'Menu' : 'Dropdown';
    hintsText += `\n${label} with ${overlay.totalCount} options: ${overlay.items.join(', ')}`;
  }

  // Other new elements (alerts, etc.)
  const otherElements = hints.newElements.filter(e => e.type !== 'modal' && e.type !== 'dropdown' && e.type !== 'menu');
  if (otherElements.length > 0) {
    hintsText += `\nNew elements appeared: ${otherElements.map(e => e.text ? `${e.type}: ${e.text}` : e.type).join(', ')}`;
  }

  // Auth redirect after click (session expired, protected route)
  if (hints.authRedirect) {
    hintsText += '\n⚠️ AUTH REDIRECT: Landed on login page. Session may have expired.';
  }

  // Element detached during click (Angular *ngFor + Zone.js)
  // This is NORMAL for Angular apps: click fires → handler runs → Zone.js triggers
  // change detection → *ngFor recreates elements → original handle is detached.
  // The click DID work — detachment is a consequence of successful state change.
  if (elementDetached) {
    hintsText += '\nNote: Element was re-rendered after click (Angular change detection). Click was successful — use analyzePage to see updated state.';
  }

  if (hints.suggestedNext.length > 0) {
    hintsText += `\nSuggested next: ${hints.suggestedNext.join('; ')}`;
  }

  // Surface SPA route-change outcome to the caller
  if (routeChangeResult) {
    if (routeChangeResult.routeChanged) {
      hintsText += `\nRoute changed: "${routeChangeResult.from}" → "${routeChangeResult.to}" (${routeChangeResult.changedInMs}ms)`;
    } else {
      hintsText += `\n⚠️ ROUTE_UNCHANGED: location did not change within ${routeChangeResult.timeoutMs}ms after click (still "${routeChangeResult.from}"). View may render without a URL change — use waitForSelector instead.`;
    }
  }

  // Surface waitForSelector outcome to the caller (success or timeout)
  if (waitResult) {
    if (waitResult.appeared) {
      hintsText += `\nWait: "${waitResult.selector}" appeared in ${waitResult.appearedInMs}ms`;
    } else {
      hintsText += `\n⚠️ WAIT_TIMEOUT: "${waitResult.selector}" did not appear within ${waitResult.timeoutMs}ms after click`;
    }
  }

  // 4. Add diagnostics to output
  const diagnosticsText = formatDiagnosticsForAI(diagnostics);

  // Include click method in output for diagnostics (only non-default methods)
  const methodNote = clickMethod !== 'puppeteer-native' ? ` [${clickMethod}]` : '';

  const content = [
    { type: "text", text: `Clicked: ${identifier}${methodNote}${hintsText}${diagnosticsText}` }
  ];

  // Only add screenshot if requested — lightweight JPEG for action confirmation
  if (screenshot === true) {
    const screenshotBuffer = await page.screenshot({ encoding: 'binary', fullPage: false });
    const processed = await processScreenshot(screenshotBuffer, {
      maxWidth: 800,
      maxHeight: 4000,
      quality: 40,
      format: 'jpeg',
    });
    content.push({ type: "image", data: processed.buffer.toString('base64'), mimeType: processed.mimeType });
  }

  return { content };
}

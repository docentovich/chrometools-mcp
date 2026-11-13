/**
 * utils/spa-settle.js
 *
 * page.goto() on a hash route resolves at once (same-document navigation),
 * before the SPA router has rendered the new screen and set document.title.
 * waitForSpaSettle() waits until title and DOM stop changing.
 */

const SETTLE_MAX_MS = Number(process.env.CHROMETOOLS_SPA_SETTLE_MS) || 2000;
const QUIET_MS = 300;
const POLL_MS = 100;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {import('puppeteer').Page} page
 * @param {{prevTitle?: string|null, maxMs?: number}} [options]
 * @returns {Promise<{title: string, titleChanged: boolean|null, waitedMs: number}>}
 */
export async function waitForSpaSettle(page, { prevTitle = null, maxMs = SETTLE_MAX_MS } = {}) {
  const start = Date.now();

  // Mutation counter lives in the page; re-installed if a full navigation replaced the document
  const probe = () => page.evaluate(() => {
    if (!window.__ctSettle) {
      const state = { mutations: 0 };
      try {
        new MutationObserver(list => { state.mutations += list.length; })
          .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      } catch (e) { /* document not ready */ }
      window.__ctSettle = state;
    }
    return { title: document.title, mutations: window.__ctSettle.mutations };
  }).catch(() => null);

  let last = await probe();
  let stableSince = Date.now();

  while (Date.now() - start < maxMs) {
    await sleep(POLL_MS);
    const cur = await probe();
    if (!cur || !last || cur.title !== last.title || cur.mutations !== last.mutations) {
      last = cur;
      stableSince = Date.now();
      continue;
    }
    const quiet = Date.now() - stableSince >= QUIET_MS;
    // Title still equal to the old one: the router may be loading a lazy chunk, keep waiting
    const titleStillOld = prevTitle !== null && cur.title === prevTitle;
    if (quiet && !titleStillOld) break;
  }

  const title = last?.title ?? await page.title().catch(() => '');
  return {
    title,
    titleChanged: prevTitle === null ? null : title !== prevTitle,
    waitedMs: Date.now() - start
  };
}

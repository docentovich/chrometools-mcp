/**
 * utils/vault-client.js
 *
 * MCP side of the Credential Vault. Talks to the ChromeTools extension service
 * worker over CDP. Passwords stay inside the extension: these calls only send
 * a credential name + one-time marker and get back { ok, error }.
 */

import { getBrowser, EXTENSION_ID, ensureExtensionLoaded } from '../browser/browser-manager.js';

const WORKER_URL_PREFIX = `chrome-extension://${EXTENSION_ID}/`;

const STEP_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

/** Current extension service worker target id, straight from Chrome (not Puppeteer's cache). */
async function findWorkerTargetId(browser) {
  const session = await browser.target().createCDPSession();
  try {
    const { targetInfos } = await withTimeout(session.send('Target.getTargets'), STEP_TIMEOUT_MS, 'Target.getTargets');
    const info = targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(WORKER_URL_PREFIX));
    return info ? info.targetId : null;
  } finally {
    await session.detach().catch(() => {});
  }
}

/**
 * Resolve the extension worker with self.__ctVault ready.
 * Matches the Puppeteer target by Chrome's target id, so a stale target left
 * after an extension reload (e.g. by another MCP process) is never used.
 * Every step has a timeout: a dead worker fails fast instead of hanging.
 * @param {boolean} reload - reload the extension first (wakes an idle worker)
 */
async function resolveWorker(reload) {
  const browser = await getBrowser();

  if (reload) await ensureExtensionLoaded(browser, { force: true });

  let targetId = await findWorkerTargetId(browser);
  if (!targetId && !reload) {
    // Worker idle or extension not loaded yet: load/reload wakes it
    await ensureExtensionLoaded(browser, { force: true });
  }
  for (let i = 0; !targetId && i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    targetId = await findWorkerTargetId(browser);
  }
  if (!targetId) {
    throw new Error('ChromeTools extension is not loaded in this Chrome. ' +
      'If it is listed in chrome://extensions but disabled, turn on "Developer mode" (top right) there. ' +
      'If MCP attached to a Chrome started earlier without --enable-unsafe-extension-debugging, ' +
      'fully quit that Chrome so MCP launches a new one (it loads the extension automatically).');
  }

  const sameTarget = t => t._targetId === targetId;
  const target = browser.targets().find(sameTarget) ||
    await withTimeout(browser.waitForTarget(sameTarget, { timeout: STEP_TIMEOUT_MS }), STEP_TIMEOUT_MS + 500, 'waitForTarget');

  const worker = await withTimeout(target.worker(), STEP_TIMEOUT_MS, 'attach to extension worker');
  if (!worker) throw new Error('Cannot attach to ChromeTools extension service worker');

  // Target appears before the module finishes executing: wait for the API
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await withTimeout(worker.evaluate(() => !!self.__ctVault), 2000, 'vault API check').catch(() => false);
    if (ready) return worker;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('ChromeTools extension vault API is not available (outdated extension?)');
}

/**
 * Call self.__ctVault.<method>(arg) in the extension worker.
 * On failure (stale/dead worker) retries once after reloading the extension.
 */
async function callVault(method, arg, timeoutMs = STEP_TIMEOUT_MS) {
  let lastError;
  for (const reload of [false, true]) {
    try {
      const worker = await resolveWorker(reload);
      return await withTimeout(
        worker.evaluate((m, a) => self.__ctVault[m](a), method, arg),
        timeoutMs,
        `vault.${method}`
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Redaction of tool responses is enabled once the vault is known to hold
// credentials (after listCredentials / typeCredential in this MCP process).
let redactionArmed = false;

export function isRedactionArmed() {
  return redactionArmed;
}

/** List credentials without passwords. */
export async function listCredentials(origin) {
  const list = await callVault('list', origin || null);
  if (list.length) redactionArmed = true;
  return list;
}

/**
 * Ask the extension to type a credential into the element marked with data-ct-fill=nonce.
 * @returns {Promise<{ok: boolean, error?: string, name?: string, field?: string, origin?: string}>}
 */
export async function fillCredential(request) {
  redactionArmed = true;
  // fill probes tabs/frames via chrome.scripting: allow more time
  return callVault('fill', request, 20000);
}

/**
 * Replace saved passwords in all text parts of an MCP tool result.
 * Fail-closed: if the vault cannot be reached while redaction is armed,
 * the response is withheld instead of being returned unchecked.
 * @param {Object} result - MCP tool result { content: [...] }
 * @returns {Promise<Object>}
 */
export async function redactToolResult(result) {
  if (!redactionArmed || !result || !Array.isArray(result.content)) return result;

  const textItems = result.content.filter(c => c && c.type === 'text' && typeof c.text === 'string');
  if (!textItems.length) return result;

  try {
    const { texts } = await callVault('redact', textItems.map(c => c.text));
    let i = 0;
    return {
      ...result,
      content: result.content.map(c =>
        (c && c.type === 'text' && typeof c.text === 'string') ? { ...c, text: texts[i++] } : c
      )
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Response withheld: could not check it for saved passwords (${error.message}). Retry the call.`
        }, null, 2)
      }],
      isError: true
    };
  }
}

/**
 * Block MCP access to extension pages. A chrome-extension:// page has access to
 * the vault key in the extension's IndexedDB, so executeScript there could decrypt passwords.
 */
export function assertNotExtensionUrl(url) {
  if (typeof url === 'string' && /^chrome-extension:/i.test(url.trim())) {
    throw new Error('Access to chrome-extension:// pages is blocked by chrometools-mcp (credential vault protection).');
  }
}

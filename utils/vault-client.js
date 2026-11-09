/**
 * utils/vault-client.js
 *
 * MCP side of the Credential Vault. Talks to the ChromeTools extension service
 * worker over CDP. Passwords stay inside the extension: these calls only send
 * a credential name + one-time marker and get back { ok, error }.
 */

import { getBrowser, EXTENSION_ID, ensureExtensionLoaded } from '../browser/browser-manager.js';

const WORKER_URL_PREFIX = `chrome-extension://${EXTENSION_ID}/`;

function findWorkerTarget(browser) {
  return browser.targets().find(t =>
    t.type() === 'service_worker' && t.url().startsWith(WORKER_URL_PREFIX)
  );
}

/**
 * Get the extension service worker with self.__ctVault ready.
 * The service worker may be idle (no target) - then reload the extension to wake it.
 * Its target also appears before the module finishes executing, so wait for the API.
 */
async function getVaultWorker() {
  const browser = await getBrowser();

  let target = findWorkerTarget(browser);
  if (!target) {
    await ensureExtensionLoaded(browser, { force: true });
    target = await browser.waitForTarget(
      t => t.type() === 'service_worker' && t.url().startsWith(WORKER_URL_PREFIX),
      { timeout: 5000 }
    ).catch(() => null);
  }
  if (!target) {
    throw new Error('ChromeTools extension is not loaded in this Chrome. ' +
      'If it is listed in chrome://extensions but disabled, turn on "Developer mode" (top right) there. ' +
      'If MCP attached to a Chrome started earlier without --enable-unsafe-extension-debugging, ' +
      'fully quit that Chrome so MCP launches a new one (it loads the extension automatically).');
  }

  const worker = await target.worker();
  if (!worker) throw new Error('Cannot attach to ChromeTools extension service worker');

  for (let i = 0; i < 50; i++) {
    if (await worker.evaluate(() => !!self.__ctVault).catch(() => false)) return worker;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('ChromeTools extension vault API is not available (outdated extension?)');
}

// Redaction of tool responses is enabled once the vault is known to hold
// credentials (after listCredentials / typeCredential in this MCP process).
let redactionArmed = false;

export function isRedactionArmed() {
  return redactionArmed;
}

/** List credentials without passwords. */
export async function listCredentials(origin) {
  const worker = await getVaultWorker();
  const list = await worker.evaluate(o => self.__ctVault.list(o), origin || null);
  if (list.length) redactionArmed = true;
  return list;
}

/**
 * Ask the extension to type a credential into the element marked with data-ct-fill=nonce.
 * @returns {Promise<{ok: boolean, error?: string, name?: string, field?: string, origin?: string}>}
 */
export async function fillCredential(request) {
  const worker = await getVaultWorker();
  redactionArmed = true;
  return worker.evaluate(r => self.__ctVault.fill(r), request);
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
    const worker = await getVaultWorker();
    const { texts } = await worker.evaluate(t => self.__ctVault.redact(t), textItems.map(c => c.text));
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

/**
 * ChromeTools MCP Extension - Credential Vault
 *
 * Passwords are stored in chrome.storage.local, encrypted with AES-GCM.
 * The key is a non-extractable CryptoKey kept in the extension's IndexedDB:
 * it can be used for encrypt/decrypt inside the extension but never exported.
 *
 * No function exported here for MCP returns a password. Plaintext is only
 * returned to the extension popup (revealPassword) and used internally for fill.
 */

const STORAGE_KEY = 'vault';
const DB_NAME = 'ctVault';
const DB_STORE = 'keys';
const KEY_ID = 'main';

let keyPromise = null;

// ============================================
// Key management
// ============================================

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadOrCreateKey() {
  const db = await openDb();
  try {
    let key = await idbGet(db, KEY_ID);
    if (!key) {
      key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable
        ['encrypt', 'decrypt']
      );
      await idbPut(db, KEY_ID, key);
    }
    return key;
  } finally {
    db.close();
  }
}

function getKey() {
  if (!keyPromise) {
    keyPromise = loadOrCreateKey().catch(err => {
      keyPromise = null;
      throw err;
    });
  }
  return keyPromise;
}

// ============================================
// Crypto helpers
// ============================================

function toB64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function encrypt(plaintext) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { iv: toB64(iv), cipher: toB64(cipher) };
}

async function decrypt(entry) {
  const key = await getKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(entry.iv) },
    key,
    fromB64(entry.cipher)
  );
  return new TextDecoder().decode(plain);
}

// ============================================
// Storage
// ============================================

async function readEntries() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

async function writeEntries(entries) {
  await chrome.storage.local.set({ [STORAGE_KEY]: entries });
}

function publicView(entry) {
  return {
    name: entry.name,
    username: entry.username || '',
    origins: entry.origins,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

// ============================================
// Origins
// ============================================

/**
 * Normalize user input into an origin pattern.
 * "site.ru" -> "https://site.ru", "https://a.site.ru/login?x" -> "https://a.site.ru",
 * "https://*.site.ru" stays a wildcard pattern.
 */
export function normalizeOrigin(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('URL is required');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;

  const wildcard = raw.match(/^(https?):\/\/\*\.([^/:?#]+)(:\d+)?/i);
  if (wildcard) {
    return `${wildcard[1].toLowerCase()}://*.${wildcard[2].toLowerCase()}${wildcard[3] || ''}`;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) URLs are supported');
  }
  return url.origin;
}

/** Check that a concrete origin (e.g. location.origin) matches one of the patterns. */
export function originMatches(origin, patterns) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return patterns.some(pattern => {
    const wildcard = pattern.match(/^(https?):\/\/\*\.([^/:]+)(:\d+)?$/);
    if (wildcard) {
      const [, scheme, base, port] = wildcard;
      return url.protocol === `${scheme}:` &&
        (url.port ? `:${url.port}` : '') === (port || '') &&
        (url.hostname === base || url.hostname.endsWith('.' + base));
    }
    return url.origin === pattern;
  });
}

function hostOf(origin) {
  return origin.replace(/^https?:\/\/(\*\.)?/, '').replace(/:\d+$/, '');
}

// ============================================
// Public API
// ============================================

/** List entries without passwords. Optional filter by concrete origin. */
export async function listEntries(origin) {
  const entries = await readEntries();
  return entries
    .filter(e => !origin || originMatches(origin, e.origins))
    .map(publicView);
}

export async function status() {
  const entries = await readEntries();
  return { count: entries.length };
}

/**
 * Create or update an entry.
 * @param {Object} data - { url, username, password, name?, originalName? }
 *   originalName - name of the entry being edited (rename allowed).
 *   Empty password on edit keeps the old one.
 */
export async function saveEntry(data) {
  const origin = normalizeOrigin(data.url);
  const username = String(data.username || '').trim();
  const password = String(data.password || '');
  const entries = await readEntries();

  const editIndex = data.originalName
    ? entries.findIndex(e => e.name === data.originalName)
    : -1;
  if (data.originalName && editIndex === -1) {
    throw new Error(`Entry "${data.originalName}" not found`);
  }
  if (editIndex === -1 && !password) {
    throw new Error('Password is required');
  }

  // Default name: host, or host:login if host is already taken by another entry
  let name = String(data.name || '').trim();
  if (!name) {
    const host = hostOf(origin);
    const taken = entries.some((e, i) => i !== editIndex && e.name === host);
    name = taken && username ? `${host}:${username}` : host;
  }
  if (entries.some((e, i) => i !== editIndex && e.name === name)) {
    throw new Error(`Entry "${name}" already exists`);
  }

  const now = new Date().toISOString();
  const base = editIndex >= 0 ? entries[editIndex] : { createdAt: now };
  const secret = password ? await encrypt(password) : { iv: base.iv, cipher: base.cipher };

  const entry = {
    name,
    username,
    origins: [origin],
    iv: secret.iv,
    cipher: secret.cipher,
    createdAt: base.createdAt,
    updatedAt: now
  };

  if (editIndex >= 0) entries[editIndex] = entry;
  else entries.push(entry);
  await writeEntries(entries);
  return publicView(entry);
}

export async function deleteEntry(name) {
  const entries = await readEntries();
  const next = entries.filter(e => e.name !== name);
  if (next.length === entries.length) throw new Error(`Entry "${name}" not found`);
  await writeEntries(next);
  return { deleted: name };
}

/**
 * Internal: get decrypted entry. Must never be exposed to MCP.
 * Used by revealPassword (popup only) and by fill (phase 2).
 */
export async function getSecretEntry(name) {
  const entries = await readEntries();
  const entry = entries.find(e => e.name === name);
  if (!entry) throw new Error(`Credential "${name}" not found`);
  return { ...publicView(entry), password: await decrypt(entry) };
}

// ============================================
// Fill (called by MCP via service worker)
// ============================================

const FILL_ATTR = 'data-ct-fill';

/** Runs in page frames: find the element marked by MCP, report its frame origin and type. */
function probeMarkedElement(attr, nonce) {
  const el = document.querySelector(`[${attr}="${CSS.escape(nonce)}"]`);
  if (!el) return null;
  return {
    origin: location.origin,
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    editable: el.isContentEditable
  };
}

/**
 * Runs in the verified frame only: set value so that React/Vue/Angular notice it,
 * then re-read the field to make sure the page did not reset it.
 */
async function setMarkedValue(attr, nonce, expectedOrigin, value, credential) {
  if (location.origin !== expectedOrigin) return { ok: false, error: 'Frame navigated away' };
  const el = document.querySelector(`[${attr}="${CSS.escape(nonce)}"]`);
  if (!el) return { ok: false, error: 'Marked element disappeared' };
  el.removeAttribute(attr);
  // Visible to the recorder content script (same isolated world): it records
  // a typeCredential step instead of the typed value.
  el.__ctCredential = credential;

  const read = () => el.isContentEditable ? el.textContent : el.value;
  const write = v => {
    if (el.isContentEditable) {
      el.textContent = v;
    } else {
      // Native setter: bypasses framework value trackers patched on the instance
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    }
  };
  const key = type => el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Unidentified' }));

  el.focus();
  // Replace, never append to what is already in the field
  if (read() !== '') {
    write('');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }
  key('keydown');
  write(value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  key('keyup');
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // Frameworks re-render on input; a controlled field that rejected the value resets here
  await new Promise(r => setTimeout(r, 50));
  const current = read();
  if (current !== value) {
    return {
      ok: false,
      error: current === ''
        ? 'Value did not stick: the field is empty after typing (the page reset it).'
        : 'Value did not stick: the field contains a different value after typing (the page changed or masked it).'
    };
  }
  return { ok: true };
}

/**
 * Type a stored credential into the element MCP marked with data-ct-fill=nonce.
 * Returns only { ok, error? } - never the password.
 * @param {Object} req - { name, field: 'password'|'username', nonce, pageUrl, allowNonPasswordField }
 */
export async function fillCredential(req) {
  const field = req.field === 'username' ? 'username' : 'password';
  if (!req.nonce) throw new Error('nonce is required');

  const entries = await readEntries();
  const entry = entries.find(e => e.name === req.name);
  if (!entry) throw new Error(`Credential "${req.name}" not found`);

  // Candidate tabs: same URL as the MCP page first, then all http(s) tabs
  const tabs = (await chrome.tabs.query({})).filter(t => /^https?:/.test(t.url || ''));
  const exact = tabs.filter(t => t.url === req.pageUrl);
  const ordered = [...exact, ...tabs.filter(t => t.url !== req.pageUrl)];

  let found = null;
  for (const tab of ordered) {
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'ISOLATED',
        func: probeMarkedElement,
        args: [FILL_ATTR, req.nonce]
      });
    } catch {
      continue; // restricted page
    }
    const hit = results.find(r => r.result);
    if (hit) {
      found = { tabId: tab.id, frameId: hit.frameId, ...hit.result };
      break;
    }
  }
  if (!found) throw new Error('Target field not found by the extension');

  if (!originMatches(found.origin, entry.origins)) {
    throw new Error(`Credential "${entry.name}" is not allowed on ${found.origin} (saved for ${entry.origins.join(', ')})`);
  }

  const isTextInput = found.tag === 'textarea' || found.editable ||
    (found.tag === 'input' && ['', 'text', 'email', 'tel', 'password', 'search', 'url', 'number'].includes(found.type));
  if (!isTextInput) {
    throw new Error(`Target is not a text field (<${found.tag} type="${found.type}">)`);
  }
  if (field === 'password' && found.type !== 'password' && !req.allowNonPasswordField) {
    throw new Error('Password can be typed only into input[type=password]. Pass allowNonPasswordField: true for custom fields.');
  }

  let value;
  if (field === 'username') {
    value = entry.username;
    if (!value) throw new Error(`Credential "${entry.name}" has no login`);
  } else {
    value = await decrypt(entry);
  }

  const [res] = await chrome.scripting.executeScript({
    target: { tabId: found.tabId, frameIds: [found.frameId] },
    world: 'ISOLATED',
    func: setMarkedValue,
    args: [FILL_ATTR, req.nonce, found.origin, value, { name: entry.name, field }]
  });
  value = null;

  const result = res?.result || { ok: false, error: 'Fill script failed' };
  if (!result.ok) throw new Error(result.error);
  return { ok: true, name: entry.name, field, origin: found.origin };
}

// ============================================
// Redact (called by MCP for every tool response)
// ============================================

const MIN_REDACT_LENGTH = 4;
let redactCache = null; // [{ needle, label }] sorted by length desc

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) redactCache = null;
  });
}

function b64Utf8(text) {
  return toB64(new TextEncoder().encode(text));
}

/** All forms a password can take in tool output: raw, URL/form encoded, JSON-escaped, Basic auth. */
function secretVariants(password, username) {
  const uri = encodeURIComponent(password);
  // application/x-www-form-urlencoded (URLSearchParams, HTML forms) also escapes !'()~
  const form = uri.replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const lowerHex = s => s.replace(/%[0-9A-F]{2}/g, m => m.toLowerCase());
  const variants = new Set([
    password,
    uri,
    uri.replace(/%20/g, '+'),
    form,
    form.replace(/%20/g, '+'),
    lowerHex(uri),
    lowerHex(form),
    JSON.stringify(password).slice(1, -1),
    b64Utf8(password)
  ]);
  if (username) variants.add(b64Utf8(`${username}:${password}`));
  return [...variants].filter(v => v.length >= MIN_REDACT_LENGTH);
}

async function getRedactPatterns() {
  if (redactCache) return redactCache;
  const entries = await readEntries();
  const patterns = [];
  for (const entry of entries) {
    let password;
    try {
      password = await decrypt(entry);
    } catch {
      continue;
    }
    if (password.length < MIN_REDACT_LENGTH) continue;
    for (const needle of secretVariants(password, entry.username)) {
      patterns.push({ needle, label: `[REDACTED:${entry.name}]` });
    }
  }
  patterns.sort((a, b) => b.needle.length - a.needle.length);
  redactCache = patterns;
  return patterns;
}

/**
 * Replace stored passwords (in any of their encodings) in the given texts.
 * @param {string[]} texts
 * @returns {Promise<{texts: string[], count: number}>}
 */
export async function redactTexts(texts) {
  const patterns = await getRedactPatterns();
  let count = 0;
  const out = texts.map(text => {
    if (typeof text !== 'string' || !patterns.length) return text;
    let result = text;
    for (const { needle, label } of patterns) {
      if (result.includes(needle)) {
        const parts = result.split(needle);
        count += parts.length - 1;
        result = parts.join(label);
      }
    }
    return result;
  });
  return { texts: out, count };
}

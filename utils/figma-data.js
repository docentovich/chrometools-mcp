/**
 * utils/figma-data.js
 *
 * Figma data access with a disk cache.
 *
 * View/Collab seats get a "low" rate limit: after a 429 Figma answers with
 * Retry-After of many hours. So every API request counts. All Figma tools get
 * node trees, renders and file structure through this module:
 *   - cache on disk (~/.chrometools/figma-cache/<fileKey>/), survives restarts;
 *   - entries live until refresh / clear, no TTL, no version check request;
 *   - node trees are also found inside cached parent trees and file.json;
 *   - renders are cropped from a cached ancestor render when possible;
 *   - after a 429 the API is not called until Retry-After passes, cached data
 *     (any version) is returned with a note instead of an error.
 * The token is never written to disk.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Jimp from 'jimp';
import { figmaFetch, normalizeFigmaNodeId } from '../figma-tools.js';

const API_BASE = (process.env.CHROMETOOLS_FIGMA_API_BASE || 'https://api.figma.com/v1/').replace(/\/?$/, '/');
const CACHE_ENABLED = !/^(off|0|false|no)$/i.test(process.env.CHROMETOOLS_FIGMA_CACHE || '');
const CACHE_DIR = process.env.CHROMETOOLS_FIGMA_CACHE_DIR || path.join(os.homedir(), '.chrometools', 'figma-cache');
const MAX_RETRY_WAIT_MS = Number(process.env.CHROMETOOLS_FIGMA_MAX_RETRY_WAIT_MS) || 30000;
const IMAGE_CHUNK = 50;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── errors ──────────────────────────────────────────────────────────────────

export class FigmaRateLimitError extends Error {
  constructor({ retryAt, limitType, planTier, endpoint }) {
    super('');
    this.name = 'FigmaRateLimitError';
    this.retryAt = retryAt;
    this.limitType = limitType || null;
    this.planTier = planTier || null;
    this.endpoint = endpoint || null;
    this.message = `Figma rate limit (429)${this.limitType ? `, limit type ${this.limitType}` : ''}` +
      `${this.planTier ? `, plan tier ${this.planTier}` : ''}: ${formatRetry(retryAt)}` +
      (this.limitType === 'low' ? '. Limit type "low" = View/Collab seat; a Full/Dev seat token has higher limits' : '');
  }
}

export class FigmaOfflineError extends Error {
  constructor(what) {
    super(`${what} is not in the Figma cache and offline: true forbids API calls. Run prefetchFigma first or drop offline.`);
    this.name = 'FigmaOfflineError';
  }
}

/** "retry after 11.11.2026, 01:20 GMT+3 (in 18 h 40 min)" */
export function formatRetry(retryAt) {
  if (!retryAt) return 'retry time unknown';
  const d = new Date(retryAt);
  const when = d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
  const leftMin = Math.max(0, Math.round((retryAt - Date.now()) / 60000));
  const left = leftMin >= 60 ? `${Math.floor(leftMin / 60)} h ${leftMin % 60} min` : `${leftMin} min`;
  return `retry after ${when} (in ${left})`;
}

function formatDate(ts) {
  if (!ts) return '?';
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─── disk layout ─────────────────────────────────────────────────────────────

const safeId = id => String(id).replace(/[:;]/g, '-').replace(/[^\w.-]/g, '_');
const fileDir = fileKey => path.join(CACHE_DIR, safeId(fileKey));

function writeAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadIndex(fileKey) {
  const idx = readJson(path.join(fileDir(fileKey), 'index.json'));
  return idx && idx.entries ? idx : { fileKey, name: null, version: null, lastModified: null, entries: {} };
}

/** Read-modify-write of index.json (re-read right before writing: other MCP processes share the cache). */
function updateIndex(fileKey, fn) {
  const idx = loadIndex(fileKey);
  fn(idx);
  writeAtomic(path.join(fileDir(fileKey), 'index.json'), JSON.stringify(idx, null, 2));
  return idx;
}

const nodeKey = id => `nodes:${id}`;
const imageKey = (id, scale, format) => `images:${id}@${scale}.${format}`;
const FILE_KEY = 'file';

function noteFileMeta(idx, meta) {
  if (!meta) return;
  if (meta.name) idx.name = meta.name;
  if (meta.version && (!idx.version || String(meta.version) !== String(idx.version))) {
    idx.version = meta.version;
    idx.lastModified = meta.lastModified || idx.lastModified;
  }
}

// In-process memo of parsed tree files (they can be large)
const treeMemo = new Map(); // absPath -> { mtimeMs, data }
function readTree(absFile) {
  try {
    const { mtimeMs } = statSync(absFile);
    const memo = treeMemo.get(absFile);
    if (memo && memo.mtimeMs === mtimeMs) return memo.data;
    const data = JSON.parse(readFileSync(absFile, 'utf8'));
    treeMemo.set(absFile, { mtimeMs, data });
    return data;
  } catch {
    return null;
  }
}

function findInTree(node, id, ancestors = []) {
  if (!node) return null;
  if (node.id === id) return { node, ancestors };
  for (const child of node.children || []) {
    const found = findInTree(child, id, [...ancestors, node]);
    if (found) return found;
  }
  return null;
}

// ─── rate-limit state ────────────────────────────────────────────────────────

const rateFile = fileKey => path.join(fileDir(fileKey), 'rate-limit.json');

function activeBlock(fileKey) {
  if (!CACHE_ENABLED) return memBlocks.get(fileKey) && memBlocks.get(fileKey).retryAt > Date.now() ? memBlocks.get(fileKey) : null;
  const st = readJson(rateFile(fileKey));
  return st && st.retryAt > Date.now() ? st : null;
}
const memBlocks = new Map();

function saveBlock(fileKey, state) {
  if (!CACHE_ENABLED) { memBlocks.set(fileKey, state); return; }
  writeAtomic(rateFile(fileKey), JSON.stringify(state, null, 2));
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * GET an API endpoint. Handles 429 (short Retry-After: wait once; long: store the
 * block and throw FigmaRateLimitError) and 5xx (one retry after 2 s).
 * @param {string} fileKey - for the per-file rate-limit state
 * @param {{token: string, explicitToken?: boolean, stats: object}} ctx
 */
async function apiGet(fileKey, endpoint, ctx) {
  // An explicit figmaToken may belong to another seat: let it try despite a stored block
  const block = ctx.explicitToken ? null : activeBlock(fileKey);
  if (block) {
    throw new FigmaRateLimitError(block);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    ctx.stats.requests++;
    const res = await figmaFetch(API_BASE + endpoint, { headers: { 'X-Figma-Token': ctx.token } });
    if (res.ok) return res.json();

    if (res.status === 429) {
      const ra = Number(res.headers['retry-after']);
      const waitMs = Number.isFinite(ra) ? ra * 1000 : 60000;
      const state = {
        retryAt: Date.now() + waitMs,
        limitType: res.headers['x-figma-rate-limit-type'] || null,
        planTier: res.headers['x-figma-plan-tier'] || null,
        endpoint: endpoint.split('?')[0],
        at: Date.now()
      };
      if (attempt === 0 && waitMs <= MAX_RETRY_WAIT_MS) {
        await sleep(waitMs);
        continue;
      }
      saveBlock(fileKey, state);
      throw new FigmaRateLimitError(state);
    }
    if (res.status >= 500 && attempt === 0) {
      await sleep(2000);
      continue;
    }
    let detail = res.text().slice(0, 300);
    throw new Error(`Figma API error: ${res.status} ${detail}`);
  }
  throw new Error('Figma API: retries exhausted');
}

function withCacheHint(e) {
  if (e instanceof FigmaRateLimitError && !e.hinted) {
    e.hinted = true;
    e.message += '. Data is not in the cache. Work offline with a manual export: compareFigmaToElement figmaImagePath, ' +
      'getFigmaSpecs figmaSpecPath; or use a token of a Full/Dev seat (pass figmaToken).';
  }
  return e;
}

// ─── context ────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {() => string} opts.getToken - resolves the token only when a request is needed
 * @param {boolean} [opts.explicitToken]
 * @param {boolean} [opts.refresh]
 * @param {boolean} [opts.offline]
 */
export function createFigmaContext({ getToken, explicitToken = false, refresh = false, offline = false } = {}) {
  let token = null;
  return {
    refresh, offline, explicitToken,
    stats: { requests: 0 },
    notes: [],          // human-readable source notes
    sources: new Set(), // 'cache' | 'api' | 'file' | 'stale'
    get token() {
      if (!token) token = getToken();
      return token;
    }
  };
}

/** One line for tool output: where the Figma data came from. */
export function formatSourceLine(ctx) {
  const parts = [];
  if (ctx.stats.requests > 0) parts.push(`API, ${ctx.stats.requests} request${ctx.stats.requests > 1 ? 's' : ''}`);
  else if (ctx.sources.has('api')) parts.push('API');
  if (ctx.notes.length) parts.push(...ctx.notes);
  if (!parts.length) return '';
  return `\nFigma: ${[...new Set(parts)].join('; ')}`;
}

function cacheNote(ctx, entry, what) {
  ctx.sources.add('cache');
  ctx.notes.push(`${what} from cache (version ${entry.version ?? '?'}, fetched ${formatDate(entry.fetchedAt)})`);
}

// ─── node trees ──────────────────────────────────────────────────────────────

function lookupCachedNode(fileKey, id) {
  if (!CACHE_ENABLED) return null;
  const idx = loadIndex(fileKey);
  const dir = fileDir(fileKey);
  const own = idx.entries[nodeKey(id)];
  if (own) {
    const data = readTree(path.join(dir, own.file));
    if (data) return { data, entry: own, via: null };
  }
  // Search inside other cached trees (a parent section or frame), then file.json
  const trees = Object.values(idx.entries).filter(e => e.kind === 'nodes' && e.nodeId !== id);
  for (const e of trees) {
    const data = readTree(path.join(dir, e.file));
    const found = data && findInTree(data.document, id);
    if (found) {
      return {
        data: { document: found.node, components: data.components, styles: data.styles },
        entry: e, via: `parent tree ${e.nodeId}`, ancestors: found.ancestors
      };
    }
  }
  const fileEntry = idx.entries[FILE_KEY];
  if (fileEntry) {
    const data = readTree(path.join(dir, fileEntry.file));
    const found = data && findInTree(data.document, id);
    if (found) {
      return {
        data: { document: found.node, components: data.components, styles: data.styles },
        entry: fileEntry, via: 'file structure', ancestors: found.ancestors
      };
    }
  }
  return null;
}

function storeNodes(fileKey, resp, ids) {
  if (!CACHE_ENABLED) return;
  const dir = fileDir(fileKey);
  const now = Date.now();
  const stored = [];
  for (const id of ids) {
    const n = resp.nodes?.[id];
    if (!n || !n.document) continue;
    const rel = path.join('nodes', `${safeId(id)}.json`);
    const json = JSON.stringify(n);
    writeAtomic(path.join(dir, rel), json);
    stored.push({ id, rel, bytes: Buffer.byteLength(json) });
  }
  updateIndex(fileKey, idx => {
    noteFileMeta(idx, resp);
    for (const s of stored) {
      idx.entries[nodeKey(s.id)] = {
        kind: 'nodes', nodeId: s.id, version: resp.version ?? null, lastModified: resp.lastModified ?? null,
        fetchedAt: now, bytes: s.bytes, file: s.rel
      };
    }
  });
}

/**
 * Get node trees (the /nodes `{document, components, styles}` object per id).
 * @returns {Promise<Record<string, {document: object, components?: object, styles?: object}>>}
 */
export async function getNodes(fileKey, nodeIds, ctx) {
  const ids = nodeIds.map(normalizeFigmaNodeId);
  const result = {};
  const missing = [];
  const stale = {};

  for (const id of ids) {
    const hit = lookupCachedNode(fileKey, id);
    if (hit && !ctx.refresh) {
      result[id] = hit.data;
      cacheNote(ctx, hit.entry, hit.via ? `node ${id} (from ${hit.via})` : `node ${id}`);
    } else {
      if (hit) stale[id] = hit;
      missing.push(id);
    }
  }
  if (!missing.length) return result;
  if (ctx.offline) throw new FigmaOfflineError(`Node ${missing.join(', ')}`);

  let resp;
  try {
    resp = await apiGet(fileKey, `files/${fileKey}/nodes?ids=${encodeURIComponent(missing.join(','))}`, ctx);
  } catch (e) {
    if (e instanceof FigmaRateLimitError || /timed out|Request failed|API error: 5/.test(e.message)) {
      const fallback = missing.filter(id => stale[id]);
      if (fallback.length === missing.length) {
        for (const id of fallback) {
          result[id] = stale[id].data;
          ctx.sources.add('stale');
          ctx.notes.push(`node ${id} from cache (version ${stale[id].entry.version ?? '?'}, fetched ${formatDate(stale[id].entry.fetchedAt)}); refresh failed: ${e.message}`);
        }
        return result;
      }
    }
    throw withCacheHint(e);
  }
  ctx.sources.add('api');
  storeNodes(fileKey, resp, missing);
  for (const id of missing) {
    const n = resp.nodes?.[id];
    if (!n || !n.document) throw new Error(`Node ${id} not found in Figma file ${fileKey}`);
    result[id] = n;
  }
  return result;
}

/** Load a node from a saved JSON file: /nodes response, {document}, or a bare node. */
export function loadNodeFromFile(specPath, nodeId = null) {
  const raw = JSON.parse(readFileSync(specPath, 'utf8'));
  const id = nodeId ? normalizeFigmaNodeId(nodeId) : null;
  if (raw.nodes) {
    if (id && raw.nodes[id]?.document) return { id, data: raw.nodes[id] };
    if (id) {
      // nodeId inside one of the saved trees (a card inside a frame)
      for (const n of Object.values(raw.nodes)) {
        const found = n?.document && findInTree(n.document, id);
        if (found) return { id, data: { document: found.node, components: n.components, styles: n.styles } };
      }
      throw new Error(`Node ${id} not found in ${specPath}`);
    }
    const key = Object.keys(raw.nodes).find(k => raw.nodes[k]?.document);
    if (!key) throw new Error(`No node in ${specPath}`);
    return { id: key, data: raw.nodes[key] };
  }
  if (raw.document) {
    if (id && raw.document.id !== id) {
      const found = findInTree(raw.document, id);
      if (!found) throw new Error(`Node ${id} not found in ${specPath}`);
      return { id, data: { document: found.node, components: raw.components, styles: raw.styles } };
    }
    return { id: raw.document.id, data: raw };
  }
  if (raw.id && raw.type) {
    if (id && raw.id !== id) {
      const found = findInTree(raw, id);
      if (!found) throw new Error(`Node ${id} not found in ${specPath}`);
      return { id, data: { document: found.node } };
    }
    return { id: raw.id, data: { document: raw } };
  }
  throw new Error(`${specPath} is not a Figma node JSON (expected nodes, document, or a node with id/type)`);
}

// ─── renders ─────────────────────────────────────────────────────────────────

function lookupCachedImage(fileKey, id, scale, format) {
  if (!CACHE_ENABLED) return null;
  const idx = loadIndex(fileKey);
  const e = idx.entries[imageKey(id, scale, format)];
  if (!e) return null;
  try {
    return { buffer: readFileSync(path.join(fileDir(fileKey), e.file)), entry: e };
  } catch {
    return null;
  }
}

/** Crop a node out of a cached ancestor render (same scale/format, raster only). */
async function cropFromAncestor(fileKey, id, scale, format) {
  if (!CACHE_ENABLED || format === 'svg') return null;
  const hit = lookupCachedNode(fileKey, id);
  if (!hit || !hit.ancestors || !hit.ancestors.length) return null;
  const box = hit.data.document.absoluteBoundingBox;
  if (!box) return null;
  for (const anc of [...hit.ancestors].reverse()) {
    const img = lookupCachedImage(fileKey, anc.id, scale, format);
    const abox = anc.absoluteBoundingBox;
    if (!img || !abox) continue;
    const image = await Jimp.read(img.buffer);
    // The render covers absoluteRenderBounds (box plus shadows); without it assume the box
    const rb = anc.absoluteRenderBounds || abox;
    const x = Math.round((box.x - rb.x) * scale);
    const y = Math.round((box.y - rb.y) * scale);
    const w = Math.round(box.width * scale);
    const h = Math.round(box.height * scale);
    if (x < 0 || y < 0 || x + w > image.bitmap.width || y + h > image.bitmap.height || w < 1 || h < 1) continue;
    image.crop(x, y, w, h);
    const buffer = await image.getBufferAsync(format === 'jpg' ? Jimp.MIME_JPEG : Jimp.MIME_PNG);
    return { buffer, entry: img.entry, ancestor: anc.id };
  }
  return null;
}

function storeImage(fileKey, id, scale, format, buffer, version) {
  if (!CACHE_ENABLED) return;
  const rel = path.join('images', `${safeId(id)}@${scale}.${format}`);
  writeAtomic(path.join(fileDir(fileKey), rel), buffer);
  updateIndex(fileKey, idx => {
    idx.entries[imageKey(id, scale, format)] = {
      kind: 'images', nodeId: id, scale, format,
      // /images has no version: the newest version known for this file at fetch time
      version: version ?? idx.version ?? null, lastModified: idx.lastModified ?? null,
      fetchedAt: Date.now(), bytes: buffer.length, file: rel
    };
  });
}

/**
 * Get node renders as bytes.
 * @returns {Promise<Record<string, Buffer>>}
 */
export async function getImages(fileKey, nodeIds, { scale = 2, format = 'png' } = {}, ctx) {
  const ids = nodeIds.map(normalizeFigmaNodeId);
  const result = {};
  const missing = [];
  const stale = {};

  for (const id of ids) {
    const hit = lookupCachedImage(fileKey, id, scale, format);
    if (hit && !ctx.refresh) {
      result[id] = hit.buffer;
      cacheNote(ctx, hit.entry, `render ${id}@${scale}x`);
      continue;
    }
    if (hit) { stale[id] = hit; missing.push(id); continue; }
    if (!ctx.refresh) {
      const crop = await cropFromAncestor(fileKey, id, scale, format).catch(() => null);
      if (crop) {
        result[id] = crop.buffer;
        ctx.sources.add('cache');
        ctx.notes.push(`render ${id}@${scale}x cropped from cached render of ${crop.ancestor} (version ${crop.entry.version ?? '?'}); overlapping siblings stay in the image`);
        continue;
      }
    }
    missing.push(id);
  }
  if (!missing.length) return result;
  if (ctx.offline) throw new FigmaOfflineError(`Render of ${missing.join(', ')} at scale ${scale}`);

  const urls = {};
  try {
    for (let i = 0; i < missing.length; i += IMAGE_CHUNK) {
      const chunk = missing.slice(i, i + IMAGE_CHUNK);
      const resp = await apiGet(fileKey, `images/${fileKey}?ids=${encodeURIComponent(chunk.join(','))}&scale=${scale}&format=${format}`, ctx);
      if (resp.err) throw new Error(`Figma export error: ${resp.err}`);
      Object.assign(urls, resp.images || {});
    }
  } catch (e) {
    if (e instanceof FigmaRateLimitError || /timed out|Request failed|API error: 5/.test(e.message)) {
      if (missing.every(id => stale[id])) {
        for (const id of missing) {
          result[id] = stale[id].buffer;
          ctx.sources.add('stale');
          ctx.notes.push(`render ${id}@${scale}x from cache (version ${stale[id].entry.version ?? '?'}, fetched ${formatDate(stale[id].entry.fetchedAt)}); refresh failed: ${e.message}`);
        }
        return result;
      }
    }
    throw withCacheHint(e);
  }
  ctx.sources.add('api');

  // Export links are temporary: download the bytes now (S3, not the rate-limited API)
  const knownVersion = CACHE_ENABLED ? loadIndex(fileKey).version : null;
  for (const id of missing) {
    const url = urls[id];
    if (!url) throw new Error(`Figma did not render node ${id} (empty or invisible node?)`);
    const res = await figmaFetch(url);
    if (!res.ok) throw new Error(`Failed to download Figma render of ${id}: ${res.status}`);
    result[id] = res.buffer;
    storeImage(fileKey, id, scale, format, res.buffer, knownVersion);
  }
  return result;
}

// ─── file structure ──────────────────────────────────────────────────────────

/** Full /v1/files/:key (pages, components, styles). */
export async function getFile(fileKey, ctx) {
  const dir = fileDir(fileKey);
  const entry = CACHE_ENABLED ? loadIndex(fileKey).entries[FILE_KEY] : null;
  const cached = entry ? readTree(path.join(dir, entry.file)) : null;
  if (cached && !ctx.refresh) {
    cacheNote(ctx, entry, 'file structure');
    return cached;
  }
  if (ctx.offline) throw new FigmaOfflineError('File structure');
  let data;
  try {
    data = await apiGet(fileKey, `files/${fileKey}`, ctx);
  } catch (e) {
    if (cached && (e instanceof FigmaRateLimitError || /timed out|Request failed|API error: 5/.test(e.message))) {
      ctx.sources.add('stale');
      ctx.notes.push(`file structure from cache (version ${entry.version ?? '?'}, fetched ${formatDate(entry.fetchedAt)}); refresh failed: ${e.message}`);
      return cached;
    }
    throw withCacheHint(e);
  }
  ctx.sources.add('api');
  if (CACHE_ENABLED) {
    const json = JSON.stringify(data);
    writeAtomic(path.join(dir, 'file.json'), json);
    updateIndex(fileKey, idx => {
      noteFileMeta(idx, data);
      idx.entries[FILE_KEY] = {
        kind: 'file', version: data.version ?? null, lastModified: data.lastModified ?? null,
        fetchedAt: Date.now(), bytes: Buffer.byteLength(json), file: 'file.json'
      };
    });
  }
  return data;
}

// ─── prefetch / status / clear ───────────────────────────────────────────────

export async function prefetch(fileKey, nodeIds, { scales = [2], format = 'png', tree = true } = {}, ctx) {
  const ids = nodeIds.map(normalizeFigmaNodeId);
  const nodes = tree ? await getNodes(fileKey, ids, ctx) : {};
  const rows = ids.map(id => ({ nodeId: id, name: nodes[id]?.document?.name, tree: !!nodes[id] }));
  for (const scale of scales) {
    const imgs = await getImages(fileKey, ids, { scale, format }, ctx);
    for (const r of rows) {
      const img = imgs[r.nodeId];
      if (!img) continue;
      let size = null;
      if (format !== 'svg') {
        try {
          const j = await Jimp.read(img);
          size = `${j.bitmap.width}x${j.bitmap.height}`;
        } catch { /* not an image */ }
      }
      r[`render@${scale}x`] = size || `${img.length} bytes`;
    }
  }
  const version = CACHE_ENABLED ? loadIndex(fileKey).version : null;
  return { fileKey, version, cacheEnabled: CACHE_ENABLED, nodes: rows };
}

export function cacheStatus(fileKey = null) {
  if (!CACHE_ENABLED) return { cacheDir: CACHE_DIR, enabled: false, files: [] };
  const keys = fileKey ? [fileKey] : (existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR) : []);
  const files = [];
  for (const key of keys) {
    const idxFile = path.join(fileDir(key), 'index.json');
    if (!existsSync(idxFile)) continue;
    const idx = loadIndex(key);
    const entries = Object.values(idx.entries);
    const byKind = k => entries.filter(e => e.kind === k);
    const images = {};
    for (const e of byKind('images')) {
      const k = `${e.scale}x ${e.format}`;
      images[k] = (images[k] || 0) + 1;
    }
    const fetched = entries.map(e => e.fetchedAt).filter(Boolean);
    const block = activeBlock(idx.fileKey || key);
    files.push({
      fileKey: idx.fileKey || key,
      name: idx.name,
      version: idx.version,
      lastModified: idx.lastModified,
      trees: byKind('nodes').map(e => e.nodeId),
      images,
      fileStructure: !!idx.entries[FILE_KEY],
      sizeKB: Math.round(entries.reduce((s, e) => s + (e.bytes || 0), 0) / 1024),
      fetched: fetched.length ? `${formatDate(Math.min(...fetched))} .. ${formatDate(Math.max(...fetched))}` : null,
      rateLimit: block ? `blocked: ${new FigmaRateLimitError(block).message}` : null
    });
  }
  return { cacheDir: CACHE_DIR, enabled: true, files };
}

/**
 * @param {{fileKey?: string, nodeIds?: string[], kind?: 'images'|'nodes'|'file'|'rate-limit'}} filter
 */
export function cacheClear({ fileKey = null, nodeIds = null, kind = null } = {}) {
  if (!CACHE_ENABLED) return { removed: 0, files: [] };
  if (!fileKey && !nodeIds && !kind) {
    const keys = existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR) : [];
    rmSync(CACHE_DIR, { recursive: true, force: true });
    treeMemo.clear();
    return { removed: 'all', files: keys };
  }
  const keys = fileKey ? [fileKey] : (existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR) : []);
  const ids = nodeIds ? new Set(nodeIds.map(normalizeFigmaNodeId)) : null;
  let removed = 0;
  for (const key of keys) {
    const dir = fileDir(key);
    if (!existsSync(dir)) continue;
    if (kind === 'rate-limit') {
      rmSync(rateFile(key), { force: true });
      removed++;
      continue;
    }
    if (!ids && !kind) {
      rmSync(dir, { recursive: true, force: true });
      removed++;
      continue;
    }
    updateIndex(key, idx => {
      for (const [k, e] of Object.entries(idx.entries)) {
        if (kind && e.kind !== kind) continue;
        if (ids && !ids.has(e.nodeId)) continue;
        rmSync(path.join(dir, e.file), { force: true });
        delete idx.entries[k];
        removed++;
      }
    });
  }
  treeMemo.clear();
  return { removed, files: keys };
}

export const figmaCacheInfo = { dir: CACHE_DIR, enabled: CACHE_ENABLED, apiBase: API_BASE };

/** Cached node tree (own entry or inside a cached parent), no network. */
export function peekNode(fileKey, nodeId) {
  return lookupCachedNode(fileKey, normalizeFigmaNodeId(nodeId))?.data || null;
}

/** File name known from earlier responses, no network. */
export function cachedFileName(fileKey) {
  return CACHE_ENABLED ? (loadIndex(fileKey).name || 'Unknown') : 'Unknown';
}

/** Find a node by id inside a Figma node tree. */
export function findFigmaNode(root, id) {
  return findInTree(root, normalizeFigmaNodeId(id))?.node || null;
}

// ─── import from local files (API in 429, data downloaded earlier) ────────────

function countNodes(n) {
  return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0);
}

/**
 * Put a saved tree into the cache: a /nodes response, a /files response (document),
 * or a bare node. Nested nodes are then found by id (parent tree lookup).
 */
export function importNodesFile(fileKey, filePath) {
  if (!CACHE_ENABLED) throw new Error('Figma cache is disabled (CHROMETOOLS_FIGMA_CACHE=off)');
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const version = raw.version ?? 'imported';
  const meta = { name: raw.name, version, lastModified: raw.lastModified };
  const dir = fileDir(fileKey);
  const imported = [];
  if (raw.nodes) {
    const ids = Object.keys(raw.nodes).filter(id => raw.nodes[id]?.document);
    storeNodes(fileKey, { ...raw, version }, ids);
    for (const id of ids) imported.push({ nodeId: id, name: raw.nodes[id].document.name, nodes: countNodes(raw.nodes[id].document) });
  } else if (raw.document && raw.document.type === 'DOCUMENT') {
    const json = JSON.stringify(raw);
    writeAtomic(path.join(dir, 'file.json'), json);
    updateIndex(fileKey, idx => {
      noteFileMeta(idx, meta);
      idx.entries[FILE_KEY] = { kind: 'file', version, lastModified: raw.lastModified ?? null, fetchedAt: Date.now(), bytes: Buffer.byteLength(json), file: 'file.json', imported: true };
    });
    imported.push({ nodeId: 'file', name: raw.name, nodes: countNodes(raw.document) });
  } else {
    const doc = raw.document || raw;
    if (!doc.id || !doc.type) throw new Error(`${filePath} is not a Figma /nodes response, file response or node`);
    storeNodes(fileKey, { ...meta, nodes: { [doc.id]: { document: doc, components: raw.components, styles: raw.styles } } }, [doc.id]);
    imported.push({ nodeId: doc.id, name: doc.name, nodes: countNodes(doc) });
  }
  treeMemo.clear();
  return { fileKey, version, imported };
}

/** Put a saved render (PNG/JPG/SVG) into the cache for nodeId + scale + format. */
export function importRenderFile(fileKey, nodeId, filePath, { scale = 1, format = null } = {}) {
  if (!CACHE_ENABLED) throw new Error('Figma cache is disabled (CHROMETOOLS_FIGMA_CACHE=off)');
  const id = normalizeFigmaNodeId(nodeId);
  const fmt = format || (path.extname(filePath).slice(1).toLowerCase().replace('jpeg', 'jpg') || 'png');
  const buffer = readFileSync(filePath);
  storeImage(fileKey, id, scale, fmt, buffer, 'imported');
  return { fileKey, nodeId: id, scale, format: fmt, bytes: buffer.length };
}

/**
 * utils/spec-compare.js
 *
 * compareFigmaSpecs: match Figma text nodes and blocks with page elements and
 * list property differences (font, size, weight, line-height, color, sizes,
 * padding, gap, radius, background, border, position). Figma px = CSS px.
 *
 * Matching:
 *  - texts: the anchor pair first (fixed), then equal normalized text with the
 *    smallest offset from the anchor (global greedy per text, duplicates limited
 *    by distance), then prefix for truncated texts of similar length;
 *  - blocks: explicit pairs, then same inner label, then same role (Figma
 *    instance name vs element role), then overlap after anchor alignment.
 *    Pairs with very different sizes are rejected.
 * Page text boxes come from a Range over the text nodes (the glyphs), not from
 * the container: a button text is not compared with the button box.
 */

import { figmaColorToHex, textStyleOf } from './figma-tree.js';
import { firstFamily, fontVerdict, platformFontsFor } from './platform-fonts.js';

const round = n => Math.round(n * 100) / 100;
const r1 = n => Math.round(n * 10) / 10;
export const normText = t => String(t || '')
  .replace(/ /g, ' ')
  .replace(/[‐-―_-]+/g, ' ')
  .replace(/(\.\.\.|…)\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
const normFamily = f => String(f || '').toLowerCase().replace(/["']/g, '').replace(/[\s_-]+/g, ' ').trim();
const isDataLike = t => /^[\d\s.,:;%+\-/()−₽$€]+$/.test(String(t).trim());

export const DEFAULT_TEXT_PROPS = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'color', 'position'];
export const DEFAULT_BLOCK_PROPS = ['width', 'height', 'padding', 'gap', 'border-radius', 'background', 'border', 'position'];
const ALL_TEXT_PROPS = [...DEFAULT_TEXT_PROPS, 'height'];
const TEXT_CASE_TO_CSS = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' };

// ─── roles ───────────────────────────────────────────────────────────────────

/** Role of a Figma node from its (instance) name. Order matters: "Icon Button" is a button. */
export function figmaRole(name) {
  const n = String(name || '').toLowerCase();
  if (/check ?box/.test(n)) return 'checkbox';
  if (/radio/.test(n)) return 'radio';
  if (/switch|toggle/.test(n)) return 'switch';
  if (/icon ?button|button|btn\b/.test(n)) return 'button';
  if (/field|input|text ?area|dropdown|select|search|combo ?box|autocomplete/.test(n)) return 'field';
  if (/chip|tag\b|badge/.test(n)) return 'chip';
  if (/\btabs?\b/.test(n)) return 'tab';
  if (/pagination|page ?item/.test(n)) return 'button';
  if (/list ?item|menu ?item|option|\brow\b/.test(n)) return 'option';
  if (/icon|arrow|chevron|caret/.test(n)) return 'icon';
  return null;
}

// ─── Figma side ──────────────────────────────────────────────────────────────

function firstSolid(paints) {
  const p = (paints || []).find(x => x.visible !== false);
  if (!p) return null;
  return p.type === 'SOLID' ? figmaColorToHex(p.color, p.opacity) : p.type.toLowerCase();
}

function firstText(n) {
  if (n.type === 'TEXT' && (n.characters || '').trim()) return n.characters;
  for (const c of n.children || []) {
    if (c.visible === false) continue;
    const t = firstText(c);
    if (t) return t;
  }
  return null;
}

function blockOf(n, o) {
  const b = n.absoluteBoundingBox;
  if (!b) return null;
  const stroke = firstSolid(n.strokes);
  const auto = n.layoutMode && n.layoutMode !== 'NONE';
  return {
    id: n.id, name: n.name, type: n.type, role: figmaRole(n.name),
    label: firstText(n),
    box: { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height },
    fill: firstSolid(n.fills),
    radius: Array.isArray(n.rectangleCornerRadii) ? n.rectangleCornerRadii : (n.cornerRadius || 0),
    stroke: stroke && n.strokeWeight ? { width: n.strokeWeight, color: stroke } : null,
    padding: auto ? [n.paddingTop || 0, n.paddingRight || 0, n.paddingBottom || 0, n.paddingLeft || 0] : null,
    gap: auto ? (n.itemSpacing || 0) : null
  };
}

function findNode(root, id) {
  if (root.id === id) return root;
  for (const c of root.children || []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

/** Block data of any node in the tree (for explicit pairs / anchor), or null. */
export function figmaBlockById(root, id) {
  const o = root.absoluteBoundingBox || { x: 0, y: 0 };
  const node = findNode(root, id);
  return node ? blockOf(node, o) : null;
}

export function collectFigma(root, { ignoreFigmaNodes = [] } = {}) {
  const o = root.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };
  const skip = new Set(ignoreFigmaNodes.map(id => id.replace(/-/g, ':')));
  const texts = [];
  const blocks = [];
  const walk = (n) => {
    if (n.visible === false || skip.has(n.id)) return;
    const b = n.absoluteBoundingBox;
    const box = b ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    if (n.type === 'TEXT' && (n.characters || '').trim()) {
      const st = textStyleOf(n);
      texts.push({
        id: n.id, name: n.name, text: n.characters, box,
        align: n.style?.textAlignHorizontal || 'LEFT',
        family: st.font.family, size: st.font.size, weight: st.font.weight,
        lineHeight: st.font.lineHeightPx, letterSpacing: st.font.letterSpacing || 0,
        textTransform: TEXT_CASE_TO_CSS[n.style?.textCase] || 'none',
        color: st.color, mixed: st.mixed
      });
    } else if (n !== root && box && ['FRAME', 'RECTANGLE', 'INSTANCE', 'COMPONENT', 'GROUP', 'ELLIPSE'].includes(n.type)) {
      const blk = blockOf(n, o);
      const styled = blk.fill || blk.stroke || (Array.isArray(blk.radius) ? blk.radius.some(Boolean) : blk.radius) ||
        (blk.padding && blk.padding.some(Boolean));
      // Components are blocks even when unstyled (their size matters: field 32 vs 44)
      if (styled || n.type === 'INSTANCE' || n.type === 'COMPONENT' || blk.role) blocks.push(blk);
    }
    (n.children || []).forEach(walk);
  };
  walk(root);
  return { texts, blocks, rootBox: { w: o.width, h: o.height } };
}

// ─── page side (runs in the browser) ─────────────────────────────────────────

/* eslint-disable no-undef */
export function collectPageInBrowser(rootSelector, pairSelectors, maxEls, anchorSelector, ignoreSelectors) {
  const root = document.querySelector(rootSelector);
  if (!root) return { error: `Element not found: ${rootSelector}` };
  const r0 = root.getBoundingClientRect();
  const ignored = [];
  for (const sel of ignoreSelectors || []) {
    try { ignored.push(...root.querySelectorAll(sel)); } catch (e) { return { error: `Invalid ignoreSelectors: ${sel}` }; }
  }
  const isIgnored = el => ignored.some(x => x === el || x.contains(el));
  const toHex = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return c;
    const [r, g, b, a = '1'] = m[1].split(/[,\s/]+/).filter(Boolean);
    const h = v => Math.round(Number(v)).toString(16).padStart(2, '0');
    const alpha = Number(a);
    if (alpha === 0) return 'transparent';
    return `#${h(r)}${h(g)}${h(b)}${alpha < 0.999 ? h(alpha * 255) : ''}`;
  };
  const px = v => (v === 'normal' ? 'normal' : Math.round(parseFloat(v) * 100) / 100);

  // Unique selector inside root: stable attributes first, nth-of-type on every level
  const STABLE = ['data-testid', 'data-test', 'data-qa', 'data-pp', 'data-pp-h', 'col-id', 'name', 'aria-label', 'for'];
  const autoId = id => /^(mui-|:r|react-|ember|ext-gen|radix-)|\d{3,}/.test(id);
  const esc = v => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'));
  const unique = sel => { try { return root.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const selectorOf = (el) => {
    const parts = [];
    for (let n = el; n && n !== root && parts.length < 10; n = n.parentElement) {
      let p = n.tagName.toLowerCase();
      if (n.id && !autoId(n.id)) {
        p = `#${esc(n.id)}`;
      } else {
        const attr = STABLE.find(a => n.hasAttribute && n.hasAttribute(a) && String(n.getAttribute(a)).length < 60);
        if (attr) {
          const v = n.getAttribute(attr);
          p += v ? `[${attr}="${String(v).replace(/"/g, '\\"')}"]` : `[${attr}]`;
        } else {
          const cls = typeof n.className === 'string'
            ? n.className.trim().split(/\s+/).filter(c => c && !/^(css|sc|jss|emotion)-|\d{3,}/.test(c)).slice(0, 1) : [];
          if (cls.length) p += '.' + esc(cls[0]);
          const sib = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
          if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
        }
      }
      parts.unshift(p);
      if (unique(parts.join(' > '))) break;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  };
  const rel = r => ({ x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height });
  const boxOf = el => rel(el.getBoundingClientRect());
  // Box of the glyphs of the element's own text nodes
  const textBox = (el) => {
    const nodes = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const rc of range.getClientRects()) {
        if (!rc.width && !rc.height) continue;
        l = Math.min(l, rc.left); t = Math.min(t, rc.top); r = Math.max(r, rc.right); b = Math.max(b, rc.bottom);
      }
    }
    return l === Infinity ? boxOf(el) : rel({ left: l, top: t, width: r - l, height: b - t });
  };
  const visible = (el, cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  const textStyle = (cs) => ({
    family: cs.fontFamily, size: px(cs.fontSize), weight: Number(cs.fontWeight) || cs.fontWeight,
    lineHeight: px(cs.lineHeight), letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
    color: toHex(cs.color), textTransform: cs.textTransform
  });
  const roleOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const cls = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
    if (role === 'checkbox' || /MuiCheckbox-root/.test(cls) || (tag === 'input' && el.type === 'checkbox')) return 'checkbox';
    if (role === 'radio' || /MuiRadio-root/.test(cls) || (tag === 'input' && el.type === 'radio')) return 'radio';
    if (role === 'switch' || /MuiSwitch-root/.test(cls)) return 'switch';
    if (role === 'tab' || /MuiTab-root/.test(cls)) return 'tab';
    if (/MuiChip-root|(^|\s|-)chip(\s|$|-)/i.test(cls)) return 'chip';
    if (tag === 'button' || role === 'button' || /MuiPaginationItem-root/.test(cls)) return 'button';
    if (/MuiInputBase-root|MuiOutlinedInput-root|MuiSelect-root/.test(cls) || role === 'combobox' ||
      ['input', 'textarea', 'select'].includes(tag)) return 'field';
    if (role === 'option' || role === 'menuitem' || /MuiMenuItem-root|MuiListItem/.test(cls)) return 'option';
    if (tag === 'svg') return 'icon';
    return null;
  };
  // An input's visual box is its wrapper (border/background), not the bare <input>
  const fieldBox = (el) => {
    let n = el;
    for (let i = 0; i < 3 && n.parentElement && n.parentElement !== root; i++) {
      const p = n.parentElement;
      const cs = getComputedStyle(p);
      const cls = typeof p.className === 'string' ? p.className : '';
      if (parseFloat(cs.borderTopWidth) > 0 || toHex(cs.backgroundColor) !== 'transparent' || /InputBase-root|OutlinedInput-root|input|field/i.test(cls)) return p;
      n = p;
    }
    return el;
  };
  const blockData = (el, role) => {
    const vis = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') ? fieldBox(el) : el;
    const cs = getComputedStyle(vis);
    const bw = parseFloat(cs.borderTopWidth) || 0;
    // MUI outlined fields draw the border on a fieldset inside
    const fs = vis.querySelector && vis.querySelector(':scope > fieldset');
    const fcs = fs ? getComputedStyle(fs) : null;
    return {
      sel: selectorOf(vis), role,
      label: ((vis.innerText || vis.value || vis.getAttribute('aria-label') || '').trim()).slice(0, 60),
      box: boxOf(vis), background: toHex(cs.backgroundColor),
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(v => parseFloat(v) || 0),
      border: bw > 0 ? { width: bw, color: toHex(cs.borderTopColor) }
        : (fcs && parseFloat(fcs.borderTopWidth) > 0 ? { width: parseFloat(fcs.borderTopWidth), color: toHex(fcs.borderTopColor) } : null),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(v => parseFloat(v) || 0),
      gap: /flex|grid/.test(cs.display) ? (parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0) : null,
      _el: vis
    };
  };

  const texts = [];
  const blocks = [];
  const textEls = [];
  const blockEls = new Set();
  const roleEls = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let el = root; el; el = walker.nextNode()) {
    if (isIgnored(el)) continue;
    const cs = getComputedStyle(el);
    if (!visible(el, cs)) continue;
    const tag = el.tagName.toLowerCase();
    const isField = tag === 'input' || tag === 'textarea';
    const own = isField ? '' : [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim();
    if (own && texts.length < maxEls) {
      texts.push({ sel: selectorOf(el), text: own, full: (el.innerText || '').trim().slice(0, 200), box: textBox(el), ...textStyle(cs) });
      textEls.push(el);
    }
    // Field values and placeholders are texts in the design ("Multon..." inside a field)
    if ((tag === 'input' || tag === 'textarea') && !['checkbox', 'radio', 'hidden'].includes(el.type) && texts.length < maxEls) {
      const val = (el.value || el.placeholder || '').trim();
      if (val) {
        texts.push({ sel: selectorOf(el), text: val, full: val, box: boxOf(el), field: true, ...textStyle(cs) });
        textEls.push(el);
      }
    }
    if (el !== root && blocks.length < maxEls) {
      const role = roleOf(el);
      const target = role === 'field' && ['input', 'textarea', 'select'].includes(tag) ? fieldBox(el) : el;
      if (blockEls.has(target)) continue;
      // A control inside a wrapper of the same role (checkbox input in MuiCheckbox span): the wrapper is the visual box
      if (role) {
        let up = target.parentElement, same = false;
        for (let i = 0; i < 3 && up && up !== root; i++, up = up.parentElement) {
          if (roleEls.get(up) === role) { same = true; break; }
        }
        if (same) continue;
      }
      const tcs = target === el ? cs : getComputedStyle(target);
      const bg = toHex(tcs.backgroundColor);
      const bw = parseFloat(tcs.borderTopWidth) || 0;
      const radius = parseFloat(tcs.borderTopLeftRadius) || 0;
      const pad = [tcs.paddingTop, tcs.paddingRight, tcs.paddingBottom, tcs.paddingLeft].map(v => parseFloat(v) || 0);
      const styled = (bg && bg !== 'transparent') || bw > 0 || radius > 0 || pad.some(Boolean);
      if (role || styled) {
        const b = boxOf(target);
        if (b.w >= 4 && b.h >= 4) {
          blockEls.add(target);
          if (role) roleEls.set(target, role);
          blocks.push(blockData(el, role));
        }
      }
    }
  }
  const pairs = (pairSelectors || []).map(sel => {
    let el = null;
    try { el = root.querySelector(sel) || document.querySelector(sel); } catch (e) { el = null; }
    return el ? blockData(el, roleOf(el)) : null;
  });
  let anchorBox = null;
  let anchorText = null;
  if (anchorSelector) {
    let a = null;
    try { a = root.querySelector(anchorSelector) || document.querySelector(anchorSelector); } catch (e) { a = null; }
    if (a) {
      anchorBox = boxOf(a);
      // the text element of the anchor (the anchor itself or its first text inside)
      anchorText = textEls.findIndex(t => t === a || a.contains(t));
    }
  }
  window.__ctSpecEls = textEls;
  for (const b of [...blocks, ...pairs.filter(Boolean)]) delete b._el;
  return { texts, blocks, pairs, anchorBox, anchorText, rootBox: { w: r0.width, h: r0.height } };
}
/* eslint-enable no-undef */

// ─── matching ────────────────────────────────────────────────────────────────

const center = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
const sizeOk = (f, p) => {
  const rw = p.box.w / Math.max(f.box.w, 1), rh = p.box.h / Math.max(f.box.h, 1);
  return rw > 0.5 && rw < 2 && rh > 0.5 && rh < 2;
};

/**
 * Positions in one frame of reference: offset from the anchor (if any), otherwise from
 * the root, page scaled to Figma px.
 */
function makeFrame(anchor, ratio) {
  return {
    f: b => (anchor ? { x: b.x - anchor.f.x, y: b.y - anchor.f.y, w: b.w, h: b.h } : b),
    p: b => (anchor ? { x: b.x - anchor.p.x, y: b.y - anchor.p.y, w: b.w, h: b.h }
      : { x: b.x / ratio, y: b.y / ratio, w: b.w / ratio, h: b.h / ratio })
  };
}

/** Greedy global assignment: all candidate pairs sorted by distance, each side used once. */
function assign(cands, usedF, usedP, out, how) {
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    if (usedF.has(c.fi) || usedP.has(c.pi)) continue;
    usedF.add(c.fi); usedP.add(c.pi);
    out.push({ fi: c.fi, pi: c.pi, how, d: c.d });
  }
}

export function matchTexts(fTexts, pTexts, { mode = 'auto', frame, maxDist = 150, anchorPair = null } = {}) {
  const usedF = new Set(), usedP = new Set();
  const out = [];
  if (anchorPair) {
    usedF.add(anchorPair.fi); usedP.add(anchorPair.pi);
    out.push({ ...anchorPair, how: 'anchor', d: 0 });
  }
  if (mode === 'order') {
    let j = 0;
    fTexts.forEach((f, i) => {
      if (usedF.has(i)) return;
      while (usedP.has(j)) j++;
      if (j < pTexts.length) { out.push({ fi: i, pi: j, how: 'order' }); usedF.add(i); usedP.add(j); j++; }
    });
    return { pairs: out, usedF, usedP };
  }
  const fc = fTexts.map(f => (f.box ? center(frame.f(f.box)) : null));
  const pc = pTexts.map(p => center(frame.p(p.box)));
  const fKey = fTexts.map(f => normText(f.text));
  const pKeys = pTexts.map(p => [normText(p.text), normText(p.full)]);

  // 1) equal text: per text value, nearest pairs first; duplicates must be close
  const groups = new Map();
  fKey.forEach((k, i) => { if (!usedF.has(i) && k && fc[i]) (groups.get(k) || groups.set(k, { f: [], p: [] }).get(k)).f.push(i); });
  pKeys.forEach(([k1, k2], i) => {
    if (usedP.has(i)) return;
    for (const k of new Set([k1, k2])) if (groups.has(k)) groups.get(k).p.push(i);
  });
  for (const g of groups.values()) {
    if (!g.p.length) continue;
    const dup = g.f.length > 1 || g.p.length > 1;
    const cands = [];
    for (const fi of g.f) for (const pi of g.p) {
      const d = dist(fc[fi], pc[pi]);
      if (!dup || d <= maxDist) cands.push({ fi, pi, d });
    }
    assign(cands, usedF, usedP, out, 'text');
  }

  // 2) prefix: truncated texts ("Very long na..."), similar length, close by
  const cands = [];
  fKey.forEach((fk, fi) => {
    if (usedF.has(fi) || !fc[fi] || fk.length < 4) return;
    pKeys.forEach(([pk], pi) => {
      if (usedP.has(pi) || pk.length < 4) return;
      const [s, l] = fk.length <= pk.length ? [fk, pk] : [pk, fk];
      const truncated = /(\.\.\.|…)\s*$/.test(fTexts[fi].text);
      if (!l.startsWith(s) || (!truncated && s.length / l.length < 0.6)) return;
      const d = dist(fc[fi], pc[pi]);
      if (d <= maxDist) cands.push({ fi, pi, d });
    });
  });
  assign(cands, usedF, usedP, out, 'prefix');
  return { pairs: out, usedF, usedP };
}

export function matchBlocks(fBlocks, pBlocks, { frame, maxDist = 150, minIoU = 0.6 } = {}) {
  const usedF = new Set(), usedP = new Set();
  const out = [];
  const fb = fBlocks.map(b => frame.f(b.box));
  const pb = pBlocks.map(b => frame.p(b.box));
  const roleOk = (f, p) => !f.role || !p.role || f.role === p.role;

  // 1) same inner label ("Save" button <-> button "Save")
  let cands = [];
  fBlocks.forEach((f, fi) => {
    const fl = normText(f.label);
    if (!fl) return;
    pBlocks.forEach((p, pi) => {
      if (normText(p.label) !== fl || !roleOk(f, p) || !sizeOk(f, p)) return;
      if (!f.role && !p.role) return; // plain containers share labels with everything inside
      cands.push({ fi, pi, d: dist(center(fb[fi]), center(pb[pi])) });
    });
  });
  assign(cands, usedF, usedP, out, 'label');

  // 2) same role, nearest
  cands = [];
  fBlocks.forEach((f, fi) => {
    if (usedF.has(fi) || !f.role) return;
    pBlocks.forEach((p, pi) => {
      if (usedP.has(pi) || p.role !== f.role || !sizeOk(f, p)) return;
      const d = dist(center(fb[fi]), center(pb[pi]));
      if (d <= maxDist) cands.push({ fi, pi, d });
    });
  });
  assign(cands, usedF, usedP, out, 'role');

  // 3) overlap after alignment
  cands = [];
  fBlocks.forEach((f, fi) => {
    if (usedF.has(fi)) return;
    pBlocks.forEach((p, pi) => {
      if (usedP.has(pi) || !roleOk(f, p) || !sizeOk(f, p)) return;
      const v = iou(fb[fi], pb[pi]);
      if (v >= minIoU) cands.push({ fi, pi, d: 1 - v });
    });
  });
  assign(cands, usedF, usedP, out, 'overlap');
  return { pairs: out, usedF, usedP };
}

// ─── diffs ───────────────────────────────────────────────────────────────────

function hexToRgb(h) {
  const m = String(h || '').match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}
function sameColor(a, b, tol) {
  if (a === b) return true;
  if ((a === 'transparent' || !a) && (b === 'transparent' || !b)) return true;
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return false;
  return x.every((v, i) => Math.abs(v - y[i]) <= tol);
}
const num = v => (typeof v === 'number' ? v : parseFloat(v));
const fmt4 = a => (Array.isArray(a) ? (a.every(v => v === a[0]) ? String(round(a[0])) : a.map(round).join(' ')) : String(round(a || 0)));

/** Text position: x by alignment (left / center / right edge), y by the line center. */
function textPoint(box, align) {
  const x = align === 'CENTER' ? box.x + box.w / 2 : align === 'RIGHT' ? box.x + box.w : box.x;
  return { x, y: box.y + box.h / 2 };
}

export function diffText(f, p, props, tol) {
  const out = [];
  const add = (prop, fv, pv, ok) => { if (!ok) out.push({ prop, figma: fv, page: pv }); };
  if (props.includes('font-family')) {
    add('font-family', f.family, firstFamily(p.family) + (p.rendered && normFamily(p.rendered) !== normFamily(firstFamily(p.family)) ? ` (rendered: ${p.rendered})` : ''),
      normFamily(f.family) === normFamily(firstFamily(p.family)) && (!p.rendered || p.fontStatus !== 'fallback'));
  }
  if (props.includes('font-size')) add('font-size', f.size, p.size, Math.abs(num(f.size) - num(p.size)) <= tol.px);
  if (props.includes('font-weight')) add('font-weight', f.weight, p.weight, num(f.weight) === num(p.weight));
  if (props.includes('line-height') && f.lineHeight != null && !p.field) {
    add('line-height', f.lineHeight, p.lineHeight, p.lineHeight !== 'normal' && Math.abs(num(f.lineHeight) - num(p.lineHeight)) <= tol.px);
  }
  if (props.includes('letter-spacing')) add('letter-spacing', f.letterSpacing || 0, p.letterSpacing || 0, Math.abs(num(f.letterSpacing || 0) - num(p.letterSpacing || 0)) <= 0.1);
  if (props.includes('text-transform')) add('text-transform', f.textTransform, p.textTransform || 'none', (f.textTransform || 'none') === (p.textTransform || 'none'));
  if (props.includes('color')) add('color', f.color, p.color, sameColor(f.color, p.color, tol.color));
  if (props.includes('position') && tol.anchor && f.box && p.box && !p.field) {
    const fp = textPoint(f.box, f.align), pp = textPoint(p.box, f.align);
    const fa = textPoint(tol.anchor.f, 'LEFT'), pa = textPoint(tol.anchor.p, 'LEFT');
    positionDiff(out, { x: fp.x - fa.x, y: fp.y - fa.y }, { x: pp.x - pa.x, y: pp.y - pa.y }, tol,
      f.align === 'CENTER' ? 'center' : f.align === 'RIGHT' ? 'right edge' : null);
  }
  if (props.includes('height') && f.box && p.box) add('height', round(f.box.h), round(p.box.h), Math.abs(f.box.h - p.box.h) <= tol.px);
  return out;
}

export function diffBlock(f, p, props, tol) {
  const out = [];
  const add = (prop, fv, pv, ok) => { if (!ok) out.push({ prop, figma: fv, page: pv }); };
  if (props.includes('width')) add('width', round(f.box.w), round(p.box.w), Math.abs(f.box.w - p.box.w) <= tol.px);
  if (props.includes('height')) add('height', round(f.box.h), round(p.box.h), Math.abs(f.box.h - p.box.h) <= tol.px);
  if (props.includes('padding') && f.padding) {
    add('padding', fmt4(f.padding), fmt4(p.padding), f.padding.every((v, i) => Math.abs(v - (p.padding?.[i] || 0)) <= tol.px));
  }
  if (props.includes('gap') && f.gap != null) add('gap', f.gap, p.gap ?? 'none', p.gap != null && Math.abs(f.gap - p.gap) <= tol.px);
  if (props.includes('border-radius')) {
    const fr = Array.isArray(f.radius) ? f.radius : [f.radius, f.radius, f.radius, f.radius];
    add('border-radius', fmt4(fr), fmt4(p.radius), fr.every((v, i) => Math.abs((v || 0) - (p.radius?.[i] || 0)) <= tol.px));
  }
  if (props.includes('background')) add('background', f.fill || 'none', p.background || 'transparent', sameColor(f.fill || 'transparent', p.background || 'transparent', tol.color));
  if (props.includes('border')) {
    const fb = f.stroke ? `${round(f.stroke.width)} ${f.stroke.color}` : 'none';
    const pb = p.border ? `${round(p.border.width)} ${p.border.color}` : 'none';
    const ok = (!f.stroke && !p.border) || (f.stroke && p.border && Math.abs(f.stroke.width - p.border.width) <= tol.px && sameColor(f.stroke.color, p.border.color, tol.color));
    add('border', fb, pb, ok);
  }
  if (props.includes('position') && tol.anchor) {
    positionDiff(out, { x: f.box.x - tol.anchor.f.x, y: f.box.y - tol.anchor.f.y },
      { x: p.box.x - tol.anchor.p.x, y: p.box.y - tol.anchor.p.y }, tol, null);
  }
  return out;
}

function positionDiff(out, fo, po, tol, ref) {
  if (Math.abs(fo.x - po.x) <= tol.pos && Math.abs(fo.y - po.y) <= tol.pos) return;
  out.push({
    prop: ref ? `position (${ref})` : 'position',
    figma: `${r1(fo.x)}, ${r1(fo.y)}`,
    page: `${r1(po.x)}, ${r1(po.y)} (dx ${r1(po.x - fo.x)}, dy ${r1(po.y - fo.y)})`
  });
}

// ─── main ────────────────────────────────────────────────────────────────────

/**
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').Frame} ctx - frame for DOM work
 * @param {object} figmaRoot - Figma node document (the compared node)
 * @param {object} o - options from the tool
 */
export async function compareSpecs(page, ctx, figmaRoot, o) {
  const props = o.properties?.length ? o.properties : [...DEFAULT_TEXT_PROPS, ...DEFAULT_BLOCK_PROPS];
  // Default: text height is not compared (a text box is not the line box); explicit properties may ask for it
  const textProps = o.properties?.length ? props.filter(p => ALL_TEXT_PROPS.includes(p)) : DEFAULT_TEXT_PROPS;
  const blockProps = props.filter(p => DEFAULT_BLOCK_PROPS.includes(p));
  const tol = { px: o.tolerancePx ?? 0.5, color: o.colorTolerance ?? 2, pos: o.tolerancePositionPx ?? 2, anchor: null };
  const maxRows = o.maxRows ?? 80;
  const maxDist = o.maxPairDistancePx ?? 150;
  const ignoreRe = (o.ignoreTexts || []).map(r => new RegExp(r, 'i'));
  const keepText = t => !ignoreRe.some(re => re.test(t)) && !(o.match === 'static' && isDataLike(t));

  const figAll = collectFigma(figmaRoot, { ignoreFigmaNodes: o.ignoreFigmaNodes || [] });
  const fig = { ...figAll, texts: figAll.texts.filter(t => keepText(t.text)) };
  const pgAll = await ctx.evaluate(collectPageInBrowser, o.selector, (o.pairs || []).map(x => x.selector), 800,
    o.anchor?.selector || null, o.ignoreSelectors || []);
  if (pgAll.error) throw new Error(pgAll.error);

  // Rendered fonts (main frame only): spot web font fallbacks
  if (textProps.includes('font-family') && ctx === page.mainFrame()) {
    try {
      const fonts = await platformFontsFor(page, '__ctSpecEls');
      pgAll.texts.forEach((t, i) => {
        const v = fontVerdict(firstFamily(t.family), fonts[i]);
        t.rendered = v.rendered;
        t.fontStatus = v.status;
      });
    } catch { /* fonts are a bonus */ }
  }
  await ctx.evaluate(() => { delete window.__ctSpecEls; }).catch(() => {});

  const pgTextIdx = pgAll.texts.map((t, i) => i).filter(i => keepText(pgAll.texts[i].text));
  const pg = { ...pgAll, texts: pgTextIdx.map(i => pgAll.texts[i]) };

  // Anchor: fixed pair, positions are offsets from it
  let anchorPair = null;
  if (o.anchor) {
    const aid = o.anchor.figmaNodeId.replace(/-/g, ':');
    const fa = figmaBlockById(figmaRoot, aid);
    if (!fa) throw new Error(`anchor.figmaNodeId ${o.anchor.figmaNodeId} is not inside node ${figmaRoot.id}`);
    if (!pg.anchorBox) throw new Error(`anchor.selector not found: ${o.anchor.selector}`);
    tol.anchor = { f: fa.box, p: pg.anchorBox };
    const fi = fig.texts.findIndex(t => t.id === aid);
    const pi = pgAll.anchorText >= 0 ? pgTextIdx.indexOf(pgAll.anchorText) : -1;
    if (fi >= 0 && pi >= 0) anchorPair = { fi, pi };
  }

  // Page px per Figma px (only used without an anchor)
  const ratio = fig.rootBox.w > 0 && pg.rootBox.w > 0 ? pg.rootBox.w / fig.rootBox.w : 1;
  const frame = makeFrame(tol.anchor, ratio);

  const tm = matchTexts(fig.texts, pg.texts, { mode: o.match === 'order' ? 'order' : 'auto', frame, maxDist, anchorPair });
  const rows = [];
  const diffCount = {};
  const push = (kind, f, p, d, how) => {
    for (const x of d) diffCount[x.prop] = (diffCount[x.prop] || 0) + 1;
    if (o.onlyDiffs !== false && !d.length) return;
    const label = kind === 'text' ? String(f.text) : `${f.name}${f.role ? ` (${f.role})` : ''}`;
    rows.push({ kind, figma: `"${label.slice(0, 40)}" [${f.id}]`, page: p.sel, how, diffs: d });
  };
  for (const { fi, pi, how } of tm.pairs) push('text', fig.texts[fi], pg.texts[pi], diffText(fig.texts[fi], pg.texts[pi], textProps, tol), how);

  // Blocks: explicit pairs first, then label / role / overlap
  const explicit = [];
  (o.pairs || []).forEach((x, i) => {
    const f = figmaBlockById(figmaRoot, x.figmaNodeId.replace(/-/g, ':'));
    const p = pg.pairs[i];
    if (f && p) explicit.push({ f, p, how: 'pair' });
  });
  const restFig = fig.blocks.filter(b => !explicit.some(e => e.f.id === b.id));
  const bm = blockProps.length ? matchBlocks(restFig, pg.blocks, { frame, maxDist }) : { pairs: [], usedF: new Set() };
  for (const { f, p, how } of explicit) push('block', f, p, diffBlock(f, p, blockProps, tol), how);
  for (const { fi, pi, how } of bm.pairs) push('block', restFig[fi], pg.blocks[pi], diffBlock(restFig[fi], pg.blocks[pi], blockProps, tol), how);

  const unmatchedFigmaTexts = fig.texts.filter((f, i) => !tm.usedF.has(i)).map(f => `"${String(f.text).slice(0, 40)}" [${f.id}]`);
  const unmatchedPageTexts = pg.texts.filter((p, i) => !tm.usedP.has(i)).map(p => `"${String(p.text).slice(0, 40)}" ${p.sel}`);
  // Components without a pair: worth checking by hand (field, button, checkbox...)
  const unmatchedFigmaBlocks = restFig.filter((b, i) => !bm.usedF.has(i) && (b.role || b.type === 'INSTANCE'))
    .map(b => `${b.name}${b.role ? ` (${b.role})` : ''} ${r1(b.box.w)}x${r1(b.box.h)} [${b.id}]`);

  const lines = [];
  let bytes = 0;
  let shown = 0;
  for (const r of rows) {
    if (shown >= maxRows || bytes > 38000) break;
    const head = `${r.kind === 'text' ? 'T' : 'B'} Figma ${r.figma} <-> ${r.page}${r.how && r.how !== 'text' ? ` (${r.how})` : ''}`;
    const body = r.diffs.length ? r.diffs.map(d => `    ${d.prop}: figma ${d.figma} | page ${d.page}`).join('\n') : '    no differences';
    lines.push(head + '\n' + body);
    bytes += head.length + body.length;
    shown++;
  }

  return {
    summary: {
      figmaTexts: fig.texts.length, pageTexts: pg.texts.length, matchedTexts: tm.pairs.length,
      figmaBlocks: fig.blocks.length, pageBlocks: pg.blocks.length, matchedBlocks: explicit.length + bm.pairs.length,
      rowsWithDiffs: rows.filter(r => r.diffs.length).length,
      diffsByProperty: diffCount,
      ...(tol.anchor ? {} : { scale: round(ratio) }),
      tolerance: { px: tol.px, color: tol.color, ...(tol.anchor ? { positionPx: tol.pos, anchor: o.anchor } : {}) },
      ...(o.anchor && !anchorPair ? { note: 'anchor is not a text pair (block anchor or no text inside): positions still use it' } : {})
    },
    text: lines.join('\n') + (rows.length > shown ? `\n... ${rows.length - shown} more rows (maxRows / size limit)` : ''),
    unmatchedFigmaTexts: unmatchedFigmaTexts.slice(0, 30),
    unmatchedPageTexts: unmatchedPageTexts.slice(0, 30),
    unmatchedFigmaBlocks: unmatchedFigmaBlocks.slice(0, 30),
    unmatchedCounts: { figmaTexts: unmatchedFigmaTexts.length, pageTexts: unmatchedPageTexts.length, figmaBlocks: unmatchedFigmaBlocks.length },
    mixedStyleTexts: fig.texts.filter(t => t.mixed).map(t => `[${t.id}] ${JSON.stringify(t.mixed)}`).slice(0, 10)
  };
}

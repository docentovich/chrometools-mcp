/**
 * utils/figma-tree.js
 *
 * Compact view of a Figma node tree: boxes relative to the root, auto-layout
 * (padding, gap), radius, fill, stroke, effects and text styles. Used by
 * getFigmaNodeTree and compareFigmaSpecs. Defaults and empty values are omitted.
 */

const round = n => Math.round(n * 100) / 100;

/** Figma color {r,g,b,a} (0..1) + extra opacity -> #rrggbb or #rrggbbaa */
export function figmaColorToHex(color, opacity = 1) {
  if (!color) return null;
  const to = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  const a = (color.a ?? 1) * (opacity ?? 1);
  return `#${to(color.r)}${to(color.g)}${to(color.b)}${a < 0.999 ? to(a) : ''}`;
}

function firstPaint(paints) {
  if (!Array.isArray(paints)) return null;
  const p = paints.find(x => x.visible !== false);
  if (!p) return null;
  if (p.type === 'SOLID') return figmaColorToHex(p.color, p.opacity);
  if (p.type === 'IMAGE') return 'image';
  return p.type.toLowerCase().replace('gradient_', 'gradient-');
}

function radiusOf(node) {
  if (Array.isArray(node.rectangleCornerRadii)) {
    const r = node.rectangleCornerRadii.map(round);
    return r.every(x => x === r[0]) ? (r[0] || undefined) : r;
  }
  return node.cornerRadius ? round(node.cornerRadius) : undefined;
}

function effectsOf(node) {
  const list = (node.effects || []).filter(e => e.visible !== false);
  if (!list.length) return undefined;
  return list.map(e => {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      return `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${round(e.offset?.x || 0)} ${round(e.offset?.y || 0)} ${round(e.radius || 0)} ${round(e.spread || 0)} ${figmaColorToHex(e.color)}`;
    }
    return `${e.type.toLowerCase()} ${round(e.radius || 0)}`;
  });
}

/** Text style of a TEXT node (base style; mixed overrides flagged). */
export function textStyleOf(node) {
  const st = node.style || {};
  const font = {
    family: st.fontFamily,
    size: st.fontSize,
    weight: st.fontWeight,
    lineHeightPx: st.lineHeightPx != null ? round(st.lineHeightPx) : undefined,
    letterSpacing: st.letterSpacing ? round(st.letterSpacing) : undefined,
    italic: st.italic || undefined,
    textCase: st.textCase && st.textCase !== 'ORIGINAL' ? st.textCase : undefined,
    align: st.textAlignHorizontal && st.textAlignHorizontal !== 'LEFT' ? st.textAlignHorizontal : undefined
  };
  const overrides = node.characterStyleOverrides || [];
  const table = node.styleOverrideTable || {};
  let mixed;
  if (overrides.some(x => x && x !== 0)) {
    const variants = Object.values(table).map(o => [o.fontFamily, o.fontSize, o.fontWeight].filter(Boolean).join(' ')).filter(Boolean);
    mixed = variants.length ? [...new Set(variants)].slice(0, 5) : true;
  }
  return { font, color: firstPaint(node.fills), mixed };
}

const strip = obj => {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null || (Array.isArray(v) && !v.length) ||
      (typeof v === 'object' && !Array.isArray(v) && Object.keys(strip(v)).length === 0)) {
      delete obj[k];
    }
  }
  return obj;
};

/**
 * One node, compact, without children.
 * @param {object} node
 * @param {{x: number, y: number}} origin - root box origin
 */
export function compactNode(node, origin) {
  const b = node.absoluteBoundingBox;
  const out = {
    id: node.id,
    name: node.name,
    type: node.type,
    box: b ? [round(b.x - origin.x), round(b.y - origin.y), round(b.width), round(b.height)] : undefined,
    hidden: node.visible === false ? true : undefined,
    opacity: node.opacity != null && node.opacity < 1 ? round(node.opacity) : undefined
  };
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    const pad = [node.paddingTop || 0, node.paddingRight || 0, node.paddingBottom || 0, node.paddingLeft || 0].map(round);
    out.layout = {
      mode: node.layoutMode,
      padding: pad.some(Boolean) ? pad : undefined,
      gap: node.itemSpacing ? round(node.itemSpacing) : undefined,
      align: [node.primaryAxisAlignItems, node.counterAxisAlignItems].filter(Boolean).join('/') || undefined,
      wrap: node.layoutWrap === 'WRAP' ? true : undefined
    };
  }
  out.radius = radiusOf(node);
  if (node.type !== 'TEXT') out.fill = firstPaint(node.fills);
  const stroke = firstPaint(node.strokes);
  if (stroke && node.strokeWeight) {
    out.stroke = `${round(node.strokeWeight)} ${stroke}${node.strokeAlign && node.strokeAlign !== 'INSIDE' ? ' ' + node.strokeAlign.toLowerCase() : ''}`;
  }
  out.effects = effectsOf(node);
  if (node.type === 'TEXT') {
    const chars = node.characters || '';
    out.chars = chars.length > 120 ? chars.slice(0, 117) + '...' : chars;
    Object.assign(out, textStyleOf(node));
  }
  return strip(out);
}

/**
 * Compact tree with a size guard.
 * @param {object} root - Figma node (document of /nodes)
 * @param {{depth?: number, includeHidden?: boolean, textOnly?: boolean, maxBytes?: number}} opts
 */
export function compactTree(root, { depth = 6, includeHidden = false, textOnly = false, maxBytes = 60000 } = {}) {
  const origin = root.absoluteBoundingBox ? { x: root.absoluteBoundingBox.x, y: root.absoluteBoundingBox.y } : { x: 0, y: 0 };
  let bytes = 0;
  let count = 0;
  let truncated = false;
  let total = 0;

  const countAll = n => { total++; (n.children || []).forEach(countAll); };
  countAll(root);

  const walk = (node, level) => {
    if (!includeHidden && node.visible === false) return null;
    if (truncated) return null;
    const c = compactNode(node, origin);
    bytes += JSON.stringify(c).length;
    count++;
    if (bytes > maxBytes) { truncated = true; }
    if (level < depth && node.children?.length && !truncated) {
      const kids = node.children.map(ch => walk(ch, level + 1)).filter(Boolean);
      if (kids.length) c.children = kids;
    } else if (node.children?.length && level >= depth) {
      c.childrenNotShown = node.children.length;
    }
    return c;
  };

  if (textOnly) {
    const texts = [];
    const collect = (node) => {
      if (!includeHidden && node.visible === false) return;
      if (node.type === 'TEXT') {
        if (bytes > maxBytes) { truncated = true; return; }
        const c = compactNode(node, origin);
        bytes += JSON.stringify(c).length;
        texts.push(c);
      }
      (node.children || []).forEach(collect);
    };
    collect(root);
    return { root: { id: root.id, name: root.name, type: root.type, box: compactNode(root, origin).box }, texts, textCount: texts.length, truncated };
  }

  const tree = walk(root, 0);
  return { root: tree, nodeCount: count, totalNodes: total, truncated };
}

/** Flat list of all visible nodes (full objects) with their depth. */
export function flattenNodes(root, { includeHidden = false } = {}) {
  const out = [];
  const walk = (node, level, parent) => {
    if (!includeHidden && node.visible === false) return;
    out.push({ node, level, parent });
    (node.children || []).forEach(ch => walk(ch, level + 1, node));
  };
  walk(root, 0, null);
  return out;
}

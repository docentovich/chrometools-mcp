/**
 * utils/platform-fonts.js
 *
 * Which font Chrome actually rendered for an element (CSS.getPlatformFontsForNode):
 * the web font, or a system fallback because the web font did not load or has no
 * such weight. Computed style only shows the declared family, not the used one.
 */

/** First family of a font-family list, without quotes, lower case. */
export function firstFamily(fontFamily) {
  return String(fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
}

const norm = s => String(s || '').toLowerCase().replace(/["']/g, '').replace(/[\s_-]+/g, ' ').trim();

/**
 * Rendered fonts for elements stored in window[globalName] (array of Elements).
 * @param {import('puppeteer').Page} page
 * @param {string} globalName
 * @returns {Promise<Array<Array<{familyName: string, postScriptName: string, isCustomFont: boolean, glyphCount: number}>|null>>}
 */
export async function platformFontsFor(page, globalName) {
  const client = await page.target().createCDPSession();
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    await client.send('DOM.getDocument', { depth: 0 });
    const { result } = await client.send('Runtime.evaluate', { expression: `window[${JSON.stringify(globalName)}] || []` });
    if (!result.objectId) return [];
    const { result: props } = await client.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
    const items = props.filter(p => /^\d+$/.test(p.name) && p.value?.objectId)
      .sort((a, b) => Number(a.name) - Number(b.name));
    const out = [];
    for (const item of items) {
      try {
        const { nodeId } = await client.send('DOM.requestNode', { objectId: item.value.objectId });
        // Platform fonts are reported for text nodes under the element too; the element node is enough
        const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
        out[Number(item.name)] = fonts;
      } catch {
        out[Number(item.name)] = null;
      }
    }
    return out;
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Verdict for one element: rendered font vs declared family.
 * @returns {{rendered: string|null, custom: boolean, status: 'webfont'|'ok'|'fallback'|'unknown'}}
 */
export function fontVerdict(declaredFamily, fonts) {
  if (!fonts || !fonts.length) return { rendered: null, custom: false, status: 'unknown' };
  const main = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0];
  const d = norm(declaredFamily);
  const r = norm(main.familyName);
  const same = d && r && (r === d || r.startsWith(d) || d.startsWith(r));
  let status;
  if (main.isCustomFont) status = same ? 'webfont' : 'webfont-other';
  else status = same ? 'ok' : 'fallback';
  return { rendered: main.familyName, custom: !!main.isCustomFont, status, others: fonts.length > 1 ? fonts.map(f => f.familyName) : undefined };
}

/**
 * Font report for text-bearing elements under a selector.
 * @param {import('puppeteer').Page} page
 * @param {{selector?: string, maxElements?: number}} opts
 */
export async function fontReport(page, { selector = 'body', maxElements = 300 } = {}) {
  const info = await page.evaluate((sel, max) => {
    const root = document.querySelector(sel);
    if (!root) return { error: `Element not found: ${sel}` };
    const els = [];
    const describe = (el) => {
      let d = el.tagName.toLowerCase();
      if (el.id) return d + '#' + el.id;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) d += '.' + cls.join('.');
      return d;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let total = 0;
    for (let el = root; el; el = walker.nextNode()) {
      const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!ownText) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      total++;
      if (els.length >= max) continue;
      els.push({ el, desc: describe(el), family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle, size: cs.fontSize });
    }
    window.__ctFontEls = els.map(e => e.el);
    const faces = [];
    try {
      document.fonts.forEach(f => faces.push({ family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, style: f.style, status: f.status }));
    } catch (e) { /* no FontFaceSet */ }
    return { total, els: els.map(({ el, ...rest }) => rest), faces };
  }, selector, maxElements);
  if (info.error) throw new Error(info.error);

  const fonts = await platformFontsFor(page, '__ctFontEls');
  await page.evaluate(() => { delete window.__ctFontEls; }).catch(() => {});

  // Group: declared family + weight -> rendered font
  const groups = new Map();
  info.els.forEach((e, i) => {
    const declared = firstFamily(e.family);
    const v = fontVerdict(declared, fonts[i]);
    const key = `${declared}|${e.weight}|${v.rendered}|${v.status}`;
    if (!groups.has(key)) {
      groups.set(key, { declared, declaredStack: e.family, weight: e.weight, rendered: v.rendered, status: v.status, count: 0, sizes: new Set(), examples: [] });
    }
    const g = groups.get(key);
    g.count++;
    g.sizes.add(e.size);
    if (g.examples.length < 3) g.examples.push(e.desc);
  });

  const rows = [...groups.values()]
    .sort((a, b) => (a.status === 'fallback' ? -1 : 0) - (b.status === 'fallback' ? -1 : 0) || b.count - a.count)
    .map(g => ({ ...g, sizes: [...g.sizes].slice(0, 6) }));

  const failedFaces = info.faces.filter(f => f.status === 'error');
  const declaredFamilies = new Set(rows.map(r => norm(r.declared)));
  const unusedOrUnloaded = info.faces.filter(f => f.status !== 'loaded' && declaredFamilies.has(norm(f.family)));

  return {
    selector,
    textElements: info.total,
    analyzed: info.els.length,
    summary: rows.map(r => {
      const label = r.status === 'fallback' ? 'FALLBACK' : r.status === 'webfont' ? 'web font' : r.status === 'ok' ? 'system font' : r.status;
      return `declared "${r.declared}" ${r.weight} -> rendered "${r.rendered}" (${label}): ${r.count} element(s), sizes ${r.sizes.join(' ')}, e.g. ${r.examples.join(', ')}`;
    }),
    groups: rows,
    fontFaces: info.faces,
    failedFontFaces: failedFaces,
    notLoadedDeclaredFaces: unusedOrUnloaded
  };
}

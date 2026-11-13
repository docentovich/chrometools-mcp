# Figma layout check: bugs and pixel-perfect tooling

Source: report from a work session 2026-11-10. React SPA (hash routing, rspack dev server), three screens checked against Figma, viewport 1440x904.

Status: CODE COMPLETE (phases 1-6), needs live check

## Findings in code

| # | Report | Cause found | Where |
|---|---|---|---|
| 1 | Viewport resets after navigateTo (2328 px, DPR 1.1) | `setViewport` is not stored anywhere. Override lives only in the CDP session of the current Page object. A new tab (navigateTo falls back to `getOrCreatePage` when `lastPage` is lost), a reconnect, or MCP restart gives the window size back. Exact trigger not reproduced yet | `index.js` setViewport / navigateTo, `browser/page-manager.js` |
| 2 | navigateTo returns title of the previous page | Hash navigation: `page.goto` resolves on same-document navigation at once, `page.title()` is read before the router updates it | `index.js` navigateTo |
| 3 | Dev error overlay not reported | Diagnostics look only at console and network logs, DOM is not checked | `utils/post-click-diagnostics.js` |
| 4 | Console errors print `undefined` | `collectErrors` reads `log.text`, the log stores `log.message`. Stack is not printed. `Runtime.exceptionThrown` (uncaught errors) is not captured at all | `post-click-diagnostics.js:122`, `page-manager.js:265,465` |
| 5 | click reports success, nothing changed | `dom-sequence-intercepted` = element was covered at its center (`elementFromPoint`), so synthetic untrusted events were dispatched. The covering element is not reported, there is no check that anything changed. Likely covered by the same webpack overlay (#3) | `utils/actions/click-action.js:66-95` |
| 6 | saveScreenshot of `body` is 1425x928 at 1440x904 viewport | Clip = body box: width without scrollbar (1440-15), height of body. No viewport mode. Default `maxWidth: 1024` silently rescales | `index.js` saveScreenshot |
| 7 | Screenshots hang 120 s | Covered by [CONNECT-CAPTURE](CONNECT-CAPTURE_SPEC.md) (minimized window, connect timeout). Not part of this spec | |
| 8 | executeScript: top-level `await` fails | Fallback wrap into async IIFE happens only for "Illegal return" SyntaxError | `index.js` executeScript |
| 9 | Figma token needed in every call | `FIGMA_TOKEN` and `FIGMA_TOKEN_FILE` are supported since 3.7.0 and set in the global MCP config. But: npm has 3.6.0 (no `FIGMA_TOKEN_FILE`), projects `C:/prj/chrometools-mcp` and `C:/Users/user` override the server with `npx chrometools-mcp` without env. Tool descriptions say only "API token (optional)", so the agent passes it anyway. `FIGMA_TOKEN_FILE` is not in README | `index.js:124-131`, `server/tool-definitions.js` |
| 10 | Figma 429 | No retry, no cache. Every compare does export + download again | `figma-tools.js` fetchFigmaAPI |
| 11 | No batch export / tree with styles | getFigmaFrame and getFigmaSpecs take one node, specs give only direct children text | `index.js` getFigmaFrame / getFigmaSpecs |
| 12 | getComputedCss: one selector | One CDP query per call | `index.js` getComputedCss |
| 13 | compareFigmaToElement: top-left, no scale, whole screen useless | Also: default `figmaScale: 2` vs page DPR 1 gives size mismatch on every call | `index.js` compareFigmaToElement |
| 14 | Spec diff instead of pixels | Not implemented | |
| 15 | Rendered font vs fallback | Not implemented. CDP `CSS.getPlatformFontsForNode` gives the font actually used | |
| 16 | Viewport from Figma frame | Not implemented | |

## Phase 1. Bugs (1-6, 8, 9)

### 1.1 Viewport persists (#1)

- `page-manager.js`: `requestedViewport` (session level, last `setViewport` call) and per-target map `targetId -> {width, height, deviceScaleFactor}`.
- `ensureViewport(page)`: compare `innerWidth/innerHeight/devicePixelRatio` with the stored value, re-apply `page.setViewport` on mismatch, return `{reapplied, before}`.
- Called in: navigateTo (after settle), `capture()` before any screenshot, `switchTab`, after reconnect in `browser-manager.js`.
- Pages created by chrometools (`getOrCreatePage`) get `requestedViewport` if set.
- navigateTo: if `getLastOpenPage` failed and a new tab was opened, say so in output ("previous tab lost, opened new tab"). If viewport was re-applied, print `Viewport: 1440x904 DPR 1 (re-applied, was 2328x... DPR 1.1)`.
- setViewport output: warning when actual differs from requested.
- Find the trigger: reproduce hash navigation after setViewport on a local SPA, log whether `lastPage` changed and whether the target was re-created.

### 1.2 SPA title (#2)

- `waitForSpaSettle(page, {prevTitle})` after `goto`: poll every 100 ms, done when title and DOM (MutationObserver counter) are stable for 300 ms; max 2000 ms (`CHROMETOOLS_SPA_SETTLE_MS`).
- Title and hints (heading) are read after settle.
- If title is equal to the title before navigation: `Page title: X (unchanged after navigation)`.

### 1.3 Dev error overlays (#3)

- `detectErrorOverlays(page)` in diagnostics, runs for navigateTo / click / openBrowser:
  - `#webpack-dev-server-client-overlay` (iframe, read `contentDocument` text);
  - `vite-error-overlay` (shadowRoot);
  - `nextjs-portal` (shadowRoot);
  - CRA `iframe` react-error-overlay, `#__parcel__error__overlay__`.
- Visible overlay: `hasErrors = true`, output `Dev error overlay covers the page (webpack-dev-server): <first 500 chars>`, no "No errors detected".

### 1.4 Console error text and stack (#4)

- One helper `attachConsoleCapture(page, client)` instead of two copies in page-manager.
- `collectErrors`: `message: log.message ?? log.text`, plus `stack`: top 5 frames `fn (url:line:col)` from `stackTrace.callFrames`.
- Listen to `Runtime.exceptionThrown`: type `error`, message from `exceptionDetails.exception.description || text`, stack from `exceptionDetails.stackTrace`.
- Output: message, then stack lines indented, each error trimmed to 800 chars.

### 1.5 Click feedback (#5)

- Intercepted path: describe the covering element (`tag#id.class`, 60 chars of text) and print `[dom-sequence-intercepted: covered by iframe#webpack-dev-server-client-overlay, synthetic untrusted events]`.
- Change check: before click install a MutationObserver on `document` (subtree, attributes, childList) and remember URL, `document.activeElement`, target `aria-selected/aria-expanded/aria-checked/aria-pressed/class`. After click and network wait: if no mutations, same URL, same attributes, print `No visible change after click`.
- Check on MUI `Tabs` inside `Dialog`: if synthetic events do not switch the tab while a trusted click does, use trusted click when the covering element is a known dev overlay or not related to the target, and report it.

### 1.6 Screenshot size (#6)

- `saveScreenshot`: `selector` optional, new `viewport: true` captures exactly `innerWidth x innerHeight` (CSS px), `excludeScrollbar: true` uses `documentElement.clientWidth/clientHeight`.
- New `scale: 'device' | 'css'` (default `device`): `css` resizes the image to CSS pixels when DPR != 1.
- Output: element box in CSS px, DPR, final file size; `Scaled by maxWidth 1024` warning when rescaled.

### 1.7 executeScript await (#8)

- Retry wrap also on SyntaxError matching `await is only valid|reserved word`.
- Without `return` in code: first try `(async () => (CODE))()` (single expression keeps its value), then `(async () => { CODE })()`. When the value is `undefined` after the statement wrap, add hint `add return to get a value`.

### 1.8 Figma token (#9)

- Token resolved at call time: `args.figmaToken || process.env.FIGMA_TOKEN || file from FIGMA_TOKEN_FILE` (file re-read, a new token works without restart).
- Tool descriptions: `Omit when the server has FIGMA_TOKEN / FIGMA_TOKEN_FILE`.
- Error without token lists checked sources (`FIGMA_TOKEN not set, FIGMA_TOKEN_FILE=<path> not found / no FIGMA_TOKEN= line`).
- `ping` shows `figmaToken: configured (FIGMA_TOKEN_FILE)` or `not configured`.
- README: `FIGMA_TOKEN_FILE` in configuration section.
- Outside code: publish 3.7.x to npm, or remove the project-level `npx chrometools-mcp` overrides in `.claude.json` (user decides).

## Phase 2. Figma infrastructure (10, 11, 12, 16)

Order inside the phase: 2.1 (disk cache) first. View/Collab seats get `x-figma-rate-limit-type: low`, after a 429 `Retry-After` is about 19 hours, so every API request counts.

Current request cost per call (all Tier 1 endpoints): `getFigmaFrame` 2 (`/images` + `/nodes`), `compareFigmaToElement` 1, `getFigmaSpecs` 1, `listFigmaPages` / `searchFigmaFrames` / `getFigmaComponents` / `getFigmaStyles` / `getFigmaColorPalette` 1 full `/files/:key` each, `convertFigmaToCode` 2. Nothing is reused between calls.

### 2.1 Disk cache for Figma (#10, second report)

Storage: `~/.chrometools/figma-cache/<fileKey>/` (`CHROMETOOLS_FIGMA_CACHE_DIR` to move it, `CHROMETOOLS_FIGMA_CACHE=off` to disable). Survives MCP restart. The token is never written: not in files, not in keys.

```
<fileKey>/
  index.json            entries: kind, nodeId, scale, format, version, lastModified, fetchedAt, bytes, file
  nodes/<nodeId>.json   /v1/files/:key/nodes document of the node, full subtree and styles
  images/<nodeId>@<scale>.<format>   PNG/JPG/SVG bytes (Figma export links expire, bytes are kept)
  file.json             /v1/files/:key structure for listFigmaPages, searchFigmaFrames, components, styles, palette
  rate-limit.json       last 429: retryAt, rate-limit type, endpoint
```
(nodeId `12:34` stored as `12-34`.)

What is cached:
1. Node renders (`/v1/images`): key `fileKey + nodeId + scale + format + version`. Bytes downloaded at once.
2. Node trees (`/v1/files/:key/nodes`): key `fileKey + nodeId + version`. `version` and `lastModified` from the response stored next to the data.
3. File structure (`/v1/files/:key`): key `fileKey + version`. Used by listFigmaPages, searchFigmaFrames, getFigmaComponents, getFigmaStyles, getFigmaColorPalette.

Lookup without network:
- Default: an entry lives until it is cleared or refreshed. No TTL, no version check request (a check would cost a request too).
- Node tree: own entry, else the node is searched by id in any cached tree of the same file (parent section, whole frame) and in `file.json`. The response says `from parent tree <id>`.
- Node render: own entry with the same scale/format, else crop from a cached render of an ancestor using `absoluteBoundingBox` from the cached tree (`cropped from parent render <id>`, note: siblings overlapping the box stay in the image). Used only when the ancestor tree is cached.
- Several versions of one node: the newest `version` is used.
- `getFigmaFrame` takes frame info from the cache, so a cached node costs 0 requests, a new node 1 (`/images`), the tree is fetched only when it is needed and missing.

Parameters on every Figma tool:
- `refresh: true`: fetch again, replace the entry.
- `offline: true`: never call the API, error if not cached.

New tools:
- `prefetchFigma({fileKey, nodeIds, scale?, format?, tree?: true})`: one `/nodes?ids=a,b,c` and one `/images?ids=a,b,c` per scale (chunks of 50 ids), downloads all images. Returns per node: cached tree yes/no, image size, version. After it the whole check works offline.
- `figmaCacheStatus({fileKey?})`: per file: version, lastModified, entries (trees, images by scale, file structure), disk size, fetchedAt range, current rate-limit block if any.
- `figmaCacheClear({fileKey?, nodeIds?, kind?: 'images' | 'nodes' | 'file'})`: without args clears everything (returns what was removed).

Rate limit (429):
- Headers parsed: `Retry-After`, `x-figma-rate-limit-type`, `x-figma-plan-tier`. Stored in `rate-limit.json`.
- Short wait (`Retry-After` up to 30 s, `CHROMETOOLS_FIGMA_MAX_RETRY_WAIT_MS`): wait and retry once. Longer: no waiting.
- While `retryAt` is in the future the API is not called at all (no new 429, no wasted time).
- Cached data available (any version): return it with a note `from cache, version X (fetched 10.11 14:02); refresh failed: 429, limit type low, retry after 11.11 01:20 MSK`. Time in the local time zone of the server process, plus hours left.
- Nothing cached: error with the same text and a hint: use `figmaImagePath` / `figmaSpecPath`, export manually, or a token of a Full/Dev seat.
- 503/5xx: one retry after 2 s, then the same fallback to cache.

Work without API:
- `compareFigmaToElement({figmaImagePath})`: compare with a local PNG (manual export or a file from the cache). `figmaScale` then means the scale of that file (default: page DPR). `fileKey`/`nodeId` become optional in this mode.
- `figmaSpecPath`: path to a saved node JSON (`/nodes` response, a `document` object, or a file from `nodes/`). Accepted by getFigmaSpecs, getFigmaNodeTree, compareFigmaSpecs (3.2), setViewport `matchFigmaFrame`.

Output: every Figma tool response has a short source line: `Figma: cache (v123, 10.11 14:02)` / `Figma: API, 1 request` / `Figma: cache, refresh failed (429 ...)`.

### 2.2 Batch export (#11)

- `getFigmaFrame` and `compareFigmaToElement`: `nodeIds: string[]` (up to 20) as alternative to `nodeId`. One `/images?ids=a,b,c` request for the missing ones only, cached ones are not requested.
- `compareFigmaToElement` with `nodeIds` takes `selectors: string[]` of the same length (pairs), one summary table plus per-pair images in `outputDir`.
- `outputDir`: save `<nodeId>.png` files and return paths instead of inline images (inline limited to 5 images or 3 MB total).

### 2.3 Node tree with styles (#11)

New tool `getFigmaNodeTree`:

- Params: `fileKey`, `nodeId` or `nodeIds`, `depth` (default 6), `includeHidden` (false), `textOnly` (false).
- One `/nodes` request (cached). Compact output per node:
  - `id, name, type, box {x, y, w, h}` relative to the requested root;
  - layout: `layoutMode, padding [t r b l], gap (itemSpacing), align`;
  - `radius` (single or 4 values), `fill` (hex + opacity, first visible solid fill), `stroke` (hex, weight, align), `effects` (short);
  - text: `chars` (120 chars), `font {family, size, weight, lineHeightPx, letterSpacing}`, `color`; mixed styles from `characterStyleOverrides` reported as `mixed`.
- Null/default values omitted. Output size guard: truncate at 60 KB with a note and node count.

### 2.4 Batch computed CSS (#12)

- `getComputedCss`: `selectors: string[]` (up to 50), `all: true` = every match of each selector (up to 100 elements total), `properties` required in batch mode or `category`.
- One `page.evaluate` with `getComputedStyle`.
- Output: `{props: [...], rows: [{sel, i, box: [x, y, w, h], values: [...]}]}`, not-found selectors listed separately.

### 2.5 Viewport from Figma frame (#16)

- `setViewport({matchFigmaFrame: {fileKey, nodeId}, deviceScaleFactor?})`: frame `absoluteBoundingBox` width/height (cached nodes request), DPR from param or 1.
- Stored as `requestedViewport` (1.1), output shows frame name and size.

## Phase 3. Spec comparison and fonts (14, 15)

### 3.1 Font report (#15)

New tool `getFontReport`:

- Params: `selector` (default `body`), `maxElements` (300).
- For text-bearing elements under the selector: declared `font-family` (first family), `font-weight`, `font-size`; rendered font via CDP `CSS.getPlatformFontsForNode` (`familyName`, `isCustomFont`, `glyphCount`).
- `document.fonts`: list of `FontFace` with family, weight, style, status (`loaded / error / unloaded`).
- Output grouped: `declared "MTS Compact" 400 -> rendered "Segoe UI" (system fallback): 120 elements, e.g. td.cell`. Separate list of declared web fonts that did not load.

### 3.2 compareFigmaSpecs (#14)

New tool `compareFigmaSpecs`:

- Params: `fileKey`, `nodeId`, `selector`, `match: 'text' | 'order' | 'auto'` (default auto), `pairs: [{figmaNodeId, selector}]` (explicit block pairs), `properties` (default set below), `tolerancePx` (0.5), `colorTolerance` (2 per channel), `maxRows` (80), `onlyDiffs` (true).
- Figma side: tree from 2.3. Page side: one `page.evaluate` walking the subtree: text-bearing elements and containers with computed styles and boxes relative to the root element.
- Matching:
  - text nodes: normalized text (trim, collapse spaces, case-insensitive); exact, then prefix; duplicates resolved by order and relative position (box scaled by root width ratio);
  - blocks: explicit `pairs`, then frames with fill/stroke/radius/padding matched to the lowest common ancestor of their matched texts, then IoU of relative boxes > 0.6.
- Properties: text: `font-family` (also rendered font from 3.1), `font-size`, `font-weight`, `line-height` (px), `letter-spacing`, `color`, `height`; blocks: `width`, `height`, `padding`, `gap`, `border-radius`, `background`, `border`.
- Output: summary (matched / unmatched / diffs per property), then rows `Figma "Cell text" [12:34] <-> td:nth-child(2) | font-size | 12 | 14`, then unmatched Figma texts and page texts (truncated). Size guard 40 KB.

## Phase 4. compareFigmaToElement (#13)

- `figmaScale` default = page `devicePixelRatio` (fixes size mismatch at DPR 1).
- `figmaChildNodeId`: crop Figma export to the child box (relative to exported node); or `figmaCrop: {x, y, width, height}` in Figma px.
- `ignore: [{selector} | {x, y, width, height}]`: masked areas excluded from diff count and drawn hatched on diff/overlay.
- `anchor: {figmaNodeId, selector}`: shift Figma image so the anchor boxes coincide (e.g. content card left edge); offset reported. Areas outside the overlap counted separately, not as difference.
- `scaleToFit: true`: optional resize of Figma image to page element width (reported, off by default).
- Uses cache from 2.1.

## Phase 5. Second report of 10.11 (artifact "Report chrometools 10.11")

1. Detached tab: liveness check before every tool (`isPageUsable`: detached main frame / dead-session errors), re-attach to an open tab with the same URL, clear error otherwise; `openBrowser` / `navigateTo` open a new tab; one retry when a call hits a tab dying at that moment; `resetBrowser` tool (drops pages + CDP connection, Chrome stays); `switchTab` returns `success: false` when it cannot attach.
2. User's Chrome: new tabs become active only when opened from a chrometools page; extension tab sync follows only chrometools tabs; `listTabs` lists chrometools tabs by default (`all: true` adds user tabs without titles); `[Active tab: url]` note when the active tab changes.
3. `outputFile` on executeScript, analyzePage, getComputedCss, screenshot, getFontReport, getFigmaNodeTree (after password redaction).
4. `hideSelectors` on compareFigmaToElement and saveScreenshot.
5. Render larger than the frame (outside stroke/shadow): cut to the frame box using absoluteRenderBounds (`cropToBounds`; cached tree by default, `true` fetches).
6. compareFigmaSpecs: `text-transform` vs Figma `textCase`; `anchor` + `position` offsets.
7. letterSpacing: Figma REST gives px, no change.

## Phase 6. Third report (second run, evening 10.11)

1. compareFigmaSpecs with figmaSpecPath ignored nodeId (loadNodeFromFile looked only at top-level keys of a /nodes file): nodeId is searched inside the saved trees.
2. Matching rewritten (`utils/spec-compare.js`): anchor = fixed pair; equal texts by nearest offset from the anchor (greedy global), duplicates limited by `maxPairDistancePx`; prefix only for truncated / similar length; `match: 'static'`, `ignoreTexts`, `ignoreSelectors`, `ignoreFigmaNodes`; unique page selectors with stable attributes.
3. Blocks: instances always included; label match, role match (Figma name vs element role), overlap; size sanity (2x); field box = input wrapper; control inside a same-role wrapper skipped; unmatched Figma components listed.
4. Text box from Range over text nodes; position by alignment and line center; text height not compared by default.
5. Normalization (case, dashes, trailing "...", own text without counters), input/textarea values as texts.
6. importFigmaCache / importFigmaRender; outputFile on compareFigmaSpecs; saveScreenshot clip.
7. OS display scaling: emulation cannot remove it (1px border = 0.909px with Windows 110%, checked with setViewport, setPageScaleFactor, setDeviceMetricsOverride); setViewport measures and reports it; CHROMETOOLS_FORCE_DEVICE_SCALE_FACTOR adds --force-device-scale-factor to Chrome launched by chrometools.

## Verification

Common: `npm run build` after each phase, existing e2e scripts (e2e-vault, e2e-multi, e2e-fill) pass.

Phase 1, local test page (hash router, title set in `setTimeout(300)`, webpack-like overlay iframe, `console.error(new Error())`, uncaught throw, MUI-like tabs under a covering element):
- setViewport 1440x904, navigateTo `#/b`: `innerWidth` 1440, DPR 1; after closing the tab navigateTo reports new tab and viewport is 1440x904.
- navigateTo `#/b` returns title of `#/b`.
- Overlay present: navigateTo and click report it, no "No errors detected".
- Console errors show text and stack, uncaught error included.
- Click on covered element reports the covering element; click with no effect reports `No visible change after click`.
- saveScreenshot `viewport: true` at 1440x904 DPR 1 gives 1440x904; `excludeScrollbar` gives 1425x904; DPR 2 + `scale: 'css'` gives 1440x904.
- executeScript `const r = await Promise.resolve(5); return r` returns 5; `await Promise.resolve(5)` returns 5.
- Figma tool without `figmaToken` works with `FIGMA_TOKEN_FILE`; error text with no token lists sources; ping shows token status.

Phase 2, fake Figma server (local http, `CHROMETOOLS_FIGMA_API_BASE` points the API base to it; counts requests per endpoint; temp `CHROMETOOLS_FIGMA_CACHE_DIR`):
- Second identical getFigmaFrame / compareFigmaToElement / getFigmaSpecs: 0 requests. Same after MCP restart (disk).
- getFigmaFrame on a cached node: 0 requests; new node: 1 (`/images`) when its tree is in the cache.
- Child node of a cached parent tree: getFigmaSpecs makes 0 requests, response says `from parent tree`.
- prefetchFigma with 3 nodes: 1 `/nodes` + 1 `/images`, then compare on all 3 offline (`offline: true` works).
- `refresh: true`: new request, newer version replaces the entry.
- 429 with `Retry-After: 68400`, `x-figma-rate-limit-type: low`: cached data returned with the note (date, MSK time, type); next call makes no request while blocked; without cache: error with the same text within 1 s.
- 429 with `Retry-After: 1`: one retry, result returned.
- Cache files contain no token (grep the cache dir for the token).
- figmaCacheStatus lists entries and size; figmaCacheClear by fileKey removes only that file.
- compareFigmaToElement with `figmaImagePath` and no token: works. getFigmaSpecs with `figmaSpecPath`: works.
- getFigmaFrame with 3 nodeIds: one images request, 3 files in outputDir.
- getFigmaNodeTree: text styles, padding, gap, radius, fill on a fixture JSON; size guard on a big fixture.
- getComputedCss batch: 10 selectors, one evaluate, table output.
- setViewport matchFigmaFrame: viewport equals fixture frame size.

Phase 3:
- getFontReport on page with a missing web font: fallback reported with family name; loaded font reported as custom.
- compareFigmaSpecs on fixture tree + local page with known differences (12px vs 14px, 41 vs 44 height, #007cff vs #0070e5): all three found, matched rows correct, no false diffs on identical nodes.
- Live check on the user's SPA and Figma file.

Phase 4:
- Fixture where page has a wider sidebar: with `anchor` diff of the content area is near 0; without it large.
- `ignore` area excluded from count.
- DPR 1 page with default scale: `sameSize: true` for an exact copy.

After any phase: README updated (new params, new tools, tool count). analyzePage is not touched, benchmark not needed.

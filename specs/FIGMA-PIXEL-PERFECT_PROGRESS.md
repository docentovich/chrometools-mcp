# Figma layout check: progress

Spec: [FIGMA-PIXEL-PERFECT_SPEC.md](FIGMA-PIXEL-PERFECT_SPEC.md)

Status: CODE COMPLETE (phases 1-6), needs live check

## Phase 1. Bugs

- [x] 1.1 Viewport stored and re-applied (navigateTo, openBrowser, capture, new tabs)
- [x] 1.1 Trigger found in code: extension `tabs_sync` / `initial_state` moved `lastPage` to the first active tab of any window, `connectToTabByUrl` matched loosely (`http://x/` is a substring of `http://x/#/route`). Bulk sync no longer switches the tab, matching is exact / same URL without hash, current page preferred. Not reproduced live with the extension
- [x] 1.2 SPA settle after navigateTo / openBrowser, title read after settle
- [x] 1.3 Dev error overlay detection (webpack, vite, next, CRA, parcel)
- [x] 1.4 Console capture helper (one per page, duplicates fixed), `message` field, stack, `Runtime.exceptionThrown`
- [x] 1.5 Click: covering element reported, behind-modal and dev-overlay warnings, `NO_CHANGE` check
- [ ] 1.5 MUI Tabs in Dialog on the real app: check whether the behind-modal warning explains the LAL case; trusted click fallback not added
- [x] 1.6 saveScreenshot `viewport`, `excludeScrollbar`, `scale`, size and DPR in output
- [x] 1.6 Found on the way: `maxWidth: null` ignored (`null ?? 1024`), element clip wrong when page scrolled (viewport coords used as document coords). Fixed in saveScreenshot and action screenshots
- [x] 1.7 executeScript top-level await
- [x] 1.8 Figma token resolved at call time, descriptions, error text, ping, README, --help
- [ ] 1.8 npm publish 3.7.x or remove project-level `npx chrometools-mcp` overrides (user decision)
- [x] README updated
- [x] Phase 1 verification passed: e2e-phase1.mjs 35/35, e2e-vault, e2e-multi, e2e-fill, e2e-capture pass
- [ ] Live check on the user's SPA after MCP restart

## Phase 2. Figma infrastructure

- [x] 2.1 Disk cache module: layout, index.json, versions, no token on disk, `CHROMETOOLS_FIGMA_CACHE_DIR` / `=off`
- [x] 2.1 All Figma tools read/write the cache, `refresh`, `offline`, source line in output
- [x] 2.1 Node lookup in parent trees and file.json; crop render from cached ancestor
- [x] 2.1 429 handling: headers, rate-limit.json, no calls while blocked, stale cache with note, local time of retry
- [x] 2.1 prefetchFigma, figmaCacheStatus, figmaCacheClear
- [x] 2.1 `figmaImagePath` in compareFigmaToElement, `figmaSpecPath` in spec tools
- [x] 2.1 verification: e2e-figma-cache.mjs 27/27 against a fake Figma API (request counts, restart, crop, prefetch, offline, refresh, 429 long/short, no token on disk, figmaImagePath/figmaSpecPath without token); phase 1 and old e2e suites pass
- [x] 2.1 README: cache section, prefetchFigma / figmaCacheStatus / figmaCacheClear, new params, tool count 64
- [ ] 2.1 Live check with the real Figma file
- [x] 2.2 getFigmaFrame `nodeIds` (one /images request), `outputDir` (exact bytes, required above 5 nodes)
- [x] 2.2 compareFigmaToElement `nodeIds` + `selectors` pairs, summary table, files per pair
- [x] 2.3 getFigmaNodeTree (`utils/figma-tree.js`): boxes, layout, radius, fill, stroke, effects, text styles, mixed overrides, 60 KB guard, textOnly
- [x] 2.4 getComputedCss batch mode (`selectors`, `all`, table output, notFound)
- [x] 2.5 setViewport `matchFigmaFrame` (+ 1 px tolerance: Windows display scaling rounds 904 to 905, reported)
- [x] README: new params and tools, tool count
- [x] Phase 2 verification passed: e2e-phase2b.mjs 15/15, e2e-figma-cache.mjs 27/27

## Phase 3. Spec comparison and fonts

- [x] 3.1 getFontReport (`utils/platform-fonts.js`, CDP CSS.getPlatformFontsForNode): web font / system font / FALLBACK, document.fonts status, failed @font-face
- [x] 3.2 compareFigmaSpecs: page walker (`utils/spec-compare.js`)
- [x] 3.2 compareFigmaSpecs: matching (text exact / prefix with position tie-break, order mode, explicit pairs, blocks by IoU)
- [x] 3.2 compareFigmaSpecs: diff table, rendered font in font-family, inline text height skipped, size guard, unmatched lists
- [x] README: new tools
- [x] Phase 3 verification passed: e2e-phase3.mjs 14/14 (12 vs 14 px, 44 vs 41 row, #0070e5 vs #007cff, radius 10 vs 6, fallback font, no false diffs)
- [ ] Live check on the SPA and Figma file

## Phase 4. compareFigmaToElement

- [x] Default figmaScale = page DPR
- [x] figmaChildNodeId (crop of the parent render, uses absoluteRenderBounds) / figmaCrop
- [x] ignore masks (selectors and rects), hatched on diff/overlay, excluded from the percentage
- [x] anchor alignment, only the overlap compared, outside pixels reported
- [x] scaleToFit
- [x] README
- [x] Phase 4 verification passed (in e2e-phase2b.mjs)

## Phase 5. Second report (detached tab, user's Chrome, outputFile)

- [x] Detached tab: liveness check, re-attach by URL, clear error, new tab on navigateTo/openBrowser, one retry on dead-page errors
- [x] resetBrowser tool; switchTab fails honestly when it cannot attach
- [x] New user tabs / tab clicks do not take over; listTabs hides user tabs (`all`); `[Active tab]` note
- [x] outputFile on 6 tools
- [x] hideSelectors (compare, saveScreenshot)
- [x] cropToBounds (render with outside stroke/shadow)
- [x] compareFigmaSpecs text-transform + anchor position
- [x] README
- [x] Verification: e2e-phase5.mjs 22/22 (4 runs in a row), all earlier suites pass

## Phase 6. Third report

- [x] figmaSpecPath + nodeId inside the saved tree
- [x] Text matching: anchor pair, nearest duplicates, prefix limits, static / ignore options, unique selectors
- [x] Block matching: label, role, overlap, size sanity, field wrapper, unmatched components
- [x] Text glyph boxes, alignment-aware position, no default text height
- [x] Normalization, field values
- [x] importFigmaCache, importFigmaRender, compareFigmaSpecs outputFile, saveScreenshot clip
- [x] OS scaling detection + CHROMETOOLS_FORCE_DEVICE_SCALE_FACTOR
- [x] README
- [x] Verification: e2e-phase6.mjs passes; phase 3 / 5 expectations updated for role labels and center-based positions; all suites pass

## Left for the user

- [ ] Restart MCP (`/mcp`) and run the layout check on the real SPA + Figma file
- [ ] 1.5 MUI Tabs in Dialog (LAL): confirm the behind-modal warning explains it
- [ ] npm publish or remove project-level `npx chrometools-mcp` overrides in `.claude.json`
- [ ] Version bump + CHANGELOG (ask)

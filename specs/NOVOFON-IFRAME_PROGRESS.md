# Progress: Novofon Blockers (iframe / session / P1 fixes)

**Spec**: [NOVOFON-IFRAME_SPEC.md](NOVOFON-IFRAME_SPEC.md)
**Status**: IN PROGRESS — approved, implementing in order (P0-2 → P0-1 → P1-4 → P1-6 → P1-3 → P1-5)

## P0-2 — Live session via env config
- [x] `platform-utils.js`: `CHROME_DEBUG_PORT` от env, `getChromePath()` env-override, `getUserDataDir()` export
- [x] `browser-manager.js`: `CHROMETOOLS_BROWSER_WS_ENDPOINT` direct-connect; userDataDir от env
- [x] Verify: custom port/profile/path override + no-env regression (WS endpoint — code path, не на живом Chrome)
- [ ] README: env-секция (batched)

## P0-1 — iframe via switchFrame + active-frame state
- [x] `page-manager.js`: `activeFrames` WeakMap, `getTargetFrame`/`setActiveFrame`/`clearActiveFrame`/`getActiveFrameMatcher`/`listFramesForPage`
- [x] `switchFrame` tool (schema + definition + handler)
- [x] `listFrames` tool (schema + definition + handler)
- [x] `resolveSelector` / `quickRegisterElements` / `getApomSnapshot` принимают `ctx` (Frame имеет .evaluate/.$)
- [x] executeScript / findElementsByText / smartFindElement → `ctx.evaluate`
- [x] click / type / hover / selectOption / pressKey / scrollTo / waitForElement → `ctx`
- [x] `executeElementAction` принимает `frame` (resolve/eval в кадре, keyboard/screenshot на page)
- [x] analyzePage → buildAPOMTree через `ctx`; `frames`+`activeFrame` в вывод (только при >1 фрейме)
- [x] navigateTo → `clearActiveFrame`
- [x] Verify (logic-level, mock page): default→main, listFrames, switch by url/selector, reset, missing→throws
- [x] README: Frame Tools section + TOC + analyzePage `frames` note
- [ ] analyzePage benchmark (Google) — **live**: один фрейм → frames не добавляется → нулевой регресс по конструкции; прогнать на живом стенде

## P1-4 — executeScript two-pass eval
- [x] Убрана `^return` + `!function` эвристика; raw→IIFE retry на illegal-return SyntaxError
- [x] Verify: bare-expr, const+return, return со словом function в колбэке, real-error остаётся ошибкой

## P1-6 — navigateTo network dump limit/filter
- [x] `post-click-diagnostics.js`: фильтр XHR/Fetch (скрыть Script/Stylesheet/Font/Image/Media/...), лимит 12 + «… N more»
- [x] Verify: 78 запросов → 8 XHR показаны/70 скрыто; 25 Fetch → 12 + «13 more»
- [x] README: navigateTo note

## P1-3 — smartFindElement candidates + threshold
- [x] `SmartFindElementSchema`: `minConfidence` default 0.6
- [x] Расширены кандидаты ([onclick], [role=menuitem], [role=tab], nav a, [role=navigation] a) + дедуп Set
- [x] Скоринг: text-mismatch штраф (-60) + nav/menu бонус (+15/+10)
- [x] Guard авто-action по порогу + зазору top1-top2 (≥10) → `actionSkipped`
- [x] `executeElementAction` через `ctx` (frame)
- [x] Verify: «Настройки»(115) > «Пополнить»(55, skip); partial+submit-keyword защищены
- [x] README: minConfidence + candidate coverage

## P1-5 — click SPA route-change wait
- [x] `ClickSchema`: `waitForRouteChange` default false
- [x] `click-action.js`: waitForFunction по pathname+search, routeChanged в hints
- [ ] Verify: **live** — SPA-клик с флагом → routeChanged:true (требует браузер)
- [x] README: waitForRouteChange + SPA-заметка

## P0-2 verify note
- [ ] `CHROMETOOLS_BROWSER_WS_ENDPOINT` — **live**: путь кода проверен, реальный connect на живом Chrome

## Session-end
- [ ] CHANGELOG + version bump (спросить пользователя)
- [ ] Live e2e на стенде вместе с пользователем (перезапуск MCP через /mcp)

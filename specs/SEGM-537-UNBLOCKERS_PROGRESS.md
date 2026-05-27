# Progress: SEGM-537 QA Unblockers

**Status**: NEEDS APPROVAL
**Spec**: [SEGM-537-UNBLOCKERS_SPEC.md](./SEGM-537-UNBLOCKERS_SPEC.md)
**Created**: 2026-05-28

## Phase 0 — Approval & alignment

- [ ] Пользователь одобрил scope (все 5 блокеров)
- [ ] Пользователь одобрил дизайн API (имена параметров, дефолты)
- [ ] Дать команду «погнали, начни с Phase 1»

## Phase 1 — Блокер #1: portal scan расширение

- [x] Расширить `pom/apom-tree-converter.js` — добавить `portalSelectors` параметр + третий проход (~120)
- [x] ~~Переименовать `forceMarkModalTree`~~ — переиспользована as-is, переименование избыточно
- [x] Прокинуть `includePortals` / `portalSelectors` через `page.evaluate` в `index.js`
- [x] Обновить `server/tool-schemas.js` + `server/tool-definitions.js` для `analyzePage`
- [x] `npm run build` — Syntax validation passed
- [ ] Verification: бенчмарк Google (требует запуска MCP — пользователь должен перезапустить и прогнать)
- [ ] Verification: ручной тест на QA-стенде (требует доступа QA — отдаём после рестарта MCP)
- [x] Обновить `README.md` — секция `analyzePage`

## Phase 2 — Блокер #2: click + waitForSelector

- [x] Добавить `waitForSelector` / `waitTimeoutMs` в `executeClickAction` + `click` handler
- [x] Возвращать `appearedInMs` в результате (или `⚠️ WAIT_TIMEOUT` сообщение)
- [x] Обновить `server/tool-schemas.js` + `server/tool-definitions.js` для `click`
- [x] `npm run build` — Syntax validation passed
- [ ] Verification: на стенде клик «три точки» с `waitForSelector` (требует рестарта MCP)
- [ ] Verification: несуществующий селектор → таймаут (требует рестарта MCP)
- [x] Обновить `README.md` — секция `click`

## Phase 3 — Блокер #4: ModelRegistry stale error

- [x] **Root cause fix**: `quickRegisterElements` теперь инжектит models code (раньше не делал → ReferenceError при auto-refresh после navigation)
- [x] User-friendly fallback: catch на `ReferenceError: ModelRegistry is not defined` в `resolveSelector` → сообщение «APOM registry stale, call analyzePage()»
- [x] `npm run build` — Syntax validation passed
- [ ] Verification: воспроизвести (analyzePage → navigate → click) — требует рестарта MCP

## Phase 4 — Блокер #3: screenshot без selector

- [x] Ослабить `.refine` в `ScreenshotSchema` (запрещаем только конфликт, не отсутствие)
- [x] Без id/selector — viewport screenshot через `processScreenshot`
- [x] Обновить `server/tool-schemas.js` + `server/tool-definitions.js`
- [x] `npm run build` — Syntax validation passed
- [ ] Verification: `screenshot()` без аргументов возвращает viewport — требует рестарта MCP
- [x] Обновить `README.md` — секция `screenshot`

## Phase 5 — Блокер #5: executeScript auto-IIFE

- [x] Препроцессор скрипта в `executeScript` handler (index.js)
- [x] Regex: оборачивает только если `^return[\s;]` И код не содержит `function ...`
- [x] `npm run build` — Syntax validation passed
- [x] Verification (offline): 5 канонических случаев работают корректно (`return document.title`, `   return 42;`, IIFE, plain expr, `function ... return`)
- [x] Обновить `README.md` — секция `executeScript`

## Phase 7 — click autoAnalyzeAfter

- [x] Helper `getApomSnapshot(page)` в index.js
- [x] Pre/post snapshot в click handler с регистрацией новых id через `quickRegisterElements`
- [x] Дельта `+N appeared: id:"text"` / `-N disappeared` / `No APOM changes` в результате click
- [x] Schema + tool-definitions + README
- [x] `npm run build` — passed
- [x] Verified на стенде: Phase 7 механика работает (snapshots + diff + content append). На SEGM-стенде дельта пустая из-за Phase 8 проблемы (popup не попадает в дерево).

## Phase 8 — In-tree popup detection

Открыт **при e2e-тесте Phase 7**: popup-меню стенда (Popper-style) рендерится внутри 0-height wrapper и не попадает в APOM tree, потому что `isVisible` отбрасывает wrapper.

- [x] Расширение portal-scan в `pom/apom-tree-converter.js` — новый блок после id-portalSelectors
- [x] `findPositionedPopup(el, depth=3)` — рекурсивный поиск absolute/fixed-positioned child с реальными bounds внутри 0×0 wrapper
- [x] force-mark найденного popup через существующий `forceMarkModalTree`
- [x] Используется тот же flag `portalInclude` (default `true`) — opt-out возможен через `includePortals: false`
- [x] README обновлён
- [x] `npm run build` — passed
- [ ] Verification на SEGM-стенде — требует рестарта MCP

## Phase 6 — Финализация сессии

- [ ] Прогон всех verification на реальном QA-стенде SEGM-537 (если доступ есть)
- [ ] Спросить пользователя: bump version + CHANGELOG entry?
- [ ] Если YES — single CHANGELOG entry для всей сессии, версия += patch (3.5.4 → 3.5.5)
- [ ] Отдать QA на повтор сценария из отчёта

## Verification status: per-phase checks

Каждая phase имеет свои verification-шаги выше. Не двигаться к следующей пока текущая не зелёная.

## Открытые вопросы (повторяю из spec)

1. Дефолтные id-портал-селекторы (`#menu-popup-root`, `#modal-root`, `#tooltip-root`, `#popover-root`) — норм или хотите другой набор?
2. `keepOpen: true` для `click` — пропускаем, делаем только `waitForSelector`. Если QA увидит что попап всё равно закрывается — добавим в Phase 2.5.
3. Авто-IIFE для `executeScript` — допустимый риск перехвата `return` в случаях, где `return` намеренно внутри функции? Митигируем regex'ом на top-level.

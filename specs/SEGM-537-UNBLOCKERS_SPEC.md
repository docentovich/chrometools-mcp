# Spec: SEGM-537 QA Unblockers

**Status**: DRAFT — waiting for user approval
**Created**: 2026-05-28
**Triggered by**: QA-отчёт SEGM-537 (Bulk Creatives Upload) — пять блокеров ChromeTools MCP не дали довести QA до фичи

## Motivation

При прогоне QA SEGM-537 на стенде `selfservice.segmento.mts-corp.ru` ChromeTools MCP заблокировал прогресс на шаге «открыть меню действий → Настройки». QA довёл до этапа 1 из 7 и зафиксировал пять конкретных проблем в инструменте. Фича сама не проверена — нужно разблокировать инструмент.

## Goals

Разблокировать сценарий: открыть React Portal попап (`#menu-popup-root`), дождаться его появления после клика, кликнуть пункт меню, продолжить QA-сценарий. Попутно убрать раздражающие шероховатости (`screenshot` без аргументов, понятная ошибка про устаревший APOM `id`, поведение `executeScript` с top-level `return`).

## Non-goals

- Не переписываем `analyzePage` целиком — расширяем существующую portal-логику в `pom/apom-tree-converter.js:88-115`.
- Не делаем «универсальный» wait для произвольных DOM-изменений — добавляем только `waitForSelector` как опцию к `click`.
- Не лезем в код QA-стенда (Замечание #6 из отчёта — про прямые URL `/app/campaign/settings/77130` — не наша зона).

---

## Блокер #1 — analyzePage не видит React Portals (menu/tooltip)

### Текущее поведение

`pom/apom-tree-converter.js:88-115` сканирует прямых детей `<body>` по жёсткому списку CSS-классов framework-портал-контейнеров (`ant-modal-root`, `MuiDialog-root`, `mantine-Modal-root` и т.п.) — это про **модальные диалоги**. Меню/dropdown/tooltip-порталы у проектов часто рендерятся в `<div id="menu-popup-root">` / `<div id="tooltip-root">` (см. `client/index.html` стенда SEGM-537) — эти контейнеры детектор пропускает.

### Целевое поведение

`analyzePage` принимает опциональный параметр `includePortals` (default `true`):

```js
analyzePage({ url?, includePortals?: boolean = true, portalSelectors?: string[] })
```

- `includePortals: true` — по умолчанию включаем порталы.
- `portalSelectors` — массив CSS-селекторов (default: `['#modal-root', '#menu-popup-root', '#tooltip-root', '#popover-root', '[data-portal]']`), любые `body > selector` контейнеры force-включаются в APOM tree с compact-форматом, как уже делается для модалок.
- Существующая логика модалок-фреймворков сохраняется без изменений (не ломаем уже работающий ant/MUI detection).

### Реализация

1. В `pom/apom-tree-converter.js` рядом с `portalPatterns` (~89) добавить `idPortalSelectors` — массив дефолтов, мерж с user-провайдеными.
2. В пасс «scan body direct children» (~107) добавить второй проход: `document.querySelectorAll(idPortalSelectors.join(','))` → force-include через существующую `forceIncludeModalSubtree()` (или вынести в `forceIncludePortalSubtree`, более широкое имя).
3. Прокинуть `includePortals` / `portalSelectors` через `page.evaluate` в `index.js:~2400`.
4. В `tool-schemas.js` добавить два параметра с описанием и дефолтами.

### Verification

- На стенде с открытым меню действий (`document.querySelector('#menu-popup-root').children.length > 0`) `analyzePage` возвращает элементы попапа в дереве.
- Бенчмарк из CLAUDE.md (Google Search) — размер вывода не вырастает на > 5KB при отсутствии порталов (контейнеры пустые → ничего не добавляется).
- `findElementsByText` — проверить что на тексте «Настройки» внутри открытого попапа возвращает > 0 (по отчёту QA там может быть отдельный баг, верифицировать).

---

## Блокер #2 — атомарный click + ожидание появления попапа

### Текущее поведение

`click({ id })` отправляет `mousePressed` + `mouseReleased` и возвращает управление. Попап-меню часто закрывается по `mousedown` outside (focus-out) при следующем действии MCP, поэтому к моменту `analyzePage`/`executeScript` контента в `#menu-popup-root` уже нет (см. отчёт: `childCount: 0`).

### Целевое поведение

```js
click({
  id | selector,
  waitForSelector?: string,          // дождаться появления селектора после клика
  waitTimeoutMs?: number = 2000,     // таймаут ожидания
})
```

- После `mouseReleased` запускается `page.waitForSelector(waitForSelector, { timeout: waitTimeoutMs, visible: true })`.
- Возвращает `{ clicked: true, appearedAfter?: 'selector', appearedInMs: number }` либо понятную ошибку `WAIT_TIMEOUT: selector did not appear within Xms after click`.
- Не двигаем курсор после клика (это уже так, но проверить — отчёт упоминает «фокус-аут» как причину закрытия).

### NOT добавляем

`keepOpen: true` (из отчёта) — не понятно как это реализовать без хака на уровне страницы. Если `waitForSelector` решает проблему — `keepOpen` не нужен. Если QA увидит, что попап всё равно закрывается — вернёмся к вопросу.

### Реализация

1. В `index.js` (`click` handler ~) после `await page.mouse.click(...)` — условное `await page.waitForSelector(opts.waitForSelector, ...)`.
2. Замерить время `Date.now() - start` для `appearedInMs`.
3. В `tool-schemas.js` добавить `waitForSelector`, `waitTimeoutMs`.

### Verification

- На стенде кликнуть «три точки» с `waitForSelector: '#menu-popup-root > div'` → попап остаётся открытым, селектор найден.
- Кликнуть с заведомо несуществующим селектором → понятная ошибка с таймаутом.

---

## Блокер #3 — screenshot без selector

### Текущее поведение

```
Either 'id' or 'selector' must be provided, but not both
```

Обязателен один из двух параметров.

### Целевое поведение

Оба параметра опциональны. Если ни `id`, ни `selector` не переданы — делается **viewport screenshot** (как `saveScreenshot('viewport')`).

### Реализация

В `index.js` (`screenshot` handler) ослабить валидацию, в дефолтной ветке использовать `page.screenshot({ fullPage: false })` (либо `fullPage: true` если будет отдельный параметр).

### Verification

`screenshot()` без аргументов возвращает viewport-картинку.

---

## Блокер #4 — `ModelRegistry is not defined` после навигации

### Текущее поведение

После навигации/перерисовки страницы повторный `click({ id: 'button_47' })` иногда падает с `ModelRegistry is not defined` (browser-side глобал сбрасывается, id из старого `analyzePage` устарел).

### Целевое поведение

`click` (и `executeModelAction`) ловят `ReferenceError: ModelRegistry is not defined` и возвращают понятную ошибку:

```
APOM registry stale (navigation/reload occurred). Call analyzePage() to refresh element ids.
```

### Реализация

В `index.js` (action handlers ~672) обернуть `page.evaluate` в try/catch, маппить `ReferenceError` на бизнес-сообщение.

### NOT делаем

Авто-вызов `analyzePage` — потенциально дорого, плюс пользователь может не ожидать перерасчёт состояния.

### Verification

Воспроизвести: `analyzePage` → `navigateTo(другая страница)` → `click({ id: 'button_47' })` → получить новое сообщение, не `ReferenceError`.

---

## Блокер #5 — executeScript падает на top-level `return`

### Текущее поведение

```js
executeScript({ script: 'return 42;' })  // Illegal return statement
```

Юзеру приходится оборачивать в IIFE: `(() => { return 42; })();`.

### Целевое поведение

Авто-оборачивание: если переданный `script` содержит top-level `return` (regex `/^\s*return\s|;\s*return\s/`), оборачиваем в `(async () => { <script> })()` перед `page.evaluate`.

### Реализация

В `index.js` (`executeScript` handler) — препроцессор кода.

### Verification

- `executeScript({ script: 'return document.title' })` → возвращает title.
- `executeScript({ script: '(() => { return 42; })()' })` — продолжает работать (уже завёрнут).
- `executeScript({ script: 'document.title' })` — продолжает работать.

---

## Affected files

- `pom/apom-tree-converter.js` — Блокер #1 (portal scan расширение)
- `index.js` — Блокеры #1, #2, #3, #4, #5 (handler-ы + page.evaluate args)
- `tool-schemas.js` — Блокеры #1, #2, #3 (новые параметры в JSON Schema)
- `README.md` — документация новых параметров (обязательно по CLAUDE.md)
- `CHANGELOG.md` — одна запись в конце сессии (только по запросу пользователя)

## Out of scope / открытые вопросы

1. **#1**: список дефолтных id-портал-селекторов — взят с потолка по практике (`#menu-popup-root` есть у QA-стенда, `#modal-root`/`#tooltip-root`/`#popover-root` — типовые имена). Возможно, стоит сделать без дефолтов и требовать явный массив? Решение: оставить дефолты, чтобы не ломать существующих юзеров.
2. **#2**: нужен ли `waitForSelector` отдельным параметром или интегрировать в существующий `waitForElement`-pattern? Решение: отдельный параметр для атомарности (одна MCP-вызов вместо двух).
3. **#5**: авто-IIFE может сломать скрипты, где `return` намеренно внутри функции. Митигируем regex'ом который ищет именно top-level (не внутри `function (){ return }`). Если окажется хрупким — откатимся к документации.

## Verification (end-to-end на QA-стенде)

После реализации QA повторяет сценарий из отчёта начиная с шага 1 плана продолжения. Успех = пройти до шага 7 (загрузка ZIP) без воркараундов через `executeScript`.

# Spec: Novofon Blockers — iframe support, live session, smart-find/executeScript/click/navigate fixes

**Status**: CODE COMPLETE — all 6 items implemented + logic-verified; pending live e2e (Novofon stand) for iframe/session/SPA-wait
**Created**: 2026-06-24
**Triggered by**: `BUGREPORT_NOVOFON_IFRAME.md` — агент не смог автоматизировать ЛК Novofon (`my.novofon.ru`): UI рендерится в cross-origin iframe `app.novofon.ru`, а MCP работает в чистом временном профиле без сессии.

## Decisions (зафиксировано с пользователем)

- **Scope**: P0 + P1 целиком (6 пунктов).
- **Frame API (P0-1)**: `switchFrame` + active-frame state (stateful), без сквозного `frame`-параметра в каждой схеме.

## Motivation

Два P0-блокера делают целый класс сайтов (cross-origin iframe + авторизованная сессия) недостижимым:
- **P0-1**: все тулы жёстко на `page.` (= main frame). Контент cross-origin iframe невидим, `<iframe>` в APOM — лист без внутренностей. Cross-origin нельзя взять через `contentDocument` (SOP) — только через Puppeteer `page.frames()` + `frame.evaluate/$` (идут через CDP, SOP игнорят).
- **P0-2**: `getBrowser()` коннектится к хардкод-порту 9222 или спавнит свежий Chrome с временным профилем `%TEMP%/chrome-mcp-profile` без куков. Env для эндпоинта/профиля/порта нет.

P1 — четыре независимые шероховатости, всплывшие в том же прогоне.

## Goals

Разблокировать сценарий Novofon: агент в РЕАЛЬНОЙ авторизованной сессии переключается ВНУТРЬ iframe `app.novofon.ru` и кликает/заполняет форму SIP-Trunk. Плюс убрать 4 P1-шероховатости.

## Non-goals

- Не делаем рекурсивную склейку APOM-деревьев всех фреймов с префиксацией id — `analyzePage` работает с **активным** фреймом (после `switchFrame`). Достаточно для сценария; глубокая мульти-фрейм склейка — отдельный спек при необходимости.
- Не трогаем bridge/extension (`bridge/`, `extension/`) — для click/navigate через CDP они не нужны.
- Не переписываем скоринг smartFind целиком — точечно расширяем кандидатов и добавляем порог.

---

## P0-1 — Поддержка iframe через `switchFrame` + active-frame state

### Текущее поведение

Всё жёстко на `page.` (= `page.mainFrame()`). `page.frames()`/`.contentFrame()`/`frame.evaluate()` нигде не вызываются для автоматизации. Единственные `mainFrame()` (`browser/page-manager.js:196`, `utils/network-monitor.js:67`, `utils/recorder-helper.js:11`) — наоборот, ОТБРАСЫВАЮТ дочерние фреймы.

Точки: `executeScript index.js:1070`, `analyzePage index.js:2547` → `pom/apom-tree-converter.js buildAPOMTree`, `resolveSelector index.js:457-470`, `findElementsByText index.js:2903`, `smartFindElement index.js:2389`, click/type/hover/waitForElement через `resolveSelector(page,...)`.

### Целевое поведение

1. **Состояние «активный фрейм» на страницу.** `WeakMap<Page, matcher>`, где `matcher = {frameUrl}` или `{frameSelector}` (храним матчер, НЕ объект `Frame` — `Frame` инвалидируется при ре-навигации фрейма; матчер ре-резолвим каждый вызов).
2. **Хелпер `getTargetFrame(page)`** (рядом с `getLastOpenPage`, `browser/page-manager.js:311`):
   - нет активного матчера → `page.mainFrame()`;
   - `frameUrl` → первый `page.frames()` с `frame.url().includes(frameUrl)`;
   - `frameSelector` → `(await page.$(frameSelector)).contentFrame()`;
   - матчер не резолвится (фрейм исчез) → понятная ошибка `Active frame "<...>" not found. Call listFrames() / switchFrame() again.`
3. **Новый тул `switchFrame({ frameUrl?, frameSelector? })`**:
   - без аргументов → сброс к main frame (очистка матчера в WeakMap);
   - с аргументом → резолвим, проверяем что фрейм существует, сохраняем матчер, возвращаем `{ active: frame.url(), frames: [...] }`.
4. **Новый тул `listFrames()`** → `[{ url, name, isMain }]` по `page.frames()`. Чтобы агент знал куда переключаться. (Также добавить `frames` в вывод `analyzePage`.)
5. **Прогон тулов через активный фрейм.** В обработчиках заменить `page.` на `ctx = await getTargetFrame(page)` для evaluate/$/waitForSelector:
   - `resolveSelector(page,...)` → `resolveSelector(ctx,...)` (использует только `.evaluate`);
   - `quickRegisterElements(page)` → принимает `ctx`;
   - `executeScript`: `page.evaluate` → `ctx.evaluate` (screenshot остаётся на `page`);
   - `findElementsByText`, `smartFindElement`: `page.evaluate` → `ctx.evaluate`;
   - click/type/hover/waitForElement: резолв и действие через `ctx` (`Frame` имеет `.$`, `.click`, `.type`, `.waitForSelector`);
   - `analyzePage`: `buildAPOMTree` гоняется через `ctx.evaluate`.
6. **Сброс активного фрейма** при `navigateTo` (новый top-документ → старые фреймы мертвы): очистка WeakMap-записи для страницы.

### Реализация (точки)

- `browser/page-manager.js`: WeakMap `activeFrames`, `getTargetFrame(page)`, `setActiveFrame(page, matcher)`, `clearActiveFrame(page)`.
- `index.js`: новые хендлеры `switchFrame`, `listFrames`; в существующих хендлерах `ctx = await getTargetFrame(page)`.
- `server/tool-schemas.js` + `server/tool-definitions.js`: схемы `SwitchFrameSchema` ({frameUrl?, frameSelector?}), `ListFramesSchema` ({}).
- `index.js navigateTo` (`~1778`): `clearActiveFrame(page)` после навигации.

### Verification

- На странице с cross-origin iframe: `listFrames()` показывает фрейм; `switchFrame({frameUrl:'app.novofon.ru'})` → `active` = url фрейма.
- После switch: `findElementsByText('...')` и `analyzePage` возвращают элементы ВНУТРИ фрейма (> 0).
- `click`/`type` по id из этого APOM попадают в элемент внутри фрейма.
- `switchFrame()` без аргументов → назад к main; `navigateTo` сбрасывает активный фрейм автоматически.

---

## P0-2 — Живая сессия через env-конфиг

### Текущее поведение

`getBrowser()` (`browser/browser-manager.js:77`): connect к `localhost:9222` (хардкод `utils/platform-utils.js:62`), иначе spawn Chrome с `--user-data-dir=%TEMP%/chrome-mcp-profile` (без куков), пути Chrome жёсткие (`utils/platform-utils.js:32-43`). Env нет.

### Целевое поведение

Новые env (все опциональные, дефолты = текущее поведение):
- `CHROMETOOLS_BROWSER_WS_ENDPOINT` — прямой CDP WS-URL для `puppeteer.connect` (если задан — коннектимся к нему, минуя port-discovery и spawn).
- `CHROMETOOLS_DEBUG_PORT` — порт remote-debugging (деф. 9222).
- `CHROMETOOLS_USER_DATA_DIR` — профиль для spawn (деф. `%TEMP%/chrome-mcp-profile`). Позволяет указать реальный/клонированный профиль с сессией.
- `CHROMETOOLS_CHROME_PATH` — путь к Chrome (деф. платформенный).

### Реализация (точки)

- `utils/platform-utils.js`: `CHROME_DEBUG_PORT` → `parseInt(process.env.CHROMETOOLS_DEBUG_PORT) || 9222`; `getChromePath()` → `process.env.CHROMETOOLS_CHROME_PATH || <платформенный>`; экспорт `getUserDataDir()` → `process.env.CHROMETOOLS_USER_DATA_DIR || ${getTempDir()}/chrome-mcp-profile`.
- `browser/browser-manager.js getBrowser()`: в начале — если `CHROMETOOLS_BROWSER_WS_ENDPOINT` задан → `puppeteer.connect({ browserWSEndpoint })` напрямую; иначе текущая логика connect→launch, но `userDataDir = getUserDataDir()`.

### Verification

- `CHROMETOOLS_BROWSER_WS_ENDPOINT=ws://...` → коннект к указанному Chrome; `listTabs` видит реальные вкладки.
- `CHROMETOOLS_DEBUG_PORT=9333` + поднятый Chrome на 9333 → коннект к нему.
- Без env — поведение не меняется (regression-safe).

---

## P1-3 — smartFindElement: расширить кандидатов + порог confidence

### Текущее поведение

Кандидаты только `input/textarea/button/[type=submit]/[type=button]/[role=button]/a` (`index.js:2402-2416`). `div/span[onclick]` без `role` не кандидаты. Скоринг (`utils/element-finder-utils.js:213-221`) даёт primary submit ~100 ДО учёта текста, штрафа за `text≠description` нет. Авто-клик `results[0]` безусловный (`index.js:2481-2486`), порог `confidence` не сравнивается, в `SmartFindElementSchema` поля нет.

### Целевое поведение

1. **Порог перед action**: `minConfidence` в схеме (деф. `0.6`). Если `bestMatch.confidence < minConfidence` ИЛИ зазор `top1.score - top2.score` мал → НЕ кликать, вернуть кандидатов с подсказкой.
2. **Расширить кандидатов** (для `button`/`any`): `[onclick]`, `[role=menuitem]`, `a[role]`, элементы в `nav`/`[role=navigation]`, `[style*="cursor: pointer"]`.
3. **Скоринг**: штраф за `text ≠ description` (нормализованное сравнение), бонус за nav-контекст.

### Реализация (точки)

- `server/tool-schemas.js SmartFindElementSchema` (`272-285`): `minConfidence` number default 0.6.
- `index.js:2407-2416`: доп. `querySelectorAll` для новых кандидатов (дедуп через `Set`).
- `index.js:2482`: guard `if (action && bestMatch.confidence >= minConfidence && gapOk)`.
- `utils/element-finder-utils.js scoreSubmitButton` (`~213`): text-mismatch штраф + nav-бонус.

### Verification

- Запрос «Настройки» (div/span[onclick]) → элемент в кандидатах, primary submit «Пополнить» НЕ кликается (confidence ниже порога / штраф за текст).
- `action:'click'` при низком confidence → возвращает кандидатов, не кликает.

---

## P1-4 — executeScript: top-level `return` всегда работает

### Текущее поведение

Авто-обёртка узкая (`index.js:1062`): только если код начинается с `return ` И нигде нет слова `function`. `const x=...; return x;` и код со словом `function` падают `Illegal return statement`.

### Целевое поведение

Двухпроходный eval (robust, без хрупкой эвристики, сохраняет работу bare-expression вроде `document.title`):
- 1-й проход: `eval(code)` как есть;
- если бросает `SyntaxError` с `Illegal return statement` → 2-й проход: `eval('(async () => { ' + code + ' })()')` и await результата.

Так и bare-expression (`document.title`), и top-level `return` работают; эвристика `^return` + `!function` убирается.

### Реализация (точки)

- `index.js:1060-1064`: убрать эвристику; в `page/ctx.evaluate` колбэке — try raw eval, на illegal-return SyntaxError retry в async-IIFE. (Совместимо с P0-1: гоняется через `ctx`.)

### Verification

- `executeScript({script:'const x=2; return x*3'})` → 6.
- `executeScript({script:'document.title'})` → заголовок (не сломали).
- `executeScript({script:'return [...document.querySelectorAll("a")].map(a=>a.href)'})` (со словом нет, но проверить и с function в колбэке) → массив.

---

## P1-5 — click: ожидание смены SPA-роута

### Текущее поведение

`utils/actions/click-action.js`: явное ожидание только опциональный `waitForSelector` (деф. `null`). Навигация определяется по `page.url() !== before` (`utils/post-click-diagnostics.js:185-193`), но `history.pushState` URL может не сменить. `success` = «click доставлен».

### Целевое поведение

Опциональное ожидание смены вью: параметр `waitForRouteChange` (boolean) и/или существующий `waitForSelector`. При `waitForRouteChange:true` — `page.waitForFunction` по `location.pathname + location.search` относительно before (короткий timeout, не фейлит клик при таймауте — пишет в диагностику `routeChanged:false`). Задокументировать в README, что для SPA надёжнее `waitForSelector` нового контента.

### Реализация (точки)

- `server/tool-schemas.js ClickSchema`: `waitForRouteChange` boolean default false.
- `utils/actions/click-action.js`: после клика, если флаг — `waitForFunction`, результат в диагностику.

### Verification

- Клик по SPA-пункту с `waitForRouteChange:true` → ждёт смены pathname, в ответе `routeChanged:true`.
- Без флага — поведение не меняется.

---

## P1-6 — navigateTo: лимит и фильтр network-дампа

### Текущее поведение

`utils/post-click-diagnostics.js:302-310` печатает ВСЕ tracked-запросы (2 строки/запрос) без лимита; `trackedRequests` = все GET/POST в окне 200мс (фильтр по методу, не по типу ресурса) → JS-чанки/css/шрифты в дампе (~67 строк).

### Целевое поведение

- Фильтр: только XHR/Fetch (исключить `Script`/`Stylesheet`/`Font`/`Image`/`Media`).
- Лимит вывода: 10–15 строк + `… N more`.

### Реализация (точки)

- `utils/post-click-diagnostics.js:302-310`: фильтр по `resourceType`, slice до лимита, суффикс «… N more».
- (Опционально) флаг verbose в `navigateTo` для полного дампа.

### Verification

- `navigateTo` на тяжёлую SPA → дамп ≤ 15 строк, только XHR/Fetch, остальное «… N more».

---

## Cross-cutting

- **README.md**: документировать новые тулы `switchFrame`, `listFrames`; новые env (P0-2); новые параметры `minConfidence` (smartFind), `waitForRouteChange` (click). Обновить tool count в Features. (ОБЯЗАТЕЛЬНО, по CLAUDE.md.)
- **analyzePage benchmark** (CLAUDE.md): прогнать Google-бенчмарк после изменений analyzePage (P0-1 прогон через ctx) — размер вывода не должен вырасти.
- **build**: `npm run build` после каждого блока (проверка синтаксиса, ES-модули).
- **CHANGELOG / version bump**: НЕ автоматически — спросить пользователя в конце сессии.

## Suggested order

1. P0-2 (env) — мелко, разблокирует ручной прогон в живой сессии, regression-safe.
2. P0-1 (switchFrame/listFrames + ctx прогон) — ядро.
3. P1-4 (executeScript) — мелко, независимо.
4. P1-6 (navigateTo дамп) — мелко, независимо.
5. P1-3 (smartFind порог) — средне.
6. P1-5 (click SPA-wait) — средне.

# Spec: Credential Vault в Chrome-расширении, ввод пароля по команде MCP

**Status**: DONE (v3.7.0)
**Created**: 2026-11-09

## Decisions (зафиксировано с пользователем 2026-11-09)

- Ключ шифрования: **вариант B, без мастер-пароля** (non-extractable CryptoKey в IndexedDB расширения). Экрана unlock/lock нет.
- Capture с текущей страницы не делаем.
- UI: форма в popup с полями **URL, логин, пароль**. Имя записи опционально, по умолчанию `host` (при нескольких логинах на один host: `host:login`). Origin берётся из введённого URL.

## Идея

Пароли хранятся в расширении ChromeTools (`extension/`). Пользователь добавляет их через popup расширения. MCP-сервер и LLM пароль никогда не получают: LLM вызывает `typeCredential({ name, id })`, MCP передаёт в расширение только имя записи и селектор поля, расширение само вставляет пароль в страницу и возвращает `ok / error`.

## Motivation

Сейчас логин через MCP требует передать пароль в чат и в `type({text})`. Пароль остаётся в истории диалога и логах.

Утечки в текущем коде, которые надо закрыть вместе с этим:
- `type` возвращает введённый текст в ответе (`model.getActionDescription(text, ...)`, `utils/actions/type-action.js`).
- `analyzePage` отдаёт `metadata.value` любого input, включая `type=password` (`pom/apom-tree-converter.js:992`).
- `getNetworkRequest` отдаёт тело POST логина.

## Non-goals

- Защита от LLM, которая целенаправленно читает поле через `executeScript` и кодирует значение (base64 и т.п.). Митигация ниже, полная защита только через `ENABLED_TOOLS` без `executeScript`. Документируем.
- Интеграция со встроенным менеджером паролей Chrome / Bitwarden.
- TOTP (follow-up: хранить seed в расширении, генерировать код там же).
- Миграция старых `secrets/*.json` рекордера.

---

## 1. Хранение в расширении

- `chrome.storage.local`, ключ `vault`: `[{ name, username, origins: [...], cipher, iv, createdAt }]`.
- Пароль шифруется WebCrypto AES-GCM. Ключ: non-extractable `CryptoKey`, генерируется один раз и хранится в IndexedDB расширения. Мастер-пароля нет, работает автономно; шифрование защищает только от чтения файлов storage в открытом виде.
- Важно: хранилище живёт в профиле Chrome. При дефолтном временном профиле (`%TEMP%/chrome-mcp-profile`) оно переживает перезапуск, пока профиль не удалён. При `CHROMETOOLS_USER_DATA_DIR` - в указанном профиле. Пишем в README.

## 2. UI: вкладка "Passwords" в popup

`extension/popup/popup.html|js|css`:
- список записей: имя, username, origins (пароль не показывается, есть кнопка "показать" для самого пользователя);
- форма добавления: URL (предзаполнен origin активной вкладки), логин, пароль, имя (опционально, по умолчанию host);
- удаление, редактирование.

Пароль вводится только в popup - это UI расширения, ни страница, ни MCP его не видят.

## 3. Транспорт MCP -> расширение

**Основной: CDP к service worker расширения.** Puppeteer видит service worker расширения как target (`browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://<id>/'))`). MCP вызывает `worker.evaluate(() => self.__ctVault.fill({...}))`. Не зависит от установки native bridge.

API в `background.js` (`self.__ctVault`), все методы НЕ возвращают пароль:
- `list(origin?)` -> `[{ name, username, origins }]`
- `fill({ name, field, tabUrl, frameUrl?, selector, allowNonPasswordField })` -> `{ ok, error? }`
- `redact(text)` -> text с заменой значений на `[REDACTED:<name>]`
- `status()` -> `{ count }`

**Загрузка расширения (найдено при реализации)**: Chrome 137+ игнорирует `--load-extension` (проверено на 156, флаг `DisableLoadExtensionCommandLineSwitch` тоже не помогает). Расширение сейчас фактически не грузится в браузер MCP. Рабочий путь: запуск с `--enable-unsafe-extension-debugging` и CDP `Extensions.loadUnpacked({ path })` с browser-сессии по тому же WS-порту (проверено). Новых рисков нет: CDP-порт и так даёт полный контроль над браузером.

**Защита расширения от LLM**: открыв `chrome-extension://<id>/...` во вкладке, `executeScript` мог бы использовать ключ из IndexedDB для расшифровки. `navigateTo` / `openBrowser` / `executeScript` должны отказывать на `chrome-extension://` URL.

Fallback: если service worker недоступен (подключение к чужому Chrome без расширения) - понятная ошибка `ChromeTools extension not loaded`.

## 4. Ввод пароля (`fill`) внутри расширения

1. Найти вкладку: `chrome.tabs.query` по URL страницы, которую MCP считает текущей (+ active). Фрейм: `chrome.webNavigation.getAllFrames` по `frameUrl` активного фрейма MCP (`switchFrame`).
2. `chrome.scripting.executeScript({ target: { tabId, frameIds }, world: 'ISOLATED', func, args })`. Внутри:
   - проверка `location.origin` против `origins` записи (origin binding);
   - проверка `el.type === 'password'` для `field: password` (если нет `allowNonPasswordField`);
   - `https:` или localhost;
   - установка значения через нативный setter `HTMLInputElement.prototype.value` + события `input`/`change` (React/Vue/Angular подхватывают);
   - возврат только `{ ok, error }`.
3. Пароль расшифровывается только в service worker на время вызова и передаётся в isolated world (скрипты страницы его аргументы не видят).

## 5. Тулы MCP

| Тул | Параметры | Возвращает |
|---|---|---|
| `typeCredential` | `name`, `field: password\|username` (default password), `id?/selector?`, `allowNonPasswordField?` | `Typed password of "name" into <identifier>` + post-type диагностика (redacted) |
| `listCredentials` | `origin?` | `[{ name, username, origins }]` |

Сохранение/удаление через MCP не делаем: пароли добавляет только пользователь в popup. Username не секрет, отдаётся в `listCredentials`, но вводится тоже через `typeCredential(field: "username")`.

## 6. Защита вывода MCP

- **Redact всех ответов**: в обработчике `CallToolRequestSchema` (`index.js:302`), если в этой сессии был хотя бы один `typeCredential`, текст ответа любого тула прогоняется через `__ctVault.redact(text)` в расширении (MCP значений не знает, расширение знает). Варианты: raw, URL-encoded, JSON-escaped. Покрывает `getNetworkRequest`, `executeScript`, `getConsoleLogs`, diagnostics.
- **`analyzePage`**: `metadata.value` для `input[type=password]` всегда `"***"` (если не пусто), независимо от vault.
- **Рекордер**: шаг `{ action: "typeCredential", name }` без значения.

## Изменяемые файлы

- `extension/background.js`: `self.__ctVault` (crypto, storage, fill, redact)
- `extension/popup/popup.html|js|css`: вкладка Passwords
- `extension/manifest.json`: версия (синк с package.json); permissions уже есть (`storage`, `scripting`, `webNavigation`, `<all_urls>`)
- `utils/vault-client.js` (новое): поиск service worker расширения, вызовы list/fill/redact
- `server/tool-schemas.js`, `server/tool-definitions.js`: 2 тула
- `index.js`: обработчики + redact в `CallToolRequestSchema`
- `pom/apom-tree-converter.js:992`: маска value для password
- `README.md` / `README.ru.md`: раздел, threat model, счётчик тулов

## Verification

1. Добавить запись в popup, в `chrome.storage.local` пароль только в зашифрованном виде.
2. `listCredentials` - запись видна без пароля.
3. `typeCredential` на правильном origin: логин проходит (живой стенд), в том числе React-форма и форма внутри iframe после `switchFrame`.
4. Другой origin: ошибка, поле пустое.
5. `field: password` в text input без флага: ошибка.
6. После ввода `analyzePage`, `getNetworkRequest` логин-запроса, `executeScript("return document.querySelector('input[type=password]').value")`: значения нет ни в одном ответе.
8. `npm run build`, analyzePage benchmark.

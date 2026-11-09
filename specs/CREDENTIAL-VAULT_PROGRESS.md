# Progress: Credential Vault (Chrome extension)

**Spec**: [CREDENTIAL-VAULT_SPEC.md](CREDENTIAL-VAULT_SPEC.md)
**Status**: DONE (v3.7.0) - проверено на реальном сайте (standhub, LDAP-логин, тело POST заменено на [REDACTED])

## Phase 1 - Vault в расширении
- [x] `extension/vault.js`: шифрование WebCrypto (non-extractable key в IndexedDB), storage, origin normalize/match (+wildcard)
- [x] `background.js`: VAULT_* сообщения только от action popup (`isTrustedPopup`), `self.__ctVault.list/status`
- [x] Popup: вкладка Passwords (список; форма URL / логин / пароль / имя; показ, редактирование, удаление)
- [x] Verify (Node, моки): нормализация, wildcard (evilnovofon.ru / novofon.ru.evil.com отклоняются), имена по умолчанию, edit с пустым паролем, delete, ключ non-extractable, нет plaintext в storage
- [x] Verify (живой Chrome 156): SW поднимается, popup-как-вкладка отклонён, настоящий popup: prefill URL, save x2, list, фильтр по origin, reveal, delete, нет plaintext в storage

## Phase 2 - Ввод
- [x] `browser-manager.js`: `ensureExtensionLoaded` (CDP `Extensions.loadUnpacked`) + `--enable-unsafe-extension-debugging`, во всех 3 путях подключения; `force` будит уснувший SW. Данные расширения переживают перезапуск Chrome (проверено)
- [x] Блок `chrome-extension://` в navigateTo / openBrowser / executeScript (`vaultClient.assertNotExtensionUrl`)
- [x] `__ctVault.fill` (`extension/vault.js` `fillCredential`): поле ищется по одноразовой метке `data-ct-fill=<nonce>`, которую ставит MCP; probe во всех вкладках/фреймах, origin binding, пароль только во фрейм-победитель; password-only; нативный setter + input/change
- [x] `utils/vault-client.js`: поиск SW, ожидание `self.__ctVault`, list/fill
- [x] Тулы `typeCredential`, `listCredentials` (schema + definition + handler + группа interaction)
- [x] Verify e2e (MCP по stdio, Chrome 156, 20/20): авто-загрузка расширения, list + matchesCurrentPage, логин и пароль, обход React-like value tracker, метка снимается, password в text-поле отклонён, cross-origin iframe через switchFrame (чужая запись отклонена, своя введена), чужой origin отклонён, chrome-extension:// заблокирован, пароль ни в одном ответе MCP

## Phase 3 - Защита вывода
- [x] `__ctVault.redact` (`redactTexts`): raw, encodeURIComponent, form-urlencoded (`!'()~`, `+`), lower-hex, JSON-escaped, base64, Basic `user:pass`; кэш сбрасывается по `chrome.storage.onChanged`; пароли короче 4 символов не фильтруются
- [x] Подключено в `CallToolRequestSchema` (успешные ответы и ошибки); включается после первого list/typeCredential; fail-closed (ответ скрывается, если расширение не ответило)
- [x] Маска `***` для password: `apom-tree-converter.js`, `apom-converter.js`, `getElementDetails`, `element-finder-utils.js` (text)
- [x] Рекордер: `setMarkedValue` ставит `el.__ctCredential`, `content.js` пишет шаг `typeCredential {name, field}` без значения и без REGISTER_SECRET; `scenario-executor.js` исполняет шаг через vault
- [x] Verify (Node): все варианты кодировок заменяются
- [x] Verify e2e (29/29): рекордер пишет 2 шага typeCredential, пароля нет в storage расширения; analyzePage без пароля и с `***`; executeScript raw и btoa заменены; reversed не ловится (задокументировано); тело POST в getNetworkRequest заменено (найден и исправлен пропуск `%21`); ни в одном ответе нет пароля ни в одной кодировке
- [ ] executeScenario со шагом typeCredential: код есть, e2e не прогонялся (нужен сохранённый сценарий через bridge)

## Phase 4 - Документация
- [x] README.md: раздел 5b Credential Vault, TOC, группа interaction (13), total 50, авто-загрузка расширения
- [x] README.ru.md: раздел "Хранилище паролей", заметка об авто-загрузке
- [x] `npm run build`
- [x] analyzePage benchmark (Google): 35.3 KB (< 40 KB OK); totalElements 350 / interactive 108 выше baseline, маска на счётчики не влияет (на странице нет password-полей), отклонение от выдачи Google

## Fix - несколько процессов MCP на одном Chrome
- [x] Причина: при подключении `browser.targets()` ещё не видит SW расширения, MCP перезагружал расширение; у других процессов оставалась устаревшая цель worker, вызовы без таймаутов висели до общего лимита 120 с
- [x] `ensureExtensionLoaded`: проверка через CDP `Target.getTargets`, перезагрузка только если расширения нет
- [x] `vault-client`: worker по targetId из Chrome (устаревшие цели не используются), таймауты на каждом шаге, один повтор с перезагрузкой
- [x] Verify (2 процесса MCP, 11/11): второй процесс не перезагружает расширение; после внешней перезагрузки и после остановки SW list / typeCredential / redaction отвечают за 15-950 мс; параллельные вызовы. Основной e2e 29/29

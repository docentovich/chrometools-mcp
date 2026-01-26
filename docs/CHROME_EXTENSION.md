# ChromeTools Chrome Extension

Chrome Extension для chrometools-mcp, обеспечивающий полное отслеживание вкладок и запись сценариев.

## Возможности

1. **Полное отслеживание вкладок** - включая вкладки, открытые пользователем вручную (Ctrl+T, контекстное меню)
2. **Запись сценариев** - работает на всех сайтах, состояние сохраняется при переходе между доменами
3. **Поддержка множественных клиентов** - до 8 MCP клиентов одновременно

## Архитектура (Bridge Architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Browser                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  ChromeTools Extension                     │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │  │
│  │  │ background  │  │  content.js │  │   popup     │        │  │
│  │  │  (tabs API) │  │  (recorder) │  │   (UI)      │        │  │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘        │  │
│  │         │                │                                 │  │
│  │         └────────────────┴────────────────────────────────┼──┼──► Native Messaging
│  └───────────────────────────────────────────────────────────┘  │      (stdio)
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                       Web Pages                            │  │
│  │          (content.js инъецируется автоматически)           │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼ Native Messaging
┌──────────────────────────────────────────────────────────────────┐
│              Bridge Service (Native Messaging Host)              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    State Store                              │ │
│  │  • tabs: Map<id, {url, title, active}>                     │ │
│  │  • recordings: Array<Action>                               │ │
│  │  • recorderState: {isRecording, isPaused, ...}             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              WebSocket Server (:9223)                       │ │
│  │  • Accepts 0-8 MCP clients                                 │ │
│  │  • Sends full state on connect                             │ │
│  │  • Broadcasts events in real-time                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
          │              │              │
          ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ Claude   │  │ Telegram │  │ Custom   │
    │ Desktop  │  │   Bot    │  │ Script   │
    │  (MCP)   │  │  (MCP)   │  │  (MCP)   │
    └──────────┘  └──────────┘  └──────────┘
```

### Ключевые компоненты

1. **Chrome Extension (Event Producer)**
   - Отслеживает все вкладки через Chrome tabs API
   - Записывает действия пользователя (клики, ввод, навигация)
   - Отправляет ВСЕ события в Bridge через Native Messaging
   - НЕ зависит от количества подключённых MCP клиентов

2. **Bridge Service (Persistent Intermediary)**
   - Запускается Chrome автоматически при загрузке Extension
   - Хранит состояние (вкладки, записи, recorder state)
   - Живёт пока работает Chrome
   - Принимает 0-8 MCP клиентов через WebSocket

3. **MCP Clients (Event Consumers)**
   - Подключаются к Bridge как WebSocket клиенты
   - Получают полное состояние сразу при подключении
   - Получают обновления в реальном времени
   - Могут отключаться/подключаться в любое время

## Структура файлов

```
extension/
├── manifest.json           # Manifest V3 (со стабильным key для ID)
├── background.js           # Service Worker (tabs API, Native Messaging)
├── content.js              # Content script (запись событий)
├── recorder-overlay.css    # Стили overlay при записи
├── popup/
│   ├── popup.html          # UI popup расширения
│   ├── popup.js            # Логика popup
│   └── popup.css           # Стили popup
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png

bridge/
├── bridge-service.js       # Native Messaging Host + WebSocket server
├── bridge-client.js        # WebSocket client для MCP
└── install.js              # Installer для Bridge
```

## Установка

### 1. Установка Bridge (один раз)

```bash
npx chrometools-mcp --install-bridge
```

Это создаёт:
- `~/.chrometools/bridge-service.js` — Bridge Service
- `~/.chrometools/native-manifest.json` — манифест Native Messaging
- Запись в Windows Registry / Chrome config для регистрации Host

### 2. Установка Extension

**Автоматически** — Extension загружается при запуске Chrome через chrometools-mcp:

```javascript
// Chrome запускается с флагами:
--load-extension=/path/to/extension
--disable-extensions-except=/path/to/extension
```

**Вручную** — если Chrome уже запущен:

1. Открыть `chrome://extensions/`
2. Включить "Developer mode"
3. Нажать "Load unpacked"
4. Выбрать папку `extension/` из пакета chrometools-mcp

### 3. Проверка

```bash
npx chrometools-mcp --check-bridge
```

## Extension ID

Extension имеет **стабильный ID**: `dmehkibmncgphijnigkahhlekgajhpbl`

Это достигается через поле `key` в manifest.json:
```json
{
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."
}
```

Стабильный ID необходим для Native Messaging — Host должен знать точный ID Extension.

## Жизненный цикл

```
1. Пользователь открывает Chrome
2. Extension загружается
3. Extension вызывает chrome.runtime.connectNative("com.chrometools.bridge")
4. Chrome запускает Bridge Service как child process
5. Bridge поднимает WebSocket сервер на :9223
6. Extension отправляет текущие вкладки в Bridge

7. Пользователь пишет боту → Claude Code стартует
8. MCP подключается к Bridge → получает полное состояние
9. Claude работает, получает события в реальном времени
10. Claude Code завершается → отключается от Bridge
11. Bridge продолжает работать, состояние сохранено

12. Новый запрос → новый Claude → подключается → актуальное состояние

13. Chrome закрывается → Bridge завершается (Chrome убивает child process)
```

## Отладка

### Консоль Extension

1. Открыть `chrome://extensions/`
2. Найти "ChromeTools MCP"
3. Нажать "Service Worker" для открытия DevTools
4. Смотреть Console для логов

### Логи Bridge

Bridge пишет в stderr:
```
[bridge] 2026-01-26T11:00:00.000Z Starting com.chrometools.bridge
[bridge] 2026-01-26T11:00:00.010Z WebSocket server listening on port 9223
[bridge] 2026-01-26T11:00:00.020Z Extension connected
[bridge] 2026-01-26T11:00:05.000Z Client connected (1/8)
```

### Проверка Native Messaging

Windows:
```cmd
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.chrometools.bridge"
```

Linux/macOS:
```bash
cat ~/.config/google-chrome/NativeMessagingHosts/com.chrometools.bridge.json
```

## Troubleshooting

### Extension показывает "Disconnected"

1. Проверить установку Bridge: `npx chrometools-mcp --check-bridge`
2. Переустановить: `npx chrometools-mcp --install-bridge`
3. Перезагрузить Extension в chrome://extensions

### "Error when communicating with the native messaging host"

- Bridge не может найти зависимости (ws пакет)
- Убедиться что `chrometools-mcp` установлен глобально или путь к проекту корректный

### MCP не видит вкладки

1. Проверить что Extension подключён (иконка должна быть цветной)
2. Проверить что Bridge работает (порт 9223)
3. Перезапустить Chrome

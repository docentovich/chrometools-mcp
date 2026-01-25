# ChromeTools Chrome Extension

Chrome Extension для chrometools-mcp, обеспечивающий полное отслеживание вкладок и запись сценариев.

## Возможности

1. **Полное отслеживание вкладок** - включая вкладки, открытые пользователем вручную (Ctrl+T, контекстное меню)
2. **Запись сценариев** - работает на всех сайтах, состояние сохраняется при переходе между доменами

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Browser                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              ChromeTools Extension                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ background  │  │  content.js │  │   popup     │  │   │
│  │  │  (tabs API) │  │  (recorder) │  │   (UI)      │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘  │   │
│  │         │                │                           │   │
│  │         └────────────────┼───────────────────────────┼───┼──► WebSocket
│  └─────────────────────────────────────────────────────┘   │      ws://localhost:9223
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Web Pages                         │   │
│  │         (content.js инъецируется автоматически)      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (Node.js)                     │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ websocket-bridge │  │   Puppeteer     │                  │
│  │  (extension comm)│  │  (page control) │                  │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

## Структура файлов

```
extension/
├── manifest.json           # Manifest V3
├── background.js           # Service Worker (tabs API, WebSocket)
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
```

## Установка

### Автоматическая (рекомендуется)

Extension автоматически загружается при запуске Chrome через chrometools-mcp:

```javascript
// Chrome запускается с флагами:
--load-extension=/path/to/extension
--disable-extensions-except=/path/to/extension
```

### Ручная установка

Если Chrome уже запущен без extension:

1. Открыть `chrome://extensions/`
2. Включить "Developer mode"
3. Нажать "Load unpacked"
4. Выбрать папку `extension/` из пакета chrometools-mcp

## Связь Extension <-> MCP Server

### WebSocket

- **URL**: `ws://localhost:9223/chrometools`
- **Порт**: 9223 (CHROME_DEBUG_PORT + 1)

### Протокол сообщений

```typescript
// Extension -> MCP
interface ExtensionMessage {
  type: 'tab_created' | 'tab_closed' | 'tab_activated' | 'tab_updated' |
        'tabs_sync' | 'scenario_save' | 'scenario_list_request' | 'ping';
  payload: any;
  requestId?: string;
}

// MCP -> Extension
interface MCPMessage {
  type: 'tabs_request' | 'scenario_list_response' | 'scenario_saved' |
        'recorder_start' | 'recorder_stop' | 'pong';
  payload: any;
  requestId?: string;
}
```

## Использование

### Отслеживание вкладок

Extension автоматически отслеживает все вкладки через Chrome tabs API:
- `chrome.tabs.onCreated` - новая вкладка
- `chrome.tabs.onRemoved` - закрытие вкладки
- `chrome.tabs.onActivated` - переключение на вкладку
- `chrome.tabs.onUpdated` - изменение URL/title

Данные синхронизируются с MCP сервером и доступны через инструменты `listTabs` и `switchTab`.

### Запись сценариев

1. Кликнуть на иконку CT в toolbar Chrome
2. Ввести имя сценария
3. Нажать "Start Recording"
4. Выполнить действия на странице
5. Нажать "Stop & Save"

Сценарии сохраняются в `~/.config/chrometools-mcp/projects/{domain}/scenarios/`

### Записываемые события

- **click** - клики по элементам
- **type** - ввод текста (с автодетекцией паролей)
- **select** - выбор в dropdown
- **keypress** - специальные клавиши (Enter, Escape, Tab, стрелки)
- **scroll** - прокрутка

## Permissions

```json
{
  "permissions": ["tabs", "activeTab", "scripting", "storage", "webNavigation"],
  "host_permissions": ["<all_urls>"]
}
```

## Хранение состояния

Состояние рекордера хранится в `chrome.storage.local`:
- Сохраняется при переходе между доменами
- Восстанавливается при перезагрузке страницы
- Очищается после сохранения сценария

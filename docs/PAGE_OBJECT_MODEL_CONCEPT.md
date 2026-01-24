# Agent Page Object Model (APOM) API - Концепция и спецификация

> **ВАЖНО: Терминология**
>
> В chrometools-mcp существуют **два разных** инструмента с похожими названиями, но **разным назначением**:
>
> 1. **Test Page Object (generatePageObject)** - существующий инструмент
>    - **Назначение**: Экспорт структуры страницы в автотесты (Playwright/Selenium)
>    - **Для кого**: QA-инженеры, разработчики автотестов
>    - **Формат**: Генерация кода классов для test frameworks
>    - **Файл**: `recorder/page-object-generator.js`
>    - **Сохраняется**: ✅ Остаётся без изменений
>
> 2. **Agent Page Object Model (APOM)** - новый API (эта спецификация)
>    - **Назначение**: Промежуточная модель коммуникации AI-агента с MCP chrometools
>    - **Для кого**: AI-агенты (Claude, ChatGPT, etc.)
>    - **Формат**: JSON-модель страницы с element IDs и actions
>    - **Цель**: Упростить взаимодействие агента с браузером через объектную модель
>    - **Новые инструменты**: `getPageObject`, `performAction`, `updatePageObject`, `queryElements`
>
> **Терминология в этом документе:**
> - **APOM (Agent Page Object Model)** = модель для AI-агентов
> - **Test Page Object** = существующий инструмент для автотестов

## Содержание

1. [Общая концепция](#общая-концепция)
2. [Архитектура решения](#архитектура-решения)
3. [Модели элементов](#модели-элементов)
4. [API инструментов](#api-инструментов)
5. [План разработки](#план-разработки)
6. [Примеры использования](#примеры-использования)

---

## Общая концепция

### Проблема

Текущая архитектура chrometools-mcp требует от AI агента работать с низкоуровневыми селекторами и отдельными командами для каждого действия. Это приводит к:

1. **Множественным запросам**: для получения информации о странице и последующих действий
2. **Потере контекста**: между вызовами инструментов элементы могут измениться
3. **Ограниченной семантике**: агент не знает, какие операции доступны для конкретного элемента
4. **Избыточным токенам**: получение HTML для простых операций

### Решение: Agent Page Object Model (APOM) API

Предлагается создать объектную модель для AI-агентов, где:

1. **Один инструмент возвращает полную модель страницы** с уникальными идентификаторами элементов
2. **Каждый элемент содержит метаданные** о доступных операциях (actions)
3. **Последующие команды работают с ID элементов**, а не с селекторами
4. **Модели типизированы** в зависимости от типа элемента (input, form, button, link и т.д.)
5. **ID элементов валидны в течение сессии** страницы (до перезагрузки/навигации)

---

## Архитектура решения

### 1. Инструменты верхнего уровня

> **🔄 ВАЖНОЕ АРХИТЕКТУРНОЕ РЕШЕНИЕ (v3.0.0)**
>
> **analyzePage → getPageObject (переименование + расширение)**
>
> В v3.0.0 существующий инструмент `analyzePage` будет переименован и расширен:
> - **Старое название:** `analyzePage` (v1.0 - v2.x)
> - **Новое название:** `getPageObject` (v3.0.0+)
>
> **Что изменится:**
> - ✅ Автоматическая генерация уникальных ID для каждого элемента
> - ✅ Автоматическая регистрация элементов в реестре (использует `utils/selector-resolver.js`)
> - ✅ Возвращает `pageId` для валидации
> - ✅ Группировка элементов по типу/секциям
> - ✅ Сохранение всех существующих возможностей `analyzePage`
>
> **Обратная совместимость:**
> - Параметр `legacy: true` вернёт старый формат без ID (для миграции)
> - `analyzePage` будет работать как алиас для `getPageObject({ legacy: true })`
>
> **Миграция:**
> ```javascript
> // Старый код (v2.x):
> const analysis = analyzePage()
> click({ selector: "#email" })
>
> // Новый код (v3.0.0):
> const page = getPageObject()
> click({ selector: "input_email_0" })  // или "#email" (backward compatible)
> ```

#### `getPageObject` - получение объектной модели страницы (APOM)

**Статус:** 🚧 Планируется в v3.0.0 (переименование + расширение `analyzePage`)

**Назначение:** Главный инструмент APOM API — получение полной модели страницы с автоматической генерацией ID и регистрацией элементов

**Параметры:**
```typescript
{
  // Существующие параметры из analyzePage:
  includeAll?: boolean,           // Включить все видимые элементы (default: false)

  // Новые параметры APOM:
  refresh?: boolean,              // Пересчитать модель (default: false)
  generateIds?: boolean,          // Генерировать уникальные ID (default: true в v3.0.0)
  registerElements?: boolean,     // Автоматически регистрировать элементы (default: true)
  groupBy?: 'type' | 'section' | 'flat', // Группировка элементов (default: 'type')
  maxElements?: number,           // Лимит элементов (default: 200)

  // Обратная совместимость:
  legacy?: boolean                // Вернуть старый формат analyzePage (default: false)
}
```

**Возвращает:**
```typescript
{
  pageId: string,                 // Уникальный ID страницы (для валидации)
  url: string,
  title: string,
  timestamp: number,              // Когда создана модель

  elements: {
    [elementId: string]: PageElement  // Карта элементов
  },

  // Группировки для удобства
  groups: {
    inputs?: ElementGroup,
    buttons?: ElementGroup,
    links?: ElementGroup,
    forms?: FormGroup[],
    sections?: SectionGroup[]
  },

  metadata: {
    totalElements: number,
    interactiveCount: number,
    formCount: number
  }
}
```

#### `performAction` - выполнение действия над элементом 🚧 **НЕ РЕАЛИЗОВАН**

**Параметры:**
```typescript
{
  pageId: string,                 // Валидация что страница не изменилась
  elementId: string,              // ID элемента из getPageObject
  action: ActionType,             // Тип действия (зависит от элемента)
  params?: ActionParams,          // Параметры действия
  screenshot?: boolean            // Сделать скриншот после действия
}
```

**Примеры actions:**
```typescript
// Для input элемента
{ action: 'type', params: { text: 'username' } }
{ action: 'clear' }
{ action: 'focus' }

// Для button
{ action: 'click' }
{ action: 'hover' }

// Для любого элемента
{ action: 'setStyles', params: { styles: [{name: 'color', value: 'red'}] } }
{ action: 'scrollTo' }

// Для select
{ action: 'selectOption', params: { value: 'option1' } }

// Для form
{ action: 'submit' }
{ action: 'fillForm', params: { fields: {...} } }
```

#### `updatePageObject` - обновление части модели 🚧 **НЕ РЕАЛИЗОВАН**

**Параметры:**
```typescript
{
  pageId: string,
  elementIds?: string[],          // Обновить только эти элементы (или все)
  includeNew?: boolean            // Добавить новые элементы (default: true)
}
```

**Использование:** после динамических изменений на странице (AJAX, React re-renders)

#### `queryElements` - поиск элементов в модели 🚧 **НЕ РЕАЛИЗОВАН**

**Параметры:**
```typescript
{
  pageId: string,
  query: {
    type?: ElementType | ElementType[],
    text?: string,                // Поиск по тексту (substring, case-insensitive)
    attributes?: Record<string, string>, // Поиск по атрибутам
    visible?: boolean,
    inForm?: boolean,
    parentId?: string             // Дочерние элементы
  },
  limit?: number                  // default: 20
}
```

**Возвращает:** массив `ElementId[]`

---

### 2. Модели элементов

Базовая модель для всех элементов:

```typescript
interface PageElement {
  id: string,                     // Уникальный ID в рамках модели
  type: ElementType,              // Тип элемента
  selector: string,               // CSS селектор для Puppeteer

  // Метаданные
  tagName: string,
  text?: string,
  visible: boolean,
  enabled: boolean,

  // Геометрия
  bounds?: {
    x: number,
    y: number,
    width: number,
    height: number
  },

  // Атрибуты
  attributes: Record<string, string>,

  // Доступные действия
  actions: Action[],

  // Стили (опционально при includeStyles: true)
  styles?: Record<string, string>,

  // Родитель/дети
  parentId?: string,
  childIds?: string[]
}
```

#### 2.1. Input элементы

```typescript
interface InputElement extends PageElement {
  type: 'input',

  inputType: 'text' | 'password' | 'email' | 'number' | 'tel' | 'search' | 'url' | 'date' | ...,
  value: string,
  placeholder?: string,
  required: boolean,
  disabled: boolean,
  readonly: boolean,
  maxLength?: number,
  pattern?: string,

  // Валидация
  validation: {
    required: boolean,
    pattern?: string,
    minLength?: number,
    maxLength?: number,
    min?: number,            // для type=number/date
    max?: number,
    step?: number
  },

  // Состояние валидации
  validationState?: {
    valid: boolean,
    message?: string
  },

  // Доступные действия
  actions: [
    { type: 'type', params: { text: string, delay?: number, clearFirst?: boolean } },
    { type: 'clear' },
    { type: 'focus' },
    { type: 'blur' },
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}
```

#### 2.2. Textarea элементы

```typescript
interface TextareaElement extends PageElement {
  type: 'textarea',

  value: string,
  placeholder?: string,
  required: boolean,
  disabled: boolean,
  readonly: boolean,
  maxLength?: number,
  rows?: number,
  cols?: number,

  validation: {
    required: boolean,
    minLength?: number,
    maxLength?: number
  },

  actions: [
    { type: 'type', params: { text: string, clearFirst?: boolean } },
    { type: 'clear' },
    { type: 'focus' },
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}
```

#### 2.3. Select элементы

```typescript
interface SelectElement extends PageElement {
  type: 'select',

  // Базовые свойства
  multiple: boolean,              // Множественный выбор
  required: boolean,              // Обязательное поле
  disabled: boolean,              // Элемент заблокирован
  readonly: boolean,              // Только для чтения (если поддерживается)
  size?: number,                  // Количество видимых опций (для multiple)

  // Опции
  options: Array<{
    value: string,                // Значение опции (атрибут value)
    text: string,                 // Отображаемый текст
    index: number,                // Индекс опции (0-based)
    selected: boolean,            // Выбрана ли опция
    disabled: boolean,            // Заблокирована ли опция
    group?: string,               // Название группы (optgroup label), если есть
    groupIndex?: number           // Индекс в группе (для optgroup)
  }>,

  // Текущий выбор
  selectedValues: string[],      // Массив выбранных значений (value)
  selectedTexts: string[],       // Массив выбранных текстов (для отображения)
  selectedIndices: number[],     // Массив индексов выбранных опций
  selectedValue: string | null,  // Первое выбранное значение (для удобства)
  selectedText: string | null,   // Первый выбранный текст (для удобства)
  selectedIndex: number,         // Первый выбранный индекс (-1 если ничего не выбрано)

  // Группировка (optgroup)
  hasGroups: boolean,            // Есть ли группы (optgroup)
  groups?: Array<{
    label: string,               // Название группы
    disabled: boolean,           // Группа заблокирована
    optionIndices: number[]      // Индексы опций в этой группе
  }>,

  // UI Framework информация (v2.6.0+)
  uiFramework?: {
    name: string,                // 'mui' | 'antd' | 'chakra' | 'bootstrap' | 'vuetify' | 'semantic' | null
    version?: string,            // Версия библиотеки (если определена)
    component?: string,          // Название компонента ('Select', 'Dropdown', etc.)
    customDropdown: boolean,     // true если кастомный dropdown (не нативный <select>)
    expanded?: boolean,          // Развернут ли dropdown (если кастомный)
    searchable?: boolean         // Поддерживает ли поиск (если кастомный)
  },

  // Валидация
  validation: {
    required: boolean,
    customValidity?: string      // Кастомное сообщение валидации
  },

  // Метаданные
  name?: string,                 // Атрибут name
  form?: string,                 // ID формы (атрибут form)
  autocomplete?: string,         // Атрибут autocomplete

  // Доступные действия
  actions: [
    { type: 'selectOption', params: { value?: string, text?: string, index?: number } },
    { type: 'selectMultiple', params: { values: string[] } },  // для multiple
    { type: 'deselectOption', params: { value?: string, text?: string, index?: number } }, // для multiple
    { type: 'deselectAll' },                                   // для multiple
    { type: 'focus' },
    { type: 'blur' },
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}
```

**Особенности Select элементов:**

1. **Нативные vs Кастомные:**
   - Нативные `<select>` элементы всегда возвращают полную информацию об опциях
   - Кастомные dropdown (MUI, Ant Design, etc.) могут иметь `uiFramework.customDropdown: true`
   - Для кастомных dropdown опции могут быть недоступны, если dropdown не раскрыт

2. **Группировка опций (optgroup):**
   - Если используется `<optgroup>`, каждая опция получает поле `group` с названием группы
   - Массив `groups` содержит информацию о всех группах
   - `groupIndex` указывает позицию опции внутри группы

3. **Множественный выбор (multiple):**
   - `selectedValues`, `selectedTexts`, `selectedIndices` содержат все выбранные элементы
   - Для удобства `selectedValue`, `selectedText`, `selectedIndex` содержат первый выбранный элемент

4. **UI Framework Detection (v2.6.0+):**
   - Автоматически определяется используемая UI-библиотека
   - Для MUI Select, Ant Design Select, Chakra Select, etc. заполняется `uiFramework`
   - `customDropdown: true` означает, что элемент не является нативным `<select>`

**Примеры:**

```typescript
// Нативный <select>
{
  type: 'select',
  multiple: false,
  options: [
    { value: 'US', text: 'United States', index: 0, selected: true, disabled: false },
    { value: 'UK', text: 'United Kingdom', index: 1, selected: false, disabled: false }
  ],
  selectedValue: 'US',
  selectedText: 'United States',
  selectedIndex: 0,
  hasGroups: false,
  uiFramework: null
}

// Select с optgroup
{
  type: 'select',
  options: [
    { value: 'us', text: 'United States', index: 0, selected: false, group: 'North America', groupIndex: 0 },
    { value: 'ca', text: 'Canada', index: 1, selected: false, group: 'North America', groupIndex: 1 },
    { value: 'uk', text: 'United Kingdom', index: 2, selected: true, group: 'Europe', groupIndex: 0 }
  ],
  hasGroups: true,
  groups: [
    { label: 'North America', disabled: false, optionIndices: [0, 1] },
    { label: 'Europe', disabled: false, optionIndices: [2] }
  ],
  selectedValue: 'uk'
}

// MUI Select (кастомный)
{
  type: 'select',
  options: [
    { value: '1', text: 'Option 1', index: 0, selected: true }
  ],
  uiFramework: {
    name: 'mui',
    version: '5.x',
    component: 'Select',
    customDropdown: true,
    expanded: false,
    searchable: false
  },
  selectedValue: '1'
}
```

#### 2.4. Button элементы

```typescript
interface ButtonElement extends PageElement {
  type: 'button',

  buttonType: 'button' | 'submit' | 'reset',
  disabled: boolean,

  // Контекст
  formId?: string,               // ID формы если кнопка внутри формы
  role?: string,                 // ARIA role
  ariaLabel?: string,

  actions: [
    { type: 'click', params: { waitForNavigation?: boolean } },
    { type: 'hover' },
    { type: 'focus' },
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}
```

#### 2.5. Link элементы

```typescript
interface LinkElement extends PageElement {
  type: 'link',

  href: string,
  target?: '_blank' | '_self' | '_parent' | '_top',
  download?: string,
  rel?: string,

  actions: [
    { type: 'click', params: { waitForNavigation?: boolean } },
    { type: 'hover' },
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}
```

#### 2.6. Form элементы (композитная модель)

```typescript
interface FormElement extends PageElement {
  type: 'form',

  method: 'GET' | 'POST',
  action?: string,
  enctype?: string,

  // Поля формы (группированные)
  fields: {
    inputs: Record<string, InputElement>,
    textareas: Record<string, TextareaElement>,
    selects: Record<string, SelectElement>,
    checkboxes: Record<string, CheckboxElement>,
    radios: Record<string, RadioElement>
  },

  // Кнопки формы
  submitButtons: ButtonElement[],
  resetButtons: ButtonElement[],

  // Валидация всей формы
  validation: {
    valid: boolean,              // Валидна ли форма в целом
    requiredFields: string[],    // ID обязательных полей
    invalidFields: string[]      // ID невалидных полей
  },

  actions: [
    {
      type: 'fillForm',
      params: {
        fields: Record<fieldId, string>,  // Заполнить несколько полей
        submit?: boolean                  // Автоматически отправить
      }
    },
    { type: 'submit', params: { waitForNavigation?: boolean } },
    { type: 'reset' },
    { type: 'validateForm' },    // Запустить HTML5 валидацию
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}
```

#### 2.7. Checkbox/Radio элементы

```typescript
interface CheckboxElement extends PageElement {
  type: 'checkbox',

  checked: boolean,
  required: boolean,
  disabled: boolean,
  value: string,

  // Для связанных радио
  name?: string,                 // Группа радио-кнопок

  actions: [
    { type: 'toggle' },          // Переключить
    { type: 'check' },           // Установить checked
    { type: 'uncheck' },         // Снять checked
    { type: 'click' },
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}

interface RadioElement extends PageElement {
  type: 'radio',

  checked: boolean,
  required: boolean,
  disabled: boolean,
  value: string,
  name: string,                  // Группа радио

  // Другие опции в группе
  groupOptions: Array<{
    elementId: string,
    value: string,
    text?: string,
    checked: boolean
  }>,

  actions: [
    { type: 'select' },          // Выбрать эту опцию
    { type: 'click' },
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}
```

#### 2.8. Generic/Non-interactive элементы

```typescript
interface GenericElement extends PageElement {
  type: 'generic',

  role?: string,                 // ARIA role
  ariaLabel?: string,

  // Интерактивность
  clickable: boolean,            // Имеет onclick или cursor:pointer
  hoverable: boolean,            // Имеет hover эффекты

  actions: [
    { type: 'click' }?,          // Только если clickable
    { type: 'hover' }?,          // Только если hoverable
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' },
    { type: 'getComputedCss', params: { category?: string } },
    { type: 'getBoxModel' }
  ]
}
```

#### 2.9. Section элементы (группировка)

```typescript
interface SectionElement extends PageElement {
  type: 'section',

  sectionType: 'header' | 'nav' | 'main' | 'article' | 'aside' | 'footer' | 'form' | 'div',
  role?: string,

  // Дочерние элементы
  childIds: string[],

  // Семантика
  label?: string,                // aria-label или heading внутри
  landmark?: string,             // ARIA landmark role

  actions: [
    { type: 'setStyles', params: { styles: StylePair[] } },
    { type: 'scrollTo' }
  ]
}
```

---

### 3. Генерация ID элементов

#### Стратегия присвоения ID:

```typescript
function generateElementId(element: Element, index: number): string {
  // Приоритет:
  // 1. data-testid
  if (element.dataset.testid) {
    return `testid:${element.dataset.testid}`;
  }

  // 2. id атрибут
  if (element.id) {
    return `id:${element.id}`;
  }

  // 3. Семантический путь + тип + индекс
  const path = getSemanticPath(element);
  const type = getElementType(element);
  return `${type}:${path}:${index}`;
}

// Примеры ID:
// - testid:login-button
// - id:email-input
// - input:form[name="login"]:0
// - button:header>nav:2
// - link:footer:5
```

#### Валидация ID

```typescript
interface ElementIdValidator {
  pageId: string,                // Берется из page.url() + timestamp
  elementIds: Set<string>,       // Валидные ID в рамках модели

  validate(elementId: string): boolean {
    return this.elementIds.has(elementId);
  }
}
```

При выполнении действия проверяется:
1. `pageId` совпадает (страница не перезагружалась)
2. `elementId` существует в модели

Если валидация не прошла - возвращается ошибка с предложением вызвать `updatePageObject` или `getPageObject`.

---

### 4. Группировка элементов

#### По типу (default: `groupBy: 'type'`)

```typescript
{
  groups: {
    inputs: {
      count: 5,
      elementIds: ['input:form[0]:0', 'input:form[0]:1', ...]
    },
    buttons: { count: 3, elementIds: [...] },
    links: { count: 10, elementIds: [...] },
    forms: [
      {
        formId: 'form:0',
        fields: { inputs: [...], selects: [...] },
        submitButtons: [...]
      }
    ]
  }
}
```

#### По секциям (`groupBy: 'section'`)

```typescript
{
  groups: {
    sections: [
      {
        sectionId: 'section:header',
        label: 'Site Header',
        childIds: ['link:header:0', 'button:header:0', ...]
      },
      {
        sectionId: 'section:main>form',
        label: 'Login Form',
        childIds: ['input:form[0]:0', 'input:form[0]:1', 'button:form[0]:0']
      }
    ]
  }
}
```

#### Плоская (`groupBy: 'flat'`)

Просто карта `elements: { [id]: element }` без группировки.

---

## API инструментов

### Полная спецификация инструментов

#### 1. `getPageObject`

**Описание:** Получить объектную модель текущей страницы

**Параметры:**
```typescript
{
  refresh?: boolean,              // Пересчитать модель (default: false)
  includeNonInteractive?: boolean, // Включить статичные элементы (default: false)
  includeStyles?: boolean,        // Включить computed styles для каждого элемента (default: false)
  groupBy?: 'type' | 'section' | 'flat', // Группировка элементов (default: 'type')
  maxElements?: number            // Лимит элементов (default: 200)
}
```

**Возвращает:** `PageObjectModel` (см. раздел 2)

**Кэширование:** результат кэшируется по URL до `refresh: true` или навигации

**Примеры использования:**
```javascript
// Базовое использование
const page = await getPageObject();
console.log(page.groups.forms); // Все формы

// С дополнительными элементами
const page = await getPageObject({
  includeNonInteractive: true,
  groupBy: 'section'
});
console.log(page.groups.sections); // Элементы по секциям страницы
```

---

#### 2. `performAction`

**Описание:** Выполнить действие над элементом по его ID

**Параметры:**
```typescript
{
  pageId: string,                 // ID страницы из getPageObject
  elementId: string,              // ID элемента из getPageObject
  action: ActionType,             // Тип действия
  params?: object,                // Параметры действия (зависят от типа)
  screenshot?: boolean,           // Сделать скриншот после (default: false)
  waitAfter?: number              // Ждать N мс после действия (default: 500)
}
```

**Поддерживаемые действия:**

| Action Type | Параметры | Применимо к |
|------------|-----------|-------------|
| `click` | `{ waitForNavigation?: boolean }` | button, link, generic (clickable) |
| `type` | `{ text: string, delay?: number, clearFirst?: boolean }` | input, textarea |
| `clear` | - | input, textarea |
| `focus` | - | input, textarea, select, button |
| `blur` | - | input, textarea |
| `hover` | - | любой видимый элемент |
| `scrollTo` | `{ behavior?: 'auto' \| 'smooth' }` | любой элемент |
| `selectOption` | `{ value?: string, text?: string, index?: number }` | select |
| `toggle` | - | checkbox |
| `check` | - | checkbox |
| `uncheck` | - | checkbox |
| `select` | - | radio |
| `submit` | `{ waitForNavigation?: boolean }` | form |
| `reset` | - | form |
| `fillForm` | `{ fields: Record<fieldId, value>, submit?: boolean }` | form |
| `validateForm` | - | form |
| `setStyles` | `{ styles: Array<{name, value}> }` | любой элемент |
| `getComputedCss` | `{ category?: 'layout'\|'typography'\|... }` | любой элемент |
| `getBoxModel` | - | любой элемент |

**Возвращает:**
```typescript
{
  success: boolean,
  message?: string,               // Сообщение об ошибке или успехе
  result?: any,                   // Результат действия (напр. CSS для getComputedCss)
  screenshot?: string,            // Base64 PNG если screenshot: true
  pageUpdated?: boolean           // true если страница изменилась (навигация, reload)
}
```

**Примеры:**
```javascript
// Заполнить input
await performAction({
  pageId: page.pageId,
  elementId: 'input:form[0]:0',
  action: 'type',
  params: { text: 'user@example.com' }
});

// Кликнуть кнопку
await performAction({
  pageId: page.pageId,
  elementId: 'button:form[0]:0',
  action: 'click',
  params: { waitForNavigation: true },
  screenshot: true
});

// Заполнить всю форму
await performAction({
  pageId: page.pageId,
  elementId: 'form:0',
  action: 'fillForm',
  params: {
    fields: {
      'input:form[0]:0': 'user@example.com',
      'input:form[0]:1': 'password123',
      'select:form[0]:0': 'option1'
    },
    submit: true
  }
});
```

---

#### 3. `updatePageObject`

**Описание:** Обновить модель страницы (после динамических изменений)

**Параметры:**
```typescript
{
  pageId: string,                 // ID страницы
  elementIds?: string[],          // Обновить только эти элементы (или все)
  includeNew?: boolean,           // Добавить новые элементы (default: true)
  removeDeleted?: boolean         // Удалить несуществующие элементы (default: true)
}
```

**Возвращает:** обновленный `PageObjectModel`

**Использование:** после AJAX запросов, React re-renders, динамических изменений DOM

**Пример:**
```javascript
// После клика, который загрузил новые элементы
await performAction({ ... });

// Обновить модель
const updatedPage = await updatePageObject({
  pageId: page.pageId,
  includeNew: true
});

console.log(updatedPage.metadata.totalElements); // Новое количество
```

---

#### 4. `queryElements`

**Описание:** Найти элементы в модели по критериям

**Параметры:**
```typescript
{
  pageId: string,
  query: {
    type?: ElementType | ElementType[],     // Фильтр по типу
    text?: string,                          // Поиск по тексту (substring)
    attributes?: Record<string, string>,    // Фильтр по атрибутам
    visible?: boolean,                      // Только видимые/невидимые
    enabled?: boolean,                      // Только enabled
    inForm?: boolean,                       // Только внутри форм
    parentId?: string,                      // Дочерние элементы
    hasAction?: ActionType                  // Элементы с определенным действием
  },
  limit?: number,                           // default: 20
  offset?: number                           // Пагинация (default: 0)
}
```

**Возвращает:**
```typescript
{
  elementIds: string[],
  total: number,                  // Всего найдено
  hasMore: boolean                // Есть еще результаты
}
```

**Примеры:**
```javascript
// Найти все кнопки submit
const { elementIds } = await queryElements({
  pageId: page.pageId,
  query: {
    type: 'button',
    attributes: { type: 'submit' }
  }
});

// Найти input с текстом "email"
const { elementIds } = await queryElements({
  pageId: page.pageId,
  query: {
    type: 'input',
    text: 'email'
  }
});

// Найти все элементы в форме
const { elementIds } = await queryElements({
  pageId: page.pageId,
  query: {
    parentId: 'form:0'
  }
});
```

---

#### 5. `getElementDetails`

**Описание:** Получить детальную информацию об элементе

**Параметры:**
```typescript
{
  pageId: string,
  elementId: string,
  includeStyles?: boolean,        // Включить computed styles (default: false)
  includeBoxModel?: boolean,      // Включить box model (default: false)
  includeChildren?: boolean       // Включить детали дочерних элементов (default: false)
}
```

**Возвращает:** полный объект `PageElement` с запрошенными деталями

**Использование:** когда нужна детальная информация об одном элементе (избегаем передачи всей модели)

---

## План разработки

### Фаза 1: Базовая инфраструктура (Week 1)

#### 1.1. Модуль генерации ID элементов
**Файл:** `pom/element-id-generator.js`

**Задачи:**
- [ ] Функция `generateElementId(element, index)` с приоритетом testid > id > semantic path
- [ ] Функция `getSemanticPath(element)` для построения пути
- [ ] Функция `getElementType(element)` для определения типа
- [ ] Unit тесты для генерации ID

**Зависимости:** нет

---

#### 1.2. Модуль валидации ID
**Файл:** `pom/element-id-validator.js`

**Задачи:**
- [ ] Класс `ElementIdValidator` с методами validate/add/remove
- [ ] Генерация `pageId` на основе URL + timestamp
- [ ] Обработка невалидных ID с рекомендациями
- [ ] Unit тесты

**Зависимости:** 1.1

---

#### 1.3. Модуль создания моделей элементов
**Файл:** `pom/element-model-factory.js`

**Задачи:**
- [ ] Функции создания моделей для каждого типа элемента:
  - `createInputElement(element, id, selector)`
  - `createButtonElement(...)`
  - `createSelectElement(...)`
  - `createFormElement(...)`
  - и т.д. (10+ типов)
- [ ] Извлечение метаданных (bounds, attributes, validation)
- [ ] Определение доступных actions для каждого типа
- [ ] Unit тесты

**Зависимости:** 1.1

---

### Фаза 2: Инструмент getPageObject (Week 2)

#### 2.1. Сбор элементов со страницы
**Файл:** `pom/page-scanner.js`

**Задачи:**
- [ ] Функция `scanPage(page, options)` - обход DOM через page.evaluate()
- [ ] Сбор интерактивных элементов (input, button, select, a, textarea, form)
- [ ] Опциональный сбор неинтерактивных элементов
- [ ] Извлечение атрибутов, bounds, visibility для каждого элемента
- [ ] Построение иерархии (parent/child relationships)
- [ ] Интеграционные тесты

**Зависимости:** 1.1, 1.3

---

#### 2.2. Группировка элементов
**Файл:** `pom/element-grouper.js`

**Задачи:**
- [ ] Группировка по типу (`groupBy: 'type'`)
- [ ] Группировка по секциям (`groupBy: 'section'`) - поиск header/nav/main/footer
- [ ] Плоская структура (`groupBy: 'flat'`)
- [ ] Специальная обработка форм (fields + buttons)
- [ ] Unit тесты

**Зависимости:** 1.3

---

#### 2.3. Инструмент getPageObject
**Файл:** `pom/tools/get-page-object.js`

**Задачи:**
- [ ] Реализация MCP tool handler
- [ ] Интеграция с кэшированием (pageAnalysisCache)
- [ ] Поддержка параметров (refresh, includeNonInteractive, groupBy, maxElements)
- [ ] Обработка ошибок
- [ ] Документация
- [ ] Интеграционные тесты

**Zod схема:**
```javascript
getPageObject: z.object({
  refresh: z.boolean().optional(),
  includeNonInteractive: z.boolean().optional(),
  includeStyles: z.boolean().optional(),
  groupBy: z.enum(['type', 'section', 'flat']).optional(),
  maxElements: z.number().optional()
})
```

**Зависимости:** 2.1, 2.2, 1.2

---

### Фаза 3: Инструмент performAction (Week 3)

#### 3.1. Модуль выполнения действий
**Файл:** `pom/action-executor.js`

**Задачи:**
- [ ] Функция `executeAction(page, element, action, params)` - роутинг по типу действия
- [ ] Реализация всех типов действий:
  - **click** - через element.click()
  - **type** - через element.type() с clearFirst
  - **clear** - через triple-click + backspace
  - **focus/blur** - через element.focus()
  - **hover** - через element.hover()
  - **scrollTo** - через element.scrollIntoView()
  - **selectOption** - через page.select()
  - **toggle/check/uncheck** - для checkbox
  - **select** - для radio (найти по name и кликнуть)
  - **submit** - через form.submit() или кнопка submit
  - **reset** - через form.reset()
  - **fillForm** - итерация по полям + submit
  - **validateForm** - вызов reportValidity()
  - **setStyles** - через page.evaluate()
  - **getComputedCss** - через CDP
  - **getBoxModel** - через CDP
- [ ] Поддержка waitForNavigation для click/submit
- [ ] Поддержка screenshot после действия
- [ ] Обработка ошибок (элемент не найден, не видим, disabled)
- [ ] Unit + интеграционные тесты

**Зависимости:** нет (использует Puppeteer API)

---

#### 3.2. Инструмент performAction
**Файл:** `pom/tools/perform-action.js`

**Задачи:**
- [ ] Реализация MCP tool handler
- [ ] Валидация pageId и elementId через ElementIdValidator
- [ ] Получение селектора из модели по elementId
- [ ] Вызов action-executor
- [ ] Обработка результата (success, message, result, screenshot)
- [ ] Определение изменения страницы (pageUpdated)
- [ ] Документация
- [ ] Интеграционные тесты

**Zod схема:**
```javascript
performAction: z.object({
  pageId: z.string(),
  elementId: z.string(),
  action: z.enum(['click', 'type', 'clear', 'focus', 'blur', 'hover', 'scrollTo',
                  'selectOption', 'toggle', 'check', 'uncheck', 'select',
                  'submit', 'reset', 'fillForm', 'validateForm',
                  'setStyles', 'getComputedCss', 'getBoxModel']),
  params: z.record(z.any()).optional(),
  screenshot: z.boolean().optional(),
  waitAfter: z.number().optional()
})
```

**Зависимости:** 3.1, 1.2, 2.3 (для получения модели)

---

### Фаза 4: Дополнительные инструменты (Week 4)

#### 4.1. Инструмент updatePageObject
**Файл:** `pom/tools/update-page-object.js`

**Задачи:**
- [ ] Реализация MCP tool handler
- [ ] Валидация pageId
- [ ] Обновление конкретных элементов (по elementIds) или всех
- [ ] Добавление новых элементов (includeNew)
- [ ] Удаление несуществующих (removeDeleted)
- [ ] Обновление кэша
- [ ] Возврат обновленной модели
- [ ] Документация
- [ ] Интеграционные тесты

**Zod схема:**
```javascript
updatePageObject: z.object({
  pageId: z.string(),
  elementIds: z.array(z.string()).optional(),
  includeNew: z.boolean().optional(),
  removeDeleted: z.boolean().optional()
})
```

**Зависимости:** 2.1, 2.2, 1.2

---

#### 4.2. Инструмент queryElements
**Файл:** `pom/tools/query-elements.js`

**Задачи:**
- [ ] Реализация MCP tool handler
- [ ] Валидация pageId
- [ ] Получение модели из кэша
- [ ] Фильтрация элементов по критериям:
  - type (поддержка массива типов)
  - text (substring, case-insensitive)
  - attributes (partial match)
  - visible/enabled
  - inForm (проверка parentId)
  - parentId (дочерние элементы)
  - hasAction (проверка actions)
- [ ] Пагинация (limit/offset)
- [ ] Возврат elementIds + metadata
- [ ] Документация
- [ ] Unit + интеграционные тесты

**Zod схема:**
```javascript
queryElements: z.object({
  pageId: z.string(),
  query: z.object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    text: z.string().optional(),
    attributes: z.record(z.string()).optional(),
    visible: z.boolean().optional(),
    enabled: z.boolean().optional(),
    inForm: z.boolean().optional(),
    parentId: z.string().optional(),
    hasAction: z.string().optional()
  }),
  limit: z.number().optional(),
  offset: z.number().optional()
})
```

**Зависимости:** 2.3, 1.2

---

#### 4.3. Инструмент getElementDetails
**Файл:** `pom/tools/get-element-details.js`

**Задачи:**
- [ ] Реализация MCP tool handler
- [ ] Валидация pageId и elementId
- [ ] Получение базовой модели элемента
- [ ] Опциональное добавление computed styles (через CDP)
- [ ] Опциональное добавление box model (через CDP)
- [ ] Опциональное добавление деталей дочерних элементов
- [ ] Документация
- [ ] Интеграционные тесты

**Zod схема:**
```javascript
getElementDetails: z.object({
  pageId: z.string(),
  elementId: z.string(),
  includeStyles: z.boolean().optional(),
  includeBoxModel: z.boolean().optional(),
  includeChildren: z.boolean().optional()
})
```

**Зависимости:** 2.3, 1.2

---

### Фаза 5: Интеграция и документация (Week 5)

#### 5.1. Интеграция в основной MCP server
**Файл:** `index.js`, `tools/tool-schemas.js`, `server/tool-definitions.js`

**Задачи:**
- [ ] Добавить импорты всех POM инструментов
- [ ] Зарегистрировать инструменты в MCP server
- [ ] Добавить Zod схемы в tool-schemas.js
- [ ] Добавить определения в tool-definitions.js
- [ ] Добавить новую группу инструментов 'pom' в tool-groups.js
- [ ] Интеграционные тесты для всего MCP сервера

**Зависимости:** 2.3, 3.2, 4.1, 4.2, 4.3

---

#### 5.2. Документация
**Файлы:** `README.md`, `CHANGELOG.md`, `docs/POM_API.md`

**Задачи:**
- [ ] Обновить README.md:
  - Добавить секцию "Page Object Model API"
  - Описание концепции
  - Список инструментов с кратким описанием
  - Примеры базового использования
  - Обновить счетчик инструментов (было ~50, стало ~55)
- [ ] Обновить CHANGELOG.md:
  - Новая версия (например, 3.0.0 - major change)
  - Секция "Added" со списком 5 новых инструментов
  - Краткое описание концепции POM
- [ ] Создать подробную документацию `docs/POM_API.md`:
  - Полное описание концепции
  - Спецификация всех инструментов
  - Примеры использования для распространенных сценариев
  - Comparison с существующими инструментами (когда использовать POM API vs классические инструменты)
  - Best practices
- [ ] Обновить package.json версию

**Зависимости:** 5.1

---

#### 5.3. Примеры и тесты
**Файлы:** `examples/pom-examples.js`, `tests/pom-integration.test.js`

**Задачи:**
- [ ] Создать файл с примерами использования:
  - Пример 1: Получение модели и заполнение формы
  - Пример 2: Поиск элементов и клики
  - Пример 3: Обновление модели после AJAX
  - Пример 4: Работа с сложными формами
  - Пример 5: Изменение стилей элементов
- [ ] End-to-end тесты:
  - Тест на реальной странице с формой
  - Тест на динамическом сайте (React/Vue)
  - Тест валидации ID
  - Тест обработки ошибок
- [ ] Performance тесты:
  - Время генерации модели для больших страниц
  - Время выполнения действий
  - Память (размер модели)

**Зависимости:** 5.1

---

## Примеры использования

### Пример 1: Базовое использование - вход в систему

```javascript
// Шаг 1: Получить модель страницы
const page = await getPageObject();

console.log(page.groups.forms);
// [
//   {
//     formId: 'form:0',
//     fields: {
//       inputs: {
//         'input:form[0]:0': { inputType: 'email', placeholder: 'Email', ... },
//         'input:form[0]:1': { inputType: 'password', placeholder: 'Password', ... }
//       }
//     },
//     submitButtons: [
//       { id: 'button:form[0]:0', text: 'Sign In', ... }
//     ]
//   }
// ]

// Шаг 2: Заполнить форму одной командой
await performAction({
  pageId: page.pageId,
  elementId: 'form:0',
  action: 'fillForm',
  params: {
    fields: {
      'input:form[0]:0': 'user@example.com',
      'input:form[0]:1': 'password123'
    },
    submit: true
  },
  screenshot: true
});

// Альтернатива: заполнить поля по отдельности
await performAction({
  pageId: page.pageId,
  elementId: 'input:form[0]:0',
  action: 'type',
  params: { text: 'user@example.com' }
});

await performAction({
  pageId: page.pageId,
  elementId: 'input:form[0]:1',
  action: 'type',
  params: { text: 'password123' }
});

await performAction({
  pageId: page.pageId,
  elementId: 'button:form[0]:0',
  action: 'click',
  params: { waitForNavigation: true }
});
```

---

### Пример 2: Поиск элементов и взаимодействие

```javascript
// Шаг 1: Получить модель
const page = await getPageObject({ groupBy: 'section' });

// Шаг 2: Найти все ссылки в навигации
const navSection = page.groups.sections.find(s => s.sectionType === 'nav');
const navLinks = navSection.childIds.filter(id =>
  page.elements[id].type === 'link'
);

console.log(navLinks);
// ['link:header>nav:0', 'link:header>nav:1', 'link:header>nav:2']

// Шаг 3: Найти конкретную ссылку по тексту
const { elementIds } = await queryElements({
  pageId: page.pageId,
  query: {
    type: 'link',
    text: 'Products',
    parentId: navSection.sectionId
  }
});

// Шаг 4: Кликнуть на найденную ссылку
await performAction({
  pageId: page.pageId,
  elementId: elementIds[0],
  action: 'click',
  params: { waitForNavigation: true }
});
```

---

### Пример 3: Работа с динамическим контентом

```javascript
// Шаг 1: Получить начальную модель
let page = await getPageObject();

console.log(page.metadata.totalElements); // 50

// Шаг 2: Кликнуть на кнопку "Load More"
const { elementIds } = await queryElements({
  pageId: page.pageId,
  query: {
    type: 'button',
    text: 'Load More'
  }
});

await performAction({
  pageId: page.pageId,
  elementId: elementIds[0],
  action: 'click',
  waitAfter: 1000
});

// Шаг 3: Обновить модель после загрузки новых элементов
page = await updatePageObject({
  pageId: page.pageId,
  includeNew: true
});

console.log(page.metadata.totalElements); // 75 (добавилось 25 элементов)

// Шаг 4: Найти новые элементы
const newElements = Object.keys(page.elements).filter(id =>
  !oldElements.includes(id)
);
```

---

### Пример 4: Изменение стилей элементов

```javascript
// Шаг 1: Получить модель
const page = await getPageObject();

// Шаг 2: Найти главный заголовок
const { elementIds } = await queryElements({
  pageId: page.pageId,
  query: {
    type: 'generic',
    text: 'Welcome',
    attributes: { tagName: 'h1' }
  }
});

// Шаг 3: Изменить стили заголовка
await performAction({
  pageId: page.pageId,
  elementId: elementIds[0],
  action: 'setStyles',
  params: {
    styles: [
      { name: 'color', value: 'red' },
      { name: 'font-size', value: '48px' },
      { name: 'font-weight', value: 'bold' }
    ]
  },
  screenshot: true
});
```

---

### Пример 5: Валидация формы

```javascript
// Шаг 1: Получить модель с формой
const page = await getPageObject();

const form = page.groups.forms[0];
console.log(form.validation);
// {
//   valid: false,
//   requiredFields: ['input:form[0]:0', 'input:form[0]:1'],
//   invalidFields: []
// }

// Шаг 2: Попытаться отправить пустую форму (для показа ошибок)
await performAction({
  pageId: page.pageId,
  elementId: form.formId,
  action: 'validateForm'
});

// Шаг 3: Получить детали полей с ошибками
for (const fieldId of form.validation.requiredFields) {
  const details = await getElementDetails({
    pageId: page.pageId,
    elementId: fieldId
  });

  console.log(details.validationState);
  // { valid: false, message: 'Please fill out this field.' }
}

// Шаг 4: Заполнить поля
await performAction({
  pageId: page.pageId,
  elementId: form.formId,
  action: 'fillForm',
  params: {
    fields: {
      'input:form[0]:0': 'user@example.com',
      'input:form[0]:1': 'password123'
    }
  }
});

// Шаг 5: Обновить модель и проверить валидацию
const updatedPage = await updatePageObject({
  pageId: page.pageId,
  elementIds: [form.formId]
});

const updatedForm = updatedPage.elements[form.formId];
console.log(updatedForm.validation);
// { valid: true, requiredFields: [...], invalidFields: [] }

// Шаг 6: Отправить форму
await performAction({
  pageId: page.pageId,
  elementId: form.formId,
  action: 'submit',
  params: { waitForNavigation: true }
});
```

---

### Пример 6: Работа с checkbox и radio

```javascript
// Шаг 1: Получить модель
const page = await getPageObject();

// Шаг 2: Найти все checkbox
const { elementIds: checkboxIds } = await queryElements({
  pageId: page.pageId,
  query: { type: 'checkbox' }
});

// Шаг 3: Включить все checkbox
for (const id of checkboxIds) {
  await performAction({
    pageId: page.pageId,
    elementId: id,
    action: 'check'
  });
}

// Шаг 4: Найти radio группу
const { elementIds: radioIds } = await queryElements({
  pageId: page.pageId,
  query: {
    type: 'radio',
    attributes: { name: 'subscription' }
  }
});

// Шаг 5: Получить детали одного radio (чтобы увидеть все опции группы)
const radioDetails = await getElementDetails({
  pageId: page.pageId,
  elementId: radioIds[0]
});

console.log(radioDetails.groupOptions);
// [
//   { elementId: 'radio:form[0]:0', value: 'free', text: 'Free', checked: true },
//   { elementId: 'radio:form[0]:1', value: 'pro', text: 'Pro', checked: false },
//   { elementId: 'radio:form[0]:2', value: 'enterprise', text: 'Enterprise', checked: false }
// ]

// Шаг 6: Выбрать опцию "Pro"
const proOption = radioDetails.groupOptions.find(o => o.value === 'pro');
await performAction({
  pageId: page.pageId,
  elementId: proOption.elementId,
  action: 'select'
});
```

---

## Comparison: POM API vs Классические инструменты

### Когда использовать POM API:

✅ **Сложные формы** - один вызов `fillForm` вместо множества `type` команд
✅ **Многошаговые взаимодействия** - получить модель один раз, использовать ID многократно
✅ **Динамический контент** - `updatePageObject` для обновления модели после AJAX
✅ **Исследование страницы** - `queryElements` для поиска элементов по критериям
✅ **Валидация форм** - детальная информация о required fields и validation state
✅ **Контекстные действия** - знание о том, какие действия доступны для элемента

### Когда использовать классические инструменты:

✅ **Простые одиночные действия** - быстрый `click(selector)` или `type(selector, text)`
✅ **Известные селекторы** - если уже знаете точный CSS селектор
✅ **Легковесные операции** - не нужна полная модель страницы
✅ **Скриншоты и инспекция** - `screenshot`, `getComputedCss`, `getBoxModel` остаются отдельными инструментами

### Гибридный подход:

Можно комбинировать оба подхода:

```javascript
// Использовать POM для сложного взаимодействия
const page = await getPageObject();
await performAction({ elementId: 'form:0', action: 'fillForm', ... });

// Использовать классические инструменты для быстрого скриншота
await screenshot({ selector: 'body' });

// Использовать POM для поиска элемента
const { elementIds } = await queryElements({ query: { text: 'Submit' } });

// Использовать классический click (если нужен просто клик)
await click({ selector: `[data-testid="submit-button"]` });
```

---

## Расширения и будущие улучшения

### Версия 3.1 (будущее):

1. **Поддержка Shadow DOM** - работа с Web Components
2. **Поддержка iframe** - вложенные документы
3. **Accessibility tree** - доступ к accessibility информации
4. **Event listeners** - информация о прикрепленных обработчиках событий
5. **Performance metrics** - время рендеринга элементов

### Версия 3.2 (будущее):

1. **Smart actions** - AI предложения действий на основе контекста
2. **Visual regression** - сравнение скриншотов элементов
3. **Element snapshots** - сохранение и восстановление состояния элементов
4. **Batch operations** - выполнение множественных действий одной командой

---

## Технические требования

### Производительность:

- Генерация модели для страницы со 100 элементами: < 500ms
- Выполнение действия по ID: < 100ms
- Обновление модели (частичное): < 200ms
- Размер модели в JSON: < 500KB для 100 элементов

### Совместимость:

- Puppeteer 24.x+
- Node.js 18+
- Chrome/Chromium 120+

### Обратная совместимость:

- Все существующие инструменты продолжают работать без изменений
- POM API - это дополнение, а не замена

---

## Заключение

Agent Page Object Model (APOM) API - это мощное дополнение к chrometools-mcp, которое позволяет AI агентам работать с браузером как с объектной моделью, а не набором команд.

**Не путать с:** Существующий инструмент `generatePageObject` остаётся без изменений и продолжает генерировать Test Page Objects для автотестов (Playwright/Selenium).

**Ключевые преимущества:**

1. ⚡ **Меньше запросов** - получить модель один раз, использовать многократно
2. 🎯 **Семантика** - знание о типах элементов и доступных действиях
3. 🔒 **Валидация** - проверка ID элементов и состояния страницы
4. 📊 **Структура** - группировка элементов по типу, секциям, формам
5. 🚀 **Производительность** - кэширование и инкрементальные обновления
6. 💪 **Мощь** - сложные операции (fillForm, validateForm) одной командой

**Roadmap:**

- Week 1-2: Базовая инфраструктура + getPageObject
- Week 3: performAction
- Week 4: updatePageObject, queryElements, getElementDetails
- Week 5: Интеграция, документация, тесты

**Версия:** 3.0.0 (major release)

---

Документация создана: 2026-01-24
Версия: 1.0.0

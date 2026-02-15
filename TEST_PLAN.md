# Element Models System - Test Plan

## Цель
Подробное и дотошное тестирование Element Models System перед рефакторингом.

## Проблемы для проверки

### 1. Архитектурная проблема
- executeModelAction использует простой DOM API (element.click())
- Существующие tools используют Puppeteer API с продвинутой логикой
- Нет переиспользования кода между executeModelAction и click/type tools

### 2. Отсутствующая функциональность в executeModelAction
- Нет post-action diagnostics (network requests, errors)
- Нет AI hints generation (modals, dropdowns)
- Нет adaptive click strategy (для React/Angular)
- Нет обработки navigation/page loads
- Нет retry логики

## Test Cases

### TC1: analyzePage возвращает models map
**Цель**: Проверить что models map появляется в output

**Шаги**:
1. Запустить MCP server (restart required!)
2. openBrowser({ url: "https://www.google.com" })
3. analyzePage()
4. Проверить output содержит:
   - `models` object
   - Модели: TxtInp, Btn, Link и т.д.
   - Для каждой модели - список действий

**Ожидаемый результат**:
```json
{
  "models": {
    "TxtInp": ["type", "click", "hover", "screenshot"],
    "Btn": ["click", "hover", "screenshot"],
    "Link": ["click", "hover", "screenshot"],
    ...
  }
}
```

### TC2: analyzePage добавляет model name в элементы
**Цель**: Проверить что у элементов появляется поле model

**Шаги**:
1. analyzePage()
2. Найти в tree интерактивные элементы
3. Проверить наличие поля "model"

**Ожидаемый результат**:
```json
{
  "tree": {
    "children": [
      {
        "id": "input_5",
        "tag": "input",
        "type": "input",
        "model": "TxtInp"  // ← должно быть
      }
    ]
  }
}
```

### TC3: executeModelAction - type в текстовое поле
**Цель**: Сравнить executeModelAction vs существующий type tool

**Тестовая страница**: https://www.google.com

**Шаги A (executeModelAction)**:
1. analyzePage() → получить id поля поиска
2. executeModelAction({ id: "input_X", action: "type", params: {text: "test query"} })
3. Проверить: текст появился в поле?
4. Проверить: есть ли diagnostics в output?

**Шаги B (существующий type)**:
1. type({ id: "input_X", text: "test query" })
2. Проверить: текст появился?
3. Проверить: есть ли diagnostics?

**Сравнение**:
- Надежность ввода текста
- Срабатывание autocomplete/suggestions
- Наличие diagnostics
- Hints для AI

### TC4: executeModelAction - click на кнопку
**Цель**: Проверить клик и сравнить с существующим click tool

**Тестовая страница**: https://www.google.com

**Шаги**:
1. executeModelAction({ id: "button_X", action: "click" })
2. Проверить: произошла ли навигация/действие?
3. Сравнить с click({ id: "button_X" })

**Проверить**:
- Срабатывание click handler
- Обработка модальных окон
- Navigation wait
- Hints generation

### TC5: executeModelAction - DatePicker (новая функциональность)
**Цель**: Проверить работу кастомной модели DatePicker

**Проблема**: Нужна страница с DatePicker компонентом

**Тестовая страница**: Создать простую HTML страницу с react-datepicker или flatpickr

**Шаги**:
1. Открыть тестовую страницу с DatePicker
2. analyzePage() → найти DatePicker элемент
3. Проверить: model === "DatePicker"?
4. Проверить: actions содержит ["SetDate", "SetDateTime", ...]?
5. executeModelAction({ id: "datepicker_X", action: "SetDate", params: {date: "2024-03-15"} })
6. Проверить: дата установилась?

### TC6: executeModelAction - Checkbox
**Цель**: Проверить действия check/uncheck/toggle

**Шаги**:
1. Найти страницу с checkbox (например форма регистрации)
2. analyzePage() → найти checkbox
3. Проверить model === "Chk"
4. executeModelAction({ id: "checkbox_X", action: "check" })
5. Проверить: checkbox.checked === true?
6. executeModelAction({ id: "checkbox_X", action: "toggle" })
7. Проверить: checkbox.checked === false?

### TC7: executeModelAction - Select dropdown
**Цель**: Проверить selectOption action

**Шаги**:
1. Найти select element
2. executeModelAction({ id: "select_X", action: "selectOption", params: {value: "option2"} })
3. Сравнить с selectOption({ id: "select_X", value: "option2" })

### TC8: Model Registry initialization
**Цель**: Проверить что registry кешируется и переиспользуется

**Шаги**:
1. analyzePage() - первый вызов
2. executeModelAction() - должен переиспользовать registry
3. analyzePage() снова - должен переиспользовать registry

**Проверить**: window.__MODEL_REGISTRY__ существует после первого вызова

### TC9: Error handling
**Цель**: Проверить обработку ошибок

**Тесты**:
1. executeModelAction с несуществующим id
2. executeModelAction с неправильным action для модели
3. executeModelAction с отсутствующими params

**Ожидаемые ошибки**:
- "Element not found"
- "Action 'wrongAction' not available for model 'TxtInp'"
- Ошибка если обязательные params отсутствуют

### TC10: Screenshot delegation
**Цель**: Проверить что screenshot action корректно обрабатывается

**Шаги**:
1. executeModelAction({ id: "button_X", action: "screenshot" })
2. Проверить: возвращается ли image в content?

## Performance Tests

### PT1: APOM output size с models map
**Цель**: Проверить что models map не раздувает output

**Baseline** (v3.3.7): ~28 KB для Google search

**Тест**:
1. analyzePage() на https://www.google.com/search?q=test
2. Измерить JSON size
3. Сравнить с baseline

**Критерии**:
- < 40 KB: ✅ OK
- 40-55 KB: ⚠️ Review
- > 55 KB: ❌ Refactor

### PT2: Model Registry performance
**Цель**: Проверить что findModel() работает быстро

**Тест**:
1. Измерить время выполнения analyzePage()
2. Сравнить с версией без Model Registry

## Compatibility Tests

### CT1: Обратная совместимость
**Цель**: Убедиться что существующие tools работают

**Тест**:
1. click() - работает?
2. type() - работает?
3. selectOption() - работает?
4. analyzePage() без registerElements - работает?

## Known Issues to Verify

### Issue 1: Дублирование логики
- models/index.js содержит _executeClick()
- index.js содержит click handler
- Нет переиспользования кода!

### Issue 2: DOM API vs Puppeteer API
- Models используют element.click() (DOM)
- Existing tools используют ElementHandle.click() (Puppeteer)
- Разная надежность!

### Issue 3: Отсутствие диагностики
- executeModelAction не вызывает runPostClickDiagnostics()
- executeModelAction не вызывает generateClickHints()
- Нет network wait после действий

## Refactoring Plan (после тестирования)

После завершения тестов нужно:

1. **Создать utils/actions/** директорию с отдельными функциями:
   - actions/click.js - executeClick(page, element, options)
   - actions/type.js - executeType(page, element, text, options)
   - actions/selectOption.js
   - actions/hover.js
   - И т.д.

2. **Рефакторить models/index.js**:
   - Убрать реализацию действий
   - Оставить только getName(), getActions(), matches()
   - Добавить getActionHandler(actionName) → возвращает имя функции

3. **Рефакторить executeModelAction**:
   - Найти модель
   - Получить action handler name
   - Вызвать соответствующую функцию из utils/actions/

4. **Переиспользовать в существующих tools**:
   - click tool → вызывает actions/click.js
   - type tool → вызывает actions/type.js
   - executeModelAction → вызывает те же функции

## Test Execution

**Требования**:
- MCP server должен быть перезапущен после изменений кода
- Тесты запускать последовательно
- Документировать все найденные проблемы
- Сравнивать результаты с существующими tools

**Кто выполняет**: Сначала я (Claude) выполню automated проверки, затем предложу ручные тесты пользователю.

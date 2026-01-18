# Video Scripts for ChromeTools MCP Tool Groups

Complete narration scripts for video tutorials. Read these texts while recording demonstrations.

---

## Video 1: Core Group (2-3 minutes)

### [0:00-0:20] Opening

**Text to read:**

"Привет! В этом видео мы разберем группу Core - базовые инструменты ChromeTools MCP сервера.

Группа Core содержит всего два инструмента, но они критически важны для работы. Это ping и openBrowser.

Эта группа нужна ВСЕГДА, независимо от вашего use case."

**[ACTION: Show mcp_config.json with ENABLED_TOOLS]**

---

### [0:20-1:00] Tool: ping

**Text to read:**

"Первый инструмент - ping. Он используется для проверки, что MCP сервер запущен и работает корректно.

Давайте попробуем."

**[ACTION: Ask AI to ping]**

**Text to read:**

"AI, ping the server"

**[PAUSE for response]**

**Text to read:**

"Как видите, сервер отвечает 'pong'. Это означает, что соединение установлено и сервер готов к работе.

Обычно этот инструмент используется автоматически при подключении, но вы можете вызвать его явно для диагностики."

---

### [1:00-2:30] Tool: openBrowser

**Text to read:**

"Второй инструмент - openBrowser. Он запускает браузер Chrome и открывает указанную страницу.

Ключевая особенность ChromeTools MCP - персистентная сессия браузера. Это означает, что браузер остается открытым между командами.

Давайте откроем example.com"

**[ACTION: Ask AI to open browser]**

**Text to read:**

"AI, open browser and navigate to https://example.com"

**[PAUSE for browser to open]**

**Text to read:**

"Браузер открылся. Обратите внимание - это НЕ headless режим, окно полностью видимое. Вы можете взаимодействовать с ним вручную между командами AI.

Теперь давайте откроем другой сайт."

**[ACTION: Navigate to github.com]**

**Text to read:**

"AI, now navigate to https://github.com"

**[PAUSE for navigation]**

**Text to read:**

"Обратите внимание - используется ТОТ ЖЕ браузер и та же вкладка. Это и есть персистентная сессия. Вы можете подготовить страницу вручную, затем попросить AI продолжить работу с ней."

---

### [2:30-3:00] Summary

**Text to read:**

"Итак, группа Core:
- Два базовых инструмента: ping и openBrowser
- Нужна ВСЕГДА в любой конфигурации
- Минимальная конфигурация: ENABLED_TOOLS равно core

Для базовой автоматизации добавьте группу interaction. Об этом в следующем видео.

Конфигурация для группы Core потребляет минимум токенов - всего около тысячи.

Ссылка на документацию в описании. Спасибо за просмотр!"

**[ACTION: Show documentation link]**

---

## Video 2: Interaction Group (5-6 minutes)

### [0:00-0:30] Opening

**Text to read:**

"Привет! В этом видео мы разберем группу Interaction - основу веб-автоматизации.

Эта группа содержит 5 инструментов для имитации действий пользователя: type, click, scrollTo, waitForElement и hover.

Вместе с группой Core, группа Interaction покрывает девяносто процентов базовой автоматизации.

Давайте откроем Google для демонстрации."

**[ACTION: Open https://www.google.com]**

---

### [0:30-1:30] Tool: type

**Text to read:**

"Первый инструмент - type. Он вводит текст в поля ввода.

Давайте найдем что-нибудь в Google."

**[ACTION: Ask AI to type]**

**Text to read:**

"AI, type 'chrometools mcp' in the search box"

**[PAUSE while typing]**

**Text to read:**

"Текст введен. По умолчанию, инструмент type ОЧИЩАЕТ поле перед вводом. Это контролируется параметром clearFirst.

Давайте попробуем ДОписать текст без очистки."

**[ACTION: Type with clearFirst: false]**

**Text to read:**

"AI, now type ' github' in the same field with clearFirst set to false"

**[PAUSE]**

**Text to read:**

"Как видите, текст добавился в конец. Поле не очистилось.

Также есть параметр delay для имитации печати человека. По умолчанию - ноль миллисекунд, то есть мгновенный ввод."

---

### [1:30-2:30] Tool: click

**Text to read:**

"Второй инструмент - click. Он выполняет клик по элементу.

Давайте нажмем на кнопку поиска."

**[ACTION: Click search button]**

**Text to read:**

"AI, click the search button"

**[PAUSE for results to load]**

**Text to read:**

"Отлично, мы на странице результатов. Инструмент click автоматически ждет, пока элемент станет видимым и кликабельным.

Есть параметр timeout - максимальное время ожидания. По умолчанию тридцать тысяч миллисекунд, то есть тридцать секунд.

Также есть параметр waitAfter - пауза после клика. По умолчанию полторы секунды, чтобы дождаться анимаций.

Давайте кликнем на первый результат."

**[ACTION: Click first result]**

**Text to read:**

"AI, click on the first result"

**[PAUSE for page to load]**

---

### [2:30-3:30] Tool: scrollTo

**Text to read:**

"Третий инструмент - scrollTo. Он прокручивает страницу к указанному элементу.

Это особенно полезно для:
- Lazy-loading контента, который загружается при прокрутке
- Тестирования видимости элементов
- Подготовки страницы перед screenshot

Давайте откроем страницу с документацией."

**[ACTION: Open long documentation page]**

**Text to read:**

"AI, scroll to the element with text 'Installation'"

**[PAUSE while scrolling]**

**Text to read:**

"Прокрутка выполнена. По умолчанию используется smooth behavior - плавная прокрутка.

Можно указать auto для мгновенной прокрутки."

---

### [3:30-4:30] Tool: waitForElement

**Text to read:**

"Четвертый инструмент - waitForElement. Он ждет появления элемента на странице.

Это критически важно для работы с динамическим контентом: AJAX запросы, React-приложения, lazy loading.

Давайте откроем страницу с динамическим контентом."

**[ACTION: Open page with dynamic content]**

**Text to read:**

"AI, wait for the element '.dynamic-content' to appear"

**[PAUSE while waiting]**

**Text to read:**

"Элемент появился. Инструмент дождался его загрузки.

Параметры:
- timeout: максимальное время ожидания. По умолчанию пять тысяч миллисекунд.
- visible: ждать именно видимый элемент. По умолчанию true.

Если элемент не появится за timeout - вы получите ошибку."

---

### [4:30-5:30] Tool: hover

**Text to read:**

"Пятый инструмент - hover. Он имитирует наведение мыши на элемент.

Используется для:
- Тестирования CSS псевдокласса hover
- Показа tooltips и подсказок
- Открытия выпадающих меню

Давайте откроем страницу с hover-эффектами."

**[ACTION: Open page with hover menus]**

**Text to read:**

"AI, hover over the menu item"

**[PAUSE while hovering]**

**Text to read:**

"Подменю появилось. Это именно то, что происходит при наведении мыши пользователем.

Теперь можем кликнуть на элемент подменю."

---

### [5:30-6:00] Summary

**Text to read:**

"Итак, группа Interaction:
- Пять инструментов для имитации действий пользователя
- type, click, scrollTo, waitForElement, hover
- Комбинируйте с core: ENABLED_TOOLS равно core comma interaction

Это покрывает девяносто процентов базовой автоматизации.

Экономия токенов: семь инструментов вместо сорока трех. Это примерно пять тысяч токенов вместо двадцати восьми тысяч.

Для инспекции страниц добавьте группу inspection. Об этом в следующем видео.

Спасибо за просмотр!"

---

## Video 3: Inspection Group (6-7 minutes)

### [0:00-0:30] Opening

**Text to read:**

"Привет! В этом видео мы разберем группу Inspection - инструменты для анализа и визуального тестирования.

Эта группа содержит 5 инструментов: getElement, getComputedCss, getBoxModel, screenshot и saveScreenshot.

Группа Inspection особенно важна для frontend-разработки и тестирования.

Давайте откроем красиво оформленную страницу для демонстрации."

**[ACTION: Open styled webpage]**

---

### [0:30-1:30] Tool: getElement

**Text to read:**

"Первый инструмент - getElement. Он возвращает HTML разметку элемента.

Используется для проверки структуры DOM, наличия атрибутов, классов.

Давайте получим HTML header элемента."

**[ACTION: Get element]**

**Text to read:**

"AI, get the HTML of the header element"

**[PAUSE for response]**

**Text to read:**

"Вот полная HTML разметка. Вы видите все теги, атрибуты, классы, вложенные элементы.

Это полезно для:
- Проверки структуры
- Дебаггинга верстки
- Проверки наличия data-атрибутов

Обратите внимание: для лучшей производительности рекомендуется использовать analyzePage вместо getElement, когда нужна общая информация о странице."

---

### [1:30-2:30] Tool: getComputedCss

**Text to read:**

"Второй инструмент - getComputedCss. Он возвращает вычисленные CSS стили элемента.

Ключевое слово - ВЫЧИСЛЕННЫЕ. То есть фактические стили, которые применил браузер, с учетом всех CSS правил, наследования, каскада.

Давайте получим цвета кнопки."

**[ACTION: Get CSS colors]**

**Text to read:**

"AI, get computed CSS for the main button, category: colors"

**[PAUSE for response]**

**Text to read:**

"Вот все цветовые свойства: color, background-color, border-color.

Инструмент поддерживает категории для фильтрации:
- colors: все цвета
- typography: шрифты, размеры текста
- layout: ширина, высота, padding, margin
- visual: тени, прозрачность, transforms
- all: все свойства

Давайте получим layout."

**[ACTION: Get layout properties]**

**Text to read:**

"AI, now get layout properties"

**[PAUSE]**

**Text to read:**

"Отлично. Ширина, высота, padding, margin - все вычисленные значения.

Это незаменимо для:
- Дизайн-валидации
- Тестирования responsive design
- Дебаггинга CSS"

---

### [2:30-3:30] Tool: getBoxModel

**Text to read:**

"Третий инструмент - getBoxModel. Он возвращает CSS box model элемента.

Box model - это базовая концепция CSS: content, padding, border, margin.

Давайте получим box model для карточки."

**[ACTION: Get box model]**

**Text to read:**

"AI, get box model for the card element"

**[PAUSE for response]**

**Text to read:**

"Вот что мы получили:
- Dimensions: ширина и высота контента
- Padding: внутренние отступы со всех сторон
- Border: толщина рамки
- Margin: внешние отступы

Это ТОЧНЫЕ значения в пикселях, которые использует браузер.

Используйте getBoxModel для:
- Дебаггинга проблем с layout
- Проверки spacing
- Анализа размеров элементов"

**[ACTION: Optionally show box model diagram on screen]**

---

### [3:30-5:00] Tool: screenshot

**Text to read:**

"Четвертый инструмент - screenshot. Он делает скриншот элемента и ВОЗВРАЩАЕТ его в контекст AI.

Это мощный инструмент, но есть важный нюанс: каждый скриншот потребляет от пятнадцати до двадцати пяти тысяч токенов.

Давайте сделаем скриншот hero-секции."

**[ACTION: Take screenshot]**

**Text to read:**

"AI, take a screenshot of the hero section"

**[PAUSE for screenshot]**

**Text to read:**

"AI получил изображение и может его анализировать.

Параметры screenshot:
- format: png для качества, jpeg для меньшего размера, auto по умолчанию
- quality: от одного до ста для JPEG. По умолчанию восемьдесят.
- maxWidth и maxHeight: ограничение размера. По умолчанию тысяча двадцать четыре на восемь тысяч.
- padding: добавить отступ вокруг элемента. По умолчанию ноль.

ВАЖНО: используйте screenshot, когда нужен ВИЗУАЛЬНЫЙ анализ.

Для анализа форм, кнопок, текста - используйте analyzePage. Он потребляет всего две-пять тысяч токенов вместо пятнадцати-двадцати пяти.

Об analyzePage расскажу в видео про Advanced группу."

---

### [5:00-6:30] Tool: saveScreenshot

**Text to read:**

"Пятый инструмент - saveScreenshot. Он сохраняет скриншот в ФАЙЛ, НЕ возвращая его в контекст.

Это критически важно для экономии токенов.

Давайте сохраним скриншот всей страницы."

**[ACTION: Save screenshot]**

**Text to read:**

"AI, save screenshot of the entire page to ./screenshots/page.png"

**[PAUSE while saving]**

**Text to read:**

"Скриншот сохранен. AI НЕ получил изображение в контекст.

Токены потрачены: НОЛЬ.

Файл создан на диске."

**[ACTION: Show saved file]**

**Text to read:**

"Вот наш файл.

Параметры те же, что у screenshot: format, quality, maxWidth, maxHeight, padding.

Best practice:
- screenshot - когда AI должен АНАЛИЗИРОВАТЬ изображение
- saveScreenshot - когда нужно просто СОХРАНИТЬ для человека

Разница в токенах: ноль против пятнадцати-двадцати пяти тысяч.

Для визуального тестирования лучше использовать saveScreenshot для baseline, затем compareFigmaToElement из группы Figma."

---

### [6:30-7:00] Summary

**Text to read:**

"Итак, группа Inspection:
- Пять инструментов для анализа страниц
- getElement, getComputedCss, getBoxModel, screenshot, saveScreenshot
- Конфигурация: ENABLED_TOOLS равно core comma interaction comma inspection

Это базовый набор для автоматизации и тестирования.

Экономия токенов: двенадцать инструментов вместо сорока трех. Примерно восемь тысяч токенов вместо двадцати восьми тысяч. Экономия семьдесят один процент.

ВАЖНО: используйте saveScreenshot вместо screenshot, когда визуальный анализ AI не нужен.

Для отладки JavaScript и сети добавьте группу debug. Об этом в следующем видео.

Спасибо за просмотр!"

---

## Video 4: Debug Group (5-6 minutes)

### [0:00-0:30] Opening

**Text to read:**

"Привет! В этом видео мы разберем группу Debug - новую группу для отладки JavaScript и мониторинга сети.

В версии два точка четыре точка ноль мы выделили эти инструменты в отдельную группу для экономии токенов.

Группа Debug содержит 4 инструмента: getConsoleLogs, listNetworkRequests, getNetworkRequest и filterNetworkRequests.

Используйте эту группу, когда нужна отладка. Отключайте для простой автоматизации.

Давайте откроем страницу с API запросами."

**[ACTION: Open page with network activity and console logs]**

---

### [0:30-1:30] Tool: getConsoleLogs

**Text to read:**

"Первый инструмент - getConsoleLogs. Он читает логи из браузерной консоли.

Полезно для:
- Отладки JavaScript ошибок
- Проверки warnings
- Анализа debug output

Давайте получим все логи."

**[ACTION: Get console logs]**

**Text to read:**

"AI, get console logs"

**[PAUSE for response]**

**Text to read:**

"Вот все сообщения: log, warn, error, info.

Можно фильтровать по типу. Давайте получим только ошибки."

**[ACTION: Get only errors]**

**Text to read:**

"AI, get only error logs"

**[PAUSE]**

**Text to read:**

"Только errors.

Параметры:
- types: массив типов. log, warn, error, info, debug, verbose, warning
- clear: очистить логи после чтения. По умолчанию false.

Используйте clear: true, если обрабатываете логи пошагово."

---

### [1:30-3:00] Tool: listNetworkRequests

**Text to read:**

"Второй инструмент - listNetworkRequests. Он возвращает СПИСОК сетевых запросов.

Именно список: метод, URL, статус. Без деталей - для обзора.

Давайте посмотрим все запросы."

**[ACTION: List network requests]**

**Text to read:**

"AI, list network requests"

**[PAUSE for response]**

**Text to read:**

"Вот список всех запросов. Для каждого: метод, URL, статус код, тип.

Инструмент поддерживает фильтрацию по:
- types: Fetch, XHR, Document, Stylesheet, Image, Media, Font, Script, WebSocket, Other
  По умолчанию: Fetch и XHR
- status: pending, completed, failed, all

Также есть pagination:
- limit: максимум запросов. По умолчанию пятьдесят.
- offset: пропустить первые N. По умолчанию ноль.

Давайте получим только XHR запросы."

**[ACTION: Filter by type]**

**Text to read:**

"AI, list only XHR requests"

**[PAUSE]**

**Text to read:**

"Только XHR. Гораздо удобнее для анализа.

Параметр clear: очистить список после чтения. По умолчанию false."

---

### [3:00-4:30] Tool: getNetworkRequest

**Text to read:**

"Третий инструмент - getNetworkRequest. Он возвращает ПОЛНЫЕ детали одного запроса.

Используйте после listNetworkRequests: сначала найдите нужный request ID, затем получите детали.

Давайте получим детали первого API запроса."

**[ACTION: Get request details]**

**Text to read:**

"AI, get details for request ID '123'"

**[PAUSE for response]**

**Text to read:**

"Вот что мы получили:
- Request headers: все заголовки запроса
- Request payload: тело запроса, если есть
- Response headers: заголовки ответа
- Response body: тело ответа

Это полная информация для дебаггинга API.

Можно проверить:
- Правильные ли заголовки авторизации
- Корректный ли payload
- Что вернул сервер
- Какие установлены cookies

Незаменимо для дебаггинга интеграций с API."

---

### [4:30-5:30] Tool: filterNetworkRequests

**Text to read:**

"Четвертый инструмент - filterNetworkRequests. Он ищет запросы по URL паттерну.

В отличие от listNetworkRequests, который просто фильтрует по типу, filterNetworkRequests ищет по содержимому URL.

И сразу возвращает ПОЛНЫЕ детали, как getNetworkRequest.

Давайте найдем все API запросы."

**[ACTION: Filter by URL pattern]**

**Text to read:**

"AI, filter network requests by URL pattern '/api/'"

**[PAUSE for response]**

**Text to read:**

"Все запросы к API эндпоинтам. С полными деталями: headers, payload, response.

Паттерн поддерживает:
- Частичное совпадение: '/api/'
- Регулярные выражения: '.*graphql.*'

Давайте найдем GraphQL запросы."

**[ACTION: Filter by "graphql"]**

**Text to read:**

"AI, filter by 'graphql'"

**[PAUSE]**

**Text to read:**

"Только GraphQL. Очень удобно для специфичных запросов.

Также поддерживает параметры types и clear."

---

### [5:30-6:00] Summary

**Text to read:**

"Итак, группа Debug:
- Четыре инструмента для отладки
- getConsoleLogs, listNetworkRequests, getNetworkRequest, filterNetworkRequests
- Выделена в отдельную группу в версии два точка четыре

Конфигурация с debugging: ENABLED_TOOLS равно core comma interaction comma inspection comma debug

Когда debugging НЕ нужен - отключайте эту группу для экономии токенов.

Для продвинутых возможностей и AI инструментов добавьте группу advanced. Об этом в следующем видео.

Спасибо за просмотр!"

---

## Video 5: Advanced Group (8-10 minutes)

### [0:00-0:30] Opening

**Text to read:**

"Привет! В этом видео мы разберем группу Advanced - самую мощную группу инструментов.

Девять инструментов для сложных задач и AI-powered автоматизации.

Группа Advanced включает:
- Выполнение произвольного JavaScript
- Изменение стилей и viewport
- Навигацию
- И самое главное - AI-powered инструменты для анализа и поиска

Давайте начнем."

**[ACTION: Open a complex webpage]**

---

### [0:30-1:30] Tool: executeScript

**Text to read:**

"Первый инструмент - executeScript. Он выполняет произвольный JavaScript код в браузере.

Это полная свобода. Можно делать ЧТО УГОДНО.

Но есть важное правило: используйте executeScript ТОЛЬКО когда специализированных инструментов недостаточно.

Давайте получим все ссылки на странице."

**[ACTION: Execute script]**

**Text to read:**

"AI, execute script to get all links on the page"

**[PAUSE for execution]**

**Text to read:**

"Вот массив всех URL на странице.

Параметры:
- script: JavaScript код. Должен возвращать JSON-сериализуемое значение
- timeout: максимальное время. По умолчанию тридцать тысяч миллисекунд
- waitAfter: пауза после выполнения. По умолчанию пятьсот миллисекунд
- screenshot: сделать скриншот после выполнения. По умолчанию false

ВАЖНО: для стандартных задач используйте специализированные инструменты. Они безопаснее и эффективнее."

---

### [1:30-2:30] Tools: setStyles, setViewport, getViewport, navigateTo

**Text to read:**

"Следующие инструменты - setStyles, setViewport, getViewport и navigateTo.

setStyles изменяет CSS стили элемента. Полезно для прототипирования и визуального тестирования.

Давайте изменим кнопку."

**[ACTION: Set styles]**

**Text to read:**

"AI, set button background to red and padding to 20px"

**[PAUSE while styles apply]**

**Text to read:**

"Стили применены вживую.

setViewport и getViewport - для тестирования responsive design.

Давайте проверим текущий размер."

**[ACTION: Get viewport]**

**Text to read:**

"AI, get current viewport size"

**[PAUSE]**

**Text to read:**

"Тысяча девятьсот двадцать на тысячу восемьдесят. Desktop.

Изменим на mobile."

**[ACTION: Set viewport to mobile]**

**Text to read:**

"AI, set viewport to 375 by 667 - that's iPhone SE"

**[PAUSE while viewport changes]**

**Text to read:**

"Layout изменился. Responsive design в действии.

navigateTo - для перехода на другие страницы."

**[ACTION: Navigate]**

**Text to read:**

"AI, navigate to https://github.com/docentovich/chrometools-mcp"

**[PAUSE]**

**Text to read:**

"Переход выполнен. В том же окне.

Параметр waitUntil контролирует, когда считать загрузку завершенной: load, domcontentloaded, networkidle0, networkidle2."

---

### [4:30-6:00] Tool: analyzePage ⭐

**Text to read:**

"Теперь КЛЮЧЕВОЙ инструмент - analyzePage.

Это AI-powered анализ страницы. Он возвращает структурированную информацию о:
- Формах и полях ввода с текущими значениями
- Кнопках с текстом
- Ссылках
- Всех интерактивных элементах

И самое важное: analyzePage потребляет всего две-пять тысяч токенов.

Для сравнения: screenshot - пятнадцать-двадцать пять тысяч токенов.

Давайте проанализируем текущую страницу."

**[ACTION: Analyze page]**

**Text to read:**

"AI, analyze the current page"

**[PAUSE for analysis]**

**Text to read:**

"Вот что мы получили:
- Форма входа с полями username и password
- Кнопка 'Sign in'
- Ссылки на регистрацию и восстановление пароля
- Все с селекторами и текущими значениями

analyzePage кешируется по URL. При повторном вызове на том же URL - вернет кеш.

Параметр refresh: true - принудительно обновить кеш.

Best practice: используйте analyzePage вместо screenshot для анализа форм и интерактивных элементов.

Экономия: в пять-десять раз меньше токенов."

---

### [6:00-7:00] Tool: getAllInteractiveElements

**Text to read:**

"Инструмент getAllInteractiveElements возвращает ВСЕ интерактивные элементы с селекторами.

Полезно для:
- Понимания доступных действий
- Генерации автотестов
- Проверки доступности

Давайте получим их."

**[ACTION: Get interactive elements]**

**Text to read:**

"AI, get all interactive elements"

**[PAUSE]**

**Text to read:**

"Список всех кнопок, ссылок, инпутов, select'ов - всего, с чем можно взаимодействовать.

Параметр includeHidden: включить скрытые элементы. По умолчанию false."

---

### [7:00-8:30] Tool: findElementsByText

**Text to read:**

"Инструмент findElementsByText ищет элементы по тексту.

Очень удобно, когда CSS селектор сложно составить, но вы знаете текст.

Давайте найдем кнопку входа."

**[ACTION: Find by text]**

**Text to read:**

"AI, find elements with text 'Sign in'"

**[PAUSE]**

**Text to read:**

"Нашли элементы с этим текстом. С селекторами.

Параметры:
- exact: точное совпадение. По умолчанию false - частичное
- caseSensitive: учитывать регистр. По умолчанию false

Также можно СРАЗУ выполнить действие на первом найденном элементе.

Давайте найдем и кликнем."

**[ACTION: Find and click]**

**Text to read:**

"AI, find and click element with exact text 'Sign In'"

**[PAUSE]**

**Text to read:**

"Один запрос - поиск и клик. Очень удобно."

---

### [8:30-9:30] Tool: smartFindElement ⭐

**Text to read:**

"И наконец - smartFindElement. Самый мощный инструмент поиска.

Он использует AI для поиска элементов по ЕСТЕСТВЕННОМУ описанию на языке.

Давайте попробуем."

**[ACTION: Smart find]**

**Text to read:**

"AI, find 'the blue button that says submit'"

**[PAUSE for AI search]**

**Text to read:**

"AI вернул ranked candidates - отранжированные кандидаты. Лучшие совпадения первыми.

Можно сразу выполнить действие."

**[ACTION: Smart find and click]**

**Text to read:**

"AI, find 'the main navigation menu' and click it"

**[PAUSE]**

**Text to read:**

"Нашли и кликнули. По описанию на естественном языке.

Параметр maxResults контролирует количество кандидатов. По умолчанию пять.

ВАЖНОЕ ЗАМЕЧАНИЕ: документация рекомендует использовать analyzePage для лучшей производительности, когда это возможно.

smartFindElement - для сложных случаев, когда другие методы не подходят."

---

### [9:30-10:00] Summary

**Text to read:**

"Итак, группа Advanced:
- Девять мощных инструментов
- executeScript, setStyles, setViewport, getViewport, navigateTo
- И AI-powered: analyzePage, getAllInteractiveElements, findElementsByText, smartFindElement

Конфигурация: ENABLED_TOOLS равно core comma interaction comma advanced

Ключевые инструменты:
- analyzePage - для анализа форм. Экономит токены
- smartFindElement - для поиска по описанию

Для записи и воспроизведения сценариев добавьте группу recorder. Об этом в следующем видео.

Спасибо за просмотр!"

---

## Video 6: Recorder Group (10-12 minutes)

### [0:00-0:30] Opening

**Text to read:**

"Привет! В этом видео мы разберем группу Recorder - самую объемную и мощную группу.

Девять инструментов для записи действий, воспроизведения сценариев и генерации автотестов.

Это полноценная система автоматизации тестирования.

Группа Recorder поддерживает:
- Запись действий в браузере
- Воспроизведение с параметрами
- Экспорт в четыре фреймворка: Playwright TypeScript, Playwright Python, Selenium Python, Selenium Java
- Генерацию Page Object Model классов

Давайте начнем с основ."

---

### [0:30-2:00] Tool: enableRecorder

**Text to read:**

"Первый инструмент - enableRecorder. Он включает UI виджет для записи.

Давайте включим его."

**[ACTION: Enable recorder]**

**Text to read:**

"AI, enable recorder"

**[PAUSE while widget loads]**

**Text to read:**

"Виджет появился в углу браузера. Вы видите:
- Кнопку Start Recording
- Поле Scenario Name для названия сценария
- Поле Tags для меток
- Поле Dependencies для зависимостей от других сценариев
- Кнопку Save

Сценарии хранятся в конфигурационной папке:
~/.config/chrometools-mcp/projects/{domain}/scenarios/

Где domain - это домен текущего сайта. Например, для github.com будет projects/github/scenarios/

Также есть глобальный индекс всех проектов и сценариев:
~/.config/chrometools-mcp/index.json

Теперь давайте запишем сценарий."

---

### [2:00-4:00] Recording a scenario (manual browser interaction)

**Text to read:**

"Я нажму Start Recording и выполню последовательность действий.

Смотрите: я перехожу на страницу входа GitHub."

**[ACTION: Click Start Recording]**
**[ACTION: Navigate to GitHub login]**

**Text to read:**

"Теперь заполню имя пользователя."

**[ACTION: Fill username]**

**Text to read:**

"Пароль."

**[ACTION: Fill password]**

**Text to read:**

"И нажму кнопку входа."

**[ACTION: Click Sign in button]**

**Text to read:**

"Отлично. Теперь остановлю запись."

**[ACTION: Click Stop Recording]**

**Text to read:**

"Запись остановлена. Теперь введу название сценария: 'Login to GitHub'"

**[ACTION: Enter scenario name]**

**Text to read:**

"Добавлю теги: auth, login"

**[ACTION: Add tags]**

**Text to read:**

"И сохраню."

**[ACTION: Click Save]**

**[PAUSE for confirmation]**

**Text to read:**

"Сценарий сохранен. Теперь можем работать с ним через AI."

---

### [4:00-5:00] Tool: listScenarios

**Text to read:**

"Инструмент listScenarios показывает все сохраненные сценарии.

Давайте посмотрим."

**[ACTION: List scenarios]**

**Text to read:**

"AI, list all scenarios"

**[PAUSE for response]**

**Text to read:**

"Вот наш сценарий 'Login to GitHub' с метаданными:
- Name: название
- Description: описание, если добавили
- Tags: метки
- Actions count: количество действий
- Created date: дата создания
- Project: к какому проекту относится

По умолчанию показываются сценарии текущего проекта.

Параметр allProjects: true - показать сценарии из ВСЕХ проектов."

---

### [5:00-5:30] Tool: searchScenarios

**Text to read:**

"Инструмент searchScenarios ищет сценарии по тексту или тегам.

Давайте найдем все сценарии с тегом 'login'."

**[ACTION: Search by tag]**

**Text to read:**

"AI, search scenarios with tag 'login'"

**[PAUSE]**

**Text to read:**

"Нашли наш сценарий.

Также можно искать по тексту в названии или описании.

Параметр allProjects: искать во всех проектах."

---

### [5:30-6:00] Tool: getScenarioInfo

**Text to read:**

"Инструмент getScenarioInfo возвращает детальную информацию о сценарии.

Давайте посмотрим детали нашего сценария."

**[ACTION: Get info]**

**Text to read:**

"AI, get scenario info for 'Login to GitHub'"

**[PAUSE]**

**Text to read:**

"Вот что мы получили:
- Список всех действий: navigate, type, click - в порядке выполнения
- Параметры, если используются
- Зависимости от других сценариев, если есть
- Секреты не показаны по умолчанию

Параметр includeSecrets: true - показать секреты. Используйте осторожно."

---

### [6:00-7:00] Tool: executeScenario

**Text to read:**

"Инструмент executeScenario воспроизводит сценарий.

Это автоматическое повторение всех записанных действий.

Давайте выполним наш сценарий."

**[ACTION: Execute scenario]**

**Text to read:**

"AI, execute scenario 'Login to GitHub' with parameters: username equals 'testuser', password equals 'hidden'"

**[PAUSE while scenario executes]**

**Text to read:**

"Сценарий выполняется автоматически. Все действия повторяются в том же порядке.

Параметры:
- name: название сценария
- parameters: объект с параметрами для замены переменных
- executeDependencies: выполнить зависимости перед этим сценарием. По умолчанию true
- projectId: ID проекта для disambiguation, если сценарии с одинаковым именем в разных проектах

Очень удобно для regression testing."

---

### [7:00-8:30] Tool: exportScenarioAsCode

**Text to read:**

"Инструмент exportScenarioAsCode - это жемчужина Recorder группы.

Он генерирует готовый код автотеста из записанного сценария.

Поддерживает четыре фреймворка:
- playwright-typescript
- playwright-python
- selenium-python
- selenium-java

Давайте экспортируем наш сценарий в Playwright TypeScript."

**[ACTION: Export as code]**

**Text to read:**

"AI, export 'Login to GitHub' as Playwright TypeScript"

**[PAUSE for code generation]**

**Text to read:**

"Вот сгенерированный тест:
- Готовый Playwright тест
- Чистые селекторы - без CSS modules и styled-components хэшей
- Комментарии, объясняющие каждый шаг
- Suggested filename для сохранения

Это НОВЫЙ файл. Для добавления в существующий используйте appendScenarioToFile.

Параметры:
- scenarioName: название сценария
- language: фреймворк
- cleanSelectors: очистить нестабильные селекторы. По умолчанию true
- includeComments: добавить комментарии. По умолчанию true
- generatePageObject: также сгенерировать Page Object класс. По умолчанию false

Давайте попробуем с Page Object."

**[ACTION: Export with POM]**

**Text to read:**

"AI, export with Page Object, generatePageObject equals true"

**[PAUSE]**

**Text to read:**

"Теперь два файла:
- Тестовый файл, использующий Page Object
- Page Object класс с методами и селекторами

Готово для использования в проекте."

---

### [8:30-10:00] Tool: appendScenarioToFile

**Text to read:**

"Инструмент appendScenarioToFile добавляет тест в СУЩЕСТВУЮЩИЙ файл.

В отличие от exportScenarioAsCode, который создает НОВЫЙ файл, appendScenarioToFile НЕ перезаписывает существующие тесты.

Давайте добавим наш сценарий в файл auth.spec.ts."

**[ACTION: Append to file]**

**Text to read:**

"AI, append 'Login to GitHub' to existing test file ./tests/auth.spec.ts"

**[PAUSE while appending]**

**Text to read:**

"Тест добавлен в конец файла. Существующие тесты не тронуты.

Можно контролировать позицию вставки.

Параметр insertPosition:
- 'end': в конец файла. По умолчанию
- 'before': перед указанным тестом
- 'after': после указанного теста

Для before и after нужен параметр referenceTestName.

Давайте вставим перед тестом 'should logout'."

**[ACTION: Append before test]**

**Text to read:**

"AI, append 'Login to GitHub' before test 'should logout'"

**[PAUSE]**

**Text to read:**

"Тест вставлен в нужное место.

Другие параметры:
- language: фреймворк
- testName: переопределить название теста
- cleanSelectors, includeComments, generatePageObject: как у exportScenarioAsCode

Это мощный инструмент для добавления тестов в существующий test suite."

---

### [10:00-11:00] Tool: generatePageObject

**Text to read:**

"Инструмент generatePageObject генерирует Page Object Model класс для ТЕКУЩЕЙ страницы.

Он анализирует страницу, находит все интерактивные элементы и создает класс.

Давайте сгенерируем Page Object для текущей страницы."

**[ACTION: Generate POM]**

**Text to read:**

"AI, generate Page Object Model for current page in Playwright TypeScript"

**[PAUSE while generating]**

**Text to read:**

"Вот что сгенерировано:
- Класс с умным названием на основе заголовка страницы
- Элементы сгруппированы по секциям: header, navigation, form, footer
- Умные имена для элементов: usernameInput, submitButton, loginLink
- Helper методы для типовых действий

Параметры:
- framework: фреймворк. По умолчанию playwright-typescript
- className: переопределить имя класса. Иначе генерируется автоматически
- groupElements: группировать по секциям. По умолчанию true
- includeComments: комментарии. По умолчанию true

Без группировки получим плоский список элементов.

Это экономит часы ручного написания Page Objects."

---

### [11:00-11:30] Tool: deleteScenario

**Text to read:**

"Последний инструмент - deleteScenario. Он удаляет сценарий.

Давайте удалим тестовый сценарий."

**[ACTION: Delete scenario]**

**Text to read:**

"AI, delete scenario 'test scenario'"

**[PAUSE]**

**Text to read:**

"Сценарий удален.

Удаляется и сценарий, и все связанные секреты.

Операция необратима."

---

### [11:30-12:00] Summary

**Text to read:**

"Итак, группа Recorder:
- Девять инструментов для автоматизации тестирования
- Запись в браузере, воспроизведение, генерация кода
- Четыре фреймворка: Playwright и Selenium, TypeScript, Python, Java
- Page Object Model генерация

Конфигурация: ENABLED_TOOLS равно core comma interaction comma inspection comma recorder

Workflow:
1. enableRecorder - включить виджет
2. Записать сценарий вручную
3. executeScenario - проверить воспроизведение
4. exportScenarioAsCode или appendScenarioToFile - сгенерировать тесты

Глобальный индекс: ~/.config/chrometools-mcp/index.json

Для интеграции с Figma добавьте группу figma. Об этом в следующем видео.

Спасибо за просмотр!"

---

## Video 7: Figma Group (8-10 minutes)

### [0:00-0:30] Opening

**Text to read:**

"Привет! В последнем видео мы разберем группу Figma - интеграцию с Figma для дизайн-валидации.

Девять инструментов для pixel-perfect сравнения дизайна и реализации.

Группа Figma позволяет:
- Экспортировать фреймы из Figma
- Сравнивать с реализацией в браузере
- Извлекать дизайн-токены
- Анализировать Design System

ВАЖНО: для работы нужен Figma Personal Access Token.

Настройте его в переменной окружения FIGMA_TOKEN в конфигурации MCP клиента."

**[ACTION: Show env configuration with FIGMA_TOKEN]**

---

### [0:30-1:00] Tool: parseFigmaUrl

**Text to read:**

"Первый инструмент - parseFigmaUrl. Он парсит Figma URL и извлекает fileKey и nodeId.

Эти параметры нужны для всех остальных инструментов.

Давайте распарсим URL."

**[ACTION: Parse URL]**

**Text to read:**

"AI, parse Figma URL 'https://www.figma.com/file/ABC123/Design?node-id=1-2'"

**[PAUSE]**

**Text to read:**

"Получили:
- fileKey: ABC123
- nodeId: 1-2

Используйте эти значения в других инструментах."

---

### [1:00-2:00] Tool: listFigmaPages

**Text to read:**

"Инструмент listFigmaPages показывает структуру Figma файла.

Это должен быть ПЕРВЫЙ инструмент при работе с новым файлом.

Давайте изучим файл."

**[ACTION: List pages]**

**Text to read:**

"AI, list all pages and frames in Figma file ABC123"

**[PAUSE]**

**Text to read:**

"Вот дерево файла:
- Pages: страницы в файле
  - Frames: фреймы на каждой странице
    - Components: компоненты внутри фреймов

Каждый элемент с nodeId.

Это карта файла. Используйте для навигации и поиска нужных фреймов."

---

### [2:00-2:30] Tool: searchFigmaFrames

**Text to read:**

"Инструмент searchFigmaFrames ищет фреймы по названию.

Удобно, когда в файле сотни фреймов.

Давайте найдем все кнопки."

**[ACTION: Search frames]**

**Text to read:**

"AI, search for frames with name 'Button' in Figma file"

**[PAUSE]**

**Text to read:**

"Нашли все фреймы с 'Button' в названии.

Для каждого: name и nodeId.

Поиск case-insensitive и ищет по всем страницам."

---

### [2:30-3:30] Tool: getFigmaFrame

**Text to read:**

"Инструмент getFigmaFrame экспортирует фрейм как изображение.

Поддерживает PNG, JPEG и SVG форматы.

Давайте экспортируем кнопку."

**[ACTION: Get frame]**

**Text to read:**

"AI, get Figma frame ABC123 slash node-id-123 as PNG with scale 2"

**[PAUSE while exporting]**

**Text to read:**

"Вот изображение кнопки из Figma.

Параметры:
- fileKey и nodeId: идентификаторы
- format: png, jpg, svg. По умолчанию png
- scale: от нуль точка один до четырех. По умолчанию два. Масштаб экспорта
- figmaToken: можно передать токен явно. Иначе используется из env

SVG формат полезен для векторной графики.

Давайте попробуем SVG."

**[ACTION: Get as SVG]**

**Text to read:**

"AI, get as SVG"

**[PAUSE]**

**Text to read:**

"SVG код. Можно использовать напрямую в вебе."

---

### [3:30-4:30] Tool: getFigmaSpecs

**Text to read:**

"Инструмент getFigmaSpecs извлекает дизайн-спецификации фрейма.

Это дизайн-токены для разработки.

Давайте получим спеки кнопки."

**[ACTION: Get specs]**

**Text to read:**

"AI, get design specs for Figma frame"

**[PAUSE]**

**Text to read:**

"Вот что извлечено:
- Colors: цвета в hex и rgba
- Fonts: шрифт, размер, вес
- Dimensions: ширина и высота
- Spacing: padding и margins

Это точные значения из Figma.

Используйте для:
- Создания CSS переменных
- Генерации design tokens
- Проверки соответствия реализации дизайну"

---

### [4:30-6:00] Tool: compareFigmaToElement ⭐

**Text to read:**

"Теперь КЛЮЧЕВОЙ инструмент группы - compareFigmaToElement.

Это pixel-perfect сравнение дизайна Figma с реализацией в браузере.

У нас открыта реализованная страница с кнопкой. Давайте сравним её с дизайном."

**[ACTION: Open implemented page]**

**Text to read:**

"AI, compare Figma frame ABC123 slash node-id with element '.hero-button'"

**[PAUSE while comparing]**

**Text to read:**

"Вот результат сравнения:
- Diff процент: насколько различаются изображения
- Diff изображение: наложение с подсветкой различий
- Threshold: порог различия. По умолчанию ноль точка ноль пять, то есть пять процентов

Если diff меньше threshold - считается идентичным.

В нашем случае есть различия. Видите красные области? Это pixel differences."

**[ACTION: Point out differences on screen]**

**Text to read:**

"Здесь padding отличается. Здесь цвет чуть-чуть другой.

Параметры:
- fileKey, nodeId: Figma идентификаторы
- selector: CSS селектор элемента в браузере
- threshold: порог. От нуля до единицы. По умолчанию ноль точка ноль пять
- figmaScale: масштаб Figma экспорта
- figmaToken: опциональный токен

Это незаменимо для:
- Design QA
- Pixel-perfect реализации
- Regression testing дизайна"

---

### [6:00-7:00] Tool: getFigmaComponents

**Text to read:**

"Инструмент getFigmaComponents извлекает все компоненты из Figma файла.

Это для работы с Design System.

Давайте получим компоненты."

**[ACTION: Get components]**

**Text to read:**

"AI, get all components from Figma file"

**[PAUSE]**

**Text to read:**

"Список всех компонентов:
- Name: название
- NodeId: идентификатор
- Description: описание, если есть

Это каталог Design System.

Можно использовать для:
- Документации компонентов
- Генерации component library
- Инвентаризации дизайна"

---

### [7:00-8:00] Tool: getFigmaStyles

**Text to read:**

"Инструмент getFigmaStyles извлекает все стили из Figma.

Стили - это глобальные дизайн-токены: цвета, типографика, эффекты, сетки.

Давайте получим их."

**[ACTION: Get styles]**

**Text to read:**

"AI, get all styles from Figma file"

**[PAUSE]**

**Text to read:**

"Вот все стили файла:
- Color styles: палитра цветов
- Text styles: типографические стили
- Effect styles: тени, blur
- Grid styles: сетки для layout

Каждый стиль с названием и значениями.

Используйте для:
- Генерации CSS variables
- Создания design tokens JSON
- Синхронизации дизайна и кода"

---

### [8:00-9:00] Tool: getFigmaColorPalette

**Text to read:**

"Инструмент getFigmaColorPalette извлекает уникальную цветовую палитру файла.

В отличие от getFigmaStyles, который возвращает именованные стили, colorPalette возвращает ВСЕ уникальные цвета.

Давайте получим палитру."

**[ACTION: Get color palette]**

**Text to read:**

"AI, get color palette from Figma file"

**[PAUSE]**

**Text to read:**

"Список всех уникальных цветов:
- Hex код
- RGBA значения
- Usage count: сколько раз используется

Цвета отсортированы по частоте использования.

Полезно для:
- Документации цветовой схемы
- Оптимизации палитры
- Поиска несогласованности в цветах"

---

### [9:00-10:00] Summary and Workflow

**Text to read:**

"Итак, группа Figma:
- Девять инструментов для дизайн-валидации
- Требуется FIGMA_TOKEN в env

Конфигурация: ENABLED_TOOLS равно core comma figma

Основной use case - compareFigmaToElement для pixel-perfect валидации.

Рекомендуемый workflow:
1. listFigmaPages - изучить структуру файла
2. searchFigmaFrames - найти нужный фрейм по названию
3. compareFigmaToElement - сравнить с реализацией
4. Если есть различия - getFigmaSpecs для точных значений

Дополнительно:
- getFigmaComponents - для документации Design System
- getFigmaStyles - для design tokens
- getFigmaColorPalette - для анализа цветов

Это мощная интеграция дизайна и разработки."

---

### [10:00-10:30] Series Conclusion

**Text to read:**

"Мы разобрали все семь групп инструментов ChromeTools MCP.

Напомню экономию токенов:
- Все 43 инструмента: ~28,000 токенов
- Базовая конфигурация (core, interaction, inspection): ~8,000 токенов - экономия 71%
- С AI (core, interaction, advanced): ~11,000 токенов - экономия 61%

Выбирайте группы под ваш use case.

Документация: ссылка в описании
Установка: npx chrometools-mcp@latest
GitHub: github.com/docentovich/chrometools-mcp

Спасибо за просмотр серии!"

---

## Bonus Video: Configuration Comparison (3-4 minutes)

### Opening

**Text to read:**

"Привет! В этом бонусном видео мы сравним разные конфигурации и поможем вам выбрать подходящую.

Давайте рассмотрим таблицу экономии токенов."

**[ACTION: Show comparison table on screen]**

---

### Configuration Comparison

**Text to read:**

"Конфигурация 'Все группы':
- Семь групп, сорок три инструмента
- Примерно двадцать восемь тысяч токенов
- Это четырнадцать процентов контекста
- Экономия: ноль процентов - это baseline

Конфигурация 'Базовая':
- core, interaction, inspection
- Двенадцать инструментов
- Примерно восемь тысяч токенов
- Экономия: семьдесят один процент

Конфигурация 'С AI':
- core, interaction, advanced
- Шестнадцать инструментов
- Примерно одиннадцать тысяч токенов
- Экономия: шестьдесят один процент

Конфигурация 'С отладкой':
- core, interaction, inspection, debug
- Шестнадцать инструментов
- Примерно одиннадцать тысяч токенов
- Экономия: шестьдесят один процент

Конфигурация 'Только Figma':
- core, figma
- Одиннадцать инструментов
- Примерно семь с половиной тысяч токенов
- Экономия: семьдесят три процента

Конфигурация 'Полная автоматизация':
- core, interaction, inspection, debug, advanced, recorder
- Тридцать четыре инструмента
- Примерно двадцать четыре тысячи токенов
- Экономия: четырнадцать процентов"

---

### Recommendations

**Text to read:**

"Рекомендации по выбору:

Вы новичок в ChromeTools? Начните с базовой: core comma interaction comma inspection.
Это покрывает девяносто процентов задач автоматизации.

Вы опытный пользователь и хотите AI-powered инструменты? Используйте: core comma interaction comma advanced.
Получите analyzePage и smartFindElement.

Вы занимаетесь тестированием? Полная автоматизация: core comma interaction comma inspection comma debug comma recorder.
Все для записи, отладки и генерации тестов.

Вы дизайнер или занимаетесь дизайн-валидацией? Только Figma: core comma figma.
Минимум инструментов, максимум фокуса.

Не уверены? Начните с базовой. Добавляйте группы по мере необходимости."

---

### Practical Example

**Text to read:**

"Практический пример.

Представим: у вас бюджет сто тысяч токенов на задачу.

С полным набором (28k токенов на инструменты):
- Остается семьдесят две тысячи токенов для работы

С базовой конфигурацией (8k токенов):
- Остается девяносто две тысячи токенов для работы

Разница: двадцать тысяч токенов.

Это может быть:
- Десять дополнительных скриншотов
- Двадцать дополнительных запросов к AI
- Анализ десяти дополнительных файлов

Выбирайте конфигурацию осознанно."

---

### Summary

**Text to read:**

"Итоги:
- Экономия токенов - главная причина фильтрации
- Начните с базовой конфигурации
- Добавляйте группы по необходимости
- Не включайте все группы, если не используете

Установка:
npx chrometools-mcp@latest

Конфигурация в:
~/.claude.json для Claude Code
~/.claude/mcp_config.json для Claude Desktop

Добавьте поле env с ENABLED_TOOLS.

Пример:
{
  \"env\": {
    \"ENABLED_TOOLS\": \"core,interaction,inspection\"
  }
}

Документация: ссылка в описании
GitHub: github.com/docentovich/chrometools-mcp

Спасибо за просмотр!"

---

## General Tips for All Videos

### Pacing and Delivery

**Slow down at:**
- Technical terms (e.g., "персистентная сессия", "box model", "pixel-perfect")
- Numbers and statistics (e.g., "экономия семьдесят один процент")
- Code examples and parameters
- URLs and file paths

**Pause after:**
- Asking AI to do something (wait for response)
- Demonstrating action in browser (let viewer see result)
- Showing code or configuration (let viewer read)

**Emphasize:**
- Key benefits (e.g., "экономия токенов")
- Important warnings (e.g., "ВАЖНО", "ТОЛЬКО когда")
- Best practices (e.g., "используйте analyzePage вместо screenshot")

### Common Phrases

When transitioning between tools:
- "Следующий инструмент..."
- "Теперь давайте посмотрим..."
- "Перейдем к..."

When showing parameters:
- "Параметры:"
- "По умолчанию..."
- "Можно указать..."

When demonstrating:
- "Давайте попробуем..."
- "Как видите..."
- "Обратите внимание..."

When summarizing:
- "Итак..."
- "Ключевые моменты:"
- "Запомните..."

### Visual Cues to Add

Throughout videos, add on-screen text for:
- Tool names when first mentioned
- Parameter names and values
- Token usage numbers
- File paths
- URLs
- Key concepts

Use highlighting for:
- Important warnings
- Best practices
- Token savings
- Configuration examples

### End Screen Elements

Every video should end with:
1. Summary slide with key points
2. Configuration example
3. Token savings percentage
4. Links:
   - Documentation
   - GitHub repository
   - npm package
5. Next video teaser (except last one)
6. Subscribe/like reminder

---

**End of Scripts**

Total estimated recording time: ~50-60 minutes of content across 7 videos
Recommended upload schedule: One video every 2-3 days for better engagement

Good luck with your recordings!
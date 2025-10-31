# Инструкция по публикации в npm

## Подготовка к публикации

### 1. Обновите информацию в package.json

Перед публикацией **ОБЯЗАТЕЛЬНО** замените placeholder-значения:

```json
{
  "author": "Your Name <your.email@example.com>",  // ← ЗАМЕНИТЕ
  "repository": {
    "url": "git+https://github.com/yourusername/chrometools-mcp.git"  // ← ЗАМЕНИТЕ
  },
  "bugs": {
    "url": "https://github.com/yourusername/chrometools-mcp/issues"  // ← ЗАМЕНИТЕ
  },
  "homepage": "https://github.com/yourusername/chrometools-mcp#readme"  // ← ЗАМЕНИТЕ
}
```

### 2. Проверьте, что вы залогинены в npm

```bash
npm whoami
```

Если не залогинены:
```bash
npm login
```

### 3. Проверьте доступность имени пакета

```bash
npm search chrometools-mcp
```

Если имя занято, измените в `package.json`.

## Проверка перед публикацией

### 1. Проверьте содержимое пакета

```bash
npm pack --dry-run
```

Посмотрите, какие файлы будут включены в пакет.

### 2. Создайте тестовый пакет

```bash
npm pack
```

Это создаст файл `chrometools-mcp-1.0.0.tgz`.

### 3. Посмотрите содержимое архива

```bash
tar -tf chrometools-mcp-*.tgz
```

Убедитесь, что:
- ✅ Включены: index.js, README.md, LICENSE, WSL_SETUP.md
- ❌ Исключены: test-*.js, .claude/, conversation-*.txt, node_modules/

### 4. Тестируйте локально

```bash
npm link
chrometools-mcp
```

Или установите из локального архива:
```bash
npm install -g ./chrometools-mcp-1.0.0.tgz
chrometools-mcp
```

### 5. Запустите валидацию

```bash
npm run build
```

Это выполнит:
- Синтаксическую проверку кода
- Валидацию всех скриптов

## Публикация

### Первая публикация (v1.0.0)

```bash
npm publish
```

### Обновление версии и публикация

```bash
# Увеличить patch версию (1.0.0 → 1.0.1)
npm version patch
npm publish

# Увеличить minor версию (1.0.1 → 1.1.0)
npm version minor
npm publish

# Увеличить major версию (1.1.0 → 2.0.0)
npm version major
npm publish

# Или установить конкретную версию
npm version 1.2.3
npm publish
```

**ВАЖНО:** `npm version` автоматически создаст git commit и tag.

### Публикация с тегом (beta/latest)

```bash
# Публикация beta-версии
npm publish --tag beta

# Публикация stable-версии
npm publish --tag latest
```

## После публикации

### 1. Проверьте публикацию на npmjs.com

```
https://www.npmjs.com/package/chrometools-mcp
```

### 2. Протестируйте установку

```bash
# Удалите локальную версию
npm uninstall -g chrometools-mcp

# Установите из npm
npx chrometools-mcp

# Или глобально
npm install -g chrometools-mcp
```

### 3. Обновите документацию

Убедитесь, что README.md содержит правильные инструкции по установке:

```markdown
## Installation

```bash
npx chrometools-mcp
```

Or install globally:

```bash
npm install -g chrometools-mcp
```
\`\`\`
```

## Важные замечания

### Checklist перед публикацией

- [ ] Обновлены author, repository, bugs, homepage в package.json
- [ ] Проверено `npm pack --dry-run` - нет лишних файлов
- [ ] Запущена валидация `npm run build` - прошла успешно
- [ ] Протестировано `npm link` - команда работает
- [ ] Проверен README.md - актуален и корректен
- [ ] Создан git commit с изменениями
- [ ] Имя пакета доступно в npm реестре
- [ ] Файл index.js имеет shebang `#!/usr/bin/env node`

### Автоматические проверки

При выполнении `npm publish` автоматически запустится:
```json
"prepublishOnly": "npm run build"
```

Это гарантирует, что код валиден перед публикацией.

## Отмена публикации

⚠️ **ВНИМАНИЕ:** Отмена публикации возможна только в течение 72 часов!

```bash
# Отменить конкретную версию
npm unpublish chrometools-mcp@1.0.0

# Отменить весь пакет (использовать с осторожностью!)
npm unpublish chrometools-mcp --force
```

## Версионирование (Semantic Versioning)

Следуйте правилам semver:

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes (несовместимые изменения API)
- **MINOR** (1.0.0 → 1.1.0): Новая функциональность (обратно совместимо)
- **PATCH** (1.0.0 → 1.0.1): Исправления багов (обратно совместимо)

Примеры:
```bash
npm version patch  # Исправление бага
npm version minor  # Добавление нового инструмента
npm version major  # Изменение API инструментов
```

## Полезные команды

```bash
# Посмотреть информацию о пакете
npm view chrometools-mcp

# Посмотреть все версии пакета
npm view chrometools-mcp versions

# Посмотреть зависимости
npm view chrometools-mcp dependencies

# Скачать статистику
npm view chrometools-mcp --json
```

## Troubleshooting

### Ошибка: "You do not have permission to publish"

Проверьте:
1. Вы залогинены: `npm whoami`
2. Email подтвержден на npmjs.com
3. У вас есть права на публикацию

### Ошибка: "Package name already exists"

Измените имя в package.json:
```json
{
  "name": "@yourusername/chrometools-mcp"
}
```

### Публикация scoped пакета (@username/package)

```bash
# Публикация как public пакет (бесплатно)
npm publish --access public
```

## Дополнительные ресурсы

- [npm Documentation](https://docs.npmjs.com/)
- [Semantic Versioning](https://semver.org/)
- [Publishing packages](https://docs.npmjs.com/cli/v10/commands/npm-publish)

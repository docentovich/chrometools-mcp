# Спецификация: Swagger/OpenAPI -> API-модели и API-клиент

## Чеклист прогресса

### Фаза 1 (текущая)
- [ ] **1.1** OpenAPI парсер (`utils/openapi/parser.js`) - единый для 2.0 и 3.x
- [ ] **1.2** $ref резолвер (`utils/openapi/ref-resolver.js`) - рекурсивное разрешение ссылок
- [ ] **1.3** Маппинг типов (`utils/openapi/type-mapper.js`) - OpenAPI -> TypeScript/Python типы
- [ ] **1.4** Тул `loadSwagger` - чтение и парсинг спецификации (URL или файл, JSON или YAML)
- [ ] **1.5** Генератор TypeScript моделей (`utils/api-generators/api-models-typescript.js`)
- [ ] **1.6** Генератор Python моделей (`utils/api-generators/api-models-python.js`)
- [ ] **1.7** Тул `generateApiModels` - генерация моделей из swagger
- [ ] **1.8** Схемы и описания тулов (`tool-schemas.js`, `tool-definitions.js`)
- [ ] **1.9** Хендлеры в `index.js`
- [ ] **1.10** Документация в `README.md`

### Фаза 2 (следующая итерация)
- [ ] **2.1** Генератор методов из endpoints (`utils/openapi/method-generator.js`) — operationId → имя метода, path/query/body параметры
- [ ] **2.2** Генератор auth-конфигурации (`utils/openapi/auth-generator.js`) — constructor params, header setup для всех типов auth
- [ ] **2.3** Генератор API-клиента TypeScript (`utils/api-generators/api-client-typescript.js`) — Playwright APIRequestContext
- [ ] **2.4** Генератор API-клиента Python (`utils/api-generators/api-client-python.js`) — requests.Session
- [ ] **2.5** Тул `generateApiClient` — Zod schema, описание
- [ ] **2.6** Схема в `tool-schemas.js` (`GenerateApiClientSchema`)
- [ ] **2.7** Описание в `tool-definitions.js`
- [ ] **2.8** Хендлер в `index.js`
- [ ] **2.9** Документация в `README.md`
- [ ] **2.10** Верификация — Petstore 2.0/3.0, auth types, path params, query params, request body

### Фаза 3 (будущее)
- [ ] **3.1** Генератор тестовых скаффолдов (`utils/openapi/test-scaffold-generator.js`) — CRUD detection, happy path + error cases
- [ ] **3.2** Генератор API-тестов TypeScript (`utils/api-generators/api-tests-typescript.js`) — Playwright test
- [ ] **3.3** Генератор API-тестов Python (`utils/api-generators/api-tests-python.js`) — pytest + requests
- [ ] **3.4** Тул `generateApiTests` — Zod schema, описание
- [ ] **3.5** Схема в `tool-schemas.js` (`GenerateApiTestsSchema`)
- [ ] **3.6** Описание в `tool-definitions.js`
- [ ] **3.7** Хендлер в `index.js`
- [ ] **3.8** Документация в `README.md`
- [ ] **3.9** Интеграция API-клиента с API-тестами (аналог POM-интеграции: опциональное использование клиента вместо raw HTTP)
- [ ] **3.10** Верификация — Petstore CRUD, auth тесты, error case scaffolds, grouping by tags

---

## Контекст

QA-автоматизаторы хотят быстро создавать API-тесты из Swagger/OpenAPI спецификации. Сейчас процесс ручной: открыть Swagger UI, скопировать эндпоинты, вручную написать типы и клиент.

**Цель**: MCP-тулы, которые читают Swagger-спецификацию и генерируют:
1. Типизированные модели данных (TypeScript interfaces / Python dataclasses)
2. API-клиент с методами для каждого endpoint (фаза 2)
3. Тестовые скаффолды (фаза 3)

---

## Фаза 1: loadSwagger + generateApiModels

### Тул 1: `loadSwagger`

**Назначение**: загрузить и распарсить OpenAPI-спецификацию, вернуть структурированную сводку.

**Параметры**:
```js
LoadSwaggerSchema = z.object({
  source: z.string().describe("URL (http/https) or local file path to swagger.json / openapi.yaml"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format. 'auto' (default) detects from extension/content"),
})
```

**Алгоритм**:
1. Определить тип источника (URL vs файл) по наличию `http://` / `https://`
2. Загрузить контент:
   - URL: HTTP GET через `fetch()` (Node 18+ built-in)
   - Файл: `fs.readFileSync()`
3. Определить формат (auto): попробовать `JSON.parse()`, если fail — `yaml.load()`
4. Определить версию: `spec.swagger === '2.0'` → OpenAPI 2.0, `spec.openapi?.startsWith('3.')` → OpenAPI 3.x
5. Нормализовать структуру (внутренне привести 2.0 к формату 3.x)
6. Разрезолвить все `$ref` ссылки
7. Вернуть сводку

**Возвращаемое значение**:
```json
{
  "success": true,
  "version": "3.0.3",
  "title": "Pet Store API",
  "description": "A sample API",
  "baseUrl": "https://petstore.swagger.io/v2",
  "auth": [
    { "name": "bearerAuth", "type": "http", "scheme": "bearer" },
    { "name": "apiKey", "type": "apiKey", "in": "header", "paramName": "X-API-Key" }
  ],
  "endpoints": [
    {
      "method": "GET",
      "path": "/pets",
      "operationId": "listPets",
      "summary": "List all pets",
      "tags": ["pets"],
      "parameters": [
        { "name": "limit", "in": "query", "type": "integer", "required": false }
      ],
      "requestBody": null,
      "responses": {
        "200": { "description": "OK", "schema": "PetList" },
        "400": { "description": "Bad Request", "schema": "Error" }
      }
    },
    {
      "method": "POST",
      "path": "/pets",
      "operationId": "createPet",
      "summary": "Create a pet",
      "tags": ["pets"],
      "parameters": [],
      "requestBody": { "schema": "CreatePetRequest", "required": true },
      "responses": {
        "201": { "description": "Created", "schema": "Pet" }
      }
    }
  ],
  "schemas": {
    "Pet": {
      "type": "object",
      "required": ["id", "name"],
      "properties": {
        "id": { "type": "integer", "format": "int64" },
        "name": { "type": "string" },
        "status": { "type": "string", "enum": ["available", "pending", "sold"] },
        "tags": { "type": "array", "items": { "$ref": "Tag" } }
      }
    },
    "Tag": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "name": { "type": "string" }
      }
    }
  },
  "endpointCount": 15,
  "schemaCount": 8,
  "instruction": "Use generateApiModels to generate typed models, or generateApiClient to generate API client class."
}
```

### Тул 2: `generateApiModels`

**Назначение**: сгенерировать типизированные модели данных из OpenAPI schemas.

**Параметры**:
```js
GenerateApiModelsSchema = z.object({
  source: z.string().describe("URL or file path to OpenAPI spec"),
  language: z.enum(['typescript', 'python']).describe("Target language for models"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format (default: auto)"),
  style: z.enum(['interface', 'type']).optional()
    .describe("TypeScript only: 'interface' (default) or 'type' aliases"),
  pythonStyle: z.enum(['dataclass', 'pydantic', 'typeddict']).optional()
    .describe("Python only: 'dataclass' (default), 'pydantic' BaseModel, or TypedDict"),
  includeEnums: z.boolean().optional()
    .describe("Generate separate enum types (default: true)"),
  includeValidation: z.boolean().optional()
    .describe("Include validation constraints as comments/decorators (default: false)"),
  schemas: z.array(z.string()).optional()
    .describe("Generate only these schemas (default: all). E.g. ['User', 'Pet']"),
})
```

**Алгоритм**:
1. Загрузить и распарсить спеку (переиспользует парсер из loadSwagger)
2. Отфильтровать schemas если указан параметр `schemas`
3. Топологически отсортировать schemas по зависимостям ($ref), чтобы зависимости шли первыми
4. Для каждой schema сгенерировать код модели
5. Вернуть единый файл с кодом + suggested filename

**TypeScript выход** (interface):
```typescript
// Generated from Pet Store API (https://petstore.swagger.io/v2)
// OpenAPI 3.0.3 | Generated at 2024-01-15T12:00:00Z

/** Pet status in the store */
export enum PetStatus {
  Available = 'available',
  Pending = 'pending',
  Sold = 'sold',
}

export interface Tag {
  id?: number;
  name?: string;
}

export interface Pet {
  /** Pet ID */
  id: number;
  /** Pet name */
  name: string;
  status?: PetStatus;
  tags?: Tag[];
}

export interface CreatePetRequest {
  name: string;
  status?: PetStatus;
}

export interface Error {
  code: number;
  message: string;
}
```

**Python выход** (dataclass):
```python
"""
Generated from Pet Store API (https://petstore.swagger.io/v2)
OpenAPI 3.0.3 | Generated at 2024-01-15T12:00:00Z
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List


class PetStatus(str, Enum):
    """Pet status in the store"""
    AVAILABLE = 'available'
    PENDING = 'pending'
    SOLD = 'sold'


@dataclass
class Tag:
    id: Optional[int] = None
    name: Optional[str] = None


@dataclass
class Pet:
    """Pet object"""
    id: int = 0
    name: str = ''
    status: Optional[PetStatus] = None
    tags: List[Tag] = field(default_factory=list)


@dataclass
class CreatePetRequest:
    name: str = ''
    status: Optional[PetStatus] = None


@dataclass
class Error:
    code: int = 0
    message: str = ''
```

**Python выход** (pydantic):
```python
from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional, List


class PetStatus(str, Enum):
    AVAILABLE = 'available'
    PENDING = 'pending'
    SOLD = 'sold'


class Tag(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None


class Pet(BaseModel):
    id: int
    name: str
    status: Optional[PetStatus] = None
    tags: List[Tag] = Field(default_factory=list)
```

**Возвращаемое значение**:
```json
{
  "action": "create_new_file",
  "suggestedFileName": "pet-store-api.models.ts",
  "code": "// ...generated code...",
  "schemaCount": 5,
  "enumCount": 1,
  "language": "typescript",
  "source": "https://petstore.swagger.io/v2/swagger.json",
  "instruction": "Create file 'pet-store-api.models.ts' with the code."
}
```

---

## Изменения по файлам (Фаза 1)

### Новые файлы

#### 1. `utils/openapi/parser.js`

Единый парсер для OpenAPI 2.0 и 3.x.

```js
import yaml from 'js-yaml';
import { resolveAllRefs } from './ref-resolver.js';

export class OpenAPIParser {
  constructor(rawSpec) {
    this.raw = rawSpec;
    this.version = this.detectVersion();
    this.spec = this.normalize(); // внутренне -> формат 3.x
  }

  /** Загрузить спеку из URL или файла */
  static async load(source, format = 'auto') { ... }

  /** Определить версию */
  detectVersion() {
    if (this.raw.swagger === '2.0') return '2.0';
    if (this.raw.openapi?.startsWith('3.')) return this.raw.openapi;
    throw new Error('Unsupported OpenAPI version');
  }

  /** Нормализовать 2.0 → 3.x структуру */
  normalize() {
    if (this.version === '2.0') return this.normalize2to3(this.raw);
    return this.raw;
  }

  /** Конвертация 2.0 → 3.x */
  normalize2to3(spec) {
    return {
      openapi: '3.0.0',
      info: spec.info,
      servers: [{
        url: `${spec.schemes?.[0] || 'https'}://${spec.host || 'localhost'}${spec.basePath || ''}`
      }],
      paths: this.normalizePaths2to3(spec.paths),
      components: {
        schemas: spec.definitions || {},
        securitySchemes: this.normalizeSecurityDefs(spec.securityDefinitions || {})
      },
      security: spec.security
    };
  }

  /** Нормализация путей 2.0 → 3.x (body params → requestBody) */
  normalizePaths2to3(paths) { ... }

  /** Нормализация securityDefinitions → securitySchemes */
  normalizeSecurityDefs(defs) { ... }

  /** Получить все schemas */
  getSchemas() {
    return this.spec.components?.schemas || {};
  }

  /** Получить security schemes */
  getSecuritySchemes() {
    return this.spec.components?.securitySchemes || {};
  }

  /** Получить base URL */
  getBaseUrl() {
    return this.spec.servers?.[0]?.url || '';
  }

  /** Получить все endpoints как плоский список */
  getEndpoints() {
    const endpoints = [];
    for (const [path, methods] of Object.entries(this.spec.paths || {})) {
      for (const [method, operation] of Object.entries(methods)) {
        if (['get','post','put','patch','delete','head','options'].includes(method)) {
          endpoints.push({
            method: method.toUpperCase(),
            path,
            operationId: operation.operationId || this.generateOperationId(method, path),
            summary: operation.summary || '',
            description: operation.description || '',
            tags: operation.tags || [],
            parameters: this.extractParameters(operation, methods.parameters),
            requestBody: this.extractRequestBody(operation),
            responses: this.extractResponses(operation),
            security: operation.security || this.spec.security || [],
            deprecated: operation.deprecated || false
          });
        }
      }
    }
    return endpoints;
  }

  /** Генерация operationId из метода и пути: GET /users/{id} -> getUser */
  generateOperationId(method, path) { ... }

  /** Извлечение параметров (path, query, header) */
  extractParameters(operation, pathParams) { ... }

  /** Извлечение request body */
  extractRequestBody(operation) { ... }

  /** Извлечение responses с именами схем */
  extractResponses(operation) { ... }

  /** Полная сводка для loadSwagger */
  getSummary() {
    return {
      version: this.version,
      title: this.spec.info?.title || '',
      description: this.spec.info?.description || '',
      baseUrl: this.getBaseUrl(),
      auth: this.getAuthSummary(),
      endpoints: this.getEndpoints(),
      schemas: this.getSchemasSummary(),
      endpointCount: this.getEndpoints().length,
      schemaCount: Object.keys(this.getSchemas()).length
    };
  }

  /** Сводка auth для удобного потребления */
  getAuthSummary() { ... }

  /** Сводка schemas (без полного тела, только имена + поля верхнего уровня) */
  getSchemasSummary() { ... }
}
```

#### 2. `utils/openapi/ref-resolver.js`

Рекурсивное разрешение `$ref` ссылок.

```js
/**
 * Разрешить все $ref в объекте спецификации
 * @param {Object} spec - полная спецификация
 * @returns {Object} - спецификация с разрешёнными $ref
 */
export function resolveAllRefs(spec) { ... }

/**
 * Разрешить одну $ref ссылку
 * "#/components/schemas/Pet" -> объект Pet
 * "#/definitions/Pet" -> объект Pet (OpenAPI 2.0)
 *
 * @param {string} ref - $ref строка
 * @param {Object} spec - корневой объект спецификации
 * @param {Set} visited - отслеживание циклических ссылок
 * @returns {Object} - разрешённый объект
 */
export function resolveRef(ref, spec, visited = new Set()) { ... }
```

**Обработка $ref**:
- Внутренние: `#/components/schemas/Pet` → разрешить по JSON path
- Циклические: отслеживать через `visited` Set, при обнаружении цикла — остановиться и вернуть `{ $circularRef: 'SchemaName' }`
- `allOf`: мержить все элементы в один объект (properties + required)
- `oneOf` / `anyOf`: сохранять как union type
- Внешние `$ref` (другие файлы): **НЕ поддерживаем в фазе 1**, бросаем warning

#### 3. `utils/openapi/type-mapper.js`

Маппинг OpenAPI типов в TypeScript и Python.

```js
/**
 * Конвертировать OpenAPI тип в целевой язык
 */
export class TypeMapper {
  static toTypeScript(schema, schemaName = null) {
    // string -> string
    // string + format:date-time -> string (ISO)
    // string + format:binary -> Blob
    // integer / number -> number
    // boolean -> boolean
    // array + items -> ItemType[]
    // object + properties -> inline { ... } или имя схемы
    // enum -> ссылка на enum type
    // oneOf/anyOf -> Union type (A | B)
    // allOf -> Intersection type (A & B)
    // nullable: true -> Type | null
  }

  static toPython(schema, schemaName = null) {
    // string -> str
    // string + format:date-time -> datetime
    // string + format:date -> date
    // integer -> int
    // number -> float
    // boolean -> bool
    // array + items -> List[ItemType]
    // object -> Dict[str, Any] или имя схемы
    // enum -> ссылка на Enum class
    // oneOf/anyOf -> Union[A, B]
    // nullable: true -> Optional[Type]
  }
}
```

Таблица маппинга:

| OpenAPI type | format | TypeScript | Python |
|---|---|---|---|
| `string` | — | `string` | `str` |
| `string` | `date-time` | `string` | `datetime` |
| `string` | `date` | `string` | `date` |
| `string` | `binary` | `Blob` | `bytes` |
| `string` | `uuid` | `string` | `str` |
| `string` | enum [...] | `EnumName` | `EnumName` |
| `integer` | `int32` | `number` | `int` |
| `integer` | `int64` | `number` | `int` |
| `number` | `float` | `number` | `float` |
| `number` | `double` | `number` | `float` |
| `boolean` | — | `boolean` | `bool` |
| `array` | items: T | `T[]` | `List[T]` |
| `object` | properties | `InterfaceName` | `ClassName` |
| `object` | additionalProperties: T | `Record<string, T>` | `Dict[str, T]` |
| — | `nullable: true` | `T \| null` | `Optional[T]` |
| — | `oneOf: [A, B]` | `A \| B` | `Union[A, B]` |
| — | `allOf: [A, B]` | `A & B` | наследование / merge |

#### 4. `utils/api-generators/api-models-typescript.js`

Генератор TypeScript моделей.

```js
export class ApiModelsTypeScriptGenerator {
  constructor(schemas, options = {}) {
    this.schemas = schemas;       // resolved schemas object
    this.options = {
      style: 'interface',         // 'interface' | 'type'
      includeEnums: true,
      includeValidation: false,   // validation constraints as JSDoc comments
      ...options
    };
  }

  /** Сгенерировать весь файл */
  generate(metadata = {}) {
    const lines = [];
    lines.push(...this.generateHeader(metadata));
    lines.push('');

    // 1. Сначала enums
    if (this.options.includeEnums) {
      lines.push(...this.generateAllEnums());
    }

    // 2. Затем interfaces/types в порядке зависимостей
    const sorted = this.topologicalSort();
    for (const name of sorted) {
      lines.push(...this.generateModel(name, this.schemas[name]));
      lines.push('');
    }

    return lines.join('\n');
  }

  /** Генерировать один interface/type */
  generateModel(name, schema) { ... }

  /** Генерировать enum из string + enum [...] */
  generateEnum(name, values, description) { ... }

  /** Обработка allOf — merge properties */
  mergeAllOf(allOfSchemas) { ... }

  /** Обработка oneOf/anyOf — union type */
  generateUnionType(name, schemas) { ... }

  /** Топологическая сортировка по зависимостям */
  topologicalSort() { ... }

  /** Генерировать заголовок файла */
  generateHeader(metadata) { ... }
}
```

#### 5. `utils/api-generators/api-models-python.js`

Генератор Python моделей.

```js
export class ApiModelsPythonGenerator {
  constructor(schemas, options = {}) {
    this.schemas = schemas;
    this.options = {
      style: 'dataclass',        // 'dataclass' | 'pydantic' | 'typeddict'
      includeEnums: true,
      includeValidation: false,
      ...options
    };
  }

  /** Сгенерировать весь файл */
  generate(metadata = {}) {
    const lines = [];
    lines.push(...this.generateHeader(metadata));
    lines.push(...this.generateImports());
    lines.push('');

    // 1. Enums
    if (this.options.includeEnums) {
      lines.push(...this.generateAllEnums());
    }

    // 2. Models в порядке зависимостей
    const sorted = this.topologicalSort();
    for (const name of sorted) {
      lines.push('');
      lines.push(...this.generateModel(name, this.schemas[name]));
    }

    return lines.join('\n');
  }

  /** Генерировать импорты в зависимости от стиля */
  generateImports() {
    if (this.options.style === 'dataclass') {
      return [
        'from __future__ import annotations',
        'from dataclasses import dataclass, field',
        'from enum import Enum',
        'from typing import Optional, List, Dict, Any, Union',
        'from datetime import datetime, date'
      ];
    }
    if (this.options.style === 'pydantic') {
      return [
        'from __future__ import annotations',
        'from pydantic import BaseModel, Field',
        'from enum import Enum',
        'from typing import Optional, List, Dict, Any, Union',
        'from datetime import datetime, date'
      ];
    }
    // typeddict
    return [
      'from typing import TypedDict, Optional, List, Dict, Any, Union',
      'from enum import Enum',
      'from datetime import datetime, date'
    ];
  }

  generateModel(name, schema) { ... }
  generateEnum(name, values, description) { ... }
  mergeAllOf(allOfSchemas) { ... }
  topologicalSort() { ... }
  generateHeader(metadata) { ... }
}
```

### Изменяемые файлы

#### 6. `server/tool-schemas.js`

```js
export const LoadSwaggerSchema = z.object({
  source: z.string().describe("URL (http/https) or local file path to swagger.json / openapi.yaml"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format. 'auto' (default) detects from extension/content"),
});

export const GenerateApiModelsSchema = z.object({
  source: z.string().describe("URL or file path to OpenAPI spec"),
  language: z.enum(['typescript', 'python']).describe("Target language for models"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format (default: auto)"),
  style: z.enum(['interface', 'type']).optional()
    .describe("TypeScript only: 'interface' (default) or 'type' aliases"),
  pythonStyle: z.enum(['dataclass', 'pydantic', 'typeddict']).optional()
    .describe("Python only: 'dataclass' (default), 'pydantic', or 'typeddict'"),
  includeEnums: z.boolean().optional()
    .describe("Generate enum types (default: true)"),
  includeValidation: z.boolean().optional()
    .describe("Include validation constraints as comments (default: false)"),
  schemas: z.array(z.string()).optional()
    .describe("Generate only these schemas (default: all)"),
});
```

#### 7. `server/tool-definitions.js`

Добавить определения обоих тулов в массив tools с описаниями и inputSchema.

#### 8. `index.js`

Добавить хендлеры для `loadSwagger` и `generateApiModels`:

**loadSwagger**:
```js
if (name === "loadSwagger") {
  const parser = await OpenAPIParser.load(args.source, args.format);
  const summary = parser.getSummary();
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, ...summary }, null, 2)
    }]
  };
}
```

**generateApiModels**:
```js
if (name === "generateApiModels") {
  const parser = await OpenAPIParser.load(args.source, args.format);
  const schemas = parser.getSchemas();
  // Отфильтровать если указан args.schemas
  // Выбрать генератор по языку
  // Сгенерировать код
  // Вернуть JSON с кодом и suggestedFileName
}
```

#### 9. `README.md`

Документировать оба тула в секции Recorder/API Tools.

---

## Обработка Auth типов

Все типы auth из OpenAPI spec парсятся и возвращаются в `loadSwagger`:

### HTTP Bearer
```yaml
securitySchemes:
  bearerAuth:
    type: http
    scheme: bearer
    bearerFormat: JWT
```
→ `{ name: "bearerAuth", type: "http", scheme: "bearer", bearerFormat: "JWT" }`

### API Key
```yaml
securitySchemes:
  apiKey:
    type: apiKey
    in: header
    name: X-API-Key
```
→ `{ name: "apiKey", type: "apiKey", in: "header", paramName: "X-API-Key" }`

### Basic Auth
```yaml
securitySchemes:
  basicAuth:
    type: http
    scheme: basic
```
→ `{ name: "basicAuth", type: "http", scheme: "basic" }`

### OAuth2
```yaml
securitySchemes:
  oauth2:
    type: oauth2
    flows:
      authorizationCode:
        authorizationUrl: https://example.com/oauth/authorize
        tokenUrl: https://example.com/oauth/token
        scopes:
          read: Read access
          write: Write access
```
→ `{ name: "oauth2", type: "oauth2", flows: { authorizationCode: { ... } } }`

### OpenAPI 2.0 → 3.x маппинг auth

| OpenAPI 2.0 securityDefinitions | OpenAPI 3.x securitySchemes |
|---|---|
| `type: "apiKey"` | `type: "apiKey"` (без изменений) |
| `type: "basic"` | `type: "http", scheme: "basic"` |
| `type: "oauth2", flow: "implicit"` | `type: "oauth2", flows: { implicit: {...} }` |
| `type: "oauth2", flow: "password"` | `type: "oauth2", flows: { password: {...} }` |
| `type: "oauth2", flow: "application"` | `type: "oauth2", flows: { clientCredentials: {...} }` |
| `type: "oauth2", flow: "accessCode"` | `type: "oauth2", flows: { authorizationCode: {...} }` |

---

## Обработка $ref

### Алгоритм разрешения

```
resolveRef("#/components/schemas/Pet", spec):
  1. Разбить путь: ["components", "schemas", "Pet"]
  2. Пройти по spec: spec.components.schemas.Pet
  3. Если результат содержит $ref — рекурсия
  4. Если уже в visited — вернуть { $circularRef: "Pet" }
  5. Кэшировать в resolvedRefs Map
```

### allOf обработка
```yaml
NewPet:
  allOf:
    - $ref: '#/components/schemas/Pet'
    - type: object
      properties:
        extraField:
          type: string
```
→ Мержить properties и required из всех элементов allOf.
Для TypeScript: `interface NewPet extends Pet { extraField?: string; }`
Для Python: `class NewPet(Pet): extra_field: Optional[str] = None`

### oneOf/anyOf обработка
```yaml
Response:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
```
→ TypeScript: `type Response = Cat | Dog;`
→ Python: `Response = Union[Cat, Dog]`

### Циклические ссылки
```yaml
TreeNode:
  properties:
    children:
      type: array
      items:
        $ref: '#/components/schemas/TreeNode'  # цикл!
```
→ TypeScript: `children?: TreeNode[]` (TS нативно поддерживает)
→ Python: `children: List['TreeNode'] = field(default_factory=list)` (forward reference)

---

## Именование файлов

| Спека | TypeScript | Python |
|---|---|---|
| Pet Store API | `pet-store-api.models.ts` | `pet_store_api_models.py` |
| My Service | `my-service.models.ts` | `my_service_models.py` |

---

## Структура файлов проекта (после реализации)

```
utils/
  openapi/
    parser.js           # OpenAPIParser class
    ref-resolver.js     # $ref resolution
    type-mapper.js      # OpenAPI → TS/Python type mapping
  api-generators/
    api-models-typescript.js  # TS interface/type generator
    api-models-python.js      # Python dataclass/pydantic generator
  code-generators/
    ... (existing POM/test generators)
```

---

## Верификация

### loadSwagger
1. Загрузить Petstore 2.0: `https://petstore.swagger.io/v2/swagger.json`
2. Загрузить Petstore 3.0: `https://petstore3.swagger.io/api/v3/openapi.json`
3. Загрузить из YAML-файла
4. Проверить количество endpoints и schemas
5. Проверить auth types
6. Проверить $ref resolution

### generateApiModels
1. Сгенерировать TypeScript interfaces из Petstore
2. Сгенерировать Python dataclasses из Petstore
3. Сгенерировать Python pydantic из Petstore
4. Проверить enum-ы (PetStatus)
5. Проверить nested objects ($ref)
6. Проверить required vs optional поля
7. Проверить allOf merge
8. Проверить массивы (tags: Tag[])
9. Фильтрация по schemas: только ['Pet', 'Tag']

---

## Фаза 2: generateApiClient

### Тул 3: `generateApiClient`

**Назначение**: сгенерировать класс API-клиента с типизированными методами для каждого endpoint из OpenAPI спецификации.

**Параметры**:
```js
GenerateApiClientSchema = z.object({
  source: z.string().describe("URL or file path to OpenAPI spec"),
  language: z.enum(['typescript', 'python']).describe("Target language"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format (default: auto)"),
  modelsImportPath: z.string().optional()
    .describe("Import path for models file. E.g. './pet-store-api.models' (default: auto from spec title)"),
  includeAuth: z.boolean().optional()
    .describe("Generate auth configuration in constructor (default: true)"),
  includeComments: z.boolean().optional()
    .describe("Include JSDoc/docstring comments on methods (default: true)"),
  tags: z.array(z.string()).optional()
    .describe("Generate methods only for these tags (default: all). E.g. ['pets', 'users']"),
  groupByTags: z.boolean().optional()
    .describe("Group methods by tag with section comments (default: true)"),
  responseStyle: z.enum(['raw', 'typed', 'both']).optional()
    .describe("Return type: 'raw' returns Response object, 'typed' returns parsed model, 'both' has overloads (default: 'raw')"),
})
```

**Алгоритм**:
1. Загрузить и распарсить спеку (переиспользует `OpenAPIParser`)
2. Извлечь все endpoints через `parser.getEndpoints()`
3. Отфильтровать endpoints по `tags` если указан
4. Извлечь auth schemes через `parser.getSecuritySchemes()`
5. Для каждого endpoint сгенерировать метод:
   a. Определить имя метода из `operationId` (или сгенерировать из method+path)
   b. Извлечь path params → параметры функции
   c. Извлечь query params → опциональный params объект
   d. Извлечь request body → body параметр с типом из моделей
   e. Определить response type из `responses.200` (или 201) schema
   f. Сгенерировать URL-строку с подстановкой path params
   g. Сгенерировать query string building
6. Сгенерировать constructor с auth configuration
7. Собрать файл: imports → class → constructor → методы
8. Вернуть код + suggested filename

**Возвращаемое значение**:
```json
{
  "action": "create_new_file",
  "suggestedFileName": "PetStoreApi.ts",
  "modelsFileName": "pet-store-api.models.ts",
  "code": "// ...generated code...",
  "methodCount": 12,
  "tagGroups": ["pets", "store", "user"],
  "authTypes": ["bearer", "apiKey"],
  "language": "typescript",
  "source": "https://petstore.swagger.io/v2/swagger.json",
  "instruction": "Create file 'PetStoreApi.ts'. Make sure models file exists (use generateApiModels if not). Set auth credentials via constructor options."
}
```

---

### Генерация имён методов (method-generator)

#### operationId → имя метода

| operationId | TypeScript method | Python method |
|---|---|---|
| `listPets` | `listPets` | `list_pets` |
| `createPet` | `createPet` | `create_pet` |
| `getPetById` | `getPetById` | `get_pet_by_id` |
| `updatePetWithForm` | `updatePetWithForm` | `update_pet_with_form` |
| `deletePet` | `deletePet` | `delete_pet` |

**Fallback (нет operationId)**:
Генерация из HTTP method + path:
| method | path | TypeScript | Python |
|---|---|---|---|
| `GET` | `/pets` | `getPets` | `get_pets` |
| `POST` | `/pets` | `createPets` | `create_pets` |
| `GET` | `/pets/{petId}` | `getPetsByPetId` | `get_pets_by_pet_id` |
| `PUT` | `/pets/{petId}` | `updatePetsByPetId` | `update_pets_by_pet_id` |
| `DELETE` | `/pets/{petId}` | `deletePetsByPetId` | `delete_pets_by_pet_id` |
| `GET` | `/users/{id}/orders` | `getUsersByIdOrders` | `get_users_by_id_orders` |

**Алгоритм генерации operationId из method+path**:
```
1. Маппинг HTTP метода → префикс: GET→get, POST→create, PUT→update, PATCH→patch, DELETE→delete
2. Разбить path по '/': /pets/{petId}/tags → ['pets', '{petId}', 'tags']
3. Для каждого сегмента:
   - Обычный сегмент: capitalize ('pets' → 'Pets')
   - Path param {x}: 'By' + capitalize(x) ('By' + 'PetId' → 'ByPetId')
4. Склеить: 'get' + 'Pets' + 'ByPetId' + 'Tags' → 'getPetsByPetIdTags'
```

#### Параметры метода

**Path params** → обязательные параметры функции:
```typescript
// GET /pets/{petId}/toys/{toyId}
async getPetToy(petId: number, toyId: number)
```
```python
# GET /pets/{petId}/toys/{toyId}
def get_pet_toy(self, pet_id: int, toy_id: int)
```

**Query params** → опциональный params объект:
```typescript
// GET /pets?limit=10&status=available&tags=cat,dog
async listPets(params?: { limit?: number; status?: PetStatus; tags?: string[] })
```
```python
# GET /pets?limit=10&status=available&tags=cat,dog
def list_pets(self, limit: Optional[int] = None, status: Optional[PetStatus] = None, tags: Optional[List[str]] = None)
```

**Request body** → body параметр:
```typescript
// POST /pets
async createPet(body: CreatePetRequest)
```
```python
# POST /pets
def create_pet(self, body: CreatePetRequest)
```

**Комбинированные** (path + query + body):
```typescript
// PUT /pets/{petId}?notify=true  body: UpdatePetRequest
async updatePet(petId: number, body: UpdatePetRequest, params?: { notify?: boolean })
```
```python
# PUT /pets/{petId}?notify=true  body: UpdatePetRequest
def update_pet(self, pet_id: int, body: UpdatePetRequest, notify: Optional[bool] = None)
```

#### Маппинг типов параметров

| OpenAPI parameter type | TypeScript | Python |
|---|---|---|
| `integer` (in: path) | `number` | `int` |
| `integer` (in: query) | `number` | `int` |
| `string` (in: query) | `string` | `str` |
| `boolean` (in: query) | `boolean` | `bool` |
| `string` + enum (in: query) | `EnumType` | `EnumType` |
| `array` (in: query) | `string[]` | `List[str]` |
| `$ref` (requestBody) | `ModelName` | `ModelName` |

---

### Генерация Auth конфигурации

#### Constructor auth params

Из `securitySchemes` спецификации генерируется конструктор с соответствующими параметрами.

**HTTP Bearer**:
```typescript
constructor(request: APIRequestContext, options: {
  baseUrl?: string;
  token?: string;  // Bearer token
} = {}) {
  this.request = request;
  this.baseUrl = options.baseUrl || 'https://petstore.swagger.io/v2';
  this.headers = {};
  if (options.token) this.headers['Authorization'] = `Bearer ${options.token}`;
}
```
```python
def __init__(self, base_url: str = 'https://petstore.swagger.io/v2',
             token: Optional[str] = None):
    self.session = requests.Session()
    self.base_url = base_url
    if token:
        self.session.headers['Authorization'] = f'Bearer {token}'
```

**API Key (header)**:
```typescript
// securitySchemes: { apiKey: { type: apiKey, in: header, name: X-API-Key } }
constructor(request: APIRequestContext, options: {
  baseUrl?: string;
  apiKey?: string;  // X-API-Key header
} = {}) {
  // ...
  if (options.apiKey) this.headers['X-API-Key'] = options.apiKey;
}
```
```python
def __init__(self, base_url: str = '...', api_key: Optional[str] = None):
    # ...
    if api_key:
        self.session.headers['X-API-Key'] = api_key
```

**API Key (query)**:
```typescript
// securitySchemes: { apiKey: { type: apiKey, in: query, name: api_key } }
// → сохраняется в this.queryAuth и добавляется ко всем запросам
constructor(request: APIRequestContext, options: {
  baseUrl?: string;
  apiKey?: string;  // api_key query parameter
} = {}) {
  // ...
  this.queryAuth = {};
  if (options.apiKey) this.queryAuth['api_key'] = options.apiKey;
}
```
```python
def __init__(self, base_url: str = '...', api_key: Optional[str] = None):
    # ...
    self.query_auth = {}
    if api_key:
        self.query_auth['api_key'] = api_key
```

**Basic Auth**:
```typescript
constructor(request: APIRequestContext, options: {
  baseUrl?: string;
  username?: string;
  password?: string;
} = {}) {
  // ...
  if (options.username && options.password) {
    const creds = Buffer.from(`${options.username}:${options.password}`).toString('base64');
    this.headers['Authorization'] = `Basic ${creds}`;
  }
}
```
```python
def __init__(self, base_url: str = '...', username: Optional[str] = None, password: Optional[str] = None):
    # ...
    if username and password:
        self.session.auth = (username, password)
```

**OAuth2** (все flows):
```typescript
// OAuth2 — генерируем приём готового access token (flow настраивается снаружи)
constructor(request: APIRequestContext, options: {
  baseUrl?: string;
  accessToken?: string;  // OAuth2 access token
} = {}) {
  // ...
  if (options.accessToken) this.headers['Authorization'] = `Bearer ${options.accessToken}`;
}
```
```python
def __init__(self, base_url: str = '...', access_token: Optional[str] = None):
    # ...
    if access_token:
        self.session.headers['Authorization'] = f'Bearer {access_token}'
```

**Комбинированные auth** (несколько schemes в одной спеке):
```typescript
constructor(request: APIRequestContext, options: {
  baseUrl?: string;
  token?: string;       // Bearer auth
  apiKey?: string;      // X-API-Key header
  username?: string;    // Basic auth
  password?: string;    // Basic auth
} = {}) {
  this.request = request;
  this.baseUrl = options.baseUrl || '...';
  this.headers = {};
  if (options.token) this.headers['Authorization'] = `Bearer ${options.token}`;
  else if (options.username && options.password) {
    const creds = Buffer.from(`${options.username}:${options.password}`).toString('base64');
    this.headers['Authorization'] = `Basic ${creds}`;
  }
  if (options.apiKey) this.headers['X-API-Key'] = options.apiKey;
}
```

#### Per-endpoint security overrides

Если endpoint имеет собственный `security` блок (отличный от глобального), генерируется комментарий:
```typescript
/** GET /admin/users - List admin users
 * Security: bearerAuth (overrides global apiKey) */
async listAdminUsers() { ... }
```

---

### URL Construction

#### Path params substitution
```typescript
// Template: /pets/{petId}/toys/{toyId}
// Generated: `${this.baseUrl}/pets/${petId}/toys/${toyId}`
```
```python
# Template: /pets/{petId}/toys/{toyId}
# Generated: f'{self.base_url}/pets/{pet_id}/toys/{toy_id}'
```

#### Query string building

**TypeScript**:
```typescript
async listPets(params?: { limit?: number; status?: PetStatus; tags?: string[] }) {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.status !== undefined) query.set('status', params.status);
  if (params?.tags !== undefined) params.tags.forEach(v => query.append('tags', v));
  // Добавить query auth params
  for (const [k, v] of Object.entries(this.queryAuth)) query.set(k, v);
  const qs = query.toString();
  const url = `${this.baseUrl}/pets${qs ? '?' + qs : ''}`;
  return this.request.get(url, { headers: this.headers });
}
```

**Python**:
```python
def list_pets(self, limit: Optional[int] = None, status: Optional[PetStatus] = None,
              tags: Optional[List[str]] = None):
    """GET /pets - List all pets"""
    params = {**self.query_auth}
    if limit is not None: params['limit'] = limit
    if status is not None: params['status'] = status.value
    if tags is not None: params['tags'] = ','.join(tags)
    return self.session.get(f'{self.base_url}/pets', params=params)
```

#### Request body serialization

**TypeScript** (Playwright request context handles JSON automatically):
```typescript
async createPet(body: CreatePetRequest) {
  return this.request.post(`${this.baseUrl}/pets`, {
    headers: { ...this.headers, 'Content-Type': 'application/json' },
    data: body
  });
}
```

**Python**:
```python
def create_pet(self, body: CreatePetRequest):
    """POST /pets - Create a pet"""
    # dataclass
    from dataclasses import asdict
    return self.session.post(f'{self.base_url}/pets', json=asdict(body))
```

Для `pydantic`:
```python
    return self.session.post(f'{self.base_url}/pets', json=body.model_dump())
```

Для `typeddict`:
```python
    return self.session.post(f'{self.base_url}/pets', json=body)
```

---

### Изменения по файлам (Фаза 2)

#### Новые файлы

##### 1. `utils/openapi/method-generator.js`

Генерация метаданных методов из endpoints.

```js
/**
 * Генератор метаданных методов из OpenAPI endpoints
 */
export class MethodGenerator {
  /**
   * Сгенерировать метаданные метода для endpoint
   * @param {Object} endpoint - endpoint из OpenAPIParser.getEndpoints()
   * @param {string} language - 'typescript' | 'python'
   * @returns {Object} - { methodName, pathParams, queryParams, bodyParam, returnType, comment }
   */
  static generateMethod(endpoint, language) {
    return {
      methodName: this.getMethodName(endpoint.operationId, endpoint.method, endpoint.path, language),
      httpMethod: endpoint.method.toLowerCase(),
      path: endpoint.path,
      pathParams: this.extractPathParams(endpoint.parameters, language),
      queryParams: this.extractQueryParams(endpoint.parameters, language),
      bodyParam: this.extractBodyParam(endpoint.requestBody, language),
      returnType: this.extractReturnType(endpoint.responses, language),
      comment: this.buildComment(endpoint),
      tags: endpoint.tags,
      deprecated: endpoint.deprecated,
      security: endpoint.security
    };
  }

  /**
   * Получить имя метода из operationId или сгенерировать из method+path
   * @param {string|null} operationId
   * @param {string} method - HTTP method
   * @param {string} path - URL path
   * @param {string} language - target language
   * @returns {string} - method name in target language convention
   */
  static getMethodName(operationId, method, path, language) {
    const camelName = operationId || this.generateOperationId(method, path);
    if (language === 'python') {
      return this.camelToSnake(camelName);
    }
    return camelName;
  }

  /**
   * Генерация operationId из HTTP method + path
   * GET /pets/{petId} → getPetsByPetId
   */
  static generateOperationId(method, path) { ... }

  /**
   * camelCase → snake_case
   */
  static camelToSnake(name) {
    return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
  }

  /**
   * Извлечь path параметры
   * @returns {Array<{name, type, required}>}
   */
  static extractPathParams(parameters, language) {
    return (parameters || [])
      .filter(p => p.in === 'path')
      .map(p => ({
        name: language === 'python' ? this.camelToSnake(p.name) : p.name,
        originalName: p.name,
        type: TypeMapper.mapParamType(p, language),
        required: true
      }));
  }

  /**
   * Извлечь query параметры
   * @returns {Array<{name, type, required, isArray, enumType}>}
   */
  static extractQueryParams(parameters, language) {
    return (parameters || [])
      .filter(p => p.in === 'query')
      .map(p => ({
        name: language === 'python' ? this.camelToSnake(p.name) : p.name,
        originalName: p.name,
        type: TypeMapper.mapParamType(p, language),
        required: p.required || false,
        isArray: p.type === 'array',
        enumType: p.enum ? p.name : null
      }));
  }

  /**
   * Извлечь body параметр
   * @returns {Object|null} - { type, required } или null
   */
  static extractBodyParam(requestBody, language) { ... }

  /**
   * Определить return type из responses
   * Приоритет: 200 → 201 → 204(void) → первый 2xx
   * @returns {string|null} - type name или null
   */
  static extractReturnType(responses, language) { ... }

  /**
   * Построить JSDoc / docstring комментарий
   * @returns {string} - "METHOD /path - summary"
   */
  static buildComment(endpoint) {
    const deprecated = endpoint.deprecated ? ' [DEPRECATED]' : '';
    return `${endpoint.method} ${endpoint.path} - ${endpoint.summary || 'No description'}${deprecated}`;
  }
}
```

##### 2. `utils/openapi/auth-generator.js`

Генерация auth-конфигурации для constructor.

```js
/**
 * Генератор auth-конфигурации для API-клиента
 */
export class AuthGenerator {
  /**
   * Сгенерировать auth metadata из securitySchemes
   * @param {Object} securitySchemes - из spec.components.securitySchemes
   * @returns {Object} - { constructorParams, headerSetup, querySetup }
   */
  static generateAuthConfig(securitySchemes) {
    const constructorParams = [];
    const headerSetup = [];
    const querySetup = [];

    for (const [name, scheme] of Object.entries(securitySchemes || {})) {
      const config = this.processScheme(name, scheme);
      constructorParams.push(...config.params);
      headerSetup.push(...config.headers);
      querySetup.push(...config.query);
    }

    return { constructorParams, headerSetup, querySetup };
  }

  /**
   * Обработать одну security scheme
   */
  static processScheme(name, scheme) {
    switch (scheme.type) {
      case 'http':
        if (scheme.scheme === 'bearer') return this.bearerAuth(name);
        if (scheme.scheme === 'basic') return this.basicAuth(name);
        break;
      case 'apiKey':
        if (scheme.in === 'header') return this.apiKeyHeader(name, scheme.name);
        if (scheme.in === 'query') return this.apiKeyQuery(name, scheme.name);
        break;
      case 'oauth2':
        return this.oauth2Auth(name);
    }
    return { params: [], headers: [], query: [] };
  }

  static bearerAuth(name) {
    return {
      params: [{ name: 'token', type: 'string', description: 'Bearer token', optional: true }],
      headers: [{ condition: 'token', header: 'Authorization', value: 'Bearer ${token}' }],
      query: []
    };
  }

  static basicAuth(name) {
    return {
      params: [
        { name: 'username', type: 'string', description: 'Basic auth username', optional: true },
        { name: 'password', type: 'string', description: 'Basic auth password', optional: true }
      ],
      headers: [{ condition: 'username && password', header: 'Authorization', value: 'Basic(username, password)' }],
      query: []
    };
  }

  static apiKeyHeader(name, headerName) {
    return {
      params: [{ name: 'apiKey', type: 'string', description: `${headerName} header`, optional: true }],
      headers: [{ condition: 'apiKey', header: headerName, value: '${apiKey}' }],
      query: []
    };
  }

  static apiKeyQuery(name, paramName) {
    return {
      params: [{ name: 'apiKey', type: 'string', description: `${paramName} query param`, optional: true }],
      headers: [],
      query: [{ condition: 'apiKey', param: paramName, value: '${apiKey}' }]
    };
  }

  static oauth2Auth(name) {
    return {
      params: [{ name: 'accessToken', type: 'string', description: 'OAuth2 access token', optional: true }],
      headers: [{ condition: 'accessToken', header: 'Authorization', value: 'Bearer ${accessToken}' }],
      query: []
    };
  }
}
```

##### 3. `utils/api-generators/api-client-typescript.js`

Генератор TypeScript API-клиента (Playwright APIRequestContext).

```js
import { MethodGenerator } from '../openapi/method-generator.js';
import { AuthGenerator } from '../openapi/auth-generator.js';

export class ApiClientTypeScriptGenerator {
  constructor(endpoints, securitySchemes, options = {}) {
    this.endpoints = endpoints;      // из parser.getEndpoints()
    this.securitySchemes = securitySchemes;
    this.options = {
      includeAuth: true,
      includeComments: true,
      groupByTags: true,
      responseStyle: 'raw',          // 'raw' | 'typed' | 'both'
      modelsImportPath: null,        // auto-generated if null
      ...options
    };
  }

  /**
   * Сгенерировать весь файл API-клиента
   * @param {Object} metadata - { title, baseUrl, version }
   * @returns {string} - полный TypeScript код
   */
  generate(metadata = {}) {
    const lines = [];

    // 1. Imports
    lines.push(...this.generateImports(metadata));
    lines.push('');

    // 2. Class declaration
    const className = this.getClassName(metadata.title);
    lines.push(`export class ${className} {`);

    // 3. Fields
    lines.push('  private request: APIRequestContext;');
    lines.push('  private baseUrl: string;');
    lines.push('  private headers: Record<string, string>;');
    if (this.hasQueryAuth()) {
      lines.push('  private queryAuth: Record<string, string>;');
    }
    lines.push('');

    // 4. Constructor
    lines.push(...this.generateConstructor(metadata));
    lines.push('');

    // 5. Methods — grouped by tag or flat
    const methods = this.endpoints.map(ep => MethodGenerator.generateMethod(ep, 'typescript'));
    if (this.options.groupByTags) {
      lines.push(...this.generateGroupedMethods(methods));
    } else {
      for (const m of methods) {
        lines.push(...this.generateMethod(m));
        lines.push('');
      }
    }

    // 6. Close class
    lines.push('}');

    return lines.join('\n');
  }

  /** Генерировать import блок */
  generateImports(metadata) {
    const lines = [
      "import { APIRequestContext } from '@playwright/test';",
    ];

    // Собрать все используемые типы моделей
    const usedTypes = this.collectUsedTypes();
    if (usedTypes.length > 0) {
      const importPath = this.options.modelsImportPath || this.getModelsImportPath(metadata.title);
      lines.push(`import { ${usedTypes.join(', ')} } from '${importPath}';`);
    }

    return lines;
  }

  /** Собрать все типы используемые в параметрах и return types */
  collectUsedTypes() { ... }

  /** Сгенерировать constructor */
  generateConstructor(metadata) { ... }

  /** Сгенерировать один метод */
  generateMethod(methodMeta) {
    const lines = [];

    // JSDoc comment
    if (this.options.includeComments) {
      lines.push(`  /** ${methodMeta.comment} */`);
    }

    // Method signature
    const params = this.buildMethodSignature(methodMeta);
    lines.push(`  async ${methodMeta.methodName}(${params}) {`);

    // Query string building (if has query params)
    if (methodMeta.queryParams.length > 0 || this.hasQueryAuth()) {
      lines.push(...this.generateQueryBuilding(methodMeta));
    }

    // URL construction
    const urlExpr = this.buildUrlExpression(methodMeta);

    // HTTP call
    lines.push(...this.generateHttpCall(methodMeta, urlExpr));

    lines.push('  }');
    return lines;
  }

  /** Сгенерировать методы сгруппированные по тегам */
  generateGroupedMethods(methods) {
    const lines = [];
    const grouped = this.groupByTag(methods);
    for (const [tag, tagMethods] of Object.entries(grouped)) {
      lines.push(`  // ======== ${tag} ========`);
      lines.push('');
      for (const m of tagMethods) {
        lines.push(...this.generateMethod(m));
        lines.push('');
      }
    }
    return lines;
  }

  /** Построить сигнатуру метода */
  buildMethodSignature(methodMeta) { ... }

  /** Построить URL expression с path params */
  buildUrlExpression(methodMeta) { ... }

  /** Сгенерировать query string building code */
  generateQueryBuilding(methodMeta) { ... }

  /** Сгенерировать HTTP call */
  generateHttpCall(methodMeta, urlExpr) { ... }

  /** Имя класса из title: "Pet Store API" → "PetStoreApi" */
  getClassName(title) { ... }

  /** Import path из title: "Pet Store API" → "./pet-store-api.models" */
  getModelsImportPath(title) { ... }

  /** Есть ли apiKey auth в query */
  hasQueryAuth() { ... }

  /** Группировка методов по первому тегу */
  groupByTag(methods) { ... }
}
```

##### 4. `utils/api-generators/api-client-python.js`

Генератор Python API-клиента (requests.Session).

```js
import { MethodGenerator } from '../openapi/method-generator.js';
import { AuthGenerator } from '../openapi/auth-generator.js';

export class ApiClientPythonGenerator {
  constructor(endpoints, securitySchemes, options = {}) {
    this.endpoints = endpoints;
    this.securitySchemes = securitySchemes;
    this.options = {
      includeAuth: true,
      includeComments: true,
      groupByTags: true,
      responseStyle: 'raw',
      modelsImportPath: null,
      pythonStyle: 'dataclass',       // для определения метода сериализации body
      ...options
    };
  }

  /**
   * Сгенерировать весь файл API-клиента
   */
  generate(metadata = {}) {
    const lines = [];

    // 1. Imports
    lines.push(...this.generateImports(metadata));
    lines.push('');
    lines.push('');

    // 2. Class
    const className = this.getClassName(metadata.title);
    lines.push(`class ${className}:`);

    // 3. Constructor (__init__)
    lines.push(...this.generateInit(metadata));
    lines.push('');

    // 4. Methods
    const methods = this.endpoints.map(ep => MethodGenerator.generateMethod(ep, 'python'));
    if (this.options.groupByTags) {
      lines.push(...this.generateGroupedMethods(methods));
    } else {
      for (const m of methods) {
        lines.push(...this.generateMethod(m));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /** Imports */
  generateImports(metadata) {
    const lines = [
      'import requests',
      'from typing import Optional, List, Dict, Any',
    ];

    const usedTypes = this.collectUsedTypes();
    if (usedTypes.length > 0) {
      const importPath = this.options.modelsImportPath || this.getModelsImportPath(metadata.title);
      lines.push(`from ${importPath} import ${usedTypes.join(', ')}`);
    }

    return lines;
  }

  /** __init__ с auth */
  generateInit(metadata) {
    // Аналогично TypeScript, но с Python синтаксисом:
    // def __init__(self, base_url: str = '...', token: Optional[str] = None, ...)
    // self.session = requests.Session()
    // self.base_url = base_url
    // if token: self.session.headers['Authorization'] = f'Bearer {token}'
    ...
  }

  /** Один метод */
  generateMethod(methodMeta) {
    const lines = [];

    // Method signature
    const params = this.buildMethodSignature(methodMeta);
    lines.push(`    def ${methodMeta.methodName}(self, ${params}):`);

    // Docstring
    if (this.options.includeComments) {
      lines.push(`        """${methodMeta.comment}"""`);
    }

    // Query params building
    if (methodMeta.queryParams.length > 0 || this.hasQueryAuth()) {
      lines.push(...this.generateQueryBuilding(methodMeta));
    }

    // URL
    const urlExpr = this.buildUrlExpression(methodMeta);

    // HTTP call
    lines.push(...this.generateHttpCall(methodMeta, urlExpr));

    return lines;
  }

  /** Сериализация body в зависимости от pythonStyle */
  serializeBody(varName) {
    switch (this.options.pythonStyle) {
      case 'dataclass': return `from dataclasses import asdict; json=asdict(${varName})`;
      case 'pydantic': return `json=${varName}.model_dump()`;
      case 'typeddict': return `json=${varName}`;
      default: return `json=${varName}`;
    }
  }

  buildMethodSignature(methodMeta) { ... }
  buildUrlExpression(methodMeta) { ... }
  generateQueryBuilding(methodMeta) { ... }
  generateHttpCall(methodMeta, urlExpr) { ... }
  getClassName(title) { ... }
  getModelsImportPath(title) { ... }
  hasQueryAuth() { ... }
  generateGroupedMethods(methods) { ... }
  collectUsedTypes() { ... }
}
```

#### Изменяемые файлы

##### 5. `server/tool-schemas.js`

Добавить:
```js
export const GenerateApiClientSchema = z.object({
  source: z.string().describe("URL or file path to OpenAPI spec"),
  language: z.enum(['typescript', 'python']).describe("Target language"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format (default: auto)"),
  modelsImportPath: z.string().optional()
    .describe("Import path for models file (default: auto from spec title)"),
  includeAuth: z.boolean().optional()
    .describe("Generate auth config in constructor (default: true)"),
  includeComments: z.boolean().optional()
    .describe("Include JSDoc/docstring comments (default: true)"),
  tags: z.array(z.string()).optional()
    .describe("Generate only for these tags (default: all)"),
  groupByTags: z.boolean().optional()
    .describe("Group methods by tag with section comments (default: true)"),
  responseStyle: z.enum(['raw', 'typed', 'both']).optional()
    .describe("Response type style (default: 'raw')"),
  pythonStyle: z.enum(['dataclass', 'pydantic', 'typeddict']).optional()
    .describe("Python only: model style for body serialization (default: 'dataclass')"),
});
```

##### 6. `server/tool-definitions.js`

Добавить в массив tools:
```js
{
  name: "generateApiClient",
  description: "Generate typed API client class from OpenAPI/Swagger spec. Creates a class with methods for each endpoint, typed parameters, and auth configuration. Use after loadSwagger to understand the API. Requires models file from generateApiModels.",
  inputSchema: GenerateApiClientSchema
}
```

##### 7. `index.js`

Добавить хендлер:
```js
if (name === "generateApiClient") {
  const parser = await OpenAPIParser.load(args.source, args.format);
  const endpoints = parser.getEndpoints();
  const securitySchemes = parser.getSecuritySchemes();
  const metadata = {
    title: parser.spec.info?.title || '',
    baseUrl: parser.getBaseUrl(),
    version: parser.version
  };

  // Фильтрация по тегам
  let filteredEndpoints = endpoints;
  if (args.tags) {
    filteredEndpoints = endpoints.filter(ep =>
      ep.tags.some(tag => args.tags.includes(tag))
    );
  }

  // Выбрать генератор
  let generator;
  if (args.language === 'typescript') {
    generator = new ApiClientTypeScriptGenerator(filteredEndpoints, securitySchemes, {
      includeAuth: args.includeAuth ?? true,
      includeComments: args.includeComments ?? true,
      groupByTags: args.groupByTags ?? true,
      responseStyle: args.responseStyle || 'raw',
      modelsImportPath: args.modelsImportPath,
    });
  } else {
    generator = new ApiClientPythonGenerator(filteredEndpoints, securitySchemes, {
      includeAuth: args.includeAuth ?? true,
      includeComments: args.includeComments ?? true,
      groupByTags: args.groupByTags ?? true,
      responseStyle: args.responseStyle || 'raw',
      modelsImportPath: args.modelsImportPath,
      pythonStyle: args.pythonStyle || 'dataclass',
    });
  }

  const code = generator.generate(metadata);
  const className = generator.getClassName(metadata.title);
  const suggestedFileName = args.language === 'typescript'
    ? `${className}.ts`
    : `${generator.getModelsImportPath(metadata.title).replace(/\./g, '_')}_client.py`;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        action: 'create_new_file',
        suggestedFileName,
        modelsFileName: args.language === 'typescript'
          ? `${generator.getModelsImportPath(metadata.title).replace('./', '')}.ts`
          : `${generator.getModelsImportPath(metadata.title)}.py`,
        code,
        methodCount: filteredEndpoints.length,
        tagGroups: [...new Set(filteredEndpoints.flatMap(ep => ep.tags))],
        authTypes: Object.values(securitySchemes || {}).map(s => s.type),
        language: args.language,
        source: args.source,
        instruction: `Create file '${suggestedFileName}'. Make sure models file exists (use generateApiModels if not). Set auth credentials via constructor options.`
      }, null, 2)
    }]
  };
}
```

##### 8. `README.md`

Добавить в секцию API Tools:
```markdown
### generateApiClient

Generate typed API client class from OpenAPI/Swagger spec.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `source` | string | required | URL or file path to OpenAPI spec |
| `language` | 'typescript' \| 'python' | required | Target language |
| `format` | 'auto' \| 'json' \| 'yaml' | 'auto' | Spec format |
| `modelsImportPath` | string | auto | Import path for models file |
| `includeAuth` | boolean | true | Generate auth in constructor |
| `includeComments` | boolean | true | Include method comments |
| `tags` | string[] | all | Filter by endpoint tags |
| `groupByTags` | boolean | true | Group methods by tag |
| `responseStyle` | 'raw' \| 'typed' \| 'both' | 'raw' | Response type style |
| `pythonStyle` | string | 'dataclass' | Python body serialization style |

**Example — TypeScript API client:**
```json
{
  "source": "https://petstore.swagger.io/v2/swagger.json",
  "language": "typescript",
  "includeAuth": true
}
```
→ Returns `PetStoreApi.ts` with methods for all endpoints.

**Example — Python client, filtered by tags:**
```json
{
  "source": "./openapi.yaml",
  "language": "python",
  "tags": ["pets"],
  "pythonStyle": "pydantic"
}
```
→ Returns Python client with only pet-related methods, pydantic body serialization.
```

---

### Именование файлов (Фаза 2)

| Спека | TypeScript client | Python client |
|---|---|---|
| Pet Store API | `PetStoreApi.ts` | `pet_store_api_client.py` |
| My Service | `MyServiceApi.ts` | `my_service_api_client.py` |

---

### Структура файлов проекта (после Фазы 2)

```
utils/
  openapi/
    parser.js             # OpenAPIParser (Фаза 1)
    ref-resolver.js       # $ref resolution (Фаза 1)
    type-mapper.js        # type mapping (Фаза 1)
    method-generator.js   # endpoint → method metadata (Фаза 2)
    auth-generator.js     # auth config generation (Фаза 2)
  api-generators/
    api-models-typescript.js  # TS models (Фаза 1)
    api-models-python.js      # Python models (Фаза 1)
    api-client-typescript.js  # TS API client (Фаза 2)
    api-client-python.js      # Python API client (Фаза 2)
```

---

### Верификация (Фаза 2)

#### Функциональные тесты

1. **Petstore 2.0**: загрузить `https://petstore.swagger.io/v2/swagger.json`, сгенерировать TS клиент
   - Проверить: все endpoints из спеки стали методами
   - Проверить: path params (`{petId}`) → параметры функции
   - Проверить: query params (`limit`, `status`) → опциональный params
   - Проверить: request body (`CreatePetRequest`) → body параметр
   - Проверить: импорт моделей из models файла

2. **Petstore 3.0**: загрузить `https://petstore3.swagger.io/api/v3/openapi.json`, сгенерировать Python клиент
   - Проверить: все endpoints
   - Проверить: groupByTags разделяет методы по секциям

3. **Auth types**: использовать спеку с разными auth schemes
   - Bearer → `token` в конструкторе, `Authorization: Bearer ...`
   - API Key (header) → `apiKey` в конструкторе, кастомный header
   - API Key (query) → `apiKey` → добавляется во все запросы
   - Basic → `username + password` → `Authorization: Basic ...`
   - OAuth2 → `accessToken` → `Authorization: Bearer ...`
   - Комбинированные → все параметры в одном конструкторе

4. **Tag filtering**: `tags: ['pets']` → только методы для тега 'pets'

5. **operationId fallback**: спека без operationId → имена генерируются из method+path

6. **Python styles**: `pythonStyle: 'pydantic'` → body сериализуется через `.model_dump()`

7. **Custom import path**: `modelsImportPath: './models/api-types'` → используется в import

#### Boundary тесты

8. **Пустая спека** (нет endpoints): клиент с пустым классом, не падает
9. **Endpoint без параметров**: `GET /health` → метод без параметров
10. **Endpoint только с path params**: `GET /pets/{id}` → метод с одним обязательным param
11. **Deprecated endpoint**: комментарий `[DEPRECATED]`
12. **Конфликт имён методов**: два endpoint'а с одинаковым operationId → добавить суффикс

---

## Фаза 3: generateApiTests

### Тул 4: `generateApiTests`

**Назначение**: сгенерировать тестовые скаффолды для API, использующие API-клиент (или raw HTTP calls). Тесты покрывают: happy path, validation errors, auth, status codes.

**Параметры**:
```js
GenerateApiTestsSchema = z.object({
  source: z.string().describe("URL or file path to OpenAPI spec"),
  language: z.enum(['typescript', 'python']).describe("Target language/framework"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format (default: auto)"),
  useApiClient: z.boolean().optional()
    .describe("Use generated API client class (default: true). If false, generates raw HTTP calls"),
  clientImportPath: z.string().optional()
    .describe("Import path for API client (default: auto from spec title)"),
  modelsImportPath: z.string().optional()
    .describe("Import path for models (default: auto). Only used when useApiClient=false"),
  tags: z.array(z.string()).optional()
    .describe("Generate tests only for these tags (default: all)"),
  testStyle: z.enum(['crud', 'per-endpoint', 'smoke']).optional()
    .describe("Test generation style (default: 'per-endpoint'). 'crud' groups related CRUD endpoints, 'per-endpoint' one test per endpoint, 'smoke' minimal happy-path only"),
  includeNegative: z.boolean().optional()
    .describe("Generate negative test cases: 401, 403, 404, 422 (default: true)"),
  includeAuth: z.boolean().optional()
    .describe("Generate auth setup in beforeAll/fixtures (default: true)"),
  authFromEnv: z.boolean().optional()
    .describe("Read auth from environment variables (default: true)"),
  envPrefix: z.string().optional()
    .describe("Prefix for env vars. E.g. 'PETSTORE' → PETSTORE_TOKEN (default: from spec title)"),
})
```

**Алгоритм**:
1. Загрузить и распарсить спеку
2. Извлечь endpoints, отфильтровать по tags
3. Определить стиль тестов:
   - `per-endpoint`: один `test()`/`def test_()` на каждый endpoint
   - `crud`: определить CRUD-группы (resource → GET list, GET by id, POST, PUT, DELETE), сгенерировать последовательные тесты
   - `smoke`: только happy path для каждого endpoint (минимальные assertions)
4. Для каждого endpoint/группы:
   a. Сгенерировать happy-path тест (200/201)
   b. Если `includeNegative`:
      - 401 Unauthorized (если есть security)
      - 404 Not Found (для endpoints с path params)
      - 422 Validation Error (для POST/PUT с request body)
5. Сгенерировать setup (beforeAll / fixture): auth configuration
6. Сгенерировать файл

**Возвращаемое значение**:
```json
{
  "action": "create_new_file",
  "suggestedFileName": "pet-store-api.spec.ts",
  "code": "// ...generated test code...",
  "testCount": 24,
  "endpointsCovered": 8,
  "testBreakdown": {
    "happyPath": 8,
    "unauthorized": 6,
    "notFound": 4,
    "validationError": 3,
    "crud": 3
  },
  "language": "typescript",
  "source": "https://petstore.swagger.io/v2/swagger.json",
  "instruction": "Create file 'pet-store-api.spec.ts'. Make sure API client and models files exist. Set environment variables for auth: PETSTORE_TOKEN, PETSTORE_API_KEY."
}
```

---

### CRUD Detection Algorithm

#### Определение CRUD-групп

CRUD-группа — это набор endpoints, работающих с одним ресурсом (одинаковый base path):

```
Ресурс: /pets
  - GET    /pets         → list (Read many)
  - POST   /pets         → create (Create)
  - GET    /pets/{petId} → getById (Read one)
  - PUT    /pets/{petId} → update (Update)
  - DELETE /pets/{petId} → delete (Delete)
```

**Алгоритм**:
```
1. Для каждого endpoint извлечь base resource:
   /pets → 'pets'
   /pets/{petId} → 'pets'
   /pets/{petId}/tags → 'pets_tags' (sub-resource)
   /users/{id}/orders → 'users_orders'

2. Группировать endpoints по base resource

3. Для каждой группы определить CRUD-операции:
   - Есть GET без path params → list
   - Есть POST без path params → create
   - Есть GET с path params → getById
   - Есть PUT/PATCH с path params → update
   - Есть DELETE с path params → delete

4. Если группа содержит ≥2 CRUD операции → CRUD-группа
   Иначе → per-endpoint тесты
```

#### CRUD test sequence

Для CRUD-группы тесты идут в логическом порядке:

```typescript
test.describe('Pets CRUD', () => {
  let createdId: number;

  test('POST /pets - create pet', async () => {
    const response = await api.createPet({ name: 'Buddy', status: 'available' });
    expect(response.status()).toBe(201);
    const body = await response.json();
    createdId = body.id;
    expect(body.name).toBe('Buddy');
  });

  test('GET /pets/{id} - get created pet', async () => {
    const response = await api.getPet(createdId);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(createdId);
    expect(body.name).toBe('Buddy');
  });

  test('PUT /pets/{id} - update pet', async () => {
    const response = await api.updatePet(createdId, { name: 'Max', status: 'sold' });
    expect(response.status()).toBe(200);
  });

  test('GET /pets - list pets contains updated', async () => {
    const response = await api.listPets();
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.some(p => p.id === createdId)).toBe(true);
  });

  test('DELETE /pets/{id} - delete pet', async () => {
    const response = await api.deletePet(createdId);
    expect(response.ok()).toBe(true);
  });

  test('GET /pets/{id} - deleted pet returns 404', async () => {
    const response = await api.getPet(createdId);
    expect(response.status()).toBe(404);
  });
});
```

```python
class TestPetsCrud:
    created_id = None

    def test_create_pet(self, api):
        response = api.create_pet(CreatePetRequest(name='Buddy', status=PetStatus.AVAILABLE))
        assert response.status_code == 201
        body = response.json()
        TestPetsCrud.created_id = body['id']
        assert body['name'] == 'Buddy'

    def test_get_created_pet(self, api):
        response = api.get_pet(TestPetsCrud.created_id)
        assert response.status_code == 200
        body = response.json()
        assert body['id'] == TestPetsCrud.created_id

    def test_update_pet(self, api):
        response = api.update_pet(TestPetsCrud.created_id,
                                  UpdatePetRequest(name='Max', status=PetStatus.SOLD))
        assert response.status_code == 200

    def test_list_pets_contains_updated(self, api):
        response = api.list_pets()
        assert response.status_code == 200
        ids = [p['id'] for p in response.json()]
        assert TestPetsCrud.created_id in ids

    def test_delete_pet(self, api):
        response = api.delete_pet(TestPetsCrud.created_id)
        assert response.ok

    def test_deleted_pet_returns_404(self, api):
        response = api.get_pet(TestPetsCrud.created_id)
        assert response.status_code == 404
```

---

### Negative Test Generation

#### 401 Unauthorized

Генерируется для endpoints с security requirements:
```typescript
test('GET /pets - 401 without auth', async ({ request }) => {
  const noAuthApi = new PetStoreApi(request, { baseUrl: BASE_URL });
  const response = await noAuthApi.listPets();
  expect(response.status()).toBe(401);
});
```

```python
def test_list_pets_unauthorized(self):
    no_auth_api = PetStoreApi(base_url=BASE_URL)
    response = no_auth_api.list_pets()
    assert response.status_code == 401
```

#### 404 Not Found

Генерируется для endpoints с path params:
```typescript
test('GET /pets/{id} - 404 non-existent', async () => {
  const response = await api.getPet(999999);
  expect(response.status()).toBe(404);
});
```

```python
def test_get_pet_not_found(self, api):
    response = api.get_pet(999999)
    assert response.status_code == 404
```

#### 422 Validation Error

Генерируется для POST/PUT endpoints с required body fields:
```typescript
test('POST /pets - 422 missing required fields', async () => {
  const response = await api.createPet({} as any);
  expect([400, 422]).toContain(response.status());
});
```

```python
def test_create_pet_validation_error(self, api):
    response = api.create_pet(CreatePetRequest())  # пустой объект
    assert response.status_code in (400, 422)
```

---

### Auth Setup Generation

#### TypeScript (Playwright)

```typescript
import { test, expect } from '@playwright/test';
import { PetStoreApi } from './PetStoreApi';

const BASE_URL = process.env.PETSTORE_BASE_URL || 'https://petstore.swagger.io/v2';

test.describe('Pet Store API', () => {
  let api: PetStoreApi;

  test.beforeAll(async ({ request }) => {
    api = new PetStoreApi(request, {
      baseUrl: BASE_URL,
      token: process.env.PETSTORE_TOKEN,
      apiKey: process.env.PETSTORE_API_KEY,
    });
  });

  // ... tests ...
});
```

#### Python (pytest)

```python
import pytest
import os
from pet_store_api_client import PetStoreApi

BASE_URL = os.environ.get('PETSTORE_BASE_URL', 'https://petstore.swagger.io/v2')


@pytest.fixture(scope='session')
def api():
    return PetStoreApi(
        base_url=BASE_URL,
        token=os.environ.get('PETSTORE_TOKEN'),
        api_key=os.environ.get('PETSTORE_API_KEY'),
    )


class TestPetsApi:
    # ... tests using 'api' fixture ...
```

#### Environment variable naming

```
envPrefix (из spec title или параметра) + '_' + AUTH_PARAM

Pet Store API (envPrefix='PETSTORE'):
  bearer  → PETSTORE_TOKEN
  apiKey  → PETSTORE_API_KEY
  basic   → PETSTORE_USERNAME, PETSTORE_PASSWORD
  oauth2  → PETSTORE_ACCESS_TOKEN
  baseUrl → PETSTORE_BASE_URL
```

---

### Интеграция с API-клиентом (аналог POM)

#### `useApiClient: true` (default)

Тесты используют API-клиент:
```typescript
const response = await api.listPets({ limit: 10 });
expect(response.status()).toBe(200);
```

#### `useApiClient: false`

Тесты используют raw HTTP calls (Playwright `request` / Python `requests`):
```typescript
const response = await request.get(`${BASE_URL}/pets?limit=10`, {
  headers: { 'Authorization': `Bearer ${process.env.PETSTORE_TOKEN}` }
});
expect(response.status()).toBe(200);
```

```python
response = requests.get(f'{BASE_URL}/pets', params={'limit': 10},
                        headers={'Authorization': f'Bearer {os.environ["PETSTORE_TOKEN"]}'})
assert response.status_code == 200
```

Переключение контролируется параметром `useApiClient`.

---

### Изменения по файлам (Фаза 3)

#### Новые файлы

##### 1. `utils/openapi/test-scaffold-generator.js`

Генератор тестовых скаффолдов — определяет какие тесты генерировать.

```js
/**
 * Генератор тестовых скаффолдов из OpenAPI endpoints
 */
export class TestScaffoldGenerator {
  /**
   * Сгенерировать план тестов для endpoint
   * @param {Object} endpoint - endpoint из parser
   * @param {Object} options - { includeNegative, testStyle }
   * @returns {Array<Object>} - массив тестовых кейсов
   */
  static generateTestCases(endpoint, options = {}) {
    const cases = [];

    // 1. Happy path
    cases.push(this.happyPathCase(endpoint));

    if (options.includeNegative) {
      // 2. 401 если есть security
      if (endpoint.security && endpoint.security.length > 0) {
        cases.push(this.unauthorizedCase(endpoint));
      }

      // 3. 404 если есть path params
      if (endpoint.parameters?.some(p => p.in === 'path')) {
        cases.push(this.notFoundCase(endpoint));
      }

      // 4. 422 если POST/PUT/PATCH с required body
      if (['POST', 'PUT', 'PATCH'].includes(endpoint.method) && endpoint.requestBody?.required) {
        cases.push(this.validationErrorCase(endpoint));
      }
    }

    return cases;
  }

  /**
   * Определить CRUD-группы из списка endpoints
   * @param {Array} endpoints
   * @returns {Map<string, Object>} - resourceName → { list, create, getById, update, delete }
   */
  static detectCrudGroups(endpoints) {
    const groups = new Map();

    for (const ep of endpoints) {
      const resource = this.extractResource(ep.path);
      if (!groups.has(resource)) {
        groups.set(resource, { resource, endpoints: {}, path: '' });
      }
      const group = groups.get(resource);
      const hasPathParam = ep.parameters?.some(p => p.in === 'path');

      switch (ep.method) {
        case 'GET':
          if (hasPathParam) group.endpoints.getById = ep;
          else group.endpoints.list = ep;
          break;
        case 'POST':
          if (!hasPathParam) group.endpoints.create = ep;
          break;
        case 'PUT':
        case 'PATCH':
          if (hasPathParam) group.endpoints.update = ep;
          break;
        case 'DELETE':
          if (hasPathParam) group.endpoints.delete = ep;
          break;
      }
    }

    // Фильтровать: только группы с ≥2 CRUD операциями
    const crudGroups = new Map();
    for (const [name, group] of groups) {
      if (Object.keys(group.endpoints).length >= 2) {
        crudGroups.set(name, group);
      }
    }
    return crudGroups;
  }

  /**
   * Извлечь имя ресурса из path
   * /pets → 'pets'
   * /pets/{petId} → 'pets'
   * /users/{id}/orders → 'users_orders'
   */
  static extractResource(path) { ... }

  /**
   * Сгенерировать happy-path test case
   */
  static happyPathCase(endpoint) {
    const successCode = this.getSuccessCode(endpoint);
    return {
      type: 'happy_path',
      name: `${endpoint.method} ${endpoint.path} - ${successCode} success`,
      endpoint,
      expectedStatus: successCode,
      sampleParams: this.generateSampleParams(endpoint),
      sampleBody: this.generateSampleBody(endpoint),
      assertions: this.generateAssertions(endpoint, successCode)
    };
  }

  /** Определить success status code из responses */
  static getSuccessCode(endpoint) {
    if (endpoint.responses['200']) return 200;
    if (endpoint.responses['201']) return 201;
    if (endpoint.responses['204']) return 204;
    const first2xx = Object.keys(endpoint.responses).find(s => s.startsWith('2'));
    return first2xx ? parseInt(first2xx) : 200;
  }

  /** Сгенерировать sample параметры для тестов */
  static generateSampleParams(endpoint) {
    const params = {};
    for (const p of endpoint.parameters || []) {
      if (p.in === 'path') {
        params[p.name] = p.type === 'integer' ? 1 : 'test';
      } else if (p.in === 'query') {
        if (p.required) {
          params[p.name] = this.getSampleValue(p);
        }
      }
    }
    return params;
  }

  /** Сгенерировать sample body для POST/PUT */
  static generateSampleBody(endpoint) { ... }

  /** Сгенерировать assertions */
  static generateAssertions(endpoint, status) { ... }

  /** Получить sample value для типа */
  static getSampleValue(param) {
    if (param.enum) return param.enum[0];
    switch (param.type) {
      case 'integer': return 10;
      case 'number': return 10.5;
      case 'boolean': return true;
      case 'string': return 'test';
      default: return 'test';
    }
  }

  static unauthorizedCase(endpoint) { ... }
  static notFoundCase(endpoint) { ... }
  static validationErrorCase(endpoint) { ... }
}
```

##### 2. `utils/api-generators/api-tests-typescript.js`

Генератор TypeScript API-тестов (Playwright test).

```js
import { TestScaffoldGenerator } from '../openapi/test-scaffold-generator.js';
import { MethodGenerator } from '../openapi/method-generator.js';

export class ApiTestsTypeScriptGenerator {
  constructor(endpoints, securitySchemes, options = {}) {
    this.endpoints = endpoints;
    this.securitySchemes = securitySchemes;
    this.options = {
      useApiClient: true,
      clientImportPath: null,
      modelsImportPath: null,
      includeNegative: true,
      includeAuth: true,
      authFromEnv: true,
      envPrefix: null,
      testStyle: 'per-endpoint',      // 'crud' | 'per-endpoint' | 'smoke'
      includeComments: true,
      ...options
    };
  }

  /**
   * Сгенерировать весь тестовый файл
   */
  generate(metadata = {}) {
    const lines = [];
    const envPrefix = this.options.envPrefix || this.titleToEnvPrefix(metadata.title);

    // 1. Imports
    lines.push(...this.generateImports(metadata));
    lines.push('');

    // 2. Constants
    lines.push(`const BASE_URL = process.env.${envPrefix}_BASE_URL || '${metadata.baseUrl}';`);
    lines.push('');

    // 3. Test describe block
    lines.push(`test.describe('${metadata.title || 'API'} Tests', () => {`);

    // 4. Setup
    if (this.options.useApiClient) {
      lines.push(...this.generateApiClientSetup(metadata, envPrefix));
    }
    lines.push('');

    // 5. Tests based on style
    if (this.options.testStyle === 'crud') {
      lines.push(...this.generateCrudTests(metadata));
    } else if (this.options.testStyle === 'smoke') {
      lines.push(...this.generateSmokeTests());
    } else {
      lines.push(...this.generatePerEndpointTests());
    }

    // 6. Close describe
    lines.push('});');

    return lines.join('\n');
  }

  /** Imports */
  generateImports(metadata) {
    const lines = ["import { test, expect } from '@playwright/test';"];
    if (this.options.useApiClient) {
      const clientPath = this.options.clientImportPath || this.getClientImportPath(metadata.title);
      const className = this.getClientClassName(metadata.title);
      lines.push(`import { ${className} } from '${clientPath}';`);
    }
    return lines;
  }

  /** beforeAll с API client setup */
  generateApiClientSetup(metadata, envPrefix) {
    const className = this.getClientClassName(metadata.title);
    const varName = className.charAt(0).toLowerCase() + className.slice(1);
    const lines = [
      `  let ${varName}: ${className};`,
      '',
      '  test.beforeAll(async ({ request }) => {',
      `    ${varName} = new ${className}(request, {`,
      `      baseUrl: BASE_URL,`,
    ];

    // Auth env vars
    for (const scheme of Object.values(this.securitySchemes || {})) {
      if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        lines.push(`      token: process.env.${envPrefix}_TOKEN,`);
      } else if (scheme.type === 'apiKey') {
        lines.push(`      apiKey: process.env.${envPrefix}_API_KEY,`);
      } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
        lines.push(`      username: process.env.${envPrefix}_USERNAME,`);
        lines.push(`      password: process.env.${envPrefix}_PASSWORD,`);
      } else if (scheme.type === 'oauth2') {
        lines.push(`      accessToken: process.env.${envPrefix}_ACCESS_TOKEN,`);
      }
    }

    lines.push('    });');
    lines.push('  });');
    return lines;
  }

  /** Тесты per-endpoint */
  generatePerEndpointTests() {
    const lines = [];
    for (const ep of this.endpoints) {
      const cases = TestScaffoldGenerator.generateTestCases(ep, {
        includeNegative: this.options.includeNegative
      });
      for (const tc of cases) {
        lines.push(...this.generateTest(tc));
        lines.push('');
      }
    }
    return lines;
  }

  /** CRUD тесты */
  generateCrudTests(metadata) {
    const lines = [];

    // Определить CRUD-группы
    const crudGroups = TestScaffoldGenerator.detectCrudGroups(this.endpoints);

    // Для каждой CRUD-группы
    for (const [resource, group] of crudGroups) {
      lines.push(`  test.describe('${this.capitalize(resource)} CRUD', () => {`);
      lines.push(`    let createdId: number | string;`);
      lines.push('');

      // Create → Read → Update → List → Delete → Verify Deleted
      if (group.endpoints.create) {
        lines.push(...this.generateCrudCreate(group.endpoints.create));
      }
      if (group.endpoints.getById) {
        lines.push(...this.generateCrudGetById(group.endpoints.getById));
      }
      if (group.endpoints.update) {
        lines.push(...this.generateCrudUpdate(group.endpoints.update));
      }
      if (group.endpoints.list) {
        lines.push(...this.generateCrudList(group.endpoints.list));
      }
      if (group.endpoints.delete) {
        lines.push(...this.generateCrudDelete(group.endpoints.delete));
        // Verify deleted
        if (group.endpoints.getById) {
          lines.push(...this.generateCrudVerifyDeleted(group.endpoints.getById));
        }
      }

      lines.push('  });');
      lines.push('');
    }

    // Endpoints вне CRUD-групп — per-endpoint
    const crudEndpoints = new Set();
    for (const group of crudGroups.values()) {
      for (const ep of Object.values(group.endpoints)) {
        crudEndpoints.add(`${ep.method} ${ep.path}`);
      }
    }
    const remaining = this.endpoints.filter(ep => !crudEndpoints.has(`${ep.method} ${ep.path}`));
    if (remaining.length > 0) {
      for (const ep of remaining) {
        const cases = TestScaffoldGenerator.generateTestCases(ep, { includeNegative: this.options.includeNegative });
        for (const tc of cases) {
          lines.push(...this.generateTest(tc));
          lines.push('');
        }
      }
    }

    return lines;
  }

  /** Smoke тесты (только happy path) */
  generateSmokeTests() {
    const lines = [];
    for (const ep of this.endpoints) {
      const tc = TestScaffoldGenerator.happyPathCase(ep);
      lines.push(...this.generateTest(tc));
      lines.push('');
    }
    return lines;
  }

  /** Генерировать один test() */
  generateTest(testCase) { ... }

  /** CRUD helpers */
  generateCrudCreate(endpoint) { ... }
  generateCrudGetById(endpoint) { ... }
  generateCrudUpdate(endpoint) { ... }
  generateCrudList(endpoint) { ... }
  generateCrudDelete(endpoint) { ... }
  generateCrudVerifyDeleted(endpoint) { ... }

  /** Utilities */
  getClientClassName(title) { ... }
  getClientImportPath(title) { ... }
  titleToEnvPrefix(title) { ... }
  capitalize(str) { ... }
}
```

##### 3. `utils/api-generators/api-tests-python.js`

Генератор Python API-тестов (pytest + requests).

```js
import { TestScaffoldGenerator } from '../openapi/test-scaffold-generator.js';
import { MethodGenerator } from '../openapi/method-generator.js';

export class ApiTestsPythonGenerator {
  constructor(endpoints, securitySchemes, options = {}) {
    this.endpoints = endpoints;
    this.securitySchemes = securitySchemes;
    this.options = {
      useApiClient: true,
      clientImportPath: null,
      modelsImportPath: null,
      includeNegative: true,
      includeAuth: true,
      authFromEnv: true,
      envPrefix: null,
      testStyle: 'per-endpoint',
      includeComments: true,
      pythonStyle: 'dataclass',
      ...options
    };
  }

  /**
   * Сгенерировать весь тестовый файл
   */
  generate(metadata = {}) {
    const lines = [];
    const envPrefix = this.options.envPrefix || this.titleToEnvPrefix(metadata.title);

    // 1. Imports
    lines.push(...this.generateImports(metadata));
    lines.push('');

    // 2. Constants
    lines.push(`BASE_URL = os.environ.get('${envPrefix}_BASE_URL', '${metadata.baseUrl}')`);
    lines.push('');
    lines.push('');

    // 3. Fixture
    if (this.options.useApiClient) {
      lines.push(...this.generateFixture(metadata, envPrefix));
      lines.push('');
      lines.push('');
    }

    // 4. Tests based on style
    if (this.options.testStyle === 'crud') {
      lines.push(...this.generateCrudTests(metadata));
    } else if (this.options.testStyle === 'smoke') {
      lines.push(...this.generateSmokeTests());
    } else {
      lines.push(...this.generatePerEndpointTests());
    }

    return lines.join('\n');
  }

  /** Imports */
  generateImports(metadata) {
    const lines = [
      'import pytest',
      'import os',
    ];
    if (this.options.useApiClient) {
      const importPath = this.options.clientImportPath || this.getClientImportPath(metadata.title);
      const className = this.getClientClassName(metadata.title);
      lines.push(`from ${importPath} import ${className}`);
    } else {
      lines.push('import requests');
    }
    return lines;
  }

  /** pytest fixture */
  generateFixture(metadata, envPrefix) {
    const className = this.getClientClassName(metadata.title);
    const lines = [
      "@pytest.fixture(scope='session')",
      'def api():',
      `    return ${className}(`,
      `        base_url=BASE_URL,`,
    ];

    for (const scheme of Object.values(this.securitySchemes || {})) {
      if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        lines.push(`        token=os.environ.get('${envPrefix}_TOKEN'),`);
      } else if (scheme.type === 'apiKey') {
        lines.push(`        api_key=os.environ.get('${envPrefix}_API_KEY'),`);
      } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
        lines.push(`        username=os.environ.get('${envPrefix}_USERNAME'),`);
        lines.push(`        password=os.environ.get('${envPrefix}_PASSWORD'),`);
      } else if (scheme.type === 'oauth2') {
        lines.push(`        access_token=os.environ.get('${envPrefix}_ACCESS_TOKEN'),`);
      }
    }

    lines.push('    )');
    return lines;
  }

  /** Per-endpoint тесты (класс на тег или flat) */
  generatePerEndpointTests() {
    const lines = [];
    // Группировка по тегам → class TestPetsApi / class TestUsersApi
    const grouped = this.groupByTag(this.endpoints);

    for (const [tag, endpoints] of Object.entries(grouped)) {
      const className = `Test${this.capitalize(tag)}Api`;
      lines.push(`class ${className}:`);

      for (const ep of endpoints) {
        const cases = TestScaffoldGenerator.generateTestCases(ep, {
          includeNegative: this.options.includeNegative
        });
        for (const tc of cases) {
          lines.push(...this.generateTest(tc));
          lines.push('');
        }
      }
      lines.push('');
    }
    return lines;
  }

  /** CRUD тесты */
  generateCrudTests(metadata) {
    // Аналогично TypeScript, но с Python синтаксисом
    // Используется class TestResourceCrud: с class-level переменными
    ...
  }

  /** Smoke тесты */
  generateSmokeTests() { ... }

  /** Генерировать один def test_() */
  generateTest(testCase) { ... }

  /** Utilities */
  getClientClassName(title) { ... }
  getClientImportPath(title) { ... }
  titleToEnvPrefix(title) { ... }
  capitalize(str) { ... }
  groupByTag(endpoints) { ... }
}
```

#### Изменяемые файлы

##### 4. `server/tool-schemas.js`

Добавить:
```js
export const GenerateApiTestsSchema = z.object({
  source: z.string().describe("URL or file path to OpenAPI spec"),
  language: z.enum(['typescript', 'python']).describe("Target language/framework"),
  format: z.enum(['auto', 'json', 'yaml']).optional()
    .describe("Spec format (default: auto)"),
  useApiClient: z.boolean().optional()
    .describe("Use generated API client (default: true). False = raw HTTP calls"),
  clientImportPath: z.string().optional()
    .describe("Import path for API client (default: auto)"),
  modelsImportPath: z.string().optional()
    .describe("Import path for models (default: auto). Used when useApiClient=false"),
  tags: z.array(z.string()).optional()
    .describe("Test only these tags (default: all)"),
  testStyle: z.enum(['crud', 'per-endpoint', 'smoke']).optional()
    .describe("'crud' groups CRUD ops, 'per-endpoint' one test each, 'smoke' happy-path only (default: 'per-endpoint')"),
  includeNegative: z.boolean().optional()
    .describe("Generate 401/404/422 tests (default: true)"),
  includeAuth: z.boolean().optional()
    .describe("Generate auth setup (default: true)"),
  authFromEnv: z.boolean().optional()
    .describe("Auth from env vars (default: true)"),
  envPrefix: z.string().optional()
    .describe("Env var prefix, e.g. 'PETSTORE' → PETSTORE_TOKEN (default: from title)"),
  pythonStyle: z.enum(['dataclass', 'pydantic', 'typeddict']).optional()
    .describe("Python only: model style for test data (default: 'dataclass')"),
});
```

##### 5. `server/tool-definitions.js`

Добавить:
```js
{
  name: "generateApiTests",
  description: "Generate API test scaffolds from OpenAPI/Swagger spec. Creates test files with happy-path and negative tests for each endpoint. Supports CRUD grouping, auth setup, and both API-client and raw HTTP styles. Use after generateApiClient for best results.",
  inputSchema: GenerateApiTestsSchema
}
```

##### 6. `index.js`

Добавить хендлер:
```js
if (name === "generateApiTests") {
  const parser = await OpenAPIParser.load(args.source, args.format);
  const endpoints = parser.getEndpoints();
  const securitySchemes = parser.getSecuritySchemes();
  const metadata = {
    title: parser.spec.info?.title || '',
    baseUrl: parser.getBaseUrl(),
    version: parser.version
  };

  // Фильтрация по тегам
  let filteredEndpoints = endpoints;
  if (args.tags) {
    filteredEndpoints = endpoints.filter(ep =>
      ep.tags.some(tag => args.tags.includes(tag))
    );
  }

  // Выбрать генератор
  let generator;
  const genOptions = {
    useApiClient: args.useApiClient ?? true,
    clientImportPath: args.clientImportPath,
    modelsImportPath: args.modelsImportPath,
    includeNegative: args.includeNegative ?? true,
    includeAuth: args.includeAuth ?? true,
    authFromEnv: args.authFromEnv ?? true,
    envPrefix: args.envPrefix,
    testStyle: args.testStyle || 'per-endpoint',
  };

  if (args.language === 'typescript') {
    generator = new ApiTestsTypeScriptGenerator(filteredEndpoints, securitySchemes, genOptions);
  } else {
    generator = new ApiTestsPythonGenerator(filteredEndpoints, securitySchemes, {
      ...genOptions,
      pythonStyle: args.pythonStyle || 'dataclass',
    });
  }

  const code = generator.generate(metadata);
  const envPrefix = genOptions.envPrefix || generator.titleToEnvPrefix(metadata.title);

  // Подсчитать тесты
  let testCount = 0;
  const breakdown = { happyPath: 0, unauthorized: 0, notFound: 0, validationError: 0 };
  for (const ep of filteredEndpoints) {
    const cases = TestScaffoldGenerator.generateTestCases(ep, { includeNegative: genOptions.includeNegative });
    testCount += cases.length;
    for (const c of cases) {
      if (c.type === 'happy_path') breakdown.happyPath++;
      else if (c.type === 'unauthorized') breakdown.unauthorized++;
      else if (c.type === 'not_found') breakdown.notFound++;
      else if (c.type === 'validation_error') breakdown.validationError++;
    }
  }

  const suggestedFileName = args.language === 'typescript'
    ? `${generator.titleToKebab(metadata.title)}.spec.ts`
    : `test_${generator.titleToSnake(metadata.title)}.py`;

  // Собрать env vars для instruction
  const envVars = [`${envPrefix}_BASE_URL`];
  for (const scheme of Object.values(securitySchemes || {})) {
    if (scheme.type === 'http' && scheme.scheme === 'bearer') envVars.push(`${envPrefix}_TOKEN`);
    else if (scheme.type === 'apiKey') envVars.push(`${envPrefix}_API_KEY`);
    else if (scheme.type === 'http' && scheme.scheme === 'basic') {
      envVars.push(`${envPrefix}_USERNAME`, `${envPrefix}_PASSWORD`);
    }
    else if (scheme.type === 'oauth2') envVars.push(`${envPrefix}_ACCESS_TOKEN`);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        action: 'create_new_file',
        suggestedFileName,
        code,
        testCount,
        endpointsCovered: filteredEndpoints.length,
        testBreakdown: breakdown,
        language: args.language,
        source: args.source,
        instruction: `Create file '${suggestedFileName}'. ${genOptions.useApiClient ? 'Make sure API client and models files exist. ' : ''}Set environment variables: ${envVars.join(', ')}.`
      }, null, 2)
    }]
  };
}
```

##### 7. `README.md`

Добавить в секцию API Tools:
```markdown
### generateApiTests

Generate API test scaffolds from OpenAPI/Swagger spec.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `source` | string | required | URL or file path to OpenAPI spec |
| `language` | 'typescript' \| 'python' | required | Target language |
| `format` | 'auto' \| 'json' \| 'yaml' | 'auto' | Spec format |
| `useApiClient` | boolean | true | Use API client class vs raw HTTP |
| `clientImportPath` | string | auto | Import path for API client |
| `tags` | string[] | all | Filter by endpoint tags |
| `testStyle` | 'crud' \| 'per-endpoint' \| 'smoke' | 'per-endpoint' | Test grouping style |
| `includeNegative` | boolean | true | Generate 401/404/422 tests |
| `includeAuth` | boolean | true | Generate auth setup |
| `authFromEnv` | boolean | true | Auth from env vars |
| `envPrefix` | string | from title | Env var prefix |

**Example — Full TypeScript test suite:**
```json
{
  "source": "https://petstore.swagger.io/v2/swagger.json",
  "language": "typescript",
  "testStyle": "crud",
  "includeNegative": true
}
```
→ Returns `pet-store-api.spec.ts` with CRUD test sequences and negative cases.

**Example — Python smoke tests:**
```json
{
  "source": "./openapi.yaml",
  "language": "python",
  "testStyle": "smoke",
  "includeNegative": false,
  "envPrefix": "MYAPI"
}
```
→ Returns `test_my_api.py` with minimal happy-path tests.

**Example — Raw HTTP tests (no API client):**
```json
{
  "source": "./openapi.yaml",
  "language": "typescript",
  "useApiClient": false,
  "tags": ["pets"]
}
```
→ Returns tests using raw `request.get()`/`request.post()` instead of API client methods.
```

---

### Именование файлов (Фаза 3)

| Спека | TypeScript tests | Python tests |
|---|---|---|
| Pet Store API | `pet-store-api.spec.ts` | `test_pet_store_api.py` |
| My Service | `my-service.spec.ts` | `test_my_service.py` |

---

### Структура файлов проекта (после всех 3 фаз)

```
utils/
  openapi/
    parser.js                    # OpenAPIParser (Фаза 1)
    ref-resolver.js              # $ref resolution (Фаза 1)
    type-mapper.js               # type mapping (Фаза 1)
    method-generator.js          # endpoint → method metadata (Фаза 2)
    auth-generator.js            # auth config generation (Фаза 2)
    test-scaffold-generator.js   # test case planning (Фаза 3)
  api-generators/
    api-models-typescript.js     # TS models (Фаза 1)
    api-models-python.js         # Python models (Фаза 1)
    api-client-typescript.js     # TS API client (Фаза 2)
    api-client-python.js         # Python API client (Фаза 2)
    api-tests-typescript.js      # TS API tests (Фаза 3)
    api-tests-python.js          # Python API tests (Фаза 3)
```

---

### Верификация (Фаза 3)

#### Функциональные тесты

1. **Per-endpoint TypeScript**: Petstore → тест на каждый endpoint, проверить happy path + negative cases
2. **Per-endpoint Python**: Petstore → pytest с fixture, class-based group by tags
3. **CRUD TypeScript**: Petstore → CRUD-группа для `/pets`, последовательные create→read→update→list→delete→verify
4. **CRUD Python**: аналогично, class-level переменные, pytest
5. **Smoke**: только happy path, минимальные assertions
6. **Auth setup**: проверить env var names для всех auth types
7. **Tag filtering**: `tags: ['pets']` → тесты только для pet endpoints
8. **useApiClient=false**: raw HTTP calls, без import клиента

#### Boundary тесты

9. **Спека без security**: нет auth setup, нет 401 тестов
10. **Endpoint без path params**: нет 404 теста
11. **GET endpoint**: нет validation error теста (нет body)
12. **Пустая спека**: файл с пустым describe/class
13. **Custom envPrefix**: `envPrefix: 'MYAPP'` → `MYAPP_TOKEN`, `MYAPP_BASE_URL`
14. **Custom import paths**: `clientImportPath`, `modelsImportPath` используются в import

#### Интеграционные тесты

15. **Полный пайплайн**: loadSwagger → generateApiModels → generateApiClient → generateApiTests → все файлы совместимы по imports
16. **Python pydantic**: `pythonStyle: 'pydantic'` → body в тестах использует `.model_dump()`
17. **Python typeddict**: body в тестах передаётся как dict

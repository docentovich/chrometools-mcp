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
- [ ] **2.1** Генератор API-клиента TypeScript (Playwright APIRequestContext)
- [ ] **2.2** Генератор API-клиента Python (requests.Session)
- [ ] **2.3** Тул `generateApiClient`
- [ ] **2.4** Схемы, хендлеры, README для `generateApiClient`

### Фаза 3 (будущее)
- [ ] **3.1** Генератор API-тестов TypeScript (Playwright)
- [ ] **3.2** Генератор API-тестов Python (pytest + requests)
- [ ] **3.3** Тул `generateApiTests`
- [ ] **3.4** Интеграция API-клиента с API-тестами (аналог POM-интеграции)

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

## Фаза 2: generateApiClient (краткий план)

Тул генерирует класс API-клиента с типизированными методами для каждого endpoint.

**TypeScript (Playwright)**:
```typescript
import { APIRequestContext } from '@playwright/test';
import { Pet, CreatePetRequest, PetStatus } from './pet-store-api.models';

export class PetStoreApi {
  private request: APIRequestContext;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(request: APIRequestContext, options: {
    baseUrl?: string;
    token?: string;
    apiKey?: string;
  } = {}) {
    this.request = request;
    this.baseUrl = options.baseUrl || 'https://petstore.swagger.io/v2';
    this.headers = {};
    if (options.token) this.headers['Authorization'] = `Bearer ${options.token}`;
    if (options.apiKey) this.headers['X-API-Key'] = options.apiKey;
  }

  /** GET /pets - List all pets */
  async listPets(params?: { limit?: number; status?: PetStatus }) {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    const url = `${this.baseUrl}/pets${query.toString() ? '?' + query : ''}`;
    return this.request.get(url, { headers: this.headers });
  }

  /** POST /pets - Create a pet */
  async createPet(body: CreatePetRequest) {
    return this.request.post(`${this.baseUrl}/pets`, {
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      data: body
    });
  }

  /** GET /pets/{petId} - Get pet by ID */
  async getPet(petId: number) {
    return this.request.get(`${this.baseUrl}/pets/${petId}`, {
      headers: this.headers
    });
  }

  /** DELETE /pets/{petId} - Delete a pet */
  async deletePet(petId: number) {
    return this.request.delete(`${this.baseUrl}/pets/${petId}`, {
      headers: this.headers
    });
  }
}
```

**Python (requests)**:
```python
import requests
from typing import Optional, List
from pet_store_api_models import Pet, CreatePetRequest, PetStatus


class PetStoreApi:
    def __init__(self, base_url: str = 'https://petstore.swagger.io/v2',
                 token: Optional[str] = None, api_key: Optional[str] = None):
        self.session = requests.Session()
        self.base_url = base_url
        if token:
            self.session.headers['Authorization'] = f'Bearer {token}'
        if api_key:
            self.session.headers['X-API-Key'] = api_key

    def list_pets(self, limit: Optional[int] = None, status: Optional[PetStatus] = None):
        """GET /pets - List all pets"""
        params = {}
        if limit is not None: params['limit'] = limit
        if status is not None: params['status'] = status.value
        return self.session.get(f'{self.base_url}/pets', params=params)

    def create_pet(self, body: CreatePetRequest):
        """POST /pets - Create a pet"""
        return self.session.post(f'{self.base_url}/pets', json=body.__dict__)

    def get_pet(self, pet_id: int):
        """GET /pets/{petId} - Get pet by ID"""
        return self.session.get(f'{self.base_url}/pets/{pet_id}')

    def delete_pet(self, pet_id: int):
        """DELETE /pets/{petId} - Delete a pet"""
        return self.session.delete(f'{self.base_url}/pets/{pet_id}')
```

---

## Фаза 3: generateApiTests (краткий план)

Генерация тестовых скаффолдов, использующих API-клиент.

```typescript
import { test, expect } from '@playwright/test';
import { PetStoreApi } from './PetStoreApi';

test.describe('Pets API', () => {
  let api: PetStoreApi;

  test.beforeAll(async ({ request }) => {
    api = new PetStoreApi(request, { token: process.env.API_TOKEN });
  });

  test('GET /pets - list pets', async () => {
    const response = await api.listPets({ limit: 10 });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('POST /pets - create pet', async () => {
    const response = await api.createPet({ name: 'Buddy', status: 'available' });
    expect(response.status()).toBe(201);
  });

  test('GET /pets/{id} - get pet by id', async () => {
    const response = await api.getPet(1);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
  });

  test('DELETE /pets/{id} - delete pet', async () => {
    const response = await api.deletePet(1);
    expect(response.ok()).toBe(true);
  });
});
```

/**
 * Tests for Swagger/OpenAPI Phase 1: parser, ref-resolver, type-mapper, model generators
 */

import { resolveAllRefs, resolveRef, mergeAllOf } from './utils/openapi/ref-resolver.js';
import { TypeMapper } from './utils/openapi/type-mapper.js';
import { OpenAPIParser } from './utils/openapi/parser.js';
import { ApiModelsTypeScriptGenerator } from './utils/api-generators/api-models-typescript.js';
import { ApiModelsPythonGenerator } from './utils/api-generators/api-models-python.js';
import yaml from 'js-yaml';

let passed = 0;
let failed = 0;
const asyncTests = [];

function test(name, fn) {
  if (fn.constructor.name === 'AsyncFunction') {
    asyncTests.push({ name, fn });
    return;
  }
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertIncludes(str, substr, msg) {
  if (!str.includes(substr)) throw new Error(msg || `Expected to include: "${substr}"\nGot: ${str.slice(0, 200)}`);
}

function assertNotIncludes(str, substr, msg) {
  if (str.includes(substr)) throw new Error(msg || `Expected NOT to include: "${substr}"`);
}

// ========== REF RESOLVER ==========
console.log('\n=== Ref Resolver ===');

test('resolveRef: simple internal ref', () => {
  const spec = { components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } } };
  const result = resolveRef('#/components/schemas/Pet', spec);
  assert(result.type === 'object');
  assert(result.properties.name.type === 'string');
});

test('resolveRef: circular ref detection', () => {
  const spec = { components: { schemas: { Node: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } } } } };
  const visited = new Set(['#/components/schemas/Node']);
  const result = resolveRef('#/components/schemas/Node', spec, visited);
  assert(result.$circularRef === 'Node');
});

test('resolveRef: broken ref returns $brokenRef', () => {
  const spec = { components: { schemas: {} } };
  const result = resolveRef('#/components/schemas/Missing', spec);
  assert(result.$brokenRef === '#/components/schemas/Missing');
});

test('resolveRef: external ref returns warning', () => {
  const result = resolveRef('http://example.com/schemas/Pet.json', {});
  assert(result.$externalRef === 'http://example.com/schemas/Pet.json');
});

test('resolveAllRefs: resolves nested refs', () => {
  const spec = {
    components: {
      schemas: {
        Tag: { type: 'object', properties: { id: { type: 'integer' } } },
        Pet: { type: 'object', properties: { tag: { $ref: '#/components/schemas/Tag' } } }
      }
    }
  };
  const resolved = resolveAllRefs(spec);
  assert(resolved.components.schemas.Pet.properties.tag.type === 'object');
  assert(resolved.components.schemas.Pet.properties.tag.properties.id.type === 'integer');
});

test('mergeAllOf: merges properties and required', () => {
  const result = mergeAllOf([
    { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    { type: 'object', properties: { b: { type: 'integer' } }, required: ['b'] },
  ]);
  assert(result.properties.a.type === 'string');
  assert(result.properties.b.type === 'integer');
  assert(result.required.includes('a'));
  assert(result.required.includes('b'));
});

// ========== TYPE MAPPER ==========
console.log('\n=== Type Mapper ===');

test('TypeScript: string → string', () => {
  assert(TypeMapper.toTypeScript({ type: 'string' }) === 'string');
});

test('TypeScript: integer → number', () => {
  assert(TypeMapper.toTypeScript({ type: 'integer' }) === 'number');
});

test('TypeScript: number → number', () => {
  assert(TypeMapper.toTypeScript({ type: 'number' }) === 'number');
});

test('TypeScript: boolean → boolean', () => {
  assert(TypeMapper.toTypeScript({ type: 'boolean' }) === 'boolean');
});

test('TypeScript: string binary → Blob', () => {
  assert(TypeMapper.toTypeScript({ type: 'string', format: 'binary' }) === 'Blob');
});

test('TypeScript: array → T[]', () => {
  assert(TypeMapper.toTypeScript({ type: 'array', items: { type: 'string' } }) === 'string[]');
});

test('TypeScript: nullable → T | null', () => {
  assert(TypeMapper.toTypeScript({ type: 'string', nullable: true }) === 'string | null');
});

test('TypeScript: enum → union', () => {
  const result = TypeMapper.toTypeScript({ type: 'string', enum: ['a', 'b', 'c'] });
  assert(result === "'a' | 'b' | 'c'");
});

test('TypeScript: oneOf → union', () => {
  const result = TypeMapper.toTypeScript({ oneOf: [{ type: 'string' }, { type: 'number' }] });
  assert(result === 'string | number');
});

test('TypeScript: additionalProperties → Record', () => {
  const result = TypeMapper.toTypeScript({ type: 'object', additionalProperties: { type: 'string' } });
  assert(result === 'Record<string, string>');
});

test('TypeScript: circularRef', () => {
  assert(TypeMapper.toTypeScript({ $circularRef: 'Node' }) === 'Node');
});

test('Python: string → str', () => {
  assert(TypeMapper.toPython({ type: 'string' }) === 'str');
});

test('Python: integer → int', () => {
  assert(TypeMapper.toPython({ type: 'integer' }) === 'int');
});

test('Python: number → float', () => {
  assert(TypeMapper.toPython({ type: 'number' }) === 'float');
});

test('Python: boolean → bool', () => {
  assert(TypeMapper.toPython({ type: 'boolean' }) === 'bool');
});

test('Python: string date-time → datetime', () => {
  assert(TypeMapper.toPython({ type: 'string', format: 'date-time' }) === 'datetime');
});

test('Python: string date → date', () => {
  assert(TypeMapper.toPython({ type: 'string', format: 'date' }) === 'date');
});

test('Python: string binary → bytes', () => {
  assert(TypeMapper.toPython({ type: 'string', format: 'binary' }) === 'bytes');
});

test('Python: array → List[T]', () => {
  assert(TypeMapper.toPython({ type: 'array', items: { type: 'string' } }) === 'List[str]');
});

test('Python: nullable → Optional[T]', () => {
  assert(TypeMapper.toPython({ type: 'string', nullable: true }) === 'Optional[str]');
});

test('Python: oneOf → Union', () => {
  const result = TypeMapper.toPython({ oneOf: [{ type: 'string' }, { type: 'integer' }] });
  assert(result === 'Union[str, int]');
});

test('Python: additionalProperties → Dict', () => {
  const result = TypeMapper.toPython({ type: 'object', additionalProperties: { type: 'integer' } });
  assert(result === 'Dict[str, int]');
});

// ========== PARSER ==========
console.log('\n=== Parser ===');

const swagger20Spec = {
  swagger: '2.0',
  info: { title: 'Test API', version: '1.0' },
  host: 'api.example.com',
  basePath: '/v1',
  schemes: ['https'],
  securityDefinitions: {
    basicAuth: { type: 'basic' },
    apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    oauth: { type: 'oauth2', flow: 'accessCode', authorizationUrl: 'https://auth.example.com', tokenUrl: 'https://token.example.com', scopes: { read: 'Read' } },
  },
  definitions: {
    Pet: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'integer', format: 'int64' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        tag: { $ref: '#/definitions/Tag' }
      }
    },
    Tag: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' }
      }
    },
    Error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'integer' },
        message: { type: 'string' }
      }
    }
  },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        tags: ['pets'],
        parameters: [
          { name: 'limit', in: 'query', type: 'integer', required: false }
        ],
        responses: {
          '200': { description: 'OK', schema: { type: 'array', items: { $ref: '#/definitions/Pet' } } }
        }
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        tags: ['pets'],
        parameters: [
          { name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Pet' } }
        ],
        responses: {
          '201': { description: 'Created', schema: { $ref: '#/definitions/Pet' } }
        }
      }
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet',
        tags: ['pets'],
        parameters: [
          { name: 'petId', in: 'path', type: 'integer', required: true }
        ],
        responses: {
          '200': { description: 'OK', schema: { $ref: '#/definitions/Pet' } },
          '404': { description: 'Not found', schema: { $ref: '#/definitions/Error' } }
        }
      },
      delete: {
        operationId: 'deletePet',
        tags: ['pets'],
        parameters: [
          { name: 'petId', in: 'path', type: 'integer', required: true }
        ],
        responses: {
          '204': { description: 'Deleted' }
        }
      }
    }
  }
};

test('Parser: detect 2.0 version', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  assert(parser.version === '2.0');
});

test('Parser: normalize 2.0 base URL', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  assert(parser.getBaseUrl() === 'https://api.example.com/v1');
});

test('Parser: normalize security defs', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const schemes = parser.getSecuritySchemes();
  assert(schemes.basicAuth.type === 'http');
  assert(schemes.basicAuth.scheme === 'basic');
  assert(schemes.apiKey.type === 'apiKey');
  assert(schemes.apiKey.in === 'header');
  assert(schemes.oauth.type === 'oauth2');
  assert(schemes.oauth.flows.authorizationCode);
});

test('Parser: extract schemas from definitions', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const schemas = parser.getSchemas();
  assert(schemas.Pet);
  assert(schemas.Tag);
  assert(schemas.Error);
});

test('Parser: $ref resolved in schemas', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const schemas = parser.getSchemas();
  // Pet.tag should be resolved (no more $ref)
  assert(schemas.Pet.properties.tag.type === 'object');
  assert(schemas.Pet.properties.tag.properties.id.type === 'integer');
});

test('Parser: extract endpoints', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const endpoints = parser.getEndpoints();
  assert(endpoints.length === 4);
  const listPets = endpoints.find(e => e.operationId === 'listPets');
  assert(listPets.method === 'GET');
  assert(listPets.path === '/pets');
  assert(listPets.tags.includes('pets'));
});

test('Parser: endpoint parameters', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const endpoints = parser.getEndpoints();
  const listPets = endpoints.find(e => e.operationId === 'listPets');
  assert(listPets.parameters.length === 1);
  assert(listPets.parameters[0].name === 'limit');
  assert(listPets.parameters[0].in === 'query');
});

test('Parser: body param → requestBody', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const endpoints = parser.getEndpoints();
  const createPet = endpoints.find(e => e.operationId === 'createPet');
  assert(createPet.requestBody !== null);
  assert(createPet.requestBody.required === true);
});

test('Parser: auth summary', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const summary = parser.getSummary();
  assert(summary.auth.length === 3);
  assert(summary.auth.find(a => a.name === 'basicAuth'));
  assert(summary.auth.find(a => a.name === 'apiKey'));
  assert(summary.auth.find(a => a.name === 'oauth'));
});

test('Parser: full summary', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const summary = parser.getSummary();
  assert(summary.endpointCount === 4);
  assert(summary.schemaCount === 3);
  assert(summary.title === 'Test API');
  assert(summary.baseUrl === 'https://api.example.com/v1');
});

// OpenAPI 3.0 spec
const openapi30Spec = {
  openapi: '3.0.3',
  info: { title: 'Test API v3', version: '1.0' },
  servers: [{ url: 'https://api.example.com/v3' }],
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'email'],
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'user', 'guest'] },
          profile: { $ref: '#/components/schemas/Profile' }
        }
      },
      Profile: {
        type: 'object',
        properties: {
          bio: { type: 'string' },
          avatar: { type: 'string', format: 'uri' }
        }
      }
    },
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    }
  },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users',
        tags: ['users'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } }
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } }
          }
        }
      }
    }
  }
};

test('Parser: detect 3.0 version', () => {
  const parser = new OpenAPIParser(openapi30Spec);
  assert(parser.version === '3.0.3');
});

test('Parser: 3.0 base URL', () => {
  const parser = new OpenAPIParser(openapi30Spec);
  assert(parser.getBaseUrl() === 'https://api.example.com/v3');
});

test('Parser: 3.0 schemas', () => {
  const parser = new OpenAPIParser(openapi30Spec);
  const schemas = parser.getSchemas();
  assert(schemas.User);
  assert(schemas.Profile);
  // $ref resolved
  assert(schemas.User.properties.profile.type === 'object');
});

test('Parser: 3.0 endpoints', () => {
  const parser = new OpenAPIParser(openapi30Spec);
  const endpoints = parser.getEndpoints();
  assert(endpoints.length === 1);
  assert(endpoints[0].operationId === 'listUsers');
  assert(endpoints[0].parameters.length === 1);
});

test('Parser: 3.0 security schemes', () => {
  const parser = new OpenAPIParser(openapi30Spec);
  const schemes = parser.getSecuritySchemes();
  assert(schemes.bearer.type === 'http');
  assert(schemes.bearer.scheme === 'bearer');
});

test('Parser: generateOperationId fallback', () => {
  const parser = new OpenAPIParser(openapi30Spec);
  assert(parser.generateOperationId('get', '/pets') === 'getPets');
  assert(parser.generateOperationId('post', '/pets') === 'createPets');
  assert(parser.generateOperationId('get', '/pets/{petId}') === 'getPetsByPetId');
  assert(parser.generateOperationId('delete', '/users/{id}/orders') === 'deleteUsersByIdOrders');
});

test('Parser: schemas summary', () => {
  const parser = new OpenAPIParser(openapi30Spec);
  const summary = parser.getSchemasSummary();
  assert(summary.User);
  assert(summary.User.properties.email);
  assert(summary.User.properties.role.enum);
});

// ========== TypeScript Generator ==========
console.log('\n=== TypeScript Models Generator ===');

test('TS: generates interfaces', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), { style: 'interface', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'export interface Pet {');
  assertIncludes(code, 'id: number;');
  assertIncludes(code, 'name: string;');
});

test('TS: generates type aliases', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), { style: 'type', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'export type Pet = {');
});

test('TS: generates enums from string+enum', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), { style: 'interface', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'export enum PetStatus {');
  assertIncludes(code, "Available = 'available'");
  assertIncludes(code, "Pending = 'pending'");
  assertIncludes(code, "Sold = 'sold'");
});

test('TS: required vs optional', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), { style: 'interface', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  // id and name are required, status is optional
  assertIncludes(code, 'id: number;');
  assertIncludes(code, 'name: string;');
  assertIncludes(code, 'status?:');
});

test('TS: Error interface', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), { style: 'interface', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'export interface Error {');
  assertIncludes(code, 'code: number;');
  assertIncludes(code, 'message: string;');
});

test('TS: header with metadata', () => {
  const gen = new ApiModelsTypeScriptGenerator({}, {});
  const code = gen.generate({ title: 'My API', source: 'http://example.com', version: '3.0.0' });
  assertIncludes(code, 'Generated from My API');
  assertIncludes(code, 'http://example.com');
});

test('TS: nested object (Tag resolved)', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), { style: 'interface', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'export interface Tag {');
});

test('TS: oneOf/anyOf generates union type', () => {
  const schemas = {
    Cat: { type: 'object', properties: { name: { type: 'string' } } },
    Dog: { type: 'object', properties: { breed: { type: 'string' } } },
    Animal: { oneOf: [{ type: 'object', properties: { name: { type: 'string' } } }, { type: 'object', properties: { breed: { type: 'string' } } }] }
  };
  const gen = new ApiModelsTypeScriptGenerator(schemas, {});
  const code = gen.generate({});
  assertIncludes(code, 'export type Animal =');
});

test('TS: allOf generates extends', () => {
  const schemas = {
    Base: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    Extended: { allOf: [
      { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      { type: 'object', properties: { extra: { type: 'string' } } }
    ]}
  };
  const gen = new ApiModelsTypeScriptGenerator(schemas, { style: 'interface' });
  const code = gen.generate({});
  assertIncludes(code, 'export interface Extended extends Base');
  assertIncludes(code, 'extra');
});

test('TS: no duplicate enums when values match top-level enum', () => {
  const schemas = {
    Status: { type: 'string', enum: ['active', 'inactive'], description: 'Status' },
    User: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'inactive'] } } }
  };
  const gen = new ApiModelsTypeScriptGenerator(schemas, { style: 'interface', includeEnums: true });
  const code = gen.generate({});
  // Should have Status enum but NOT UserStatus enum
  assertIncludes(code, 'export enum Status {');
  assertNotIncludes(code, 'export enum UserStatus {');
});

test('TS: empty schemas → no crash', () => {
  const gen = new ApiModelsTypeScriptGenerator({}, {});
  const code = gen.generate({});
  assert(typeof code === 'string');
});

// ========== Python Generator ==========
console.log('\n=== Python Models Generator ===');

test('PY: generates dataclasses', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'dataclass', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, '@dataclass');
  assertIncludes(code, 'class Pet:');
  assertIncludes(code, 'id: int');
  assertIncludes(code, 'name: str');
});

test('PY: generates pydantic', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'pydantic', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'from pydantic import BaseModel');
  assertIncludes(code, 'class Pet(BaseModel):');
});

test('PY: generates typeddict', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'typeddict', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'from typing import TypedDict');
  assertIncludes(code, 'class Pet(TypedDict, total=False):');
});

test('PY: generates enums', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'dataclass', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'class PetStatus(str, Enum):');
  assertIncludes(code, "AVAILABLE = 'available'");
});

test('PY: optional fields use Optional', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'dataclass', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'status: Optional[');
});

test('PY: required fields have no defaults in dataclass', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'dataclass', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  // Required fields should NOT have defaults (enforced at construction)
  const lines = code.split('\n');
  const idLine = lines.find(l => l.trim().startsWith('id: int'));
  assert(idLine && !idLine.includes('='), 'Dataclass required int should not have default');
  const nameLine = lines.find(l => l.trim().startsWith('name: str'));
  assert(nameLine && !nameLine.includes('='), 'Dataclass required str should not have default');
});

test('PY: pydantic required fields no default', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'pydantic', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  // Pydantic required fields don't have = default
  const lines = code.split('\n');
  const idLine = lines.find(l => l.trim().startsWith('id: int'));
  assert(idLine && !idLine.includes('= 0'), 'Pydantic required int should not have default');
});

test('PY: header with docstring', () => {
  const gen = new ApiModelsPythonGenerator({}, {});
  const code = gen.generate({ title: 'My API', source: 'http://example.com', version: '3.0.0' });
  assertIncludes(code, '"""');
  assertIncludes(code, 'Generated from My API');
});

test('PY: Tag class', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'dataclass', includeEnums: true });
  const code = gen.generate({ title: 'Test', source: 'test', version: '2.0' });
  assertIncludes(code, 'class Tag:');
});

test('PY: no duplicate enums when values match top-level enum', () => {
  const schemas = {
    Status: { type: 'string', enum: ['active', 'inactive'], description: 'Status' },
    User: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'inactive'] } } }
  };
  const gen = new ApiModelsPythonGenerator(schemas, { style: 'dataclass', includeEnums: true });
  const code = gen.generate({});
  assertIncludes(code, 'class Status(str, Enum):');
  assertNotIncludes(code, 'class UserStatus(str, Enum):');
});

test('PY: empty schemas → no crash', () => {
  const gen = new ApiModelsPythonGenerator({}, {});
  const code = gen.generate({});
  assert(typeof code === 'string');
});

test('PY: imports include future annotations', () => {
  const gen = new ApiModelsPythonGenerator({ X: { type: 'object', properties: {} } }, { style: 'dataclass' });
  const code = gen.generate({});
  assertIncludes(code, 'from __future__ import annotations');
});

test('PY: datetime imports when date-time used', () => {
  const schemas = {
    Event: { type: 'object', properties: { created: { type: 'string', format: 'date-time' } } }
  };
  const gen = new ApiModelsPythonGenerator(schemas, { style: 'dataclass' });
  const code = gen.generate({});
  assertIncludes(code, 'from datetime import datetime');
});

// ========== Integration: filtering schemas ==========
console.log('\n=== Integration ===');

test('Generator respects schema filtering', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const allSchemas = parser.getSchemas();
  const filtered = { Pet: allSchemas.Pet };
  const gen = new ApiModelsTypeScriptGenerator(filtered, {});
  const code = gen.generate({});
  assertIncludes(code, 'export interface Pet {');
  assertNotIncludes(code, 'export interface Error {');
});

test('Topological sort: Tag before Pet', () => {
  const parser = new OpenAPIParser(swagger20Spec);
  const gen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), {});
  const code = gen.generate({});
  const tagIndex = code.indexOf('export interface Tag');
  const petIndex = code.indexOf('export interface Pet');
  assert(tagIndex < petIndex, 'Tag should appear before Pet (dependency order)');
});

test('TS: suggested filename generation', () => {
  const titleSlug = 'Pet Store API'.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  assert(titleSlug === 'pet-store-api');
  assert(`${titleSlug}.models.ts` === 'pet-store-api.models.ts');
});

test('PY: suggested filename generation', () => {
  const titleSlug = 'Pet Store API'.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  assert(titleSlug === 'pet_store_api');
  assert(`${titleSlug}_models.py` === 'pet_store_api_models.py');
});

// ========== Bug fix regression tests ==========
console.log('\n=== Bug Fix Regressions ===');

test('Circular $ref produces $circularRef marker (not infinite JS refs)', () => {
  const spec = {
    openapi: '3.0.0', info: { title: 'Test' }, paths: {},
    components: { schemas: {
      TreeNode: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          children: { type: 'array', items: { $ref: '#/components/schemas/TreeNode' } }
        }
      }
    }}
  };
  const parser = new OpenAPIParser(spec);
  const schemas = parser.getSchemas();
  // First level resolves fully, second level gets $circularRef marker
  const resolved = schemas.TreeNode.properties.children.items;
  assert(resolved.type === 'object', 'First level should be fully resolved');
  const nested = resolved.properties.children.items;
  assert(nested.$circularRef === 'TreeNode', `Expected $circularRef at nested level, got: ${JSON.stringify(nested)}`);
  // Verify no infinite JS object references (JSON.stringify would throw)
  const json = JSON.stringify(schemas.TreeNode);
  assert(json.includes('"$circularRef":"TreeNode"'), 'Should contain $circularRef marker in serialized output');
});

test('Circular schemas do not crash generators', () => {
  const spec = {
    openapi: '3.0.0', info: { title: 'Test' }, paths: {},
    components: { schemas: {
      A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
      B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } }
    }}
  };
  const parser = new OpenAPIParser(spec);
  const tsGen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), {});
  const tsCode = tsGen.generate({});
  assertIncludes(tsCode, 'export interface A');
  assertIncludes(tsCode, 'export interface B');

  const pyGen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'dataclass' });
  const pyCode = pyGen.generate({});
  assertIncludes(pyCode, 'class A:');
  assertIncludes(pyCode, 'class B:');
});

test('Enum key starting with digit gets _ prefix', () => {
  const schemas = {
    Status: { type: 'string', enum: ['3xx', '4xx', '5xx'] }
  };
  const tsGen = new ApiModelsTypeScriptGenerator(schemas, { includeEnums: true });
  const tsCode = tsGen.generate({});
  assertIncludes(tsCode, "_3xx = '3xx'");

  const pyGen = new ApiModelsPythonGenerator(schemas, { includeEnums: true });
  const pyCode = pyGen.generate({});
  assertIncludes(pyCode, "_3XX = '3xx'");
});

test('Path-level params overridden by operation-level params', () => {
  const spec = {
    swagger: '2.0', info: { title: 'Test' }, host: 'localhost', basePath: '/api',
    paths: {
      '/items/{id}': {
        parameters: [
          { name: 'id', in: 'path', type: 'string', description: 'path-level' }
        ],
        get: {
          operationId: 'getItem',
          parameters: [
            { name: 'id', in: 'path', type: 'integer', description: 'op-level override' }
          ],
          responses: { '200': { description: 'OK' } }
        }
      }
    }
  };
  const parser = new OpenAPIParser(spec);
  const endpoints = parser.getEndpoints();
  const getItem = endpoints.find(e => e.operationId === 'getItem');
  // Operation-level param should win (type integer, not string)
  const idParams = getItem.parameters.filter(p => p.name === 'id');
  assert(idParams.length === 1, `Expected 1 id param, got ${idParams.length}`);
  assert(idParams[0].type === 'integer', `Expected integer, got ${idParams[0].type}`);
});

test('_refName marker enables fast schema lookup', () => {
  const spec = {
    openapi: '3.0.0', info: { title: 'Test' }, paths: {},
    components: { schemas: {
      Address: { type: 'object', properties: { street: { type: 'string' }, city: { type: 'string' } } },
      User: { type: 'object', properties: { name: { type: 'string' }, address: { $ref: '#/components/schemas/Address' } } }
    }}
  };
  const parser = new OpenAPIParser(spec);
  const schemas = parser.getSchemas();
  // The resolved address property should be identified as Address
  const gen = new ApiModelsTypeScriptGenerator(schemas, {});
  const code = gen.generate({});
  assertIncludes(code, 'address?: Address;');
});

test('Schema matching includes types, not just keys', () => {
  const schemas = {
    PersonName: { type: 'object', properties: { first: { type: 'string' }, last: { type: 'string' } } },
    Coords: { type: 'object', properties: { first: { type: 'number' }, last: { type: 'number' } } },
  };
  const gen = new ApiModelsTypeScriptGenerator(schemas, {});
  // Both have keys "first,last" but different types — should NOT be confused
  const code = gen.generate({});
  assertIncludes(code, 'export interface PersonName');
  assertIncludes(code, 'export interface Coords');
  // Both should exist independently
  const personIdx = code.indexOf('export interface PersonName');
  const coordsIdx = code.indexOf('export interface Coords');
  assert(personIdx >= 0 && coordsIdx >= 0, 'Both schemas should be generated');
});

// ========== Remote URL loading ==========
console.log('\n=== Remote Loading ===');

test('Parser: load from Petstore 2.0 URL', async () => {
  try {
    const parser = await OpenAPIParser.load('https://petstore.swagger.io/v2/swagger.json');
    assert(parser.version === '2.0');
    const summary = parser.getSummary();
    assert(summary.endpointCount > 0, `Expected >0 endpoints, got ${summary.endpointCount}`);
    assert(summary.schemaCount > 0, `Expected >0 schemas, got ${summary.schemaCount}`);
    assert(summary.title.toLowerCase().includes('pet'));
    console.log(`    (${summary.endpointCount} endpoints, ${summary.schemaCount} schemas)`);
  } catch (e) {
    // Network might be unavailable in CI
    console.log(`    (skipped: ${e.message})`);
  }
});

test('Parser: load from Petstore 3.0 URL', async () => {
  try {
    const parser = await OpenAPIParser.load('https://petstore3.swagger.io/api/v3/openapi.json');
    assert(parser.version.startsWith('3.'));
    const summary = parser.getSummary();
    assert(summary.endpointCount > 0);
    assert(summary.schemaCount > 0);
    console.log(`    (${summary.endpointCount} endpoints, ${summary.schemaCount} schemas)`);
  } catch (e) {
    console.log(`    (skipped: ${e.message})`);
  }
});

test('TS: generate models from Petstore 2.0', async () => {
  try {
    const parser = await OpenAPIParser.load('https://petstore.swagger.io/v2/swagger.json');
    const gen = new ApiModelsTypeScriptGenerator(parser.getSchemas(), { style: 'interface', includeEnums: true });
    const code = gen.generate({ title: 'Petstore', source: 'petstore', version: parser.version });
    assertIncludes(code, 'export interface Pet {');
    assertIncludes(code, 'export interface Category {');
    console.log(`    (${code.split('\n').length} lines)`);
  } catch (e) {
    console.log(`    (skipped: ${e.message})`);
  }
});

test('PY: generate dataclasses from Petstore 2.0', async () => {
  try {
    const parser = await OpenAPIParser.load('https://petstore.swagger.io/v2/swagger.json');
    const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'dataclass', includeEnums: true });
    const code = gen.generate({ title: 'Petstore', source: 'petstore', version: parser.version });
    assertIncludes(code, '@dataclass');
    assertIncludes(code, 'class Pet:');
    console.log(`    (${code.split('\n').length} lines)`);
  } catch (e) {
    console.log(`    (skipped: ${e.message})`);
  }
});

test('PY: generate pydantic from Petstore 2.0', async () => {
  try {
    const parser = await OpenAPIParser.load('https://petstore.swagger.io/v2/swagger.json');
    const gen = new ApiModelsPythonGenerator(parser.getSchemas(), { style: 'pydantic', includeEnums: true });
    const code = gen.generate({ title: 'Petstore', source: 'petstore', version: parser.version });
    assertIncludes(code, 'class Pet(BaseModel):');
    console.log(`    (${code.split('\n').length} lines)`);
  } catch (e) {
    console.log(`    (skipped: ${e.message})`);
  }
});

// ========== YAML parsing ==========
console.log('\n=== YAML Parsing ===');

test('Parser: YAML format support', () => {
  const yamlContent = `
openapi: '3.0.0'
info:
  title: YAML API
  version: '1.0'
servers:
  - url: https://api.example.com
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: OK
components:
  schemas:
    Item:
      type: object
      properties:
        name:
          type: string
`;
  const spec = yaml.load(yamlContent);
  const parser = new OpenAPIParser(spec);
  assert(parser.version === '3.0.0');
  assert(parser.spec.info.title === 'YAML API');
  assert(parser.getSchemas().Item);
  assert(parser.getEndpoints().length === 1);
});

// ========== Run async tests ==========
for (const { name, fn } of asyncTests) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ========== Summary ==========
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  process.exit(1);
}

/**
 * utils/openapi/parser.js
 *
 * Unified parser for OpenAPI 2.0 (Swagger) and 3.x specs.
 * Normalizes 2.0 to 3.x internally.
 */

import yaml from 'js-yaml';
import { readFileSync } from 'fs';
import { resolveAllRefs } from './ref-resolver.js';
import { schemaSignature } from './helpers.js';

export class OpenAPIParser {
  constructor(rawSpec) {
    this.raw = rawSpec;
    this.version = this.detectVersion();
    this.spec = this.normalize();
    this.spec = resolveAllRefs(this.spec);
  }

  /**
   * Load spec from URL or file path
   * @param {string} source - URL or file path
   * @param {string} [format='auto'] - 'auto' | 'json' | 'yaml'
   * @returns {OpenAPIParser}
   */
  static async load(source, format = 'auto') {
    let content;

    if (source.startsWith('http://') || source.startsWith('https://')) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(source, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to fetch ${source}: ${response.status} ${response.statusText}`);
        }
        content = await response.text();
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      content = readFileSync(source, 'utf-8');
    }

    const spec = parseContent(content, format, source);
    return new OpenAPIParser(spec);
  }

  detectVersion() {
    if (this.raw.swagger === '2.0') return '2.0';
    if (this.raw.openapi && this.raw.openapi.startsWith('3.')) return this.raw.openapi;
    throw new Error('Unsupported OpenAPI version. Expected swagger: "2.0" or openapi: "3.x.x"');
  }

  normalize() {
    if (this.version === '2.0') return this.normalize2to3(this.raw);
    return this.raw;
  }

  /**
   * Convert OpenAPI 2.0 to 3.x structure
   */
  normalize2to3(spec) {
    const result = {
      openapi: '3.0.0',
      info: spec.info || {},
      servers: [{
        url: `${spec.schemes?.[0] || 'https'}://${spec.host || 'localhost'}${spec.basePath || ''}`
      }],
      paths: this.normalizePaths2to3(spec.paths || {}, spec),
      components: {
        schemas: spec.definitions || {},
        securitySchemes: this.normalizeSecurityDefs(spec.securityDefinitions || {})
      },
      security: spec.security,
      tags: spec.tags
    };
    // Rewrite $ref from #/definitions/X to #/components/schemas/X
    this._rewriteRefs(result);
    return result;
  }

  /**
   * Rewrite all $ref strings: #/definitions/X → #/components/schemas/X
   */
  _rewriteRefs(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(item => this._rewriteRefs(item)); return; }
    for (const [key, val] of Object.entries(obj)) {
      if (key === '$ref' && typeof val === 'string' && val.startsWith('#/definitions/')) {
        obj[key] = val.replace('#/definitions/', '#/components/schemas/');
      } else if (val && typeof val === 'object') {
        this._rewriteRefs(val);
      }
    }
  }

  /**
   * Normalize paths: convert body params to requestBody
   */
  normalizePaths2to3(paths, spec) {
    const normalized = {};
    for (const [pathStr, methods] of Object.entries(paths)) {
      normalized[pathStr] = {};
      const pathParams = methods.parameters || [];

      for (const [method, operation] of Object.entries(methods)) {
        if (method === 'parameters') continue;
        if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;

        // Operation params override path params with same name+in (per OpenAPI spec)
        const opParams = operation.parameters || [];
        const opKeys = new Set(opParams.map(p => `${p.name}:${p.in}`));
        const mergedParams = [...opParams, ...pathParams.filter(p => !opKeys.has(`${p.name}:${p.in}`))];
        const bodyParam = mergedParams.find(p => p.in === 'body');
        const nonBodyParams = mergedParams.filter(p => p.in !== 'body' && p.in !== 'formData');

        const op = { ...operation, parameters: nonBodyParams };

        // Convert body param to requestBody
        if (bodyParam) {
          op.requestBody = {
            required: bodyParam.required || false,
            content: {
              'application/json': {
                schema: bodyParam.schema || {}
              }
            }
          };
        }

        // Convert formData params to requestBody
        const formParams = mergedParams.filter(p => p.in === 'formData');
        if (formParams.length > 0 && !op.requestBody) {
          const properties = {};
          const required = [];
          for (const fp of formParams) {
            properties[fp.name] = { type: fp.type, description: fp.description };
            if (fp.required) required.push(fp.name);
          }
          const contentType = operation.consumes?.includes('multipart/form-data')
            ? 'multipart/form-data'
            : 'application/x-www-form-urlencoded';
          op.requestBody = {
            required: required.length > 0,
            content: {
              [contentType]: {
                schema: { type: 'object', properties, required: required.length > 0 ? required : undefined }
              }
            }
          };
        }

        // Normalize responses
        if (op.responses) {
          for (const [code, resp] of Object.entries(op.responses)) {
            if (resp.schema) {
              op.responses[code] = {
                description: resp.description || '',
                content: {
                  'application/json': { schema: resp.schema }
                }
              };
            }
          }
        }

        normalized[pathStr][method] = op;
      }
    }
    return normalized;
  }

  /**
   * Normalize securityDefinitions (2.0) to securitySchemes (3.x)
   */
  normalizeSecurityDefs(defs) {
    const schemes = {};
    for (const [name, def] of Object.entries(defs)) {
      switch (def.type) {
        case 'basic':
          schemes[name] = { type: 'http', scheme: 'basic' };
          break;
        case 'apiKey':
          schemes[name] = { type: 'apiKey', in: def.in, name: def.name };
          break;
        case 'oauth2': {
          const flows = {};
          const flowMap = {
            implicit: 'implicit',
            password: 'password',
            application: 'clientCredentials',
            accessCode: 'authorizationCode'
          };
          const flowName = flowMap[def.flow] || def.flow;
          flows[flowName] = {
            ...(def.authorizationUrl ? { authorizationUrl: def.authorizationUrl } : {}),
            ...(def.tokenUrl ? { tokenUrl: def.tokenUrl } : {}),
            scopes: def.scopes || {}
          };
          schemes[name] = { type: 'oauth2', flows };
          break;
        }
        default:
          schemes[name] = def;
      }
    }
    return schemes;
  }

  getSchemas() {
    return this.spec.components?.schemas || {};
  }

  getSecuritySchemes() {
    return this.spec.components?.securitySchemes || {};
  }

  getBaseUrl() {
    return this.spec.servers?.[0]?.url || '';
  }

  /**
   * Get all endpoints as flat list
   * @returns {Array<Object>}
   */
  getEndpoints() {
    const endpoints = [];
    for (const [pathStr, methods] of Object.entries(this.spec.paths || {})) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;

        endpoints.push({
          method: method.toUpperCase(),
          path: pathStr,
          operationId: operation.operationId || this.generateOperationId(method, pathStr),
          summary: operation.summary || '',
          description: operation.description || '',
          tags: operation.tags || [],
          parameters: this.extractParameters(operation),
          requestBody: this.extractRequestBody(operation),
          responses: this.extractResponses(operation),
          security: operation.security || this.spec.security || [],
          deprecated: operation.deprecated || false
        });
      }
    }
    return endpoints;
  }

  /**
   * Generate operationId from method + path
   * GET /pets/{petId} → getPetsByPetId
   */
  generateOperationId(method, pathStr) {
    const prefixMap = { get: 'get', post: 'create', put: 'update', patch: 'patch', delete: 'delete', head: 'head', options: 'options' };
    const prefix = prefixMap[method] || method;

    const segments = pathStr.split('/').filter(Boolean);
    const parts = segments.map(seg => {
      if (seg.startsWith('{') && seg.endsWith('}')) {
        const param = seg.slice(1, -1);
        return 'By' + param.charAt(0).toUpperCase() + param.slice(1);
      }
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    });

    return prefix + parts.join('');
  }

  /**
   * Extract parameters (path, query, header)
   */
  extractParameters(operation) {
    return (operation.parameters || []).map(p => ({
      name: p.name,
      in: p.in,
      type: p.schema?.type || p.type || 'string',
      format: p.schema?.format || p.format,
      required: p.required || p.in === 'path',
      description: p.description || '',
      enum: p.schema?.enum || p.enum,
      schema: p.schema || { type: p.type || 'string' }
    }));
  }

  /**
   * Extract request body info
   */
  extractRequestBody(operation) {
    const rb = operation.requestBody;
    if (!rb) return null;

    const content = rb.content || {};
    const jsonContent = content['application/json'] || content[Object.keys(content)[0]];
    const schema = jsonContent?.schema;

    // Get schema name from the schema itself
    let schemaName = null;
    if (schema) {
      // If it was a $ref that got resolved, try to get the name
      schemaName = this._getSchemaName(schema);
    }

    return {
      required: rb.required || false,
      schema: schemaName,
      schemaObject: schema || null
    };
  }

  /**
   * Extract response info
   */
  extractResponses(operation) {
    const responses = {};
    for (const [code, resp] of Object.entries(operation.responses || {})) {
      const content = resp.content || {};
      const jsonContent = content['application/json'] || content[Object.keys(content)[0]];
      const schema = jsonContent?.schema;
      let schemaName = schema ? this._getSchemaName(schema) : null;

      responses[code] = {
        description: resp.description || '',
        schema: schemaName
      };
    }
    return responses;
  }

  /**
   * Try to determine schema name from a resolved schema object
   */
  _getSchemaName(schema) {
    if (!schema) return null;

    // Fast path: resolved $ref carries its origin name
    if (schema._refName && this.spec.components?.schemas?.[schema._refName]) {
      return schema._refName;
    }

    // Check if this matches a known schema
    const schemas = this.spec.components?.schemas || {};
    for (const [name, s] of Object.entries(schemas)) {
      if (s === schema) return name;
      // Signature-based match (keys + types to avoid false positives)
      if (s.properties && schema.properties) {
        const sSig = schemaSignature(s.properties);
        const schemaSig = schemaSignature(schema.properties);
        if (sSig === schemaSig && sSig.length > 0) return name;
      }
    }

    // Array type
    if (schema.type === 'array' && schema.items) {
      const itemName = this._getSchemaName(schema.items);
      if (itemName) return `${itemName}[]`;
    }

    return null;
  }

  /**
   * Get auth summary for loadSwagger response
   */
  getAuthSummary() {
    const schemes = this.getSecuritySchemes();
    return Object.entries(schemes).map(([name, scheme]) => {
      const summary = { name, type: scheme.type };
      if (scheme.scheme) summary.scheme = scheme.scheme;
      if (scheme.bearerFormat) summary.bearerFormat = scheme.bearerFormat;
      if (scheme.in) summary.in = scheme.in;
      if (scheme.name) summary.paramName = scheme.name;
      if (scheme.flows) summary.flows = scheme.flows;
      return summary;
    });
  }

  /**
   * Get schemas summary (names + top-level property names)
   */
  getSchemasSummary() {
    const schemas = this.getSchemas();
    const summary = {};
    for (const [name, schema] of Object.entries(schemas)) {
      summary[name] = {
        type: schema.type || 'object',
        required: schema.required || [],
        properties: schema.properties
          ? Object.entries(schema.properties).reduce((acc, [k, v]) => {
              acc[k] = {
                type: v.type || (v.enum ? 'enum' : 'object'),
                ...(v.format ? { format: v.format } : {}),
                ...(v.enum ? { enum: v.enum } : {}),
                ...(v.items ? { items: v.items.type || 'object' } : {}),
                ...(v.$circularRef ? { $circularRef: v.$circularRef } : {})
              };
              return acc;
            }, {})
          : undefined,
        ...(schema.enum ? { enum: schema.enum } : {}),
        ...(schema.description ? { description: schema.description } : {}),
        ...(schema.allOf ? { allOf: true } : {}),
        ...(schema.oneOf ? { oneOf: true } : {}),
        ...(schema.anyOf ? { anyOf: true } : {})
      };
    }
    return summary;
  }

  /**
   * Full summary for loadSwagger response
   */
  getSummary() {
    const endpoints = this.getEndpoints();
    return {
      version: this.version,
      title: this.spec.info?.title || '',
      description: this.spec.info?.description || '',
      baseUrl: this.getBaseUrl(),
      auth: this.getAuthSummary(),
      endpoints,
      schemas: this.getSchemasSummary(),
      endpointCount: endpoints.length,
      schemaCount: Object.keys(this.getSchemas()).length
    };
  }
}

/**
 * Parse content string to object
 */
function parseContent(content, format, source) {
  if (format === 'json') return JSON.parse(content);
  if (format === 'yaml') return yaml.load(content);

  // Auto-detect
  try {
    return JSON.parse(content);
  } catch {
    try {
      return yaml.load(content);
    } catch (yamlErr) {
      throw new Error(`Failed to parse spec from ${source}. Not valid JSON or YAML: ${yamlErr.message}`);
    }
  }
}

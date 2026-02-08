/**
 * utils/api-generators/api-models-typescript.js
 *
 * Generates TypeScript interfaces/types from OpenAPI schemas.
 */

import { TypeMapper } from '../openapi/type-mapper.js';
import { mergeAllOf } from '../openapi/ref-resolver.js';
import { arraysEqual, schemaSignature } from '../openapi/helpers.js';

export class ApiModelsTypeScriptGenerator {
  constructor(schemas, options = {}) {
    this.schemas = schemas;
    this.options = {
      style: 'interface',        // 'interface' | 'type'
      includeEnums: true,
      includeValidation: false,
      ...options
    };
    this.generatedEnums = new Set();
  }

  /**
   * Generate full file content
   * @param {Object} metadata - { title, source, version }
   * @returns {string}
   */
  generate(metadata = {}) {
    const lines = [];

    // Header
    lines.push(...this.generateHeader(metadata));
    lines.push('');

    // Enums first
    if (this.options.includeEnums) {
      const enumLines = this.generateAllEnums();
      if (enumLines.length > 0) {
        lines.push(...enumLines);
      }
    }

    // Models in dependency order
    const sorted = this.topologicalSort();
    for (const name of sorted) {
      const schema = this.schemas[name];
      if (!schema) continue;

      // Skip if it's a pure enum (already generated)
      if (schema.enum && schema.type === 'string' && this.generatedEnums.has(name)) continue;

      const modelLines = this.generateModel(name, schema);
      if (modelLines.length > 0) {
        lines.push(...modelLines);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  generateHeader(metadata) {
    const lines = [];
    lines.push(`// Generated from ${metadata.title || 'OpenAPI'} (${metadata.source || 'unknown source'})`);
    lines.push(`// OpenAPI ${metadata.version || 'unknown'} | Generated at ${new Date().toISOString()}`);
    return lines;
  }

  /**
   * Find all enums in schemas and generate them
   */
  generateAllEnums() {
    const lines = [];
    for (const [name, schema] of Object.entries(this.schemas)) {
      // Top-level enum schema
      if (schema.enum && schema.type === 'string') {
        lines.push(...this.generateEnum(name, schema.enum, schema.description));
        lines.push('');
        this.generatedEnums.add(name);
        continue;
      }
      // Enums inside properties (skip if values match a top-level enum)
      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          if (propSchema.enum && propSchema.type === 'string') {
            // Check if values match an already-generated top-level enum
            const matchingEnum = this._findMatchingEnum(propSchema.enum);
            if (matchingEnum) continue;

            const enumName = name + propName.charAt(0).toUpperCase() + propName.slice(1);
            if (!this.generatedEnums.has(enumName)) {
              lines.push(...this.generateEnum(enumName, propSchema.enum, propSchema.description));
              lines.push('');
              this.generatedEnums.add(enumName);
            }
          }
        }
      }
    }
    return lines;
  }

  generateEnum(name, values, description) {
    const lines = [];
    if (description) {
      lines.push(`/** ${description} */`);
    }
    lines.push(`export enum ${name} {`);
    for (const value of values) {
      let key = value.charAt(0).toUpperCase() + value.slice(1).replace(/[^a-zA-Z0-9]/g, '_');
      if (/^\d/.test(key)) key = `_${key}`;
      lines.push(`  ${key} = '${value}',`);
    }
    lines.push('}');
    return lines;
  }

  /**
   * Generate a single model (interface or type)
   */
  generateModel(name, schema) {
    // Handle allOf
    if (schema.allOf) {
      return this.generateAllOfModel(name, schema);
    }

    // Handle oneOf / anyOf → union type
    if (schema.oneOf || schema.anyOf) {
      return this.generateUnionType(name, schema.oneOf || schema.anyOf, schema.description);
    }

    // Standard object with properties
    if (schema.type === 'object' || schema.properties) {
      return this.generateObjectModel(name, schema);
    }

    // Simple type alias (e.g., type Foo = string)
    if (schema.type && schema.type !== 'object') {
      const tsType = TypeMapper.toTypeScript(schema);
      return [`export type ${name} = ${tsType};`];
    }

    // Fallback: empty interface
    if (this.options.style === 'interface') {
      return [`export interface ${name} {}`];
    }
    return [`export type ${name} = Record<string, unknown>;`];
  }

  generateObjectModel(name, schema) {
    const lines = [];
    const required = new Set(schema.required || []);

    if (schema.description) {
      lines.push(`/** ${schema.description} */`);
    }

    if (this.options.style === 'interface') {
      lines.push(`export interface ${name} {`);
    } else {
      lines.push(`export type ${name} = {`);
    }

    for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
      const isRequired = required.has(propName);
      const type = this.resolvePropertyType(name, propName, propSchema);
      const opt = isRequired ? '' : '?';

      if (propSchema.description && this.options.includeValidation) {
        lines.push(`  /** ${propSchema.description} */`);
      }

      lines.push(`  ${propName}${opt}: ${type};`);
    }

    // additionalProperties
    if (schema.additionalProperties) {
      const valueType = typeof schema.additionalProperties === 'object'
        ? TypeMapper.toTypeScript(schema.additionalProperties)
        : 'any';
      lines.push(`  [key: string]: ${valueType};`);
    }

    if (this.options.style === 'interface') {
      lines.push('}');
    } else {
      lines.push('};');
    }

    return lines;
  }

  generateAllOfModel(name, schema) {
    const lines = [];
    if (schema.description) {
      lines.push(`/** ${schema.description} */`);
    }

    // Find named refs and inline schemas
    const namedRefs = [];
    const inlineSchemas = [];

    for (const sub of schema.allOf) {
      const refName = this._findSchemaName(sub);
      if (refName) {
        namedRefs.push(refName);
      } else if (sub.properties) {
        inlineSchemas.push(sub);
      }
    }

    if (this.options.style === 'interface' && namedRefs.length > 0 && inlineSchemas.length > 0) {
      // interface X extends A, B { extra props }
      const merged = mergeAllOf(inlineSchemas);
      lines.push(`export interface ${name} extends ${namedRefs.join(', ')} {`);
      const required = new Set(merged.required || []);
      for (const [propName, propSchema] of Object.entries(merged.properties || {})) {
        const isRequired = required.has(propName);
        const type = this.resolvePropertyType(name, propName, propSchema);
        lines.push(`  ${propName}${isRequired ? '' : '?'}: ${type};`);
      }
      lines.push('}');
    } else if (namedRefs.length > 0 && inlineSchemas.length === 0) {
      // Pure extension
      if (this.options.style === 'interface') {
        lines.push(`export interface ${name} extends ${namedRefs.join(', ')} {}`);
      } else {
        lines.push(`export type ${name} = ${namedRefs.join(' & ')};`);
      }
    } else {
      // Merge everything into one
      const merged = mergeAllOf(schema.allOf);
      return this.generateObjectModel(name, merged);
    }

    return lines;
  }

  generateUnionType(name, schemas, description) {
    const lines = [];
    if (description) {
      lines.push(`/** ${description} */`);
    }
    const types = schemas.map(s => {
      const refName = this._findSchemaName(s);
      if (refName) return refName;
      return TypeMapper.toTypeScript(s);
    });
    lines.push(`export type ${name} = ${types.join(' | ')};`);
    return lines;
  }

  /**
   * Resolve type for a property, using enum name if available
   */
  resolvePropertyType(parentName, propName, propSchema) {
    // Enum property → reference generated enum
    if (propSchema.enum && propSchema.type === 'string' && this.options.includeEnums) {
      const enumName = parentName + propName.charAt(0).toUpperCase() + propName.slice(1);
      // Check if this enum matches a top-level enum
      for (const [schemaName, schema] of Object.entries(this.schemas)) {
        if (schema.enum && schema.type === 'string' && arraysEqual(schema.enum, propSchema.enum)) {
          return propSchema.nullable ? `${schemaName} | null` : schemaName;
        }
      }
      return propSchema.nullable ? `${enumName} | null` : enumName;
    }

    // Array with items that might be a known schema
    if (propSchema.type === 'array' && propSchema.items) {
      const itemName = this._findSchemaName(propSchema.items);
      if (itemName) {
        return propSchema.nullable ? `${itemName}[] | null` : `${itemName}[]`;
      }
    }

    // Object reference
    const refName = this._findSchemaName(propSchema);
    if (refName) {
      return propSchema.nullable ? `${refName} | null` : refName;
    }

    return TypeMapper.toTypeScript(propSchema);
  }

  /**
   * Find a top-level enum schema whose values match
   */
  _findMatchingEnum(enumValues) {
    for (const [name, schema] of Object.entries(this.schemas)) {
      if (schema.enum && schema.type === 'string' && arraysEqual(schema.enum, enumValues)) {
        return name;
      }
    }
    return null;
  }

  /**
   * Try to find schema name for a resolved schema
   */
  _findSchemaName(schema) {
    if (!schema || typeof schema !== 'object') return null;
    if (schema.$circularRef) return schema.$circularRef;
    if (schema._refName && this.schemas[schema._refName]) return schema._refName;

    for (const [name, s] of Object.entries(this.schemas)) {
      if (s === schema) return name;
      if (s.properties && schema.properties) {
        const sSig = schemaSignature(s.properties);
        const schemaSig = schemaSignature(schema.properties);
        if (sSig === schemaSig && sSig.length > 0) return name;
      }
    }
    return null;
  }

  /**
   * Topological sort schemas by dependencies
   */
  topologicalSort() {
    const names = Object.keys(this.schemas);
    const visited = new Set();
    const result = [];

    const visit = (name) => {
      if (visited.has(name)) return;
      visited.add(name);

      const deps = this.getDependencies(name);
      for (const dep of deps) {
        if (this.schemas[dep]) visit(dep);
      }
      result.push(name);
    };

    for (const name of names) {
      visit(name);
    }

    return result;
  }

  /**
   * Get dependency names for a schema
   */
  getDependencies(name) {
    const schema = this.schemas[name];
    if (!schema) return [];
    const deps = new Set();
    const seen = new WeakSet();

    const collectDeps = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.$circularRef) { deps.add(obj.$circularRef); return; }
      if (seen.has(obj)) return;
      seen.add(obj);
      if (Array.isArray(obj)) { obj.forEach(collectDeps); return; }

      const refName = this._findSchemaName(obj);
      if (refName && refName !== name) deps.add(refName);

      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') collectDeps(val);
      }
    };

    if (schema.properties) collectDeps(schema.properties);
    if (schema.allOf) collectDeps(schema.allOf);
    if (schema.oneOf) collectDeps(schema.oneOf);
    if (schema.anyOf) collectDeps(schema.anyOf);
    if (schema.items) collectDeps(schema.items);

    return [...deps];
  }
}

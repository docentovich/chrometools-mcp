/**
 * utils/api-generators/api-models-python.js
 *
 * Generates Python dataclass/pydantic/typeddict models from OpenAPI schemas.
 */

import { TypeMapper } from '../openapi/type-mapper.js';
import { mergeAllOf } from '../openapi/ref-resolver.js';

export class ApiModelsPythonGenerator {
  constructor(schemas, options = {}) {
    this.schemas = schemas;
    this.options = {
      style: 'dataclass',       // 'dataclass' | 'pydantic' | 'typeddict'
      includeEnums: true,
      includeValidation: false,
      ...options
    };
    this.generatedEnums = new Set();
    this.usesDatetime = false;
    this.usesDate = false;
  }

  /**
   * Generate full file content
   * @param {Object} metadata - { title, source, version }
   * @returns {string}
   */
  generate(metadata = {}) {
    // Pre-scan to detect datetime usage
    this._scanForDateTypes();

    const lines = [];

    // Header
    lines.push(...this.generateHeader(metadata));

    // Imports
    lines.push(...this.generateImports());
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

      if (schema.enum && schema.type === 'string' && this.generatedEnums.has(name)) continue;

      const modelLines = this.generateModel(name, schema);
      if (modelLines.length > 0) {
        lines.push('');
        lines.push(...modelLines);
      }
    }

    return lines.join('\n') + '\n';
  }

  generateHeader(metadata) {
    return [
      '"""',
      `Generated from ${metadata.title || 'OpenAPI'} (${metadata.source || 'unknown source'})`,
      `OpenAPI ${metadata.version || 'unknown'} | Generated at ${new Date().toISOString()}`,
      '"""',
      ''
    ];
  }

  generateImports() {
    const lines = ['from __future__ import annotations'];

    if (this.options.style === 'dataclass') {
      lines.push('from dataclasses import dataclass, field');
      lines.push('from enum import Enum');
      lines.push('from typing import Optional, List, Dict, Any, Union');
    } else if (this.options.style === 'pydantic') {
      lines.push('from pydantic import BaseModel, Field');
      lines.push('from enum import Enum');
      lines.push('from typing import Optional, List, Dict, Any, Union');
    } else {
      // typeddict
      lines.push('from typing import TypedDict, Optional, List, Dict, Any, Union');
      lines.push('from enum import Enum');
    }

    if (this.usesDatetime || this.usesDate) {
      const imports = [];
      if (this.usesDatetime) imports.push('datetime');
      if (this.usesDate) imports.push('date');
      lines.push(`from datetime import ${imports.join(', ')}`);
    }

    return lines;
  }

  _scanForDateTypes() {
    const scan = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.format === 'date-time') this.usesDatetime = true;
      if (obj.format === 'date') this.usesDate = true;
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') scan(val);
      }
    };
    scan(this.schemas);
  }

  generateAllEnums() {
    const lines = [];
    for (const [name, schema] of Object.entries(this.schemas)) {
      if (schema.enum && schema.type === 'string') {
        lines.push('');
        lines.push(...this.generateEnum(name, schema.enum, schema.description));
        this.generatedEnums.add(name);
        continue;
      }
      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          if (propSchema.enum && propSchema.type === 'string') {
            // Skip if values match a top-level enum
            const matchingEnum = this._findMatchingEnum(propSchema.enum);
            if (matchingEnum) continue;

            const enumName = name + propName.charAt(0).toUpperCase() + propName.slice(1);
            if (!this.generatedEnums.has(enumName)) {
              lines.push('');
              lines.push(...this.generateEnum(enumName, propSchema.enum, propSchema.description));
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
    lines.push(`class ${name}(str, Enum):`);
    if (description) {
      lines.push(`    """${description}"""`);
    }
    for (const value of values) {
      const key = value.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      lines.push(`    ${key} = '${value}'`);
    }
    return lines;
  }

  generateModel(name, schema) {
    if (schema.allOf) {
      return this.generateAllOfModel(name, schema);
    }

    if (schema.oneOf || schema.anyOf) {
      return this.generateUnionType(name, schema.oneOf || schema.anyOf, schema.description);
    }

    if (schema.type === 'object' || schema.properties) {
      return this.generateObjectModel(name, schema);
    }

    // Simple type alias
    if (schema.type && schema.type !== 'object') {
      const pyType = TypeMapper.toPython(schema);
      return [`${name} = ${pyType}`];
    }

    return this.generateObjectModel(name, { type: 'object', properties: {} });
  }

  generateObjectModel(name, schema) {
    const lines = [];
    const required = new Set(schema.required || []);

    if (this.options.style === 'dataclass') {
      lines.push('@dataclass');
      lines.push(`class ${name}:`);
    } else if (this.options.style === 'pydantic') {
      lines.push(`class ${name}(BaseModel):`);
    } else {
      lines.push(`class ${name}(TypedDict, total=False):`);
    }

    if (schema.description) {
      lines.push(`    """${schema.description}"""`);
    }

    const props = Object.entries(schema.properties || {});

    if (props.length === 0) {
      lines.push('    pass');
      return lines;
    }

    // Sort: required first, then optional
    const sortedProps = props.sort(([a], [b]) => {
      const aReq = required.has(a);
      const bReq = required.has(b);
      if (aReq && !bReq) return -1;
      if (!aReq && bReq) return 1;
      return 0;
    });

    for (const [propName, propSchema] of sortedProps) {
      const isRequired = required.has(propName);
      const pyName = this.toSnakeCase(propName);
      const type = this.resolvePropertyType(name, propName, propSchema);

      if (this.options.style === 'typeddict') {
        if (isRequired) {
          lines.push(`    ${pyName}: ${type}`);
        } else {
          lines.push(`    ${pyName}: Optional[${type}]`);
        }
      } else if (this.options.style === 'pydantic') {
        if (isRequired) {
          lines.push(`    ${pyName}: ${type}`);
        } else {
          lines.push(`    ${pyName}: Optional[${type}] = None`);
        }
      } else {
        // dataclass
        if (isRequired) {
          lines.push(`    ${pyName}: ${type} = ${this.getDefaultValue(type, propSchema)}`);
        } else {
          lines.push(`    ${pyName}: Optional[${type}] = None`);
        }
      }
    }

    return lines;
  }

  generateAllOfModel(name, schema) {
    const lines = [];
    const namedRefs = [];
    const inlineSchemas = [];

    for (const sub of schema.allOf) {
      const refName = this._findSchemaName(sub);
      if (refName) {
        namedRefs.push(refName);
      } else {
        inlineSchemas.push(sub);
      }
    }

    const merged = mergeAllOf(inlineSchemas.length > 0 ? inlineSchemas : schema.allOf);
    const baseClass = namedRefs.length > 0 ? namedRefs[0] : null;
    const required = new Set(merged.required || []);

    if (this.options.style === 'dataclass') {
      lines.push('@dataclass');
      if (baseClass) {
        lines.push(`class ${name}(${baseClass}):`);
      } else {
        lines.push(`class ${name}:`);
      }
    } else if (this.options.style === 'pydantic') {
      if (baseClass) {
        lines.push(`class ${name}(${baseClass}):`);
      } else {
        lines.push(`class ${name}(BaseModel):`);
      }
    } else {
      if (baseClass) {
        lines.push(`class ${name}(${baseClass}, total=False):`);
      } else {
        lines.push(`class ${name}(TypedDict, total=False):`);
      }
    }

    if (schema.description) {
      lines.push(`    """${schema.description}"""`);
    }

    const props = Object.entries(merged.properties || {});
    if (props.length === 0 && !baseClass) {
      lines.push('    pass');
      return lines;
    }

    if (props.length === 0) {
      lines.push('    pass');
      return lines;
    }

    for (const [propName, propSchema] of props) {
      const isRequired = required.has(propName);
      const pyName = this.toSnakeCase(propName);
      const type = this.resolvePropertyType(name, propName, propSchema);

      if (this.options.style === 'pydantic') {
        lines.push(isRequired
          ? `    ${pyName}: ${type}`
          : `    ${pyName}: Optional[${type}] = None`);
      } else if (this.options.style === 'dataclass') {
        lines.push(isRequired
          ? `    ${pyName}: ${type} = ${this.getDefaultValue(type, propSchema)}`
          : `    ${pyName}: Optional[${type}] = None`);
      } else {
        lines.push(isRequired
          ? `    ${pyName}: ${type}`
          : `    ${pyName}: Optional[${type}]`);
      }
    }

    return lines;
  }

  generateUnionType(name, schemas, description) {
    const lines = [];
    if (description) {
      lines.push(`# ${description}`);
    }
    const types = schemas.map(s => {
      const refName = this._findSchemaName(s);
      if (refName) return refName;
      return TypeMapper.toPython(s);
    });
    lines.push(`${name} = Union[${types.join(', ')}]`);
    return lines;
  }

  resolvePropertyType(parentName, propName, propSchema) {
    // Enum property
    if (propSchema.enum && propSchema.type === 'string' && this.options.includeEnums) {
      for (const [schemaName, schema] of Object.entries(this.schemas)) {
        if (schema.enum && schema.type === 'string' && arraysEqual(schema.enum, propSchema.enum)) {
          return schemaName;
        }
      }
      return parentName + propName.charAt(0).toUpperCase() + propName.slice(1);
    }

    // Array with known items
    if (propSchema.type === 'array' && propSchema.items) {
      const itemName = this._findSchemaName(propSchema.items);
      if (itemName) return `List[${itemName}]`;
    }

    // Object reference
    const refName = this._findSchemaName(propSchema);
    if (refName) return refName;

    return TypeMapper.toPython(propSchema);
  }

  getDefaultValue(type, schema) {
    if (type === 'str') return "''";
    if (type === 'int') return '0';
    if (type === 'float') return '0.0';
    if (type === 'bool') return 'False';
    if (type.startsWith('List[')) return 'field(default_factory=list)';
    if (type.startsWith('Dict[')) return 'field(default_factory=dict)';
    return "''";
  }

  toSnakeCase(name) {
    return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '').replace(/-/g, '_');
  }

  _findMatchingEnum(enumValues) {
    for (const [name, schema] of Object.entries(this.schemas)) {
      if (schema.enum && schema.type === 'string' && arraysEqual(schema.enum, enumValues)) {
        return name;
      }
    }
    return null;
  }

  _findSchemaName(schema) {
    if (!schema || typeof schema !== 'object') return null;
    if (schema.$circularRef) return `'${schema.$circularRef}'`;

    for (const [name, s] of Object.entries(this.schemas)) {
      if (s === schema) return name;
      if (s.properties && schema.properties) {
        const sKeys = Object.keys(s.properties).sort().join(',');
        const schemaKeys = Object.keys(schema.properties).sort().join(',');
        if (sKeys === schemaKeys && sKeys.length > 0) return name;
      }
    }
    return null;
  }

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

  getDependencies(name) {
    const schema = this.schemas[name];
    if (!schema) return [];
    const deps = new Set();

    const collectDeps = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.$circularRef) { deps.add(obj.$circularRef); return; }
      if (Array.isArray(obj)) { obj.forEach(collectDeps); return; }
      const refName = this._findSchemaName(obj);
      if (refName && refName !== name && !refName.startsWith("'")) deps.add(refName);
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

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * utils/openapi/type-mapper.js
 *
 * Maps OpenAPI types to TypeScript and Python types.
 */

/**
 * Type mapper for OpenAPI → target language
 */
export class TypeMapper {
  /**
   * Convert OpenAPI schema to TypeScript type string
   * @param {Object} schema - OpenAPI schema object
   * @param {string} [schemaName] - named schema reference
   * @returns {string} - TypeScript type
   */
  static toTypeScript(schema, schemaName = null) {
    if (!schema) return 'any';

    // Named reference (already resolved but carried as name)
    if (schemaName && !schema.type && !schema.oneOf && !schema.anyOf && !schema.allOf) {
      return schemaName;
    }

    // Circular ref
    if (schema.$circularRef) return schema.$circularRef;

    // Nullable wrapper
    const nullable = schema.nullable === true;
    let type = this._toTypeScriptInner(schema);
    if (nullable) type = `${type} | null`;
    return type;
  }

  static _toTypeScriptInner(schema) {
    // Enum
    if (schema.enum && schema.type === 'string') {
      // Inline enum - return union of literals
      return schema.enum.map(v => `'${v}'`).join(' | ');
    }

    // oneOf / anyOf → union
    if (schema.oneOf) {
      return schema.oneOf.map(s => this.toTypeScript(s)).join(' | ');
    }
    if (schema.anyOf) {
      return schema.anyOf.map(s => this.toTypeScript(s)).join(' | ');
    }

    // allOf → intersection
    if (schema.allOf) {
      return schema.allOf.map(s => this.toTypeScript(s)).join(' & ');
    }

    // Array
    if (schema.type === 'array') {
      const itemType = schema.items ? this.toTypeScript(schema.items) : 'any';
      return `${itemType}[]`;
    }

    // Object with additionalProperties → Record
    if (schema.type === 'object' && schema.additionalProperties && !schema.properties) {
      const valueType = typeof schema.additionalProperties === 'object'
        ? this.toTypeScript(schema.additionalProperties)
        : 'any';
      return `Record<string, ${valueType}>`;
    }

    // Primitive types
    switch (schema.type) {
      case 'string':
        if (schema.format === 'binary') return 'Blob';
        return 'string';
      case 'integer':
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'object':
        return 'Record<string, unknown>';
      default:
        return 'any';
    }
  }

  /**
   * Convert OpenAPI schema to Python type string
   * @param {Object} schema - OpenAPI schema object
   * @param {string} [schemaName] - named schema reference
   * @returns {string} - Python type
   */
  static toPython(schema, schemaName = null) {
    if (!schema) return 'Any';

    if (schemaName && !schema.type && !schema.oneOf && !schema.anyOf && !schema.allOf) {
      return schemaName;
    }

    if (schema.$circularRef) return `'${schema.$circularRef}'`;

    const nullable = schema.nullable === true;
    let type = this._toPythonInner(schema);
    if (nullable) type = `Optional[${type}]`;
    return type;
  }

  static _toPythonInner(schema) {
    // Enum
    if (schema.enum && schema.type === 'string') {
      return 'str';
    }

    // oneOf / anyOf → Union
    if (schema.oneOf) {
      const types = schema.oneOf.map(s => this.toPython(s));
      return `Union[${types.join(', ')}]`;
    }
    if (schema.anyOf) {
      const types = schema.anyOf.map(s => this.toPython(s));
      return `Union[${types.join(', ')}]`;
    }

    // allOf → just merge (first named type or Any)
    if (schema.allOf) {
      const types = schema.allOf.map(s => this.toPython(s));
      return types[0] || 'Any';
    }

    // Array
    if (schema.type === 'array') {
      const itemType = schema.items ? this.toPython(schema.items) : 'Any';
      return `List[${itemType}]`;
    }

    // Object with additionalProperties → Dict
    if (schema.type === 'object' && schema.additionalProperties && !schema.properties) {
      const valueType = typeof schema.additionalProperties === 'object'
        ? this.toPython(schema.additionalProperties)
        : 'Any';
      return `Dict[str, ${valueType}]`;
    }

    // Primitive types
    switch (schema.type) {
      case 'string':
        if (schema.format === 'date-time') return 'datetime';
        if (schema.format === 'date') return 'date';
        if (schema.format === 'binary') return 'bytes';
        return 'str';
      case 'integer':
        return 'int';
      case 'number':
        return 'float';
      case 'boolean':
        return 'bool';
      case 'object':
        return 'Dict[str, Any]';
      default:
        return 'Any';
    }
  }

  /**
   * Map a parameter type for method signatures
   * @param {Object} param - OpenAPI parameter object
   * @param {string} language - 'typescript' | 'python'
   * @returns {string}
   */
  static mapParamType(param, language) {
    const schema = param.schema || param;
    if (language === 'typescript') return this.toTypeScript(schema);
    return this.toPython(schema);
  }
}

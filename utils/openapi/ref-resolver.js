/**
 * utils/openapi/ref-resolver.js
 *
 * Recursive $ref resolution for OpenAPI specs.
 * Handles internal refs, circular refs, allOf/oneOf/anyOf.
 */

/**
 * Resolve all $ref in a spec object (in-place on a deep clone)
 * @param {Object} spec - full OpenAPI spec
 * @returns {Object} - spec with resolved $ref
 */
export function resolveAllRefs(spec) {
  const clone = JSON.parse(JSON.stringify(spec));
  const cache = new Map();
  resolveObject(clone, clone, new Set(), cache);
  return clone;
}

/**
 * Recursively walk an object and resolve $ref
 */
function resolveObject(obj, root, visited, cache) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (obj[i] && typeof obj[i] === 'object' && obj[i].$ref) {
        obj[i] = resolveRef(obj[i].$ref, root, visited, cache);
      } else {
        resolveObject(obj[i], root, visited, cache);
      }
    }
    return obj;
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (!val || typeof val !== 'object') continue;

    if (val.$ref) {
      obj[key] = resolveRef(val.$ref, root, visited, cache);
    } else {
      resolveObject(val, root, visited, cache);
    }
  }

  return obj;
}

/**
 * Resolve a single $ref string
 * @param {string} ref - e.g. "#/components/schemas/Pet"
 * @param {Object} root - root spec object
 * @param {Set} visited - cycle detection
 * @param {Map} cache - resolved ref cache
 * @returns {Object} - resolved object
 */
export function resolveRef(ref, root, visited = new Set(), cache = new Map()) {
  if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) {
    // External $ref - not supported
    return { $externalRef: ref, _warning: 'External $ref not supported' };
  }

  if (cache.has(ref)) {
    return cache.get(ref);
  }

  if (visited.has(ref)) {
    // Circular reference
    const name = ref.split('/').pop();
    return { $circularRef: name };
  }

  visited.add(ref);

  const parts = ref.replace('#/', '').split('/');
  let resolved = root;
  for (const part of parts) {
    const decoded = decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (resolved == null || typeof resolved !== 'object') {
      visited.delete(ref);
      return { $brokenRef: ref, _warning: `Could not resolve path segment: ${decoded}` };
    }
    resolved = resolved[decoded];
  }

  if (resolved == null) {
    visited.delete(ref);
    return { $brokenRef: ref };
  }

  // Deep clone to avoid mutation
  const result = JSON.parse(JSON.stringify(resolved));

  // Cache before recursing to handle self-references
  cache.set(ref, result);

  // Recursively resolve nested $ref
  resolveObject(result, root, visited, cache);

  visited.delete(ref);
  return result;
}

/**
 * Merge allOf schemas into a single schema
 * @param {Array} allOfSchemas - array of schemas
 * @returns {Object} - merged schema
 */
export function mergeAllOf(allOfSchemas) {
  const merged = {
    type: 'object',
    properties: {},
    required: [],
  };
  let description = '';

  for (const schema of allOfSchemas) {
    if (schema.properties) {
      Object.assign(merged.properties, schema.properties);
    }
    if (schema.required) {
      merged.required.push(...schema.required);
    }
    if (schema.description && !description) {
      description = schema.description;
    }
    // Carry over other top-level fields
    if (schema.type) merged.type = schema.type;
  }

  if (description) merged.description = description;
  merged.required = [...new Set(merged.required)];
  if (merged.required.length === 0) delete merged.required;

  return merged;
}

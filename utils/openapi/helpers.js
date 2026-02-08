/**
 * utils/openapi/helpers.js
 *
 * Shared utilities for OpenAPI processing.
 */

/**
 * Compare two arrays for shallow equality
 */
export function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Build a signature from object properties (key + type) for schema matching.
 * Used by _findSchemaName to avoid false positives from key-only comparison.
 */
export function schemaSignature(properties) {
  if (!properties) return '';
  return Object.entries(properties)
    .map(([k, v]) => `${k}:${v.type || v.$circularRef || '?'}`)
    .sort()
    .join(',');
}

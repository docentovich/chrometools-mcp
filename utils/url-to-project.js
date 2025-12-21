/**
 * utils/url-to-project.js
 *
 * Utilities for extracting project ID from website URLs.
 * Used by scenario recorder to organize scenarios by domain.
 */

/**
 * Extract project ID from URL
 *
 * Strategy (v3.0):
 * - Always use main domain only (strip all subdomains)
 * - Include ports for ALL domains (localhost and others)
 * - file:// URLs → "local"
 * - Invalid URLs → "unknown"
 *
 * Examples:
 * - https://www.google.com → "google"
 * - https://dev.example.com:8080 → "example-8080"
 * - https://mail.google.com → "google"
 * - http://localhost:3000 → "localhost-3000"
 * - https://api.stripe.com:443 → "stripe-443"
 * - file:///C:/test.html → "local"
 *
 * @param {string} url - Full URL
 * @returns {string} - Project ID (e.g., "google", "localhost-3000", "example-8080")
 */
export function urlToProjectId(url) {
  try {
    // Handle file:// protocol
    if (url.startsWith('file://')) {
      return 'local';
    }

    const urlObj = new URL(url);
    let hostname = urlObj.hostname.toLowerCase();
    const port = urlObj.port;

    // Remove www prefix
    hostname = hostname.replace(/^www\./, '');

    // Split hostname into parts
    const parts = hostname.split('.');

    // Single-level hostnames (e.g., "localhost", "example")
    if (parts.length === 1) {
      const projectId = sanitizeProjectId(parts[0]);
      return port ? `${projectId}-${port}` : projectId;
    }

    // Multi-level hostnames: extract main domain (second-to-last part before TLD)
    // Examples:
    // - google.com → parts=['google', 'com'] → mainDomain='google'
    // - dev.example.com → parts=['dev', 'example', 'com'] → mainDomain='example'
    // - mail.google.co.uk → parts=['mail', 'google', 'co', 'uk'] → mainDomain='co' (not ideal, but simple)
    const mainDomain = parts[parts.length - 2];
    const projectId = sanitizeProjectId(mainDomain);

    // Add port if present (for ALL domains, not just localhost)
    return port ? `${projectId}-${port}` : projectId;

  } catch (error) {
    // Invalid URL, return safe fallback
    console.error('[url-to-project] Invalid URL:', url, error);
    return 'unknown';
  }
}

/**
 * Sanitize project ID
 * - Lowercase everything
 * - Replace non-alphanumeric characters with hyphens
 * - Collapse multiple hyphens into one
 * - Remove leading/trailing hyphens
 *
 * @param {string} id - Raw project ID
 * @returns {string} - Sanitized ID
 */
function sanitizeProjectId(id) {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')  // Replace non-alphanumeric with hyphens
    .replace(/-+/g, '-')          // Collapse multiple hyphens
    .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
}

/**
 * Get browser-compatible version of urlToProjectId for injection
 * Returns the function as a string to be injected into browser context
 *
 * @returns {string} - Function code as string
 */
export function getUrlToProjectIdForBrowser() {
  return `
/**
 * Extract project ID from URL (browser version)
 * @param {string} url - Full URL
 * @returns {string} - Project ID
 */
function urlToProjectId(url) {
  try {
    if (url.startsWith('file://')) {
      return 'local';
    }

    const urlObj = new URL(url);
    let hostname = urlObj.hostname.toLowerCase();
    const port = urlObj.port;

    hostname = hostname.replace(/^www\\./, '');
    const parts = hostname.split('.');

    if (parts.length === 1) {
      const projectId = sanitizeProjectId(parts[0]);
      return port ? \`\${projectId}-\${port}\` : projectId;
    }

    const mainDomain = parts[parts.length - 2];
    const projectId = sanitizeProjectId(mainDomain);
    return port ? \`\${projectId}-\${port}\` : projectId;

  } catch (error) {
    console.error('[url-to-project] Invalid URL:', url, error);
    return 'unknown';
  }
}

/**
 * Sanitize project ID (browser version)
 * @param {string} id - Raw project ID
 * @returns {string} - Sanitized ID
 */
function sanitizeProjectId(id) {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
`;
}

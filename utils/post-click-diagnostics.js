/**
 * Post-Action Diagnostics
 * Collects errors and waits for network requests after user actions (click, navigation, etc.)
 */

import { consoleLogs, networkRequests } from '../browser/page-manager.js';
import { getNetworkRequestsFromBridge, isBridgeConnected } from '../bridge/bridge-client.js';

/**
 * Wait for network requests to complete
 * Tracks all requests (GET, POST, PUT, PATCH, DELETE) that started within detection window
 * @param {number} beforeActionTimestamp - Timestamp before action to track new requests
 * @param {number} detectionWindowMs - Time window to detect requests (default: 200ms)
 * @param {number} maxWaitMs - Maximum time to wait for requests (default: 10000ms)
 * @returns {Promise<{pendingFound: boolean, waitedMs: number, completedRequests: number, totalRequests: number}>}
 */
export async function waitForPendingRequests(beforeActionTimestamp, detectionWindowMs = 200, maxWaitMs = 10000) {
  const startTime = Date.now();

  // Step 1: Wait for detection window to let requests start
  await new Promise(resolve => setTimeout(resolve, detectionWindowMs));

  // Step 2: Find all requests (GET, POST, PUT, PATCH, DELETE) that started within detection window
  const cutoffStart = new Date(beforeActionTimestamp).toISOString();
  const cutoffEnd = new Date(beforeActionTimestamp + detectionWindowMs).toISOString();

  const trackedRequests = networkRequests.filter(req => {
    // Track all HTTP methods
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return false;
    }
    // Only requests in detection window [T0, T0+200ms]
    return req.timestamp >= cutoffStart && req.timestamp <= cutoffEnd;
  });

  // If no requests found, return immediately
  if (trackedRequests.length === 0) {
    return {
      pendingFound: false,
      waitedMs: Date.now() - startTime,
      completedRequests: 0,
      stillPending: 0,
      pendingRequests: [],
      totalRequests: 0,
      trackedRequests: []
    };
  }

  // Step 3: Wait for these specific requests to complete
  const trackedRequestIds = new Set(trackedRequests.map(req => req.requestId));

  const checkPending = () => {
    return networkRequests.filter(req =>
      trackedRequestIds.has(req.requestId) && req.status === 'pending'
    );
  };

  let pending = checkPending();
  const initialPendingCount = pending.length;

  // Wait for requests to complete (with configurable timeout)
  while (pending.length > 0 && (Date.now() - startTime) < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
    pending = checkPending();
  }

  // Collect final results for tracked requests
  const finalRequests = networkRequests.filter(req => trackedRequestIds.has(req.requestId));
  const completedRequests = finalRequests.filter(req => req.status === 'completed' || (typeof req.status === 'number'));
  const stillPendingRequests = pending.map(req => ({
    url: req.url,
    method: req.method,
    timestamp: req.timestamp,
    status: 'pending' // Still waiting after timeout
  }));

  return {
    pendingFound: initialPendingCount > 0,
    waitedMs: Date.now() - startTime,
    completedRequests: completedRequests.length,
    stillPending: pending.length,
    pendingRequests: stillPendingRequests,
    totalRequests: finalRequests.length,
    trackedRequests: finalRequests.map(req => ({
      method: req.method,
      url: req.url,
      status: req.status,
      statusText: req.statusText
    }))
  };
}

/**
 * Collect errors from console logs and network requests
 * @param {number} sinceTimestamp - Only collect errors after this timestamp (default: collect recent errors)
 * @param {number} maxConsoleErrors - Maximum console errors to return (default: 15)
 * @param {number} maxNetworkErrors - Maximum network errors to return (default: 15)
 * @returns {Object} Object with consoleErrors and networkErrors arrays
 */
export function collectErrors(sinceTimestamp = null, maxConsoleErrors = 15, maxNetworkErrors = 15) {
  const errors = {
    consoleErrors: [],
    networkErrors: [],
    jsExceptions: [],
    consoleErrorsOmitted: 0,
    networkErrorsOmitted: 0
  };

  // If no timestamp provided, look back 10 seconds
  const cutoffTime = sinceTimestamp || (Date.now() - 10000);
  const cutoffDate = new Date(cutoffTime).toISOString();

  // Collect console errors (with limit)
  let consoleErrorCount = 0;
  consoleLogs.forEach(log => {
    if (log.type === 'error') {
      // Check if error is recent
      const logTime = new Date(log.timestamp || 0).toISOString();
      if (!sinceTimestamp || logTime >= cutoffDate) {
        if (consoleErrorCount < maxConsoleErrors) {
          errors.consoleErrors.push({
            message: log.text,
            timestamp: log.timestamp,
            location: log.location || 'unknown'
          });
        } else {
          errors.consoleErrorsOmitted++;
        }
        consoleErrorCount++;
      }
    }
  });

  // Collect network errors (failed requests, with limit)
  let networkErrorCount = 0;
  networkRequests.forEach(req => {
    if (req.status === 'failed' || (typeof req.status === 'number' && req.status >= 400)) {
      // Check if error is recent
      const reqTime = req.timestamp;
      if (!sinceTimestamp || reqTime >= cutoffDate) {
        if (networkErrorCount < maxNetworkErrors) {
          errors.networkErrors.push({
            url: req.url,
            method: req.method,
            status: req.status,
            statusText: req.statusText,
            errorText: req.errorText,
            timestamp: req.timestamp
          });
        } else {
          errors.networkErrorsOmitted++;
        }
        networkErrorCount++;
      }
    }
  });

  return errors;
}

/**
 * Full post-action diagnostics: wait for requests and collect errors
 * @param {Page} page - Puppeteer page instance
 * @param {number} beforeActionTimestamp - Timestamp before action (to filter errors)
 * @param {Object} options - Options for diagnostics
 * @param {boolean} options.skipNetworkWait - Skip waiting for network requests (default: false)
 * @param {number} options.networkWaitTimeout - Custom timeout for network wait in ms (default: 10000)
 * @param {string} options.urlBeforeAction - URL before action (to detect navigation/form submit)
 * @returns {Promise<Object>} Diagnostics result with errors and network info
 */
export async function runPostClickDiagnostics(page, beforeActionTimestamp, options = {}) {
  const { skipNetworkWait = false, networkWaitTimeout = 10000, urlBeforeAction = null } = options;

  // Wait for network requests (all methods within 200ms detection window)
  // Default maxWait = 10s for click, configurable via networkWaitTimeout parameter
  const networkInfo = skipNetworkWait
    ? { pendingFound: false, waitedMs: 0, completedRequests: 0, stillPending: 0, pendingRequests: [], totalRequests: 0, trackedRequests: [], allRecentRequests: [] }
    : await waitForPendingRequests(beforeActionTimestamp, 200, networkWaitTimeout);

  // Small delay to let pending requests update their error status
  // (handles case where request completes with error right after maxWait expires)
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check for page navigation (indicates form submit in non-SPA apps)
  const currentUrl = page.url();
  let navigationDetected = null;
  if (urlBeforeAction && currentUrl !== urlBeforeAction) {
    navigationDetected = {
      from: urlBeforeAction,
      to: currentUrl,
      likelyFormSubmit: true // Page URL changed after click - likely form POST with redirect
    };
  }

  // Fetch network requests from Bridge (Extension webRequest API)
  // These persist across page navigations, unlike CDP requests
  let bridgeRequests = [];
  if (isBridgeConnected()) {
    try {
      const allBridgeRequests = await getNetworkRequestsFromBridge({ timeout: 2000 });
      // Filter to requests after beforeActionTimestamp
      const cutoffTime = beforeActionTimestamp - 1000; // 1s buffer
      bridgeRequests = allBridgeRequests.filter(req =>
        req.timestamp >= cutoffTime
      );
    } catch (e) {
      // Bridge not available, continue without
    }
  }

  // Check for chrome error page (ERR_CONNECTION_REFUSED, etc.)
  const url = currentUrl;
  let chromeErrorInfo = null;
  if (url.startsWith('chrome-error://')) {
    chromeErrorInfo = await page.evaluate(() => {
      const errorCode = document.querySelector('#error-code');
      const suggestionText = document.querySelector('.suggestions');
      return {
        errorCode: errorCode?.textContent || 'UNKNOWN_ERROR',
        suggestion: suggestionText?.textContent?.trim() || 'Connection failed'
      };
    }).catch(() => ({ errorCode: 'PAGE_LOAD_ERROR', suggestion: 'Navigation failed' }));
  }

  // Collect errors that occurred after the action (including errors from just-completed requests)
  const errors = collectErrors(beforeActionTimestamp);

  // Combine into diagnostics report
  const diagnostics = {
    networkActivity: {
      hadPendingRequests: networkInfo.pendingFound,
      completedRequests: networkInfo.completedRequests,
      stillPending: networkInfo.stillPending,
      pendingRequests: networkInfo.pendingRequests,
      totalRequests: networkInfo.totalRequests,
      waitedMs: networkInfo.waitedMs,
      trackedRequests: networkInfo.trackedRequests || [],
      allRecentRequests: networkInfo.allRecentRequests || [],
      // Bridge requests (from Extension webRequest API) - persist across page navigations
      bridgeRequests: bridgeRequests.map(req => ({
        method: req.method,
        url: req.url,
        type: req.type,
        status: req.status,
        timestamp: req.timestamp
      }))
    },
    navigation: navigationDetected,
    chromeError: chromeErrorInfo,
    errors: {
      consoleErrors: errors.consoleErrors,
      networkErrors: errors.networkErrors,
      consoleErrorsOmitted: errors.consoleErrorsOmitted,
      networkErrorsOmitted: errors.networkErrorsOmitted,
      totalErrors: errors.consoleErrors.length + errors.networkErrors.length
    },
    hasErrors: (errors.consoleErrors.length + errors.networkErrors.length) > 0 || chromeErrorInfo !== null
  };

  return diagnostics;
}

/**
 * Format diagnostics for AI-friendly output
 * @param {Object} diagnostics - Diagnostics object from runPostClickDiagnostics
 * @returns {string} Formatted text for AI
 */
export function formatDiagnosticsForAI(diagnostics) {
  let output = '\n\n** POST-ACTION DIAGNOSTICS **';

  // Chrome error page (connection refused, DNS failed, etc.)
  if (diagnostics.chromeError) {
    output += `\n\n🔴 CRITICAL: Navigation Failed`;
    output += `\n   Error: ${diagnostics.chromeError.errorCode}`;
    output += `\n   Suggestion: ${diagnostics.chromeError.suggestion}`;
    output += `\n   → Backend likely not running or unreachable`;
  }

  // Page navigation detection (form submit in non-SPA apps)
  if (diagnostics.navigation) {
    const to = diagnostics.navigation.to || '';
    const isAuthRedirect = /login|signin|auth/i.test(to)
      && /[?&](returnUrl|return_url|redirect|next)/i.test(to);
    if (isAuthRedirect) {
      output += `\n\n⚠️ AUTH REDIRECT detected:`;
      output += `\n   From: ${diagnostics.navigation.from}`;
      output += `\n   To: ${diagnostics.navigation.to}`;
      output += `\n   → Session not established. Ensure login completes and cookies are set before navigating to protected routes.`;
    } else {
      output += `\n\n🔄 Page navigation detected (form submit):`;
      output += `\n   From: ${diagnostics.navigation.from}`;
      output += `\n   To: ${diagnostics.navigation.to}`;
      output += `\n   → This indicates a successful form POST with page reload`;
    }
  }

  // Network activity - show all tracked requests (GET/POST/PUT/PATCH/DELETE)
  const netActivity = diagnostics.networkActivity;
  const trackedRequests = netActivity.trackedRequests || [];

  // Show requests detected within 200ms after action
  if (trackedRequests.length > 0) {
    output += `\n\n📡 Network requests (${trackedRequests.length}):`;
    trackedRequests.forEach((req, idx) => {
      const statusIcon = req.status === 'pending' ? '⏳' :
                        (req.status === 'completed' || (typeof req.status === 'number' && req.status < 400) ? '✓' : '✗');
      const statusText = req.statusText || req.status || 'pending';
      output += `\n  ${idx + 1}. ${statusIcon} ${req.method} ${req.url}`;
      output += `\n     → Status: ${statusText}`;
    });

    // Show if some requests are still pending after timeout
    if (netActivity.stillPending > 0) {
      output += `\n\n⏳ ${netActivity.stillPending} request(s) still pending after ${Math.round(netActivity.waitedMs)}ms timeout`;
    }
  } else {
    output += '\n\n📡 No network requests detected within 200ms';
  }

  // Bridge requests (from Extension - persist across page reloads)
  const bridgeRequests = netActivity.bridgeRequests || [];
  if (bridgeRequests.length > 0) {
    output += `\n\n📡 Browser-level requests (via Extension):`;
    bridgeRequests.forEach((req, idx) => {
      const statusIcon = req.status === 'pending' ? '⏳' :
                        (req.status === 'completed' || (typeof req.status === 'number' && req.status < 400) ? '✓' : '✗');
      output += `\n  ${idx + 1}. ${statusIcon} ${req.method} ${req.url}`;
      if (req.status !== 'pending') {
        output += ` → ${req.status}`;
      }
    });
  }

  // Errors
  if (diagnostics.errors.totalErrors > 0) {
    output += `\n\n⚠️  ERRORS DETECTED (${diagnostics.errors.totalErrors} total):`;

    // Console errors
    if (diagnostics.errors.consoleErrors.length > 0) {
      output += `\n\nJavaScript Console Errors (${diagnostics.errors.consoleErrors.length}):`;
      diagnostics.errors.consoleErrors.forEach((err, idx) => {
        output += `\n  ${idx + 1}. ${err.message}`;
        if (err.location && err.location !== 'unknown') {
          output += ` [${err.location}]`;
        }
      });
      // Show if some errors were omitted
      if (diagnostics.errors.consoleErrorsOmitted > 0) {
        output += `\n  ... and ${diagnostics.errors.consoleErrorsOmitted} more console error(s) (omitted to prevent spam)`;
      }
    }

    // Network errors
    if (diagnostics.errors.networkErrors.length > 0) {
      output += `\n\nNetwork Errors (${diagnostics.errors.networkErrors.length}):`;
      diagnostics.errors.networkErrors.forEach((err, idx) => {
        output += `\n  ${idx + 1}. ${err.method} ${err.url}`;
        output += `\n     Status: ${err.status}${err.statusText ? ' ' + err.statusText : ''}`;
        if (err.errorText) {
          output += `\n     Error: ${err.errorText}`;
        }
      });
      // Show if some errors were omitted
      if (diagnostics.errors.networkErrorsOmitted > 0) {
        output += `\n  ... and ${diagnostics.errors.networkErrorsOmitted} more network error(s) (omitted to prevent spam)`;
      }
    }
  } else {
    output += '\n✓ No errors detected';
  }

  // Pending requests (if any still running after timeout)
  if (netActivity.stillPending > 0 && netActivity.pendingRequests.length > 0) {
    output += `\n\n⏳ PENDING REQUESTS (${netActivity.stillPending} still running):`;
    netActivity.pendingRequests.forEach((req, idx) => {
      output += `\n  ${idx + 1}. ${req.method} ${req.url}`;
      const elapsed = Date.now() - new Date(req.timestamp).getTime();
      output += `\n     Running for: ${elapsed}ms`;
    });
    output += `\n\n💡 Suggestion: These requests may be slow or hanging`;
    output += `\n   → Check backend performance or network connectivity`;
    output += `\n   → Consider using getNetworkRequest() to monitor progress`;
  }

  return output;
}

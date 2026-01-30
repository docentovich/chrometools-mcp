/**
 * Post-Action Diagnostics
 * Collects errors and waits for network requests after user actions (click, navigation, etc.)
 */

import { consoleLogs, networkRequests } from '../browser/page-manager.js';

/**
 * Wait for pending network requests to complete
 * @param {number} beforeActionTimestamp - Timestamp before action to track new requests
 * @param {number} initialWaitMs - Initial wait time before checking (default: 500ms)
 * @param {number} maxWaitMs - Maximum time to wait for requests (default: 10000ms for Django forms)
 * @returns {Promise<{pendingFound: boolean, waitedMs: number, completedRequests: number, totalRequests: number}>}
 */
export async function waitForPendingRequests(beforeActionTimestamp, initialWaitMs = 500, maxWaitMs = 10000) {
  const startTime = Date.now();

  // Step 1: Wait initial period to let requests start
  await new Promise(resolve => setTimeout(resolve, initialWaitMs));

  // Step 2: Get requests that started AFTER action
  const getPostActionRequests = () => {
    const cutoffDate = new Date(beforeActionTimestamp).toISOString();
    return networkRequests.filter(req => req.timestamp >= cutoffDate);
  };

  // Step 3: Check for pending requests (from post-action requests)
  const checkPending = () => {
    return getPostActionRequests().filter(req => req.status === 'pending');
  };

  let pending = checkPending();
  let allPostActionRequests = getPostActionRequests();
  const initialPendingCount = pending.length;

  // Step 4: If there are pending requests OR new requests appeared, wait for completion
  if (pending.length > 0 || allPostActionRequests.length > 0) {
    // Wait for pending requests to complete (with timeout)
    while (pending.length > 0 && (Date.now() - startTime) < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
      pending = checkPending();
      allPostActionRequests = getPostActionRequests(); // Update total count
    }
  }

  const finalRequests = getPostActionRequests();
  const completedRequests = finalRequests.filter(req => req.status === 'completed' || (typeof req.status === 'number'));
  const pendingRequests = pending.map(req => ({
    url: req.url,
    method: req.method,
    timestamp: req.timestamp
  }));

  return {
    pendingFound: initialPendingCount > 0,
    waitedMs: Date.now() - startTime,
    completedRequests: completedRequests.length,
    stillPending: pending.length,
    pendingRequests: pendingRequests,
    totalRequests: finalRequests.length
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
 * @returns {Promise<Object>} Diagnostics result with errors and network info
 */
export async function runPostClickDiagnostics(page, beforeActionTimestamp, options = {}) {
  const { skipNetworkWait = false, networkWaitTimeout = 10000 } = options;

  // Wait for network requests (passing timestamp to track post-action requests)
  // Default maxWait = 10s (configurable via networkWaitTimeout parameter)
  const networkInfo = skipNetworkWait
    ? { pendingFound: false, waitedMs: 0, completedRequests: 0, stillPending: 0, pendingRequests: [], totalRequests: 0 }
    : await waitForPendingRequests(beforeActionTimestamp, 500, networkWaitTimeout);

  // Small delay to let pending requests update their error status
  // (handles case where request completes with error right after maxWait expires)
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check for chrome error page (ERR_CONNECTION_REFUSED, etc.)
  const url = page.url();
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
      waitedMs: networkInfo.waitedMs
    },
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

  // Network activity
  const netActivity = diagnostics.networkActivity;
  if (netActivity.totalRequests > 0) {
    const errorCount = diagnostics.errors.networkErrors.length;
    const successCount = netActivity.completedRequests - errorCount;

    // Show warning if there are pending requests after timeout
    if (netActivity.stillPending > 0) {
      output += `\n⚠️  Network: ${successCount} OK, ${errorCount} failed, ${netActivity.stillPending} PENDING`;
      output += `\n   ⏱️  Timeout: Stopped waiting after ${netActivity.waitedMs}ms`;
      output += `\n   → ${netActivity.stillPending} request(s) still running - status unknown`;
      output += `\n   → May complete successfully or fail - cannot determine outcome`;
    } else if (errorCount > 0) {
      output += `\n⚠️  Network: ${successCount} OK, ${errorCount} failed (${netActivity.waitedMs}ms)`;
    } else {
      output += `\n✓ Network: ${netActivity.completedRequests} completed (${netActivity.waitedMs}ms)`;
    }
  } else {
    output += '\n✓ No network requests triggered';
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

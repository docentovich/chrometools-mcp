/**
 * Post-Click Diagnostics
 * Collects errors and waits for network requests after click actions
 */

import { consoleLogs, networkRequests } from '../browser/page-manager.js';

/**
 * Wait for pending network requests to complete
 * @param {number} initialWaitMs - Initial wait time before checking (default: 500ms)
 * @param {number} maxWaitMs - Maximum time to wait for requests (default: 5000ms)
 * @returns {Promise<{pendingFound: boolean, waitedMs: number, completedRequests: number}>}
 */
export async function waitForPendingRequests(initialWaitMs = 500, maxWaitMs = 5000) {
  // Step 1: Wait initial period to let requests start
  await new Promise(resolve => setTimeout(resolve, initialWaitMs));

  const startTime = Date.now();
  let pendingFound = false;
  let completedCount = 0;

  // Step 2: Check for pending requests
  const checkPending = () => {
    return networkRequests.filter(req => req.status === 'pending');
  };

  let pending = checkPending();

  if (pending.length > 0) {
    pendingFound = true;

    // Step 3: Wait for pending requests to complete (with timeout)
    while (pending.length > 0 && (Date.now() - startTime) < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
      const stillPending = checkPending();
      completedCount = pending.length - stillPending.length;
      pending = stillPending;
    }
  }

  return {
    pendingFound,
    waitedMs: Date.now() - startTime,
    completedRequests: completedCount,
    stillPending: pending.length
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
 * Full post-click diagnostics: wait for requests and collect errors
 * @param {number} beforeClickTimestamp - Timestamp before click (to filter errors)
 * @returns {Promise<Object>} Diagnostics result with errors and network info
 */
export async function runPostClickDiagnostics(beforeClickTimestamp) {
  // Wait for network requests
  const networkInfo = await waitForPendingRequests(500, 5000);

  // Collect errors that occurred after the click
  const errors = collectErrors(beforeClickTimestamp);

  // Combine into diagnostics report
  const diagnostics = {
    networkActivity: {
      hadPendingRequests: networkInfo.pendingFound,
      completedRequests: networkInfo.completedRequests,
      stillPending: networkInfo.stillPending,
      waitedMs: networkInfo.waitedMs
    },
    errors: {
      consoleErrors: errors.consoleErrors,
      networkErrors: errors.networkErrors,
      consoleErrorsOmitted: errors.consoleErrorsOmitted,
      networkErrorsOmitted: errors.networkErrorsOmitted,
      totalErrors: errors.consoleErrors.length + errors.networkErrors.length
    },
    hasErrors: (errors.consoleErrors.length + errors.networkErrors.length) > 0
  };

  return diagnostics;
}

/**
 * Format diagnostics for AI-friendly output
 * @param {Object} diagnostics - Diagnostics object from runPostClickDiagnostics
 * @returns {string} Formatted text for AI
 */
export function formatDiagnosticsForAI(diagnostics) {
  let output = '\n\n** POST-CLICK DIAGNOSTICS **';

  // Network activity
  if (diagnostics.networkActivity.hadPendingRequests) {
    output += `\n✓ Waited ${diagnostics.networkActivity.waitedMs}ms for ${diagnostics.networkActivity.completedRequests} network request(s)`;
    if (diagnostics.networkActivity.stillPending > 0) {
      output += ` (${diagnostics.networkActivity.stillPending} still pending - may be slow)`;
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

  return output;
}

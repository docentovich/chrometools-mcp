/**
 * Post-Click Diagnostics
 * Collects errors and waits for network requests after click actions
 */

import { consoleLogs, networkRequests } from '../browser/page-manager.js';

/**
 * Wait for pending network requests to complete
 * @param {number} beforeClickTimestamp - Timestamp before click to track new requests
 * @param {number} initialWaitMs - Initial wait time before checking (default: 500ms)
 * @param {number} maxWaitMs - Maximum time to wait for requests (default: 5000ms)
 * @returns {Promise<{pendingFound: boolean, waitedMs: number, completedRequests: number, totalRequests: number}>}
 */
export async function waitForPendingRequests(beforeClickTimestamp, initialWaitMs = 500, maxWaitMs = 5000) {
  const startTime = Date.now();

  // Step 1: Wait initial period to let requests start
  await new Promise(resolve => setTimeout(resolve, initialWaitMs));

  // Step 2: Get requests that started AFTER click
  const getPostClickRequests = () => {
    const cutoffDate = new Date(beforeClickTimestamp).toISOString();
    return networkRequests.filter(req => req.timestamp >= cutoffDate);
  };

  // Step 3: Check for pending requests (from post-click requests)
  const checkPending = () => {
    return getPostClickRequests().filter(req => req.status === 'pending');
  };

  let pending = checkPending();
  let allPostClickRequests = getPostClickRequests();
  const initialPendingCount = pending.length;

  // Step 4: If there are pending requests OR new requests appeared, wait for completion
  if (pending.length > 0 || allPostClickRequests.length > 0) {
    // Wait for pending requests to complete (with timeout)
    while (pending.length > 0 && (Date.now() - startTime) < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
      pending = checkPending();
      allPostClickRequests = getPostClickRequests(); // Update total count
    }
  }

  const finalRequests = getPostClickRequests();
  const completedRequests = finalRequests.filter(req => req.status === 'completed' || (typeof req.status === 'number'));

  return {
    pendingFound: initialPendingCount > 0,
    waitedMs: Date.now() - startTime,
    completedRequests: completedRequests.length,
    stillPending: pending.length,
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
 * Full post-click diagnostics: wait for requests and collect errors
 * @param {Page} page - Puppeteer page instance
 * @param {number} beforeClickTimestamp - Timestamp before click (to filter errors)
 * @returns {Promise<Object>} Diagnostics result with errors and network info
 */
export async function runPostClickDiagnostics(page, beforeClickTimestamp) {
  // Wait for network requests (passing timestamp to track post-click requests)
  const networkInfo = await waitForPendingRequests(beforeClickTimestamp, 500, 5000);

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

  // Collect errors that occurred after the click
  const errors = collectErrors(beforeClickTimestamp);

  // Combine into diagnostics report
  const diagnostics = {
    networkActivity: {
      hadPendingRequests: networkInfo.pendingFound,
      completedRequests: networkInfo.completedRequests,
      stillPending: networkInfo.stillPending,
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
  let output = '\n\n** POST-CLICK DIAGNOSTICS **';

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
    output += `\n✓ Network: ${netActivity.completedRequests} completed`;
    if (netActivity.stillPending > 0) {
      output += `, ${netActivity.stillPending} pending (waited ${netActivity.waitedMs}ms)`;
    } else {
      output += ` (${netActivity.waitedMs}ms)`;
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

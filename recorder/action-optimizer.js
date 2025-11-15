/**
 * recorder/action-optimizer.js
 *
 * Optimizes recorded action chains by:
 * 1. Combining sequential type actions
 * 2. Removing duplicate clicks
 * 3. Detecting patterns (e.g., custom select dropdowns)
 * 4. Merging redundant waits
 * 5. Removing unnecessary scroll actions
 */

/**
 * Optimize action chain
 * @param {Array} actions - Raw recorded actions
 * @returns {Array} - Optimized actions
 */
export function optimizeActions(actions) {
  if (!actions || actions.length === 0) {
    return [];
  }

  let optimized = [...actions];

  // Apply optimization passes in order
  optimized = removeRecorderWidgetEvents(optimized); // NEW: Remove events on recorder widget
  optimized = combineSequentialTypes(optimized);
  optimized = detectCustomSelects(optimized);
  optimized = removeDuplicateClicks(optimized);
  optimized = mergeWaits(optimized);
  optimized = removeUnnecessaryScrolls(optimized);
  optimized = removeUnnecessaryHovers(optimized);

  return optimized;
}

/**
 * Remove events on recorder widget itself
 * Filters out any action targeting the chrometools-recorder widget
 */
function removeRecorderWidgetEvents(actions) {
  return actions.filter(action => {
    const selector = action.selector?.primary || action.selector?.value || '';

    // Remove any action targeting recorder widget
    if (selector.includes('chrometools-recorder')) {
      return false;
    }

    // Also check elementInfo for recorder classes
    const classes = action.selector?.elementInfo?.classes || [];
    if (classes.some(cls => cls.includes('chrometools-recorder'))) {
      return false;
    }

    return true;
  });
}

/**
 * Combine sequential type actions on the same element
 * Before: type("H"), type("e"), type("l"), type("l"), type("o")
 * After: type("Hello")
 */
function combineSequentialTypes(actions) {
  const result = [];
  let i = 0;

  while (i < actions.length) {
    const action = actions[i];

    if (action.type === 'type') {
      // Collect all sequential type actions on same selector
      const typeActions = [action];
      let j = i + 1;

      while (j < actions.length && actions[j].type === 'type' &&
             actions[j].selector?.value === action.selector?.value) {
        typeActions.push(actions[j]);
        j++;
      }

      // Combine if multiple type actions found
      if (typeActions.length > 1) {
        const combinedText = typeActions.map(a => a.data.text).join('');
        const combinedAction = {
          ...action,
          data: {
            ...action.data,
            text: combinedText
          },
          timestamp: typeActions[typeActions.length - 1].timestamp
        };
        result.push(combinedAction);
        i = j;
      } else {
        result.push(action);
        i++;
      }
    } else {
      result.push(action);
      i++;
    }
  }

  return result;
}

/**
 * Detect custom select patterns
 * Pattern: click(dropdown) → wait → click(option)
 * Converts to: select with custom=true
 */
function detectCustomSelects(actions) {
  const result = [];
  let i = 0;

  while (i < actions.length) {
    // Look for pattern: click → (optional wait) → click
    if (i + 2 < actions.length &&
        actions[i].type === 'click' &&
        actions[i + 2].type === 'click') {

      const firstClick = actions[i];
      const maybeWait = actions[i + 1];
      const secondClick = actions[i + 2];

      // Check if middle action is a short wait
      const isWait = maybeWait.type === 'wait' && maybeWait.data.duration <= 1000;

      // Check if first click is on container and second is on option
      const isCustomSelect = isCustomSelectPattern(firstClick, secondClick);

      if (isCustomSelect) {
        // Create custom select action
        const selectAction = {
          type: 'select',
          selector: firstClick.selector,
          data: {
            value: secondClick.data?.text || secondClick.selector.elementInfo.text,
            selectType: 'custom',
            steps: [
              { action: 'click', selector: firstClick.selector.value },
              { action: 'wait', duration: isWait ? maybeWait.data.duration : 300 },
              { action: 'click', selector: secondClick.selector.value }
            ]
          },
          timestamp: secondClick.timestamp
        };

        result.push(selectAction);
        i += isWait ? 3 : 2;
        continue;
      }
    }

    result.push(actions[i]);
    i++;
  }

  return result;
}

/**
 * Check if two clicks match custom select pattern
 */
function isCustomSelectPattern(firstClick, secondClick) {
  const first = firstClick.selector?.elementInfo;
  const second = secondClick.selector?.elementInfo;

  if (!first || !second) {
    return false;
  }

  // Check for common custom select indicators
  const selectKeywords = ['select', 'dropdown', 'picker', 'choice', 'menu'];
  const optionKeywords = ['option', 'item', 'choice', 'menu-item'];

  const firstText = [
    first.classes?.join(' ') || '',
    first.id || '',
    first.role || ''
  ].join(' ').toLowerCase();

  const secondText = [
    second.classes?.join(' ') || '',
    second.id || '',
    second.role || ''
  ].join(' ').toLowerCase();

  const firstIsSelect = selectKeywords.some(kw => firstText.includes(kw));
  const secondIsOption = optionKeywords.some(kw => secondText.includes(kw));

  return firstIsSelect && secondIsOption;
}

/**
 * Remove duplicate clicks on same element within short time window
 */
function removeDuplicateClicks(actions) {
  const result = [];
  const DUPLICATE_THRESHOLD = 500; // ms

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    if (action.type === 'click') {
      // Check if next action is same click within threshold
      const next = actions[i + 1];

      if (next &&
          next.type === 'click' &&
          next.selector?.value === action.selector?.value &&
          (next.timestamp - action.timestamp) < DUPLICATE_THRESHOLD) {
        // Skip current click, keep the next one (more recent)
        continue;
      }
    }

    result.push(action);
  }

  return result;
}

/**
 * Merge sequential wait actions
 * Before: wait(100), wait(200)
 * After: wait(300)
 */
function mergeWaits(actions) {
  const result = [];
  let i = 0;

  while (i < actions.length) {
    const action = actions[i];

    if (action.type === 'wait') {
      // Collect sequential waits
      const waits = [action];
      let j = i + 1;

      while (j < actions.length && actions[j].type === 'wait') {
        waits.push(actions[j]);
        j++;
      }

      if (waits.length > 1) {
        const totalDuration = waits.reduce((sum, w) => sum + w.data.duration, 0);
        const mergedWait = {
          type: 'wait',
          data: { duration: totalDuration },
          timestamp: waits[waits.length - 1].timestamp
        };
        result.push(mergedWait);
        i = j;
      } else {
        result.push(action);
        i++;
      }
    } else {
      result.push(action);
      i++;
    }
  }

  return result;
}

/**
 * Remove unnecessary scroll actions
 * Scroll is unnecessary if:
 * 1. Immediately followed by another scroll to different position
 * 2. Element is already in viewport (can't detect this in optimizer, needs runtime check)
 */
function removeUnnecessaryScrolls(actions) {
  const result = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    if (action.type === 'scroll') {
      // Check if next non-wait action is also scroll
      let j = i + 1;
      while (j < actions.length && actions[j].type === 'wait') {
        j++;
      }

      if (j < actions.length && actions[j].type === 'scroll') {
        // Skip this scroll, the next one will be used
        continue;
      }
    }

    result.push(action);
  }

  return result;
}

/**
 * Remove unnecessary hover actions
 * Hover is unnecessary if:
 * 1. Immediately followed by click on same element (click already triggers hover)
 * 2. Multiple hovers on same element
 */
function removeUnnecessaryHovers(actions) {
  const result = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    if (action.type === 'hover') {
      // Check if immediately followed by click on same element
      const next = actions[i + 1];

      if (next &&
          next.type === 'click' &&
          next.selector?.value === action.selector?.value) {
        // Skip hover, click will handle it
        continue;
      }

      // Check if previous action was hover on same element
      const prev = result[result.length - 1];
      if (prev &&
          prev.type === 'hover' &&
          prev.selector?.value === action.selector?.value) {
        // Skip duplicate hover
        continue;
      }
    }

    result.push(action);
  }

  return result;
}

/**
 * Analyze action chain and generate statistics
 * Useful for debugging and showing optimization results
 */
export function analyzeActionChain(actions) {
  const stats = {
    total: actions.length,
    byType: {},
    duration: 0,
    secrets: 0,
    forms: new Set(),
    urls: new Set()
  };

  actions.forEach(action => {
    // Count by type
    stats.byType[action.type] = (stats.byType[action.type] || 0) + 1;

    // Calculate duration
    if (action.type === 'wait') {
      stats.duration += action.data.duration;
    }

    // Count secrets
    if (action.data?.isSecret) {
      stats.secrets++;
    }

    // Track forms
    if (action.selector?.elementInfo?.formId) {
      stats.forms.add(action.selector.elementInfo.formId);
    }

    // Track URLs
    if (action.type === 'navigate') {
      stats.urls.add(action.data.url);
    }
  });

  stats.forms = stats.forms.size;
  stats.urls = stats.urls.size;

  return stats;
}

/**
 * Compare action chains before/after optimization
 */
export function compareOptimization(before, after) {
  const beforeStats = analyzeActionChain(before);
  const afterStats = analyzeActionChain(after);

  return {
    before: beforeStats,
    after: afterStats,
    reduction: {
      actions: before.length - after.length,
      percentage: ((before.length - after.length) / before.length * 100).toFixed(1)
    },
    improvements: generateImprovementsSummary(before, after)
  };
}

/**
 * Generate human-readable summary of improvements
 */
function generateImprovementsSummary(before, after) {
  const improvements = [];

  // Count combined types
  const beforeTypes = before.filter(a => a.type === 'type').length;
  const afterTypes = after.filter(a => a.type === 'type').length;
  if (beforeTypes > afterTypes) {
    improvements.push(`Combined ${beforeTypes - afterTypes} sequential type actions`);
  }

  // Count detected custom selects
  const customSelects = after.filter(a => a.type === 'select' && a.data.selectType === 'custom').length;
  if (customSelects > 0) {
    improvements.push(`Detected ${customSelects} custom select pattern(s)`);
  }

  // Count removed duplicate clicks
  const beforeClicks = before.filter(a => a.type === 'click').length;
  const afterClicks = after.filter(a => a.type === 'click').length;
  if (beforeClicks > afterClicks) {
    improvements.push(`Removed ${beforeClicks - afterClicks} duplicate click(s)`);
  }

  // Count merged waits
  const beforeWaits = before.filter(a => a.type === 'wait').length;
  const afterWaits = after.filter(a => a.type === 'wait').length;
  if (beforeWaits > afterWaits) {
    improvements.push(`Merged ${beforeWaits - afterWaits} wait action(s)`);
  }

  return improvements;
}

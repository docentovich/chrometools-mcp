/**
 * server/tool-groups.js
 *
 * Tool group definitions for filtering
 */

export const toolGroups = {
  core: ['ping', 'openBrowser', 'executeScript', 'navigateTo', 'resetBrowser', 'listTabs', 'switchTab'],

  interaction: ['click', 'type', 'scrollTo', 'waitForElement', 'hover', 'selectOption', 'selectFromGroup', 'drag', 'scrollHorizontal', 'switchFrame', 'listFrames', 'typeCredential', 'listCredentials'],

  inspection: ['getElement', 'getComputedCss', 'getBoxModel', 'screenshot', 'saveScreenshot', 'getFontReport'],

  debug: [
    'getConsoleLogs',
    'listNetworkRequests',
    'getNetworkRequest',
    'filterNetworkRequests'
  ],

  advanced: [
    'setStyles',
    'setViewport',
    'getViewport',
    'smartFindElement',
    'analyzePage',
    'findElementsByText'
  ],

  recorder: [
    'enableRecorder',
    'executeScenario',
    'listScenarios',
    'searchScenarios',
    'getScenarioInfo',
    'deleteScenario',
    'exportScenarioAsCode',
    'appendScenarioToFile',
    'generatePageObject'
  ],

  figma: [
    'getFigmaFrame',
    'compareFigmaToElement',
    'getFigmaSpecs',
    'parseFigmaUrl',
    'listFigmaPages',
    'searchFigmaFrames',
    'getFigmaComponents',
    'getFigmaStyles',
    'getFigmaColorPalette',
    'convertFigmaToCode',
    'getFigmaNodeTree',
    'compareFigmaSpecs',
    'prefetchFigma',
    'importFigmaCache',
    'importFigmaRender',
    'figmaCacheStatus',
    'figmaCacheClear'
  ]
};

/**
 * Get all tool names from specified groups
 * @param {string[]} groupNames - Array of group names (e.g., ['core', 'interaction'])
 * @returns {Set<string>} - Set of tool names
 */
export function getToolsFromGroups(groupNames) {
  const tools = new Set();

  for (const groupName of groupNames) {
    const group = toolGroups[groupName];
    if (group) {
      group.forEach(tool => tools.add(tool));
    }
  }

  return tools;
}

/**
 * Get all available group names
 * @returns {string[]} - Array of group names
 */
export function getAllGroupNames() {
  return Object.keys(toolGroups);
}

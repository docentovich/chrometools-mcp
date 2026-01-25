/**
 * server/websocket-bridge.js
 *
 * WebSocket server for communication between Chrome Extension and MCP server
 */

import { WebSocketServer } from 'ws';
import { saveScenario, listScenarios } from '../recorder/scenario-storage.js';
import { urlToProjectId } from '../utils/url-to-project.js';

const WS_PORT = 9223;

// State
let wss = null;
let extensionConnection = null;
let isRunning = false;

// Tabs state from extension (source of truth)
export const extensionTabs = new Map();

// Callbacks for tab events
const tabEventCallbacks = [];

// Handler for syncing active tab (set by page-manager to avoid circular imports)
let activeTabSyncHandler = null;

/**
 * Set handler for syncing active tab to Puppeteer's lastPage
 * Called by page-manager during initialization
 */
export function setActiveTabSyncHandler(handler) {
  activeTabSyncHandler = handler;
}

/**
 * Debug log helper
 */
function debugLog(...args) {
  if (process.env.DEBUG === '1') {
    console.error('[ws-bridge]', ...args);
  }
}

/**
 * Start WebSocket server
 */
export function startWebSocketServer() {
  if (isRunning) {
    debugLog('WebSocket server already running');
    return;
  }

  try {
    wss = new WebSocketServer({ port: WS_PORT });

    wss.on('connection', (ws) => {
      debugLog('Extension connected');
      extensionConnection = ws;

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleExtensionMessage(ws, message);
        } catch (error) {
          debugLog('Failed to parse message:', error.message);
        }
      });

      ws.on('close', () => {
        debugLog('Extension disconnected');
        if (extensionConnection === ws) {
          extensionConnection = null;
        }
      });

      ws.on('error', (error) => {
        debugLog('WebSocket error:', error.message);
      });
    });

    wss.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        debugLog(`Port ${WS_PORT} is already in use`);
      } else {
        debugLog('WebSocket server error:', error.message);
      }
    });

    isRunning = true;
    debugLog(`WebSocket server listening on port ${WS_PORT}`);

  } catch (error) {
    debugLog('Failed to start WebSocket server:', error.message);
  }
}

/**
 * Stop WebSocket server
 */
export function stopWebSocketServer() {
  if (wss) {
    wss.close();
    wss = null;
    isRunning = false;
    debugLog('WebSocket server stopped');
  }
}

/**
 * Handle messages from extension
 */
async function handleExtensionMessage(ws, message) {
  debugLog('Received:', message.type);

  switch (message.type) {
    case 'tabs_sync':
      // Full tabs sync from extension
      extensionTabs.clear();
      if (message.payload?.tabs) {
        message.payload.tabs.forEach(tab => {
          extensionTabs.set(tab.tabId, tab);
        });
      }
      debugLog(`Synced ${extensionTabs.size} tabs`);
      notifyTabCallbacks('sync', null);

      // Sync Puppeteer's lastPage to the currently active tab
      if (activeTabSyncHandler) {
        const activeTab = message.payload?.tabs?.find(tab => tab.active);
        if (activeTab && activeTab.url) {
          activeTabSyncHandler(activeTab.url).catch(err => {
            debugLog(`Failed to sync lastPage on tabs_sync: ${err.message}`);
          });
        }
      }
      break;

    case 'tab_created':
      extensionTabs.set(message.payload.tabId, message.payload);
      debugLog(`Tab created: ${message.payload.tabId}`);
      notifyTabCallbacks('created', message.payload);
      break;

    case 'tab_closed':
      extensionTabs.delete(message.payload.tabId);
      debugLog(`Tab closed: ${message.payload.tabId}`);
      notifyTabCallbacks('closed', message.payload);
      break;

    case 'tab_activated':
      // Update active status
      for (const [id, tab] of extensionTabs) {
        tab.active = (id === message.payload.tabId);
      }
      debugLog(`Tab activated: ${message.payload.tabId}`);
      notifyTabCallbacks('activated', message.payload);

      // Sync Puppeteer's lastPage to match the user's active tab
      if (activeTabSyncHandler) {
        const activatedTab = extensionTabs.get(message.payload.tabId);
        if (activatedTab && activatedTab.url) {
          activeTabSyncHandler(activatedTab.url).catch(err => {
            debugLog(`Failed to sync lastPage to activated tab: ${err.message}`);
          });
        }
      }
      break;

    case 'tab_updated':
      if (message.payload.tab) {
        extensionTabs.set(message.payload.tabId, message.payload.tab);
      }
      debugLog(`Tab updated: ${message.payload.tabId}`);
      notifyTabCallbacks('updated', message.payload);
      break;

    case 'scenario_save':
      await handleScenarioSave(ws, message.payload, message.requestId);
      break;

    case 'scenario_list_request':
      await handleScenarioListRequest(ws, message.requestId);
      break;

    case 'recorder_started':
      debugLog('Recording started from extension:', message.payload?.startUrl);
      break;

    case 'ping':
      sendToExtension({ type: 'pong' });
      break;

    default:
      debugLog('Unknown message type:', message.type);
  }
}

/**
 * Handle scenario save request from extension
 */
async function handleScenarioSave(ws, scenario, requestId) {
  try {
    // Determine project ID from entry URL
    const projectId = urlToProjectId(scenario.metadata?.entryUrl || '');

    const result = await saveScenario(scenario, projectId);

    sendToExtension({
      type: 'scenario_saved',
      payload: {
        success: result.success,
        filePath: result.filePath,
        error: result.error
      },
      requestId
    });

    debugLog('Scenario saved:', scenario.name);

  } catch (error) {
    sendToExtension({
      type: 'scenario_saved',
      payload: {
        success: false,
        error: error.message
      },
      requestId
    });
    debugLog('Failed to save scenario:', error.message);
  }
}

/**
 * Handle scenario list request from extension
 */
async function handleScenarioListRequest(ws, requestId) {
  try {
    const scenarios = await listScenarios(null, true); // All projects

    sendToExtension({
      type: 'scenario_list_response',
      payload: {
        scenarios: scenarios.map(s => ({
          name: s.name,
          projectId: s.projectId,
          metadata: s.metadata
        }))
      },
      requestId
    });

  } catch (error) {
    sendToExtension({
      type: 'scenario_list_response',
      payload: {
        scenarios: [],
        error: error.message
      },
      requestId
    });
  }
}

/**
 * Send message to extension
 */
export function sendToExtension(message) {
  if (extensionConnection && extensionConnection.readyState === 1) { // WebSocket.OPEN
    extensionConnection.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/**
 * Request tabs sync from extension
 */
export function requestTabsSync() {
  return sendToExtension({ type: 'tabs_request' });
}

/**
 * Get all tabs from extension
 */
export function getTabsFromExtension() {
  return Array.from(extensionTabs.values());
}

/**
 * Get active tab from extension
 */
export function getActiveTabFromExtension() {
  for (const tab of extensionTabs.values()) {
    if (tab.active) {
      return tab;
    }
  }
  return null;
}

/**
 * Check if extension is connected
 */
export function isExtensionConnected() {
  return extensionConnection !== null && extensionConnection.readyState === 1;
}

/**
 * Switch to tab by index or URL pattern via extension
 * @param {number|string} tabIdentifier - Tab index or URL pattern
 * @returns {object|null} - Tab info or null if not found
 */
export function switchTabViaExtension(tabIdentifier) {
  const tabs = Array.from(extensionTabs.values());

  let targetTab = null;

  if (typeof tabIdentifier === 'number') {
    // Find by index
    targetTab = tabs[tabIdentifier];
  } else if (typeof tabIdentifier === 'string') {
    // Find by URL pattern (partial match)
    targetTab = tabs.find(t => t.url.toLowerCase().includes(tabIdentifier.toLowerCase()));
  }

  if (targetTab) {
    // Send switch command to extension
    sendToExtension({
      type: 'switch_tab',
      payload: { tabId: targetTab.tabId }
    });
    return targetTab;
  }

  return null;
}

/**
 * Register callback for tab events
 */
export function onTabEvent(callback) {
  tabEventCallbacks.push(callback);
  return () => {
    const index = tabEventCallbacks.indexOf(callback);
    if (index > -1) {
      tabEventCallbacks.splice(index, 1);
    }
  };
}

/**
 * Notify registered callbacks about tab events
 */
function notifyTabCallbacks(eventType, payload) {
  tabEventCallbacks.forEach(callback => {
    try {
      callback(eventType, payload);
    } catch (error) {
      debugLog('Tab callback error:', error.message);
    }
  });
}

/**
 * Send recorder command to extension
 */
export function sendRecorderCommand(command, options = {}) {
  return sendToExtension({
    type: `recorder_${command}`,
    payload: options
  });
}

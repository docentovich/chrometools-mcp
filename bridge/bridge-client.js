/**
 * bridge-client.js
 *
 * WebSocket client for MCP to connect to Bridge Service.
 * Replaces the old websocket-bridge.js (which was a server).
 *
 * MCP is now a CLIENT that:
 * - Connects to Bridge on port 9223
 * - Receives full state on connect
 * - Gets real-time updates (tabs, recordings)
 * - Sends commands (start/stop recording, etc.)
 */

import WebSocket from 'ws';

const BRIDGE_PORT = 9223;
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

// State received from Bridge
let bridgeState = {
  tabs: new Map(),
  recordings: [],
  recorderState: {
    isRecording: false,
    isPaused: false,
    metadata: null,
    secrets: {}
  },
  extensionConnected: false
};

// Connection state
let ws = null;
let isConnected = false;
let reconnectAttempts = 0;
let reconnectTimer = null;

// Callbacks
const messageCallbacks = new Map(); // requestId -> {resolve, reject, timeout}
const eventCallbacks = []; // Array of (eventType, payload) => void

// Handler for syncing active tab (set by page-manager)
let activeTabSyncHandler = null;

/**
 * Debug log helper
 */
function debugLog(...args) {
  if (process.env.DEBUG === '1') {
    console.error('[bridge-client]', ...args);
  }
}

/**
 * Set handler for syncing active tab to Puppeteer's lastPage
 */
export function setActiveTabSyncHandler(handler) {
  activeTabSyncHandler = handler;
}

/**
 * Connect to Bridge Service
 */
export async function connectToBridge() {
  return new Promise((resolve) => {
    if (isConnected && ws?.readyState === WebSocket.OPEN) {
      debugLog('Already connected to Bridge');
      resolve(true);
      return;
    }

    debugLog(`Connecting to Bridge on port ${BRIDGE_PORT}...`);

    try {
      ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);

      const connectTimeout = setTimeout(() => {
        debugLog('Connection timeout');
        ws?.close();
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        isConnected = true;
        reconnectAttempts = 0;
        debugLog('Connected to Bridge');
        console.error('[chrometools-mcp] Connected to Bridge Service');
        resolve(true);
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleBridgeMessage(message);
        } catch (error) {
          debugLog('Failed to parse message:', error.message);
        }
      });

      ws.on('close', () => {
        debugLog('Disconnected from Bridge');
        isConnected = false;
        ws = null;
        scheduleReconnect();
      });

      ws.on('error', (error) => {
        clearTimeout(connectTimeout);
        debugLog('Connection error:', error.message);
        resolve(false);
      });

    } catch (error) {
      debugLog('Failed to create WebSocket:', error.message);
      resolve(false);
    }
  });
}

/**
 * Schedule reconnection attempt
 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    debugLog(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
    return;
  }

  reconnectAttempts++;
  debugLog(`Scheduling reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectToBridge();
  }, RECONNECT_DELAY);
}

/**
 * Disconnect from Bridge
 */
export function disconnectFromBridge() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  isConnected = false;
}

/**
 * Handle messages from Bridge
 */
function handleBridgeMessage(message) {
  debugLog('Received:', message.type);

  // Check if this is a response to a pending request
  if (message.requestId && messageCallbacks.has(message.requestId)) {
    const { resolve, timeout } = messageCallbacks.get(message.requestId);
    clearTimeout(timeout);
    messageCallbacks.delete(message.requestId);
    resolve(message);
    return;
  }

  // Handle different message types
  switch (message.type) {
    case 'initial_state':
      // Full state received on connect
      updateFullState(message.payload);
      break;

    case 'tabs_sync':
      bridgeState.tabs.clear();
      message.payload.tabs?.forEach(tab => {
        bridgeState.tabs.set(tab.tabId, tab);
      });
      notifyEventCallbacks('tabs_sync', message.payload);
      syncActiveTab(message.payload.tabs);
      break;

    case 'tab_created':
      bridgeState.tabs.set(message.payload.tabId, message.payload);
      notifyEventCallbacks('tab_created', message.payload);
      break;

    case 'tab_closed':
      bridgeState.tabs.delete(message.payload.tabId);
      notifyEventCallbacks('tab_closed', message.payload);
      break;

    case 'tab_activated':
      for (const [id, tab] of bridgeState.tabs) {
        tab.active = (id === message.payload.tabId);
      }
      notifyEventCallbacks('tab_activated', message.payload);
      syncActiveTabById(message.payload.tabId);
      break;

    case 'tab_updated':
      if (message.payload.tab) {
        bridgeState.tabs.set(message.payload.tabId, message.payload.tab);
      }
      notifyEventCallbacks('tab_updated', message.payload);
      break;

    case 'recorder_state_changed':
      bridgeState.recorderState = { ...bridgeState.recorderState, ...message.payload };
      notifyEventCallbacks('recorder_state_changed', message.payload);
      break;

    case 'action_recorded':
      bridgeState.recordings.push(message.payload);
      notifyEventCallbacks('action_recorded', message.payload);
      break;

    case 'recordings_cleared':
      bridgeState.recordings = [];
      notifyEventCallbacks('recordings_cleared', null);
      break;

    case 'extension_disconnected':
      bridgeState.extensionConnected = false;
      notifyEventCallbacks('extension_disconnected', null);
      break;

    case 'pong':
      // Handled by requestId callback
      break;

    default:
      debugLog('Unknown message type:', message.type);
      notifyEventCallbacks(message.type, message.payload);
  }
}

/**
 * Update full state from initial_state message
 */
function updateFullState(state) {
  bridgeState.tabs.clear();
  state.tabs?.forEach(tab => {
    bridgeState.tabs.set(tab.tabId, tab);
  });
  bridgeState.recordings = state.recordings || [];
  bridgeState.recorderState = state.recorderState || bridgeState.recorderState;
  bridgeState.extensionConnected = state.extensionConnected;

  debugLog(`State updated: ${bridgeState.tabs.size} tabs, ${bridgeState.recordings.length} recordings`);
  notifyEventCallbacks('state_updated', state);

  // Sync active tab
  syncActiveTab(state.tabs);
}

/**
 * Sync Puppeteer's lastPage to active tab
 */
function syncActiveTab(tabs) {
  if (!activeTabSyncHandler || !tabs) return;

  const activeTab = tabs.find(t => t.active);
  if (activeTab?.url) {
    activeTabSyncHandler(activeTab.url).catch(err => {
      debugLog(`Failed to sync lastPage: ${err.message}`);
    });
  }
}

function syncActiveTabById(tabId) {
  if (!activeTabSyncHandler) return;

  const tab = bridgeState.tabs.get(tabId);
  if (tab?.url) {
    activeTabSyncHandler(tab.url).catch(err => {
      debugLog(`Failed to sync lastPage: ${err.message}`);
    });
  }
}

/**
 * Notify registered event callbacks
 */
function notifyEventCallbacks(eventType, payload) {
  eventCallbacks.forEach(callback => {
    try {
      callback(eventType, payload);
    } catch (error) {
      debugLog('Event callback error:', error.message);
    }
  });
}

/**
 * Send message to Bridge
 */
export function sendToBridge(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    debugLog('Cannot send: not connected');
    return false;
  }
  ws.send(JSON.stringify(message));
  return true;
}

/**
 * Send command and wait for response
 */
export function sendCommand(type, payload = {}, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!isConnected) {
      reject(new Error('Not connected to Bridge'));
      return;
    }

    const requestId = `req_${Date.now()}_${Math.random()}`;

    const timeoutHandle = setTimeout(() => {
      messageCallbacks.delete(requestId);
      reject(new Error(`Command timeout: ${type}`));
    }, timeout);

    messageCallbacks.set(requestId, { resolve, reject, timeout: timeoutHandle });

    sendToBridge({ type, payload, requestId });
  });
}

// ============================================
// Public API (compatible with old websocket-bridge.js)
// ============================================

/**
 * Start connection to Bridge (replaces startWebSocketServer)
 */
export async function startWebSocketServer() {
  await connectToBridge();
}

/**
 * Stop connection (replaces stopWebSocketServer)
 */
export function stopWebSocketServer() {
  disconnectFromBridge();
}

/**
 * Check if connected to Bridge (replaces isExtensionConnected)
 */
export function isExtensionConnected() {
  return isConnected && bridgeState.extensionConnected;
}

/**
 * Check if connected to Bridge
 */
export function isBridgeConnected() {
  return isConnected;
}

/**
 * Get tabs from Bridge state
 */
export function getTabsFromExtension() {
  return Array.from(bridgeState.tabs.values());
}

/**
 * Get active tab
 */
export function getActiveTabFromExtension() {
  for (const tab of bridgeState.tabs.values()) {
    if (tab.active) return tab;
  }
  return null;
}

/**
 * Get debug info
 */
export function getWsDebugInfo() {
  return {
    bridgeConnected: isConnected,
    extensionConnected: bridgeState.extensionConnected,
    readyState: ws?.readyState,
    tabCount: bridgeState.tabs.size,
    recordingsCount: bridgeState.recordings.length,
    recorderState: bridgeState.recorderState
  };
}

/**
 * Export extensionTabs for compatibility
 */
export const extensionTabs = bridgeState.tabs;

/**
 * Request tabs sync
 */
export function requestTabsSync() {
  return sendToBridge({ type: 'get_tabs' });
}

/**
 * Switch tab via Bridge
 */
export function switchTabViaExtension(tabIdentifier) {
  const tabs = Array.from(bridgeState.tabs.values());
  let targetTab = null;

  if (typeof tabIdentifier === 'number') {
    targetTab = tabs[tabIdentifier];
  } else if (typeof tabIdentifier === 'string') {
    targetTab = tabs.find(t => t.url.toLowerCase().includes(tabIdentifier.toLowerCase()));
  }

  if (targetTab) {
    sendToBridge({
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
  eventCallbacks.push(callback);
  return () => {
    const index = eventCallbacks.indexOf(callback);
    if (index > -1) eventCallbacks.splice(index, 1);
  };
}

/**
 * Send recorder command
 */
export function sendRecorderCommand(command, options = {}) {
  return sendToBridge({
    type: `recorder_${command}`,
    payload: options
  });
}

/**
 * Send command and wait for response
 */
export function sendExtensionCommand(message, timeout = 5000) {
  return sendCommand(message.type, message.payload, timeout);
}

/**
 * Get recorder state
 */
export function getRecorderState() {
  return bridgeState.recorderState;
}

/**
 * Get recordings
 */
export function getRecordings() {
  return bridgeState.recordings;
}

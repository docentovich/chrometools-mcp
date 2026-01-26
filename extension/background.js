/**
 * ChromeTools MCP Extension - Background Service Worker
 *
 * Handles:
 * - Tab tracking via Chrome tabs API
 * - WebSocket connection to MCP server
 * - Recorder state management
 * - Message routing between content scripts and MCP
 */

const WS_PORT_START = 9223;
const WS_PORT_END = 9227;
const RECONNECT_INTERVAL = 3000;
const INSTANCES_SCAN_INTERVAL = 20000; // 20 seconds

// State
const wsConnections = new Map(); // port -> WebSocket
const tabsState = new Map(); // tabId -> {url, title, active, windowId}
let scanTimer = null;

// Recorder state (persisted in storage)
let recorderState = {
  isRecording: false,
  isPaused: false,
  actions: [],
  secrets: {},
  startUrl: null,
  startTabId: null,
  currentTabId: null,  // ⭐ Track active recording tab
  metadata: {
    name: '',
    description: '',
    tags: []
  }
};

// ============================================
// WebSocket Connection - Multi-Instance Support
// ============================================

/**
 * Scan for active MCP instances by testing ports
 * Tries to connect to each port in range to discover running servers
 */
async function scanForMCPInstances() {
  try {
    const discoveredPorts = new Set();

    // Test each port in range
    for (let port = WS_PORT_START; port <= WS_PORT_END; port++) {
      const isAvailable = await testPortConnection(port);
      if (isAvailable) {
        discoveredPorts.add(port);
      }
    }

    console.log(`[ChromeTools] Found ${discoveredPorts.size} MCP instance(s) on ports: ${Array.from(discoveredPorts).join(', ')}`);

    // Get current connected ports
    const currentPorts = new Set(wsConnections.keys());

    // Disconnect from instances that no longer exist
    for (const port of currentPorts) {
      if (!discoveredPorts.has(port)) {
        console.log(`[ChromeTools] Instance on port ${port} no longer exists, disconnecting`);
        disconnectFromPort(port);
      }
    }

    // Connect to new instances
    for (const port of discoveredPorts) {
      if (!wsConnections.has(port)) {
        connectToPort(port);
      }
    }

    // Update extension icon
    updateIcon(wsConnections.size > 0);

  } catch (error) {
    console.error('[ChromeTools] Failed to scan for instances:', error);
  }
}

/**
 * Test if MCP server is running on given port
 */
async function testPortConnection(port) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 1000); // 1 second timeout

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    } catch (error) {
      resolve(false);
    }
  });
}

/**
 * Connect to MCP server on specific port
 */
function connectToPort(port) {
  if (wsConnections.has(port)) {
    const existing = wsConnections.get(port);
    if (existing.readyState === WebSocket.OPEN) {
      return;
    }
  }

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);

    ws.onopen = () => {
      console.log(`[ChromeTools] Connected to MCP server on port ${port}`);
      wsConnections.set(port, ws);

      // Send current state of all tabs
      syncAllTabs();

      // Update extension icon
      updateIcon(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMCPMessage(message, port);
      } catch (error) {
        console.error(`[ChromeTools] Failed to parse message from port ${port}:`, error);
      }
    };

    ws.onclose = () => {
      console.log(`[ChromeTools] Disconnected from MCP server on port ${port}`);
      wsConnections.delete(port);
      updateIcon(wsConnections.size > 0);
    };

    ws.onerror = (error) => {
      console.error(`[ChromeTools] WebSocket error on port ${port}:`, error);
    };

  } catch (error) {
    console.error(`[ChromeTools] Failed to connect to port ${port}:`, error);
  }
}

/**
 * Disconnect from specific port
 */
function disconnectFromPort(port) {
  const ws = wsConnections.get(port);
  if (ws) {
    ws.close();
    wsConnections.delete(port);
  }
}

/**
 * Send message to all connected MCP servers (broadcast)
 */
function sendToMCP(message) {
  let sent = false;
  for (const [port, ws] of wsConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      sent = true;
    }
  }
  return sent;
}

/**
 * Start periodic scanning for MCP instances
 */
function startInstanceScanning() {
  // Initial scan
  scanForMCPInstances();

  // Periodic scan every 20 seconds
  if (scanTimer) {
    clearInterval(scanTimer);
  }
  scanTimer = setInterval(scanForMCPInstances, INSTANCES_SCAN_INTERVAL);

  console.log('[ChromeTools] Started periodic instance scanning (every 20s)');
}

/**
 * Stop periodic scanning
 */
function stopInstanceScanning() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

function handleMCPMessage(message, port) {
  console.log(`[ChromeTools] Received from MCP (port ${port}):`, message.type);

  switch (message.type) {
    case 'tabs_request':
      // MCP запрашивает список вкладок
      syncAllTabs();
      break;

    case 'recorder_start':
      // MCP запускает запись
      startRecording(message.payload);
      break;

    case 'recorder_stop':
      // MCP останавливает запись
      stopRecording();
      break;

    case 'recorder_get_state':
      // MCP запрашивает состояние рекордера
      sendToMCP({
        type: 'recorder_state',
        payload: recorderState,
        requestId: message.requestId
      });
      break;

    case 'scenario_list_response':
      // Ответ на запрос списка сценариев
      // Передать в popup если открыт
      chrome.runtime.sendMessage({
        type: 'SCENARIOS_LIST',
        scenarios: message.payload.scenarios,
        requestId: message.requestId
      }).catch(() => {});
      break;

    case 'scenario_saved':
      // Подтверждение сохранения сценария
      chrome.runtime.sendMessage({
        type: 'SCENARIO_SAVED',
        success: message.payload.success,
        error: message.payload.error,
        requestId: message.requestId
      }).catch(() => {});
      break;

    case 'pong':
      // Keepalive response
      break;

    case 'switch_tab':
      // MCP requests to switch to a specific tab
      console.log('[ChromeTools] switch_tab received:', message.payload);
      if (message.payload?.tabId) {
        chrome.tabs.update(message.payload.tabId, { active: true }, (tab) => {
          if (chrome.runtime.lastError) {
            console.error('[ChromeTools] Failed to switch tab:', chrome.runtime.lastError);
          } else if (tab) {
            // Also focus the window containing this tab
            chrome.windows.update(tab.windowId, { focused: true });
            console.log('[ChromeTools] Switched to tab:', tab.id, tab.url);
          }
        });
      } else {
        console.error('[ChromeTools] switch_tab: no tabId in payload');
      }
      break;

    default:
      console.log('[ChromeTools] Unknown message type:', message.type);
  }
}

// ============================================
// Tab Tracking
// ============================================

function syncAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    tabsState.clear();

    const tabsList = tabs.map(tab => {
      const state = {
        tabId: tab.id,
        url: tab.url || tab.pendingUrl || '',
        title: tab.title || '',
        active: tab.active,
        windowId: tab.windowId,
        index: tab.index
      };
      tabsState.set(tab.id, state);
      return state;
    });

    sendToMCP({
      type: 'tabs_sync',
      payload: { tabs: tabsList }
    });
  });
}

// Tab created
chrome.tabs.onCreated.addListener((tab) => {
  const state = {
    tabId: tab.id,
    url: tab.url || tab.pendingUrl || '',
    title: tab.title || '',
    active: tab.active,
    windowId: tab.windowId,
    index: tab.index
  };
  tabsState.set(tab.id, state);

  sendToMCP({
    type: 'tab_created',
    payload: state
  });

  // ⭐ If recording and new tab is active, record newTab action
  if (recorderState.isRecording && !recorderState.isPaused && tab.active) {
    recordAction({
      type: 'newTab',
      timestamp: Date.now(),
      data: {
        tabId: tab.id,
        url: state.url,
        title: state.title || 'New Tab'
      }
    });

    // Update current recording tab to the new tab
    recorderState.currentTabId = tab.id;
    saveRecorderState();

    console.log(`[ChromeTools] New tab opened during recording: ${tab.id}`);
  }

  console.log('[ChromeTools] Tab created:', tab.id, state.url);
});

// Tab closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  tabsState.delete(tabId);

  sendToMCP({
    type: 'tab_closed',
    payload: { tabId, windowId: removeInfo.windowId }
  });

  console.log('[ChromeTools] Tab closed:', tabId);
});

// Tab activated (switched to)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Update active status in local state
  for (const [id, state] of tabsState) {
    state.active = (id === activeInfo.tabId);
  }

  sendToMCP({
    type: 'tab_activated',
    payload: {
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId
    }
  });

  // ⭐ If recording, switch recording to new active tab
  if (recorderState.isRecording && !recorderState.isPaused) {
    const previousTabId = recorderState.currentTabId;

    // Only record if actually switching to a different tab
    if (previousTabId !== activeInfo.tabId) {
      // Get tab info for the action
      const tab = await chrome.tabs.get(activeInfo.tabId);

      // Record switchTab action
      recordAction({
        type: 'switchTab',
        timestamp: Date.now(),
        data: {
          fromTabId: previousTabId,
          toTabId: activeInfo.tabId,
          toTabUrl: tab.url,
          toTabTitle: tab.title
        }
      });

      // Update current recording tab
      recorderState.currentTabId = activeInfo.tabId;
      await saveRecorderState();

      console.log(`[ChromeTools] Recording switched from tab ${previousTabId} to tab ${activeInfo.tabId}`);
    }
  }

  console.log('[ChromeTools] Tab activated:', activeInfo.tabId);
});

// Tab updated (URL change, title change, etc.)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabsState.has(tabId)) {
    const state = tabsState.get(tabId);
    if (changeInfo.url) state.url = changeInfo.url;
    if (changeInfo.title) state.title = changeInfo.title;
    if (changeInfo.status) state.status = changeInfo.status;
  } else {
    // Tab not in our state yet, add it
    tabsState.set(tabId, {
      tabId: tab.id,
      url: tab.url || '',
      title: tab.title || '',
      active: tab.active,
      windowId: tab.windowId,
      index: tab.index
    });
  }

  // Only send meaningful updates
  if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
    sendToMCP({
      type: 'tab_updated',
      payload: {
        tabId,
        changes: changeInfo,
        tab: tabsState.get(tabId)
      }
    });
  }
});

// ============================================
// Recorder Management
// ============================================

async function loadRecorderState() {
  try {
    const result = await chrome.storage.local.get('recorderState');
    if (result.recorderState) {
      recorderState = result.recorderState;
      console.log('[ChromeTools] Recorder state loaded:', recorderState.isRecording ? 'recording' : 'idle');
    }
  } catch (error) {
    console.error('[ChromeTools] Failed to load recorder state:', error);
  }
}

async function saveRecorderState() {
  try {
    await chrome.storage.local.set({ recorderState });
  } catch (error) {
    console.error('[ChromeTools] Failed to save recorder state:', error);
  }
}

async function startRecording(options = {}) {
  // Get current active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  recorderState = {
    isRecording: true,
    isPaused: false,
    actions: [],
    secrets: {},
    startUrl: activeTab?.url || null,
    startTabId: activeTab?.id || null,
    currentTabId: activeTab?.id || null,  // ⭐ Initialize with start tab
    metadata: {
      name: options.name || '',
      description: options.description || '',
      tags: options.tags || []
    }
  };

  await saveRecorderState();

  // Notify all content scripts
  notifyContentScripts({ type: 'RECORDING_STARTED' });

  // Notify MCP
  sendToMCP({
    type: 'recorder_started',
    payload: { startUrl: recorderState.startUrl }
  });

  console.log('[ChromeTools] Recording started');
}

async function stopRecording() {
  const actions = recorderState.actions;
  const secrets = recorderState.secrets;

  recorderState.isRecording = false;
  recorderState.isPaused = false;

  await saveRecorderState();

  // Notify all content scripts
  notifyContentScripts({ type: 'RECORDING_STOPPED' });

  console.log('[ChromeTools] Recording stopped, actions:', actions.length);

  return { actions, secrets };
}

async function pauseRecording() {
  recorderState.isPaused = !recorderState.isPaused;
  await saveRecorderState();

  notifyContentScripts({
    type: recorderState.isPaused ? 'RECORDING_PAUSED' : 'RECORDING_RESUMED'
  });

  console.log('[ChromeTools] Recording', recorderState.isPaused ? 'paused' : 'resumed');
}

function recordAction(action) {
  if (!recorderState.isRecording || recorderState.isPaused) {
    return;
  }

  recorderState.actions.push(action);
  saveRecorderState();

  // Notify popup about new action
  chrome.runtime.sendMessage({
    type: 'ACTION_RECORDED',
    actionCount: recorderState.actions.length
  }).catch(() => {});

  console.log('[ChromeTools] Action recorded:', action.type);
}

function notifyContentScripts(message) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

// ============================================
// Message Handling from Content Scripts & Popup
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ChromeTools] Message from', sender.tab ? `tab ${sender.tab.id}` : 'popup', ':', message.type);

  switch (message.type) {
    // From content script
    case 'ACTION':
      // ⭐ Only record actions from currently active recording tab
      if (recorderState.isRecording && sender.tab?.id === recorderState.currentTabId) {
        recordAction({
          ...message.action,
          tabId: sender.tab?.id,
          tabUrl: sender.tab?.url
        });
        sendResponse({ success: true });
      } else {
        // Ignore actions from non-active tabs during recording
        sendResponse({ success: false, reason: 'Not recording on this tab' });
      }
      break;

    case 'GET_RECORDING_STATE':
      sendResponse({
        isRecording: recorderState.isRecording,
        isPaused: recorderState.isPaused,
        actionCount: recorderState.actions.length
      });
      break;

    case 'REGISTER_SECRET':
      recorderState.secrets[message.paramName] = message.value;
      saveRecorderState();
      sendResponse({ success: true });
      break;

    // From popup
    case 'START_RECORDING':
      startRecording(message.options).then(() => {
        sendResponse({ success: true });
      });
      return true; // async response

    case 'STOP_RECORDING':
      stopRecording().then((result) => {
        sendResponse({ success: true, ...result });
      });
      return true;

    case 'PAUSE_RECORDING':
      pauseRecording().then(() => {
        sendResponse({ success: true, isPaused: recorderState.isPaused });
      });
      return true;

    case 'CLEAR_ACTIONS':
      recorderState.actions = [];
      recorderState.secrets = {};
      saveRecorderState();
      sendResponse({ success: true });
      break;

    case 'FORCE_RESET':
      // Force reset all recording state
      recorderState.isRecording = false;
      recorderState.isPaused = false;
      recorderState.actions = [];
      recorderState.secrets = {};
      recorderState.metadata = null;
      recorderState.entryUrl = null;
      saveRecorderState();
      sendResponse({ success: true, message: 'Recording state reset' });
      break;

    case 'GET_STATE':
      sendResponse({
        isRecording: recorderState.isRecording,
        isPaused: recorderState.isPaused,
        actions: recorderState.actions,
        metadata: recorderState.metadata,
        isConnected: wsConnections.size > 0,
        connectedInstances: wsConnections.size,
        // Provide scenario metadata for popup state restoration
        scenarioName: recorderState.metadata?.name || '',
        scenarioDescription: recorderState.metadata?.description || '',
        scenarioTags: recorderState.metadata?.tags || []
      });
      break;

    case 'SAVE_SCENARIO':
      saveScenario(message.scenario).then((result) => {
        sendResponse(result);
      });
      return true;

    case 'REQUEST_SCENARIOS_LIST':
      sendToMCP({
        type: 'scenario_list_request',
        requestId: message.requestId
      });
      sendResponse({ success: true });
      break;

    case 'GET_CONNECTION_STATUS':
      sendResponse({
        isConnected: wsConnections.size > 0,
        connectedInstances: wsConnections.size
      });
      break;

    default:
      console.log('[ChromeTools] Unknown message type:', message.type);
      sendResponse({ error: 'Unknown message type' });
  }

  return false;
});

async function saveScenario(scenarioData) {
  // Get end URL from current active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const scenario = {
    name: scenarioData.name,
    metadata: {
      name: scenarioData.name,
      description: scenarioData.description || '',
      tags: scenarioData.tags || [],
      dependencies: scenarioData.dependencies || [],
      parameters: extractParameters(recorderState.secrets),
      entryUrl: recorderState.startUrl,
      exitUrl: activeTab?.url || null
    },
    chain: recorderState.actions,
    secrets: recorderState.secrets
  };

  // Send to MCP for saving
  const requestId = Date.now().toString();

  sendToMCP({
    type: 'scenario_save',
    payload: scenario,
    requestId
  });

  // Clear recorder state after save
  recorderState.actions = [];
  recorderState.secrets = {};
  recorderState.isRecording = false;
  await saveRecorderState();

  return { success: true, requestId };
}

function extractParameters(secrets) {
  const params = {};
  for (const [paramName] of Object.entries(secrets)) {
    params[paramName] = {
      type: 'string',
      required: true,
      description: `Secret parameter: ${paramName}`
    };
  }
  return params;
}

// ============================================
// Icon Management
// ============================================

function updateIcon(connected) {
  // For now, just log the status
  // TODO: Create actual icon files and update badge
  console.log('[ChromeTools] Icon status:', connected ? 'connected' : 'disconnected');

  if (connected) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }
}

// ============================================
// Initialization
// ============================================

async function initialize() {
  console.log('[ChromeTools] Extension initializing...');

  // Load persisted recorder state
  await loadRecorderState();

  // Start scanning for MCP instances and connect to all found
  startInstanceScanning();

  // Initial tab sync
  syncAllTabs();

  console.log('[ChromeTools] Extension initialized');
}

// Start
initialize();

// Keepalive ping to all connections
setInterval(() => {
  if (wsConnections.size > 0) {
    sendToMCP({ type: 'ping' });
  }
}, 30000);

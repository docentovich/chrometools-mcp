/**
 * ChromeTools MCP Extension - Background Service Worker
 *
 * Handles:
 * - Tab tracking via Chrome tabs API
 * - WebSocket connection to MCP server
 * - Recorder state management
 * - Message routing between content scripts and MCP
 */

const WS_PORT = 9223;
const WS_URL = `ws://localhost:${WS_PORT}/chrometools`;
const RECONNECT_INTERVAL = 3000;

// State
let wsConnection = null;
let isConnected = false;
const tabsState = new Map(); // tabId -> {url, title, active, windowId}

// Recorder state (persisted in storage)
let recorderState = {
  isRecording: false,
  isPaused: false,
  actions: [],
  secrets: {},
  startUrl: null,
  startTabId: null,
  metadata: {
    name: '',
    description: '',
    tags: []
  }
};

// ============================================
// WebSocket Connection
// ============================================

function connectToMCP() {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    wsConnection = new WebSocket(WS_URL);

    wsConnection.onopen = () => {
      console.log('[ChromeTools] Connected to MCP server');
      isConnected = true;

      // Send current state of all tabs
      syncAllTabs();

      // Update extension icon
      updateIcon(true);
    };

    wsConnection.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMCPMessage(message);
      } catch (error) {
        console.error('[ChromeTools] Failed to parse message:', error);
      }
    };

    wsConnection.onclose = () => {
      console.log('[ChromeTools] Disconnected from MCP server');
      isConnected = false;
      wsConnection = null;
      updateIcon(false);

      // Attempt reconnection
      setTimeout(connectToMCP, RECONNECT_INTERVAL);
    };

    wsConnection.onerror = (error) => {
      console.error('[ChromeTools] WebSocket error:', error);
      isConnected = false;
    };

  } catch (error) {
    console.error('[ChromeTools] Failed to connect:', error);
    setTimeout(connectToMCP, RECONNECT_INTERVAL);
  }
}

function sendToMCP(message) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.send(JSON.stringify(message));
    return true;
  }
  return false;
}

function handleMCPMessage(message) {
  console.log('[ChromeTools] Received from MCP:', message.type);

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
chrome.tabs.onActivated.addListener((activeInfo) => {
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
      recordAction({
        ...message.action,
        tabId: sender.tab?.id,
        tabUrl: sender.tab?.url
      });
      sendResponse({ success: true });
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

    case 'GET_STATE':
      sendResponse({
        isRecording: recorderState.isRecording,
        isPaused: recorderState.isPaused,
        actions: recorderState.actions,
        metadata: recorderState.metadata,
        isConnected
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
      sendResponse({ isConnected });
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

  // Connect to MCP server
  connectToMCP();

  // Initial tab sync
  syncAllTabs();

  console.log('[ChromeTools] Extension initialized');
}

// Start
initialize();

// Keepalive ping
setInterval(() => {
  if (isConnected) {
    sendToMCP({ type: 'ping' });
  }
}, 30000);

/**
 * ChromeTools MCP Extension - Background Service Worker
 *
 * NEW ARCHITECTURE: Uses Native Messaging to communicate with Bridge Service
 *
 * - Extension is the EVENT PRODUCER
 * - Bridge Service is the PERSISTENT INTERMEDIARY
 * - Claude/MCP clients connect to Bridge as CONSUMERS
 *
 * Extension lifecycle:
 * 1. On load: connect to Native Host (Bridge Service)
 * 2. Send all events (tabs, recordings) to Bridge
 * 3. Bridge stores state and broadcasts to connected clients
 * 4. Extension doesn't care how many clients are connected
 */

const HOST_NAME = 'com.chrometools.bridge';

// State
let nativePort = null;
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
  currentTabId: null,
  metadata: {
    name: '',
    description: '',
    tags: []
  }
};

// ============================================
// Native Messaging Connection
// ============================================

/**
 * Connect to Native Messaging Host (Bridge Service)
 */
function connectToNativeHost() {
  console.log(`[ChromeTools] Connecting to Native Host: ${HOST_NAME}`);

  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);

    nativePort.onMessage.addListener((message) => {
      console.log('[ChromeTools] Message from Bridge:', message.type);
      handleBridgeMessage(message);
    });

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.log('[ChromeTools] Disconnected from Bridge:', error?.message || 'no error');
      isConnected = false;
      nativePort = null;
      updateIcon(false);

      // Try to reconnect after a delay
      setTimeout(connectToNativeHost, 5000);
    });

    isConnected = true;
    updateIcon(true);
    console.log('[ChromeTools] Connected to Native Host');

    // Send initial tabs state
    syncAllTabs();

  } catch (error) {
    console.error('[ChromeTools] Failed to connect to Native Host:', error);
    isConnected = false;
    updateIcon(false);

    // Retry connection
    setTimeout(connectToNativeHost, 5000);
  }
}

/**
 * Send message to Bridge Service
 */
function sendToBridge(message) {
  if (nativePort && isConnected) {
    try {
      nativePort.postMessage(message);
      return true;
    } catch (error) {
      console.error('[ChromeTools] Failed to send to Bridge:', error);
      return false;
    }
  }
  return false;
}

/**
 * Handle messages from Bridge Service
 */
function handleBridgeMessage(message) {
  switch (message.type) {
    case 'bridge_ready':
      console.log('[ChromeTools] Bridge is ready');
      syncAllTabs();
      break;

    case 'start_recording':
    case 'recorder_start':
      startRecording(message.payload).then(() => {
        sendToBridge({
          type: 'recorder_started',
          payload: { success: true, startUrl: recorderState.startUrl },
          requestId: message.requestId
        });
      });
      break;

    case 'stop_recording':
    case 'recorder_stop':
      stopRecording().then((result) => {
        sendToBridge({
          type: 'recorder_stopped',
          payload: result,
          requestId: message.requestId
        });
      });
      break;

    case 'pause_recording':
    case 'recorder_pause':
      pauseRecording().then(() => {
        sendToBridge({
          type: 'recorder_paused',
          payload: { isPaused: recorderState.isPaused },
          requestId: message.requestId
        });
      });
      break;

    case 'switch_tab':
      if (message.payload?.tabId) {
        chrome.tabs.update(message.payload.tabId, { active: true });
      }
      break;

    case 'ping':
      sendToBridge({ type: 'pong', requestId: message.requestId });
      break;

    default:
      console.log('[ChromeTools] Unknown message from Bridge:', message.type);
  }
}

// ============================================
// Tab Tracking
// ============================================

/**
 * Sync all current tabs to Bridge
 */
async function syncAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    tabsState.clear();

    const tabsData = tabs.map(tab => ({
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || '',
      title: tab.title || '',
      active: tab.active,
      index: tab.index
    }));

    tabsData.forEach(tab => {
      tabsState.set(tab.tabId, tab);
    });

    sendToBridge({
      type: 'tabs_sync',
      payload: { tabs: tabsData }
    });

    console.log(`[ChromeTools] Synced ${tabsData.length} tabs to Bridge`);
  } catch (error) {
    console.error('[ChromeTools] Failed to sync tabs:', error);
  }
}

// Tab event listeners
chrome.tabs.onCreated.addListener((tab) => {
  const tabData = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || '',
    title: tab.title || '',
    active: tab.active,
    index: tab.index
  };
  tabsState.set(tab.id, tabData);

  sendToBridge({
    type: 'tab_created',
    payload: tabData
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabsState.delete(tabId);

  sendToBridge({
    type: 'tab_closed',
    payload: { tabId }
  });
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Update active status in local state
  for (const [id, tab] of tabsState) {
    tab.active = (id === activeInfo.tabId);
  }

  sendToBridge({
    type: 'tab_activated',
    payload: {
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId
    }
  });

  // Update recording tab if recording
  if (recorderState.isRecording && !recorderState.isPaused) {
    const previousTabId = recorderState.currentTabId;

    // Only record tab switch if switching to a different tab
    if (previousTabId !== activeInfo.tabId) {
      // Get tab info for the new tab
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);

        // Record openTab action for tab switch
        recordAction({
          type: 'openTab',
          data: {
            url: tab.url,
            title: tab.title,
            switchToTab: true,
            reason: 'tab_switch' // Indicates this was a manual tab switch
          },
          selector: null,
          tabId: activeInfo.tabId,
          tabUrl: tab.url
        });

        console.log(`[ChromeTools] Recorded tab switch from ${previousTabId} to ${activeInfo.tabId}`);
      } catch (error) {
        console.error('[ChromeTools] Failed to get tab info for recording:', error);
      }

      recorderState.currentTabId = activeInfo.tabId;
      saveRecorderState();
    }

    // Inject content script if needed and notify about active recording
    await injectContentScriptAndNotify(activeInfo.tabId, 'RECORDING_STARTED', {
      actionCount: recorderState.actions.length
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
    const tabData = {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || '',
      title: tab.title || '',
      active: tab.active,
      index: tab.index
    };
    tabsState.set(tabId, tabData);

    sendToBridge({
      type: 'tab_updated',
      payload: { tabId, tab: tabData, changeInfo }
    });
  }
});

// ============================================
// Icon Management
// ============================================

function updateIcon(connected) {
  const iconSuffix = connected ? '' : '-gray';
  const iconPath = {
    16: `icons/icon16${iconSuffix}.png`,
    48: `icons/icon48${iconSuffix}.png`,
    128: `icons/icon128${iconSuffix}.png`
  };

  // Check if gray icons exist, otherwise use default
  chrome.action.setIcon({ path: iconPath }).catch(() => {
    // Fallback to default icons if gray versions don't exist
    chrome.action.setIcon({
      path: {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
      }
    });
  });

  chrome.action.setTitle({
    title: connected ? 'ChromeTools MCP (Connected)' : 'ChromeTools MCP (Disconnected)'
  });

  console.log(`[ChromeTools] Icon status: ${connected ? 'connected' : 'disconnected'}`);
}

// ============================================
// Content Script Injection
// ============================================

/**
 * Inject content script into tab if not already present, then send message
 */
async function injectContentScriptAndNotify(tabId, messageType, extraData = {}) {
  try {
    // First try to send message - if content script is already there, it will respond
    await chrome.tabs.sendMessage(tabId, { type: messageType, ...extraData });
    console.log(`[ChromeTools] Content script responded to ${messageType}`);
    return true;
  } catch (error) {
    // Content script not present, inject it
    console.log('[ChromeTools] Content script not present, injecting...');

    try {
      // Inject CSS first
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['recorder-overlay.css']
      });

      // Then inject JS
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      console.log('[ChromeTools] Content script injected');

      // Wait a bit for script to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now send the message
      await chrome.tabs.sendMessage(tabId, { type: messageType, ...extraData });
      console.log(`[ChromeTools] Sent ${messageType} after injection`);
      return true;
    } catch (injectError) {
      console.error('[ChromeTools] Failed to inject content script:', injectError.message);
      return false;
    }
  }
}

// ============================================
// Recorder Functions
// ============================================

async function loadRecorderState() {
  try {
    const stored = await chrome.storage.local.get('recorderState');
    if (stored.recorderState) {
      recorderState = { ...recorderState, ...stored.recorderState };
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
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  recorderState.isRecording = true;
  recorderState.isPaused = false;
  recorderState.actions = [];
  recorderState.secrets = {};
  recorderState.startUrl = activeTab?.url || '';
  recorderState.startTabId = activeTab?.id;
  recorderState.currentTabId = activeTab?.id;
  recorderState.metadata = {
    name: options.name || '',
    description: options.description || '',
    tags: options.tags || []
  };

  await saveRecorderState();

  // Inject content script if needed and notify about recording start
  if (activeTab?.id) {
    await injectContentScriptAndNotify(activeTab.id, 'RECORDING_STARTED');
  }

  // Notify Bridge about state change
  sendToBridge({
    type: 'recorder_state_changed',
    payload: {
      isRecording: true,
      isPaused: false,
      startUrl: recorderState.startUrl,
      metadata: recorderState.metadata
    }
  });

  console.log('[ChromeTools] Recording started');
}

async function stopRecording() {
  const result = {
    actions: recorderState.actions,
    secrets: recorderState.secrets,
    metadata: {
      ...recorderState.metadata,
      entryUrl: recorderState.startUrl,
      recordedAt: new Date().toISOString()
    }
  };

  // Notify content script in current recording tab to stop
  if (recorderState.currentTabId) {
    try {
      await chrome.tabs.sendMessage(recorderState.currentTabId, { type: 'RECORDING_STOPPED' });
      console.log('[ChromeTools] Notified content script about recording stop');
    } catch (error) {
      console.log('[ChromeTools] Content script not available:', error.message);
    }
  }

  recorderState.isRecording = false;
  recorderState.isPaused = false;

  await saveRecorderState();

  // Notify Bridge
  sendToBridge({
    type: 'recorder_state_changed',
    payload: {
      isRecording: false,
      isPaused: false
    }
  });

  // Also send recordings to Bridge for storage
  sendToBridge({
    type: 'recordings_cleared'
  });

  console.log('[ChromeTools] Recording stopped');
  return result;
}

async function pauseRecording() {
  recorderState.isPaused = !recorderState.isPaused;
  await saveRecorderState();

  // Notify content script about pause/resume
  if (recorderState.currentTabId) {
    try {
      const messageType = recorderState.isPaused ? 'RECORDING_PAUSED' : 'RECORDING_RESUMED';
      await chrome.tabs.sendMessage(recorderState.currentTabId, { type: messageType });
      console.log(`[ChromeTools] Notified content script: ${messageType}`);
    } catch (error) {
      console.log('[ChromeTools] Content script not available for pause notification:', error.message);
    }
  }

  sendToBridge({
    type: 'recorder_state_changed',
    payload: { isPaused: recorderState.isPaused }
  });

  console.log(`[ChromeTools] Recording ${recorderState.isPaused ? 'paused' : 'resumed'}`);
}

function recordAction(action) {
  if (!recorderState.isRecording || recorderState.isPaused) return;

  const actionWithMeta = {
    ...action,
    timestamp: Date.now(),
    index: recorderState.actions.length
  };

  recorderState.actions.push(actionWithMeta);
  saveRecorderState();

  // Send to Bridge
  sendToBridge({
    type: 'action_recorded',
    payload: actionWithMeta
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
      if (recorderState.isRecording && sender.tab?.id === recorderState.currentTabId) {
        recordAction({
          ...message.action,
          tabId: sender.tab?.id,
          tabUrl: sender.tab?.url
        });
        sendResponse({ success: true });
      } else {
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
      return true;

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
      sendToBridge({ type: 'recordings_cleared' });
      sendResponse({ success: true });
      break;

    case 'FORCE_RESET':
      recorderState.isRecording = false;
      recorderState.isPaused = false;
      recorderState.actions = [];
      recorderState.secrets = {};
      recorderState.metadata = null;
      recorderState.entryUrl = null;
      saveRecorderState();
      sendToBridge({
        type: 'recorder_state_changed',
        payload: { isRecording: false, isPaused: false }
      });
      sendResponse({ success: true, message: 'Recording state reset' });
      break;

    case 'GET_STATE':
      sendResponse({
        isRecording: recorderState.isRecording,
        isPaused: recorderState.isPaused,
        actions: recorderState.actions,
        metadata: recorderState.metadata,
        isConnected: isConnected,
        connectedInstances: isConnected ? 1 : 0,
        scenarioName: recorderState.metadata?.name || '',
        scenarioDescription: recorderState.metadata?.description || '',
        scenarioTags: recorderState.metadata?.tags || []
      });
      break;

    case 'SAVE_SCENARIO':
      // Forward to Bridge for saving
      sendToBridge({
        type: 'scenario_save',
        payload: message.scenario,
        requestId: `save_${Date.now()}`
      });
      sendResponse({ success: true });
      break;

    default:
      console.log('[ChromeTools] Unknown message:', message.type);
  }
});

// ============================================
// Initialization
// ============================================

async function init() {
  console.log('[ChromeTools] Initializing extension...');

  // Load saved state
  await loadRecorderState();

  // Connect to Native Host
  connectToNativeHost();

  console.log('[ChromeTools] Extension initialized');
}

// Start
init();

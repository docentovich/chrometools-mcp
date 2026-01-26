#!/usr/bin/env node
/**
 * bridge-service.js
 *
 * Native Messaging Host that acts as a persistent bridge between
 * Chrome Extension and Claude/MCP clients.
 *
 * - Launched by Chrome when Extension starts
 * - Maintains state (tabs, recordings, events)
 * - Accepts 0-8 WebSocket clients
 * - Clients get full state on connect + real-time updates
 */

import { WebSocketServer } from 'ws';
import { createRequire } from 'module';
import { saveScenario } from '../recorder/scenario-storage.js';
import { urlToProjectId } from '../utils/url-to-project.js';

// For Native Messaging protocol
const require = createRequire(import.meta.url);

// ============================================
// Configuration
// ============================================

const WS_PORT = 9223;
const MAX_CLIENTS = 8;
const HOST_NAME = 'com.chrometools.bridge';

// ============================================
// State Store
// ============================================

const state = {
  tabs: new Map(),           // tabId -> {url, title, active, ...}
  recordings: [],            // Array of recorded actions
  recorderState: {
    isRecording: false,
    isPaused: false,
    metadata: null,
    secrets: {}
  },
  eventLog: [],              // Ring buffer of recent events (max 1000)
  extensionConnected: false
};

const MAX_EVENT_LOG = 1000;

// ============================================
// WebSocket Server for Claude/MCP Clients
// ============================================

let wss = null;
const clients = new Set();

function startWebSocketServer() {
  wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

  wss.on('listening', () => {
    log(`WebSocket server listening on port ${WS_PORT}`);
  });

  wss.on('connection', (ws) => {
    if (clients.size >= MAX_CLIENTS) {
      log(`Max clients (${MAX_CLIENTS}) reached, rejecting connection`);
      ws.close(1013, 'Max clients reached');
      return;
    }

    clients.add(ws);
    log(`Client connected (${clients.size}/${MAX_CLIENTS})`);

    // Send full state immediately on connect
    sendToClient(ws, {
      type: 'initial_state',
      payload: getFullState()
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(ws, message);
      } catch (error) {
        log(`Failed to parse client message: ${error.message}`);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      log(`Client disconnected (${clients.size}/${MAX_CLIENTS})`);
    });

    ws.on('error', (error) => {
      log(`Client error: ${error.message}`);
    });
  });

  wss.on('error', (error) => {
    log(`WebSocket server error: ${error.message}`);
  });
}

function getFullState() {
  return {
    tabs: Array.from(state.tabs.values()),
    recordings: state.recordings,
    recorderState: state.recorderState,
    extensionConnected: state.extensionConnected,
    timestamp: Date.now()
  };
}

function sendToClient(ws, message) {
  if (ws.readyState === 1) { // OPEN
    ws.send(JSON.stringify(message));
  }
}

function broadcastToClients(message) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

function handleClientMessage(ws, message) {
  log(`Client message: ${message.type}`);

  switch (message.type) {
    case 'get_state':
      sendToClient(ws, {
        type: 'state',
        payload: getFullState(),
        requestId: message.requestId
      });
      break;

    case 'get_tabs':
      sendToClient(ws, {
        type: 'tabs',
        payload: { tabs: Array.from(state.tabs.values()) },
        requestId: message.requestId
      });
      break;

    case 'get_recorder_state':
      sendToClient(ws, {
        type: 'recorder_state',
        payload: state.recorderState,
        requestId: message.requestId
      });
      break;

    // Commands to forward to extension
    case 'start_recording':
    case 'stop_recording':
    case 'pause_recording':
    case 'switch_tab':
    case 'recorder_start':
    case 'recorder_stop':
    case 'recorder_pause':
      // Forward to extension via Native Messaging
      sendToExtension({
        type: message.type,
        payload: message.payload,
        requestId: message.requestId
      });
      break;

    default:
      log(`Unknown client message type: ${message.type}`);
  }
}

// ============================================
// Native Messaging (communication with Extension)
// ============================================

let nativePort = null;

function initNativeMessaging() {
  // Native Messaging uses stdin/stdout with length-prefixed JSON
  process.stdin.on('readable', () => {
    let chunk;
    while ((chunk = process.stdin.read(4)) !== null) {
      const length = chunk.readUInt32LE(0);
      const data = process.stdin.read(length);
      if (data) {
        try {
          const message = JSON.parse(data.toString());
          handleExtensionMessage(message);
        } catch (error) {
          log(`Failed to parse extension message: ${error.message}`);
        }
      }
    }
  });

  process.stdin.on('end', () => {
    log('Extension disconnected (stdin closed)');
    state.extensionConnected = false;
    broadcastToClients({ type: 'extension_disconnected' });
    // Chrome closed the connection, we should exit
    setTimeout(() => process.exit(0), 100);
  });

  state.extensionConnected = true;
  log('Native Messaging initialized');
}

function sendToExtension(message) {
  const json = JSON.stringify(message);
  const buffer = Buffer.alloc(4 + json.length);
  buffer.writeUInt32LE(json.length, 0);
  buffer.write(json, 4);
  process.stdout.write(buffer);
}

function handleExtensionMessage(message) {
  log(`Extension message: ${message.type}`);
  addToEventLog(message);

  switch (message.type) {
    case 'tabs_sync':
      // Full tabs sync
      state.tabs.clear();
      if (message.payload?.tabs) {
        message.payload.tabs.forEach(tab => {
          state.tabs.set(tab.tabId, tab);
        });
      }
      broadcastToClients({
        type: 'tabs_sync',
        payload: { tabs: Array.from(state.tabs.values()) }
      });
      break;

    case 'tab_created':
      state.tabs.set(message.payload.tabId, message.payload);
      broadcastToClients({ type: 'tab_created', payload: message.payload });
      break;

    case 'tab_closed':
      state.tabs.delete(message.payload.tabId);
      broadcastToClients({ type: 'tab_closed', payload: message.payload });
      break;

    case 'tab_activated':
      // Update active status
      for (const [id, tab] of state.tabs) {
        tab.active = (id === message.payload.tabId);
      }
      broadcastToClients({ type: 'tab_activated', payload: message.payload });
      break;

    case 'tab_updated':
      if (message.payload.tab) {
        state.tabs.set(message.payload.tabId, message.payload.tab);
      }
      broadcastToClients({ type: 'tab_updated', payload: message.payload });
      break;

    case 'recorder_state_changed':
      state.recorderState = { ...state.recorderState, ...message.payload };
      broadcastToClients({ type: 'recorder_state_changed', payload: message.payload });
      break;

    case 'action_recorded':
      state.recordings.push(message.payload);
      broadcastToClients({ type: 'action_recorded', payload: message.payload });
      break;

    case 'recordings_cleared':
      state.recordings = [];
      broadcastToClients({ type: 'recordings_cleared' });
      break;

    case 'scenario_save':
      // Handle scenario save from extension popup
      handleScenarioSave(message.payload, message.requestId);
      break;

    // Responses to forward to requesting client
    case 'recorder_started':
    case 'recorder_stopped':
    case 'recorder_paused':
    case 'scenario_saved':
    case 'scenario_list_response':
      broadcastToClients(message);
      break;

    case 'pong':
      broadcastToClients({ type: 'pong' });
      break;

    default:
      // Forward unknown messages to clients
      broadcastToClients(message);
  }
}

function addToEventLog(event) {
  state.eventLog.push({
    ...event,
    timestamp: Date.now()
  });
  // Keep ring buffer bounded
  if (state.eventLog.length > MAX_EVENT_LOG) {
    state.eventLog.shift();
  }
}

/**
 * Handle scenario save from extension popup
 */
async function handleScenarioSave(scenario, requestId) {
  try {
    // Determine project ID from entry URL
    const entryUrl = scenario.metadata?.entryUrl || scenario.entryUrl || '';
    const projectId = urlToProjectId(entryUrl);

    log(`Saving scenario "${scenario.name}" to project "${projectId}"`);

    // Convert actions to chain format if needed (popup sends 'actions', storage expects 'chain')
    const scenarioToSave = {
      ...scenario,
      chain: scenario.chain || scenario.actions || []
    };

    const result = await saveScenario(scenarioToSave, projectId);

    // Send response back to extension
    sendToExtension({
      type: 'scenario_saved',
      payload: {
        success: result.success,
        filePath: result.filePath,
        error: result.error
      },
      requestId
    });

    // Also notify clients
    broadcastToClients({
      type: 'scenario_saved',
      payload: {
        success: result.success,
        name: scenario.name,
        projectId
      },
      requestId
    });

    log(`Scenario saved: ${scenario.name}`);
  } catch (error) {
    log(`Failed to save scenario: ${error.message}`);

    sendToExtension({
      type: 'scenario_saved',
      payload: {
        success: false,
        error: error.message
      },
      requestId
    });
  }
}

// ============================================
// Logging
// ============================================

function log(message) {
  // Write to stderr (Native Messaging uses stdout for protocol)
  console.error(`[bridge] ${new Date().toISOString()} ${message}`);
}

// ============================================
// Main
// ============================================

function main() {
  log(`Starting ${HOST_NAME} bridge service`);

  // Start WebSocket server for clients
  startWebSocketServer();

  // Initialize Native Messaging with extension
  initNativeMessaging();

  // Send ready message to extension
  sendToExtension({ type: 'bridge_ready' });

  log('Bridge service ready');
}

main();

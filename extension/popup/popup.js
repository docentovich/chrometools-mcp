/**
 * ChromeTools MCP Extension - Popup Script
 */

// DOM Elements
const elements = {
  // Status
  connectionStatus: document.getElementById('connection-status'),
  recordingStatus: document.getElementById('recording-status'),

  // Tabs navigation
  tabButtons: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Recorder
  metadataForm: document.getElementById('metadata-form'),
  actionCountDisplay: document.getElementById('action-count-display'),
  actionCount: document.getElementById('action-count'),
  actionsPreview: document.getElementById('actions-preview'),
  actionsList: document.getElementById('actions-list'),

  // Form fields
  scenarioName: document.getElementById('scenario-name'),
  scenarioDesc: document.getElementById('scenario-desc'),
  scenarioTags: document.getElementById('scenario-tags'),

  // Buttons
  btnStart: document.getElementById('btn-start'),
  btnPause: document.getElementById('btn-pause'),
  btnStop: document.getElementById('btn-stop'),
  btnClear: document.getElementById('btn-clear'),
  btnReset: document.getElementById('btn-reset'),

  // Tabs list
  tabsList: document.getElementById('tabs-list')
};

// State
let currentState = {
  isRecording: false,
  isPaused: false,
  actions: [],
  isConnected: false,
  scenarioName: '',
  scenarioDescription: '',
  scenarioTags: []
};

// ============================================
// Tab Navigation
// ============================================

elements.tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    const tabName = button.dataset.tab;

    // Update buttons
    elements.tabButtons.forEach(b => b.classList.remove('active'));
    button.classList.add('active');

    // Update content
    elements.tabContents.forEach(content => {
      content.classList.remove('active');
      if (content.id === `tab-${tabName}`) {
        content.classList.add('active');
      }
    });

    // Load tabs list if switching to tabs tab
    if (tabName === 'tabs') {
      loadTabsList();
    }

    if (tabName === 'passwords') {
      openPasswordsTab();
    }
  });
});

// ============================================
// State Management
// ============================================

async function loadState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    currentState = {
      isRecording: response.isRecording || false,
      isPaused: response.isPaused || false,
      actions: response.actions || [],
      isConnected: response.isConnected || false,
      scenarioName: response.scenarioName || '',
      scenarioDescription: response.scenarioDescription || '',
      scenarioTags: response.scenarioTags || []
    };
    updateUI();
  } catch (error) {
    console.error('Failed to load state:', error);
  }
}

function updateUI() {
  // Connection status
  if (currentState.isConnected) {
    elements.connectionStatus.classList.add('connected');
    elements.connectionStatus.querySelector('.status-text').textContent = 'Connected';
  } else {
    elements.connectionStatus.classList.remove('connected');
    elements.connectionStatus.querySelector('.status-text').textContent = 'Disconnected';
  }

  // Recording status
  elements.recordingStatus.classList.remove('recording', 'paused');
  if (currentState.isRecording) {
    if (currentState.isPaused) {
      elements.recordingStatus.classList.add('paused');
      elements.recordingStatus.querySelector('.recording-text').textContent = 'Paused';
    } else {
      elements.recordingStatus.classList.add('recording');
      elements.recordingStatus.querySelector('.recording-text').textContent = 'Recording...';
    }
  } else {
    elements.recordingStatus.querySelector('.recording-text').textContent = 'Not recording';
  }

  // Form vs Action Count
  if (currentState.isRecording) {
    elements.metadataForm.classList.add('hidden');
    elements.actionCountDisplay.classList.remove('hidden');
    elements.actionCount.textContent = currentState.actions.length;

    // Show actions preview
    if (currentState.actions.length > 0) {
      elements.actionsPreview.classList.remove('hidden');
      updateActionsList();
    }
  } else {
    elements.metadataForm.classList.remove('hidden');
    elements.actionCountDisplay.classList.add('hidden');
    elements.actionsPreview.classList.add('hidden');
  }

  // Buttons
  if (currentState.isRecording) {
    elements.btnStart.classList.add('hidden');
    elements.btnPause.classList.remove('hidden');
    elements.btnStop.classList.remove('hidden');
    elements.btnClear.classList.remove('hidden');
    elements.btnReset.classList.remove('hidden');

    // Update pause button text
    if (currentState.isPaused) {
      elements.btnPause.innerHTML = '<span class="btn-icon">&#9658;</span> Resume';
    } else {
      elements.btnPause.innerHTML = '<span class="btn-icon">&#10074;&#10074;</span> Pause';
    }
  } else {
    elements.btnStart.classList.remove('hidden');
    elements.btnPause.classList.add('hidden');
    elements.btnStop.classList.add('hidden');
    elements.btnClear.classList.add('hidden');
    elements.btnReset.classList.add('hidden');
  }

  // Disable start if not connected or no name
  elements.btnStart.disabled = !currentState.isConnected;
}

function updateActionsList() {
  const recentActions = currentState.actions.slice(-5).reverse();

  elements.actionsList.innerHTML = recentActions.map(action => {
    let details = '';
    switch (action.type) {
      case 'click':
        details = action.data?.text || action.selector?.primary || '';
        break;
      case 'type':
        details = action.data?.isSecret ? '***' : (action.data?.text || '').substring(0, 20);
        break;
      case 'select':
        details = action.data?.text || action.data?.value || '';
        break;
      case 'keypress':
        details = (action.data?.modifiers || []).concat(action.data?.key || '').join('+');
        break;
      default:
        details = action.selector?.primary || '';
    }

    return `
      <li>
        <span class="action-type">${action.type}</span>
        <span class="action-details">${escapeHtml(details)}</span>
      </li>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// Button Handlers
// ============================================

elements.btnStart.addEventListener('click', async () => {
  const name = elements.scenarioName.value.trim();
  const description = elements.scenarioDesc.value.trim();
  const tags = elements.scenarioTags.value.split(',').map(t => t.trim()).filter(Boolean);

  if (!name) {
    elements.scenarioName.focus();
    elements.scenarioName.style.borderColor = '#ef4444';
    setTimeout(() => {
      elements.scenarioName.style.borderColor = '';
    }, 2000);
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      options: {
        name,
        description,
        tags
      }
    });

    // Save metadata in state for later use
    currentState.isRecording = true;
    currentState.isPaused = false;
    currentState.actions = [];
    currentState.scenarioName = name;
    currentState.scenarioDescription = description;
    currentState.scenarioTags = tags;
    updateUI();
  } catch (error) {
    console.error('Failed to start recording:', error);
    alert('Failed to start recording: ' + error.message);
  }
});

elements.btnPause.addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
    currentState.isPaused = response.isPaused;
    updateUI();
  } catch (error) {
    console.error('Failed to pause recording:', error);
  }
});

elements.btnStop.addEventListener('click', async () => {
  // Use saved scenario name from state (form is hidden during recording)
  const name = currentState.scenarioName || elements.scenarioName.value.trim();

  if (!name) {
    alert('Please enter a scenario name');
    return;
  }

  try {
    // First, stop recording to get actions and secrets
    const stopResult = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });

    if (!stopResult.success) {
      throw new Error('Failed to stop recording');
    }

    // Then save the scenario with collected data
    await chrome.runtime.sendMessage({
      type: 'SAVE_SCENARIO',
      scenario: {
        name,
        description: currentState.scenarioDescription || elements.scenarioDesc.value.trim(),
        tags: currentState.scenarioTags.length > 0 ? currentState.scenarioTags : elements.scenarioTags.value.split(',').map(t => t.trim()).filter(Boolean),
        actions: stopResult.actions || [],
        secrets: stopResult.secrets || {},
        metadata: stopResult.metadata || {}
      }
    });

    // Reset form and state
    elements.scenarioName.value = '';
    elements.scenarioDesc.value = '';
    elements.scenarioTags.value = '';

    currentState.isRecording = false;
    currentState.isPaused = false;
    currentState.actions = [];
    currentState.scenarioName = '';
    currentState.scenarioDescription = '';
    currentState.scenarioTags = [];
    updateUI();

    // Show success message
    alert('Scenario saved successfully!');

    // Force reload state from background to ensure sync
    await loadState();
  } catch (error) {
    console.error('Failed to save scenario:', error);
    alert('Failed to save scenario: ' + error.message);
  }
});

elements.btnClear.addEventListener('click', async () => {
  if (!confirm('Clear all recorded actions?')) return;

  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_ACTIONS' });
    currentState.actions = [];
    updateUI();
  } catch (error) {
    console.error('Failed to clear actions:', error);
  }
});

elements.btnReset.addEventListener('click', async () => {
  if (!confirm('Force reset recording? All recorded actions will be lost.')) return;

  try {
    await chrome.runtime.sendMessage({ type: 'FORCE_RESET' });

    // Reset local state
    currentState.isRecording = false;
    currentState.isPaused = false;
    currentState.actions = [];
    currentState.scenarioName = '';
    currentState.scenarioDescription = '';
    currentState.scenarioTags = [];

    // Reset form
    elements.scenarioName.value = '';
    elements.scenarioDesc.value = '';
    elements.scenarioTags.value = '';

    updateUI();
  } catch (error) {
    console.error('Failed to reset:', error);
    alert('Failed to reset: ' + error.message);
  }
});

// ============================================
// Tabs List
// ============================================

async function loadTabsList() {
  elements.tabsList.innerHTML = '<div class="tabs-loading">Loading tabs...</div>';

  try {
    const tabs = await chrome.tabs.query({});

    if (tabs.length === 0) {
      elements.tabsList.innerHTML = '<div class="tabs-loading">No tabs open</div>';
      return;
    }

    elements.tabsList.innerHTML = tabs.map(tab => `
      <div class="tab-item ${tab.active ? 'active' : ''}" data-tab-id="${tab.id}">
        <img class="tab-favicon" src="${tab.favIconUrl || ''}" alt="" onerror="this.style.display='none'">
        <div class="tab-info">
          <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
          <div class="tab-url">${escapeHtml(tab.url || '')}</div>
        </div>
        ${tab.active ? '<span class="tab-active-badge">Active</span>' : ''}
      </div>
    `).join('');

    // Add click handlers
    elements.tabsList.querySelectorAll('.tab-item').forEach(item => {
      item.addEventListener('click', () => {
        const tabId = parseInt(item.dataset.tabId);
        chrome.tabs.update(tabId, { active: true });
        window.close();
      });
    });

  } catch (error) {
    console.error('Failed to load tabs:', error);
    elements.tabsList.innerHTML = '<div class="tabs-loading">Failed to load tabs</div>';
  }
}

// ============================================
// Message Listener
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'ACTION_RECORDED':
      currentState.actions.push({});  // Just increment count
      elements.actionCount.textContent = message.actionCount || currentState.actions.length;
      break;

    case 'SCENARIO_SAVED':
      if (message.success) {
        // Already handled in btnStop click
      } else {
        alert('Failed to save scenario: ' + (message.error || 'Unknown error'));
      }
      break;
  }
});

// ============================================
// Initialization
// ============================================

loadState();

// Refresh state periodically
setInterval(loadState, 2000);

// ============================================
// Passwords (Credential Vault)
// ============================================

const vaultEls = {
  form: document.getElementById('vault-form'),
  url: document.getElementById('vault-url'),
  username: document.getElementById('vault-username'),
  password: document.getElementById('vault-password'),
  name: document.getElementById('vault-name'),
  togglePassword: document.getElementById('vault-toggle-password'),
  error: document.getElementById('vault-error'),
  save: document.getElementById('vault-save'),
  cancel: document.getElementById('vault-cancel'),
  list: document.getElementById('vault-list')
};

// Name of the entry being edited, null when adding a new one
let vaultEditing = null;

async function vaultRequest(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.success) {
    throw new Error(response?.error || 'Vault request failed');
  }
  return response.result;
}

function showVaultError(message) {
  vaultEls.error.textContent = message || '';
  vaultEls.error.classList.toggle('hidden', !message);
}

async function openPasswordsTab() {
  if (!vaultEditing && !vaultEls.url.value) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ? new URL(tab.url) : null;
      if (url && (url.protocol === 'https:' || url.protocol === 'http:')) {
        vaultEls.url.value = url.origin;
      }
    } catch {
      // No active tab URL - leave field empty
    }
  }
  await loadVaultList();
}

async function loadVaultList() {
  try {
    const entries = await vaultRequest('VAULT_LIST');
    renderVaultList(entries);
  } catch (err) {
    showVaultError(err.message);
  }
}

function renderVaultList(entries) {
  if (!entries.length) {
    vaultEls.list.innerHTML = '<li class="vault-empty">No saved passwords</li>';
    return;
  }

  vaultEls.list.innerHTML = entries.map(entry => `
    <li class="vault-item" data-name="${escapeHtml(entry.name)}">
      <div class="vault-item-info">
        <div class="vault-item-name">${escapeHtml(entry.name)}</div>
        <div class="vault-item-meta">${escapeHtml(entry.username || '(no login)')} &middot; ${escapeHtml(entry.origins.join(', '))}</div>
        <div class="vault-item-secret hidden"></div>
      </div>
      <div class="vault-item-actions">
        <button class="btn btn-ghost btn-small" data-action="reveal" title="Show password">&#128065;</button>
        <button class="btn btn-ghost btn-small" data-action="edit" title="Edit">&#9998;</button>
        <button class="btn btn-ghost btn-small" data-action="delete" title="Delete">&#10006;</button>
      </div>
    </li>
  `).join('');

  // Keep entries for edit prefill
  vaultEls.list._entries = entries;
}

function resetVaultForm() {
  vaultEditing = null;
  vaultEls.form.reset();
  vaultEls.password.type = 'password';
  vaultEls.password.placeholder = '';
  vaultEls.save.textContent = 'Save';
  vaultEls.cancel.classList.add('hidden');
  showVaultError('');
}

vaultEls.togglePassword.addEventListener('click', () => {
  vaultEls.password.type = vaultEls.password.type === 'password' ? 'text' : 'password';
});

vaultEls.cancel.addEventListener('click', () => {
  resetVaultForm();
  openPasswordsTab();
});

vaultEls.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showVaultError('');
  vaultEls.save.disabled = true;
  try {
    await vaultRequest('VAULT_SAVE', {
      entry: {
        url: vaultEls.url.value,
        username: vaultEls.username.value,
        password: vaultEls.password.value,
        name: vaultEls.name.value,
        originalName: vaultEditing
      }
    });
    resetVaultForm();
    await openPasswordsTab();
  } catch (err) {
    showVaultError(err.message);
  } finally {
    vaultEls.save.disabled = false;
  }
});

vaultEls.list.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = button.closest('.vault-item');
  const name = item.dataset.name;
  showVaultError('');

  try {
    switch (button.dataset.action) {
      case 'reveal': {
        const secretEl = item.querySelector('.vault-item-secret');
        if (!secretEl.classList.contains('hidden')) {
          secretEl.textContent = '';
          secretEl.classList.add('hidden');
          break;
        }
        const { password } = await vaultRequest('VAULT_REVEAL', { name });
        secretEl.textContent = password;
        secretEl.classList.remove('hidden');
        break;
      }

      case 'edit': {
        const entry = (vaultEls.list._entries || []).find(e => e.name === name);
        if (!entry) break;
        vaultEditing = name;
        vaultEls.url.value = entry.origins[0] || '';
        vaultEls.username.value = entry.username || '';
        vaultEls.password.value = '';
        vaultEls.password.placeholder = 'Leave empty to keep current';
        vaultEls.name.value = entry.name;
        vaultEls.save.textContent = 'Update';
        vaultEls.cancel.classList.remove('hidden');
        vaultEls.url.focus();
        break;
      }

      case 'delete':
        if (!confirm(`Delete "${name}"?`)) break;
        await vaultRequest('VAULT_DELETE', { name });
        if (vaultEditing === name) resetVaultForm();
        await loadVaultList();
        break;
    }
  } catch (err) {
    showVaultError(err.message);
  }
});

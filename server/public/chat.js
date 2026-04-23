import {
  clearNotice,
  copyText,
  el,
  escapeHtml,
  fetchJson,
  formatDate,
  forgetApiKey,
  getApiKey,
  getSavedApiKeys,
  loadAuthContext,
  notify,
  openTraceability,
  renderSystemContext,
  setActiveSessionId,
  setApiKey,
  statusClass,
} from './shared.js';

const state = {
  auth: null,
  advancedPanel: 'root',
  currentDetails: null,
  demoTaskMap: {},
  demoTasks: [],
  eventSource: null,
  pendingRequest: null,
  sessionId: null,
  sessions: [],
  dropdownOpen: false,
  advancedOpen: false,
};

function formatMessageBody(value) {
  return escapeHtml(value || '').replace(/\n/g, '<br>');
}

function humanizeStatus(status) {
  return String(status || 'idle').replace(/_/g, ' ');
}

function getActiveSessionRecord() {
  return state.sessions.find((item) => item.session_id === state.sessionId) || null;
}

function teardownStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function scrollConversationToEnd(behavior = 'auto') {
  const container = el('conversation-list');
  if (!container) {
    return;
  }
  requestAnimationFrame(() => {
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  });
}

function setDropdownOpen(open) {
  state.dropdownOpen = open;
  const dropdown = el('session-dropdown');
  const btn = el('session-selector-btn');
  dropdown.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

function setAdvancedOpen(open) {
  state.advancedOpen = open;
  if (!open) {
    setAdvancedPanel('root');
  }
  el('advanced-menu').hidden = !open;
  el('advanced-toggle').setAttribute('aria-expanded', String(open));
}

function setAdvancedPanel(panel) {
  state.advancedPanel = panel;
  document.querySelectorAll('[data-advanced-panel]').forEach((node) => {
    node.hidden = node.dataset.advancedPanel !== panel;
  });
}

function showAuthModal(show) {
  el('auth-modal').classList.toggle('visible', show);
}

function updateSelectorButton() {
  const active = getActiveSessionRecord();
  const runtimeStatus = state.pendingRequest?.status
    || active?.status
    || (state.currentDetails?.active_request_id ? 'running' : 'idle');

  const name = state.sessionId
    ? (state.sessionId.length > 24 ? `…${state.sessionId.slice(-20)}` : state.sessionId)
    : 'No session';
  el('session-selector-name').textContent = name;
  el('session-selector-status').className = `session-status-indicator ${runtimeStatus}`;
}

function renderSessionDropdown(sessions = []) {
  const list = el('session-dropdown-list');
  if (sessions.length === 0) {
    list.innerHTML = '<div class="muted small" style="padding:0.65rem 0.85rem;">No sessions yet.</div>';
    return;
  }
  list.innerHTML = '';
  for (const item of sessions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `session-dropdown-item ${item.session_id === state.sessionId ? 'active' : ''}`;
    btn.dataset.sessionId = item.session_id;
    btn.innerHTML = `
      <div class="session-item-name">${escapeHtml(item.session_id)}</div>
      <div class="session-item-meta">
        <span class="badge">${escapeHtml(item.session_origin || 'client')}</span>
        <span class="badge">${escapeHtml(item.effective_role || 'user')}</span>
        <span class="badge ${statusClass(item.status || 'idle')}">${escapeHtml(humanizeStatus(item.status || 'idle'))}</span>
      </div>
    `;
    list.appendChild(btn);
  }
}

function renderConversationMeta() {
  updateSelectorButton();
  renderSessionDropdown(state.sessions);
}

function renderDemoTasks() {
  const container = el('demo-task-list');
  container.innerHTML = state.demoTasks.map((task) => `
    <button class="ghost demo-task-btn" type="button" data-demo-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>
  `).join('');
}

async function loadDemoTasks() {
  const payload = await fetchJson('/api/demo-tasks');
  state.demoTasks = Array.isArray(payload.items) ? payload.items : [];
  state.demoTaskMap = Object.fromEntries(state.demoTasks.map((item) => [item.id, item]));
  renderDemoTasks();
}

function updateComposerStatus() {
  const status = el('composer-status');
  if (!status) {
    return;
  }
  status.textContent = '';
}

function createMessageElement({ role, label, meta, body, actions = '', pending = false, timestamp = '' }) {
  const article = document.createElement('article');
  article.className = `message ${role}${pending ? ' pending' : ''}`;
  article.innerHTML = `
    <div class="message-header">
      <strong>${escapeHtml(label)}</strong>
      <span>${meta || ''}</span>
    </div>
    <div class="message-body">${body}</div>
    ${actions ? `<div class="message-actions">${actions}</div>` : ''}
    <div class="message-time">${escapeHtml(timestamp)}</div>
  `;
  return article;
}

function renderConversation(details = state.currentDetails || {}) {
  const container = el('conversation-list');
  const history = Array.isArray(details.request_history) ? details.request_history : [];
  const pendingRequestId = state.pendingRequest?.request_id || details.active_request_id || null;
  const pendingHistoryItem = pendingRequestId
    ? history.find((item) => item.request_id === pendingRequestId)
    : null;

  if (history.length === 0 && !state.pendingRequest) {
    container.innerHTML = `
      <div class="conversation-empty card">
        <div class="empty-state-content">
          <h3>MRP-VM Chat</h3>
          <p class="muted">Use the demo tasks or write a request. Traceability, KB Browser, and settings stay in dedicated pages.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  for (const item of history) {
    container.appendChild(createMessageElement({
      role: 'user',
      label: 'You',
      meta: '',
      body: formatMessageBody(item.request_text || ''),
      timestamp: formatDate(item.created_at),
      actions: `
        <button class="icon-btn" data-action="copy-user" data-request-id="${escapeHtml(item.request_id)}" title="Copy message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      `,
    }));

    if (!item.response && item.request_id === pendingRequestId) {
      container.appendChild(createMessageElement({
        role: 'assistant',
        label: 'Assistant',
        meta: `<span class="badge ${statusClass(state.pendingRequest?.status || 'running')}">${escapeHtml(humanizeStatus(state.pendingRequest?.status || 'running'))}</span>`,
        body: `
          <div class="thinking-indicator" aria-live="polite">
            <span>Thinking...</span>
            <span class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
          </div>
        `,
        pending: true,
        timestamp: '',
      }));
      continue;
    }

    container.appendChild(createMessageElement({
      role: 'assistant',
      label: 'Assistant',
      meta: `<span class="badge ${statusClass(item.stop_reason || 'unknown')}">${escapeHtml(humanizeStatus(item.stop_reason || 'unknown'))}</span>`,
      body: formatMessageBody(item.response || '(no response captured)'),
      timestamp: formatDate(item.created_at),
      actions: `
        <button class="icon-btn" data-action="details" data-request-id="${escapeHtml(item.request_id)}" title="View traceability">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
        </button>
        ${item.response ? `
          <button class="icon-btn" data-action="copy" data-request-id="${escapeHtml(item.request_id)}" title="Copy response">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        ` : ''}
        <button class="icon-btn" data-action="retry" data-request-id="${escapeHtml(item.request_id)}" title="Retry request">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
      `,
    }));
  }

  if (state.pendingRequest && !pendingHistoryItem) {
    container.appendChild(createMessageElement({
      role: 'user',
      label: 'You',
      meta: '',
      body: formatMessageBody(state.pendingRequest.request_text || ''),
      timestamp: formatDate(state.pendingRequest.created_at),
    }));
    container.appendChild(createMessageElement({
      role: 'assistant',
      label: 'Assistant',
      meta: `<span class="badge ${statusClass(state.pendingRequest.status || 'running')}">${escapeHtml(humanizeStatus(state.pendingRequest.status || 'running'))}</span>`,
      body: `
        <div class="thinking-indicator" aria-live="polite">
          <span>Thinking...</span>
          <span class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        </div>
      `,
      pending: true,
    }));
  }

  scrollConversationToEnd(history.length > 0 ? 'smooth' : 'auto');
}

function syncPendingFromDetails(details) {
  if (!details?.active_request_id) {
    state.pendingRequest = null;
    return;
  }
  const runningItem = (details.request_history || []).find((item) => item.request_id === details.active_request_id)
    || details.request_history?.at(-1)
    || null;
  if (state.pendingRequest?.request_id === details.active_request_id) {
    return;
  }
  state.pendingRequest = {
    request_id: details.active_request_id,
    request_text: runningItem?.request_text || '',
    created_at: runningItem?.created_at || new Date().toISOString(),
    status: 'running',
  };
}

async function loadSession(sessionId, options = {}) {
  const { allowReconnect = true } = options;
  if (state.sessionId && state.sessionId !== sessionId) {
    teardownStream();
  }
  state.sessionId = sessionId;
  setActiveSessionId(sessionId);
  const details = await fetchJson(`/api/sessions/${sessionId}`);
  state.currentDetails = details;
  syncPendingFromDetails(details);
  renderConversationMeta();
  renderConversation(details);
  setDropdownOpen(false);
  if (!details.active_request_id) {
    teardownStream();
  } else if (allowReconnect && state.pendingRequest?.request_id === details.active_request_id && !state.eventSource) {
    openStream(details.active_request_id);
  }
}

async function refreshSessions(options = {}) {
  const { autoLoad = true } = options;
  const payload = await fetchJson('/api/sessions');
  state.sessions = payload.sessions || [];
  renderSessionDropdown(state.sessions);

  if (!state.sessions.length) {
    state.sessionId = null;
    state.currentDetails = null;
    state.pendingRequest = null;
    updateSelectorButton();
    renderConversation();
    return;
  }

  const activeExists = state.sessionId && state.sessions.some((item) => item.session_id === state.sessionId);
  if (!activeExists) {
    state.sessionId = state.sessions[0].session_id;
  }

  updateSelectorButton();
  if (autoLoad && state.sessionId) {
    await loadSession(state.sessionId);
  }
}

async function createSession() {
  const created = await fetchJson('/api/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
    sessionId: null,
  });
  await refreshAuthSummary();
  await refreshSessions({ autoLoad: false });
  await loadSession(created.session_id, { allowReconnect: false });
  setDropdownOpen(false);
}

async function reloadActiveSession() {
  if (!state.sessionId) {
    notify('No session is selected.', 'error');
    return;
  }
  teardownStream();
  await refreshSessions({ autoLoad: false });
  await loadSession(state.sessionId, { allowReconnect: true });
  notify('Session reloaded.');
}

async function logoutFromChat() {
  teardownStream();
  setApiKey('');
  setActiveSessionId('');
  state.sessionId = null;
  state.sessions = [];
  state.currentDetails = null;
  state.pendingRequest = null;
  renderConversation();
  renderConversationMeta();
  await ensureAuthFlow();
  await refreshSessions({ autoLoad: false });
  notify('Logged out.');
}

function updateSessionRecord(patch) {
  state.sessions = state.sessions.map((item) => (
    item.session_id === state.sessionId
      ? { ...item, ...patch }
      : item
  ));
  renderSessionDropdown(state.sessions);
  updateSelectorButton();
}

function openStream(requestId) {
  teardownStream();
  const params = new URLSearchParams({
    session_id: state.sessionId,
  });
  const apiKey = getApiKey();
  if (apiKey) {
    params.set('api_key', apiKey);
  }
  state.eventSource = new EventSource(`/api/sessions/${state.sessionId}/requests/${requestId}/stream?${params.toString()}`);
  for (const eventName of ['request_started', 'planning_triggered', 'failure_recorded', 'request_stopped']) {
    state.eventSource.addEventListener(eventName, async (event) => {
      const payload = JSON.parse(event.data);
      const liveStatus = payload.stop_reason || payload.final_outcome || (eventName === 'planning_triggered' ? 'planning' : 'running');
      if (state.pendingRequest?.request_id === requestId) {
        state.pendingRequest = {
          ...state.pendingRequest,
          status: liveStatus,
        };
      }
      updateSessionRecord({
        status: eventName === 'request_stopped' ? (payload.stop_reason || 'idle') : liveStatus,
        last_activity_at: payload.created_at || new Date().toISOString(),
      });
      renderConversation(state.currentDetails);

      if (eventName === 'request_stopped') {
        state.pendingRequest = null;
        teardownStream();
        await refreshSessions({ autoLoad: false });
        await loadSession(state.sessionId, { allowReconnect: false });
      }
    });
  }
}

async function submitRequest(event) {
  event.preventDefault();
  clearNotice();
  try {
    const requestText = el('request-input').value.trim();
    if (!requestText) {
      notify('Write a request first.', 'error');
      return;
    }
    if (!state.sessionId) {
      await createSession();
    }

    const response = await fetchJson(`/api/sessions/${state.sessionId}/requests`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        request: requestText,
        budgets: {
          steps_remaining: Number(el('step-budget').value),
          planning_remaining: Number(el('planning-budget').value),
        },
      }),
    });

    state.pendingRequest = {
      request_id: response.request_id,
      request_text: requestText,
      created_at: new Date().toISOString(),
      status: 'running',
    };
    state.currentDetails = state.currentDetails || { request_history: [] };
    updateSessionRecord({
      status: 'running',
      last_activity_at: state.pendingRequest.created_at,
    });
    updateSelectorButton();
    renderConversation();
    openStream(response.request_id);
    el('request-input').value = '';
    el('request-input').style.height = 'auto';
    updateComposerStatus();
    setAdvancedOpen(false);
  } catch (error) {
    notify(error.message, 'error');
  }
}

function renderSavedAuthKeys() {
  const items = getSavedApiKeys();
  el('chat-saved-key-options').innerHTML = items.map((entry) => `
    <option value="${escapeHtml(entry.token)}">${escapeHtml(entry.label)}</option>
  `).join('');
  el('chat-auth-saved-keys').innerHTML = items.length
    ? items.map((entry) => `
      <div class="saved-key-row">
        <div class="stack compact">
          <strong>${escapeHtml(entry.label)}</strong>
          <div class="muted small">${escapeHtml(entry.id)}</div>
        </div>
        <div class="row wrap">
          <button class="secondary" type="button" data-auth-use="${escapeHtml(entry.token)}">Use</button>
          <button class="secondary" type="button" data-auth-forget="${escapeHtml(entry.id)}">Forget</button>
        </div>
      </div>
    `).join('')
    : '<div class="muted small">No saved browser keys.</div>';
}

async function refreshAuthSummary() {
  state.auth = await loadAuthContext();
  renderSystemContext(el('auth-summary'), {
    session_origin: state.auth.caller.session_origin,
    can_edit_global_state: state.auth.caller.role === 'admin',
  });
}

async function ensureAuthFlow() {
  await refreshAuthSummary();
  renderSavedAuthKeys();
  const bootstrap = state.auth.bootstrap;
  const currentKey = getApiKey();
  el('chat-api-key-input').value = currentKey;
  el('chat-bootstrap-key').disabled = !bootstrap.bootstrap_admin_available || bootstrap.has_api_keys;

  if (bootstrap.has_api_keys && !currentKey) {
    el('auth-modal-title').textContent = 'API key required';
    el('auth-modal-status').textContent = 'Select or paste an API key. Saved local keys appear below for quick switching.';
    showAuthModal(true);
    return;
  }

  if (!bootstrap.has_api_keys && !currentKey) {
    el('auth-modal-title').textContent = 'Create bootstrap admin key';
    el('auth-modal-status').textContent = 'No server API keys exist yet. Create the first admin key and store it locally in this browser.';
    showAuthModal(true);
    return;
  }

  showAuthModal(false);
}

async function applyAuthKey({ remember = false } = {}) {
  const token = el('chat-api-key-input').value.trim();
  const label = el('chat-api-key-label').value.trim();
  if (!token) {
    notify('Provide an API key first.', 'error');
    return;
  }
  setApiKey(token, { remember, label });
  await ensureAuthFlow();
  await refreshSessions({ autoLoad: false });
}

async function bootstrapAuthKey() {
  const payload = await fetchJson('/api/auth/bootstrap-key', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      label: el('chat-api-key-label').value.trim() || 'Bootstrap admin',
    }),
  });
  setApiKey(payload.api_key, { remember: true, label: payload.record.label });
  el('chat-api-key-input').value = payload.api_key;
  el('chat-api-key-label').value = payload.record.label;
  await ensureAuthFlow();
}

async function insertTextFilesIntoInput(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) {
    return;
  }
  const chunks = await Promise.all(files.map(async (file) => {
    const text = await file.text();
    return `File: ${file.name}\n\`\`\`\n${text}\n\`\`\``;
  }));
  const textarea = el('request-input');
  const separator = textarea.value.trim() ? '\n\n' : '';
  textarea.value = `${textarea.value}${separator}${chunks.join('\n\n')}`.trim();
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  notify(`${files.length} text file(s) inserted into the request.`);
}

function attachEventHandlers() {
  el('new-session').addEventListener('click', () => createSession().catch((error) => notify(error.message, 'error')));
  el('reload-session').addEventListener('click', () => reloadActiveSession().catch((error) => notify(error.message, 'error')));
  el('chat-logout').addEventListener('click', () => logoutFromChat().catch((error) => notify(error.message, 'error')));
  el('chat-composer').addEventListener('submit', submitRequest);

  el('session-selector-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    setDropdownOpen(!state.dropdownOpen);
  });

  el('session-dropdown-list').addEventListener('click', (event) => {
    const btn = event.target.closest('.session-dropdown-item');
    if (!btn) {
      return;
    }
    loadSession(btn.dataset.sessionId).catch((error) => notify(error.message, 'error'));
  });

  el('advanced-toggle').addEventListener('click', (event) => {
    event.stopPropagation();
    setAdvancedOpen(!state.advancedOpen);
  });

  el('advanced-menu').addEventListener('click', (event) => {
    const navButton = event.target.closest('[data-advanced-nav]');
    if (navButton) {
      setAdvancedPanel(navButton.dataset.advancedNav);
      return;
    }
    if (event.target.closest('[data-advanced-close]')) {
      setAdvancedOpen(false);
      return;
    }
    if (event.target.closest('#text-insert-trigger')) {
      el('text-insert-input').click();
    }
  });

  document.addEventListener('click', (event) => {
    if (state.dropdownOpen && !el('session-selector').contains(event.target)) {
      setDropdownOpen(false);
    }
    if (state.advancedOpen && !el('advanced-popover').contains(event.target)) {
      setAdvancedOpen(false);
    }
  });

  const textarea = el('request-input');
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      el('chat-composer').dispatchEvent(new Event('submit'));
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.advancedOpen) {
      setAdvancedOpen(false);
    }
  });

  el('conversation-list').addEventListener('click', async (event) => {
    const actionButton = event.target.closest('button[data-action]');
    if (!actionButton) {
      return;
    }
    const requestId = actionButton.dataset.requestId;
    const details = await fetchJson(`/api/sessions/${state.sessionId}`);
    const selected = (details.request_history || []).find((item) => item.request_id === requestId);
    if (!selected) {
      return;
    }
    if (actionButton.dataset.action === 'details') {
      openTraceability(state.sessionId, requestId);
      return;
    }
    if (actionButton.dataset.action === 'copy-user') {
      await copyText(selected.request_text ?? '');
      notify('Message copied.');
      return;
    }
    if (actionButton.dataset.action === 'copy') {
      await copyText(selected.response ?? '');
      notify('Response copied.');
      return;
    }
    if (actionButton.dataset.action === 'retry') {
      textarea.value = selected.request_text ?? '';
      textarea.focus();
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    }
  });

  el('demo-task-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-demo-task]');
    if (!button) {
      return;
    }
    textarea.value = state.demoTaskMap[button.dataset.demoTask]?.prompt || '';
    textarea.focus();
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    setAdvancedOpen(false);
  });

  el('text-insert-input').addEventListener('change', (event) => {
    insertTextFilesIntoInput(event.target.files).catch((error) => notify(error.message, 'error'));
    event.target.value = '';
  });
  el('step-budget').addEventListener('input', updateComposerStatus);
  el('planning-budget').addEventListener('input', updateComposerStatus);

  el('chat-use-api-key').addEventListener('click', () => {
    applyAuthKey({ remember: false }).catch((error) => notify(error.message, 'error'));
  });
  el('chat-remember-api-key').addEventListener('click', () => {
    applyAuthKey({ remember: true }).catch((error) => notify(error.message, 'error'));
  });
  el('chat-bootstrap-key').addEventListener('click', () => {
    bootstrapAuthKey().catch((error) => notify(error.message, 'error'));
  });
  el('chat-auth-saved-keys').addEventListener('click', (event) => {
    const useButton = event.target.closest('[data-auth-use]');
    if (useButton) {
      const token = useButton.dataset.authUse;
      const saved = getSavedApiKeys().find((entry) => entry.token === token);
      el('chat-api-key-input').value = token;
      el('chat-api-key-label').value = saved?.label || '';
      applyAuthKey({ remember: false }).catch((error) => notify(error.message, 'error'));
      return;
    }
    const forgetButton = event.target.closest('[data-auth-forget]');
    if (forgetButton) {
      forgetApiKey(forgetButton.dataset.authForget);
      renderSavedAuthKeys();
      notify('Saved key removed from this browser.');
    }
  });
}

async function init() {
  attachEventHandlers();
  await loadDemoTasks();
  state.sessionId = localStorage.getItem('mrpvm.activeSessionId');
  updateComposerStatus();
  await ensureAuthFlow();
  await refreshSessions({ autoLoad: false });
  if (state.sessionId && state.sessions.some((item) => item.session_id === state.sessionId)) {
    await loadSession(state.sessionId);
    return;
  }
  if (state.sessions.length > 0) {
    await loadSession(state.sessions[0].session_id);
    return;
  }
  updateSelectorButton();
  renderConversation();
}

init().catch((error) => notify(error.message, 'error'));

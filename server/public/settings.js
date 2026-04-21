import {
  clearNotice,
  copyText,
  el,
  escapeHtml,
  fetchJson,
  formatDate,
  getApiKey,
  getSavedApiKeys,
  notify,
  rememberApiKey,
  renderSystemContext,
  setActiveSessionId,
  setApiKey,
} from './shared.js';

const state = {
  config: null,
  keys: [],
  models: [],
  availableTags: [],
  modelFilter: '',
  keyModal: {
    mode: null,
    token: '',
    record: null,
  },
};

function canEditGlobalState() {
  return Boolean(state.config?.system_context?.can_edit_global_state);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function modelTags(model) {
  return unique((model?.tags || []).map((tag) => normalizeText(tag)));
}

function modelLabel(model) {
  const tags = (model.tags || []).join(', ');
  return tags ? `${model.name} [${tags}]` : model.name;
}

function modelMatchesReference(model, reference) {
  const target = normalizeText(reference);
  if (!target) {
    return false;
  }
  return [model?.id, model?.name].filter(Boolean).some((value) => {
    const current = normalizeText(value);
    return current === target || current.endsWith(`/${target}`) || current.endsWith(`:${target}`);
  });
}

function inferDefaultFilter(reference) {
  const exact = state.models.find((model) => modelMatchesReference(model, reference));
  if (exact) {
    return modelTags(exact)[0] || '';
  }
  const source = String(reference || '').toLowerCase();
  if (/code|coder|codex/.test(source) && state.availableTags.includes('coding')) return 'coding';
  if (/reason|deep|strong|max|premium/.test(source) && state.availableTags.includes('reasoning')) return 'reasoning';
  if (/agent|plan|orchestr/.test(source) && state.availableTags.includes('agentic')) return 'agentic';
  if (/write|doc/.test(source) && state.availableTags.includes('writing')) return 'writing';
  if (/fast|mini|lite|cheap|small/.test(source) && state.availableTags.includes('fast')) return 'fast';
  return '';
}

function resolveModelId(reference, filterTag = '') {
  if (state.models.length === 0) {
    return reference || '';
  }
  const exact = state.models.find((model) => modelMatchesReference(model, reference));
  if (exact) {
    return exact.id;
  }
  if (filterTag) {
    const tagged = state.models.find((model) => modelTags(model).includes(normalizeText(filterTag)));
    if (tagged) {
      return tagged.id;
    }
  }
  return state.models[0].id;
}

function filterModels(filterTag = '', selectedId = '') {
  const normalized = normalizeText(filterTag);
  if (!normalized) {
    return state.models;
  }
  const filtered = state.models.filter((model) => modelTags(model).includes(normalized));
  if (filtered.length > 0) {
    return filtered;
  }
  const selected = state.models.find((model) => model.id === selectedId);
  return selected ? [selected] : state.models;
}

function tagOptionsMarkup(selected = '') {
  return [
    '<option value="">All tags</option>',
    ...state.availableTags.map((tag) => `<option value="${escapeHtml(tag)}" ${tag === selected ? 'selected' : ''}>${escapeHtml(tag)}</option>`),
  ].join('');
}

function renderTagRail(containerId, modelId) {
  const model = state.models.find((entry) => entry.id === modelId);
  el(containerId).innerHTML = model
    ? (model.tags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')
    : '<span class="muted small">No tag metadata.</span>';
}

function renderAuthorityStrip() {
  const ctx = state.config?.system_context || {};
  renderSystemContext(el('settings-system-context'), ctx);
  el('settings-authority-strip').innerHTML = [
    `<span class="badge">${escapeHtml(ctx.role || 'anonymous')}</span>`,
    ctx.auth_mode ? `<span class="badge">${escapeHtml(ctx.auth_mode)}</span>` : '',
    ctx.owner_identity ? `<span class="badge">${escapeHtml(ctx.owner_identity)}</span>` : '',
  ].filter(Boolean).join('');
}

function renderPermissionMessage() {
  el('settings-permission-message').textContent = canEditGlobalState()
    ? 'Admin authority is active. Global model defaults, interpreters, and API keys are writable.'
    : 'Non-admin mode: settings are read-only until you authenticate with an admin API key.';
}

function renderModels() {
  if (!state.modelFilter) {
    state.modelFilter = inferDefaultFilter(state.config?.default_llm);
  }
  const selectedId = resolveModelId(state.config?.default_llm, state.modelFilter);
  el('default-llm-tag-filter').innerHTML = tagOptionsMarkup(state.modelFilter);
  el('default-llm').innerHTML = filterModels(state.modelFilter, selectedId)
    .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === selectedId ? 'selected' : ''}>${escapeHtml(modelLabel(model))}</option>`)
    .join('');
  renderTagRail('default-llm-tags', el('default-llm').value);
}

function renderInterpreters() {
  el('interpreter-list').innerHTML = (state.config?.interpreters || []).map((entry) => `
    <label class="interpreter-row">
      <div class="interpreter-main">
        <strong>${escapeHtml(entry.name)}</strong>
        <span class="muted small">${escapeHtml(entry.purpose || entry.name)}</span>
      </div>
      <div class="interpreter-meta">
        <span class="badge">${escapeHtml(entry.cost_class || 'normal')}</span>
        <span class="badge">${entry.uses_llm_adapter ? 'llm-adapter' : 'native'}</span>
      </div>
      <div class="interpreter-toggle">
        <input type="checkbox" data-interpreter="${escapeHtml(entry.name)}" ${entry.enabled ? 'checked' : ''}>
        <span class="small muted">Enabled</span>
      </div>
    </label>
  `).join('');
}

function maskToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    return '';
  }
  return value.length <= 18 ? `${value.slice(0, 6)}…` : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function savedEntryForId(id) {
  return getSavedApiKeys().find((entry) => entry.id === id) || null;
}

function activeKeyMatches(entry) {
  const token = getApiKey();
  const activeId = token.split('.')[0] || '';
  return activeId && activeId === entry.id;
}

function copyableTokenForEntry(entry) {
  return savedEntryForId(entry.id)?.token || (activeKeyMatches(entry) ? getApiKey() : '');
}

function renderBootstrapStatus() {
  const auth = state.config?.auth || {};
  if (!auth.has_api_keys) {
    el('bootstrap-status').innerHTML = '<span class="badge status-active">No API keys exist yet. Bootstrap admin setup is required.</span>';
    return;
  }
  if (state.config?.system_context?.auth_mode === 'api_key') {
    el('bootstrap-status').innerHTML = '<span class="badge status-enabled">Authenticated with API key.</span>';
    return;
  }
  el('bootstrap-status').innerHTML = '<span class="badge status-error">API key login required.</span>';
}

function renderCurrentAccess() {
  const auth = state.config?.auth || {};
  const currentToken = getApiKey();
  const authenticated = state.config?.system_context?.auth_mode === 'api_key';
  const currentId = currentToken.split('.')[0] || '';

  if (!auth.has_api_keys) {
    el('auth-current-access').innerHTML = `
      <div class="settings-key-card">
        <div class="stack compact">
          <strong>Bootstrap admin key</strong>
          <div class="muted small">Create the first admin key. The full key is shown once in a popup so you can copy it, then decide when to log in with it.</div>
        </div>
        <div class="settings-inline-actions">
          <button type="button" data-open-bootstrap-modal>Create bootstrap admin key</button>
        </div>
      </div>
    `;
    return;
  }

  if (authenticated && currentToken) {
    el('auth-current-access').innerHTML = `
      <div class="settings-key-card">
        <div class="stack compact">
          <strong>Active API key</strong>
          <div class="muted small">${escapeHtml(maskToken(currentToken))}</div>
          <div class="row wrap">
            <span class="badge">${escapeHtml(state.config?.system_context?.role || 'user')}</span>
            <span class="badge">${escapeHtml(currentId)}</span>
          </div>
        </div>
        <div class="settings-inline-actions">
          <button class="secondary" type="button" data-copy-current-key>Copy</button>
        </div>
      </div>
    `;
    return;
  }

  const invalidStored = currentToken && !authenticated;
  el('auth-current-access').innerHTML = `
    <div class="settings-key-card stack">
      <div class="stack compact">
        <strong>${invalidStored ? 'Stored API key is not accepted' : 'Log in with an API key'}</strong>
        <div class="muted small">${invalidStored
          ? 'The browser still has a stale or invalid key value. Paste a valid key or clear the stale one.'
          : 'Paste a valid API key to authenticate and unlock admin settings.'
        }</div>
      </div>
      <label class="stack">
        <span class="small muted">API key</span>
        <input id="api-key-input" placeholder="Paste an API key">
      </label>
      <div class="settings-inline-actions">
        <button id="login-api-key" type="button">Login</button>
        ${invalidStored ? '<button id="clear-api-key" class="secondary" type="button">Clear stale key</button>' : ''}
      </div>
    </div>
  `;
}

function renderIssuedKeys() {
  el('issued-keys-summary').textContent = state.keys.length ? `${state.keys.length} valid key(s)` : 'Admin authority required.';
  el('api-key-list').innerHTML = state.keys.length
    ? state.keys.map((entry) => {
      const copyableToken = copyableTokenForEntry(entry);
      return `
        <div class="issued-key-row">
          <div class="stack compact">
            <strong>${escapeHtml(entry.label)}</strong>
            <div class="muted small">${escapeHtml(entry.id)} · ${escapeHtml(entry.role)} · ${escapeHtml(entry.token_prefix)}…</div>
            <div class="muted small">Created ${escapeHtml(formatDate(entry.created_at))} · last used ${escapeHtml(formatDate(entry.last_used_at))}</div>
          </div>
          <div class="row wrap">
            <button class="secondary" type="button" data-copy-key="${escapeHtml(entry.id)}" ${copyableToken ? '' : 'disabled'}>Copy</button>
            <button class="secondary" type="button" data-revoke-key="${escapeHtml(entry.id)}">Invalidate</button>
          </div>
        </div>
      `;
    }).join('')
    : '<div class="muted small">No active server key inventory is visible.</div>';
}

function renderAuthPanel() {
  renderBootstrapStatus();
  renderCurrentAccess();
  renderIssuedKeys();
}

function syncAuthority() {
  const canEdit = canEditGlobalState();
  el('save-model-settings').disabled = !canEdit;
  el('save-interpreters').disabled = !canEdit;
  el('create-key').disabled = !canEdit;
  el('new-key-label').disabled = !canEdit;
  el('new-key-role').disabled = !canEdit;
  el('default-llm').disabled = !canEdit;
  el('default-llm-tag-filter').disabled = !canEdit;
  document.querySelectorAll('#settings-interpreters-tab input[type="checkbox"]').forEach((node) => {
    node.disabled = !canEdit;
  });
}

function activateTab(tabId) {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

async function loadKeys() {
  try {
    const payload = await fetchJson('/api/auth/keys');
    state.keys = payload.items || [];
  } catch {
    state.keys = [];
  }
}

async function loadModels() {
  try {
    const payload = await fetchJson('/api/models');
    state.models = payload.models || [];
    state.availableTags = payload.available_tags || [];
  } catch {
    state.models = [];
    state.availableTags = [];
  }
}

async function refresh() {
  clearNotice();
  state.config = await fetchJson('/api/config');
  await Promise.all([loadKeys(), loadModels()]);
  renderAuthorityStrip();
  renderPermissionMessage();
  renderModels();
  renderInterpreters();
  renderAuthPanel();
  syncAuthority();
  maybePromptBootstrap();
}

async function saveModelSettings(event) {
  event.preventDefault();
  try {
    await fetchJson('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        default_llm: el('default-llm').value,
      }),
    });
    notify('Default model updated.');
    await refresh();
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function saveInterpreters(event) {
  event.preventDefault();
  try {
    const interpreters = {};
    document.querySelectorAll('[data-interpreter]').forEach((checkbox) => {
      interpreters[checkbox.dataset.interpreter] = { enabled: checkbox.checked };
    });
    await fetchJson('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interpreters }),
    });
    notify('Interpreter states updated.');
    await refresh();
  } catch (error) {
    notify(error.message, 'error');
  }
}

function showKeyModal(mode, payload = {}) {
  state.keyModal = {
    mode,
    token: payload.token || '',
    record: payload.record || null,
  };
  renderKeyModal();
  el('settings-key-modal').classList.add('visible');
}

function hideKeyModal() {
  state.keyModal = { mode: null, token: '', record: null };
  el('settings-key-modal').classList.remove('visible');
}

function renderKeyModal() {
  const { mode, token, record } = state.keyModal;
  el('settings-key-modal-create').hidden = mode !== 'bootstrap-create';
  el('settings-key-modal-reveal').hidden = mode !== 'reveal';
  if (mode === 'bootstrap-create') {
    el('settings-key-modal-title').textContent = 'Create bootstrap admin key';
    el('settings-key-modal-status').textContent = 'This is a one-time setup step. The server stores only a hash, so copy the key when it appears.';
    return;
  }
  if (mode === 'reveal') {
    el('settings-key-modal-title').textContent = 'Copy this API key now';
    el('settings-key-modal-status').textContent = 'The server inventory keeps only ids and prefixes. Full key copy is possible now because this browser just created it.';
    el('settings-key-modal-token').value = token;
    el('settings-key-modal-meta').innerHTML = record
      ? [
        `<span class="badge">${escapeHtml(record.role || 'user')}</span>`,
        record.id ? `<span class="badge">${escapeHtml(record.id)}</span>` : '',
      ].filter(Boolean).join('')
      : '';
  }
}

function maybePromptBootstrap() {
  const auth = state.config?.auth || {};
  if (!auth.has_api_keys && state.keyModal.mode !== 'reveal') {
    showKeyModal('bootstrap-create');
  }
}

async function createBootstrapKey() {
  try {
    const payload = await fetchJson('/api/auth/bootstrap-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: el('settings-key-modal-label').value.trim() || 'Bootstrap admin',
      }),
    });
    rememberApiKey(payload.api_key, payload.record.label);
    showKeyModal('reveal', { token: payload.api_key, record: payload.record });
    notify('Bootstrap admin key created.');
    await refresh();
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function createServerKey(event) {
  event.preventDefault();
  try {
    const payload = await fetchJson('/api/auth/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: el('new-key-label').value.trim(),
        role: el('new-key-role').value,
      }),
    });
    rememberApiKey(payload.api_key, payload.record.label);
    showKeyModal('reveal', { token: payload.api_key, record: payload.record });
    el('new-key-label').value = '';
    el('new-key-role').value = 'admin';
    notify(`Created ${payload.record.role} API key ${payload.record.id}.`);
    await refresh();
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function revokeKey(keyId) {
  try {
    await fetchJson(`/api/auth/keys/${keyId}`, {
      method: 'DELETE',
    });
    notify('API key invalidated.');
    await refresh();
  } catch (error) {
    notify(error.message, 'error');
  }
}

function loginWithApiKey() {
  const token = el('api-key-input')?.value.trim();
  if (!token) {
    notify('Provide an API key first.', 'error');
    return false;
  }
  setApiKey(token);
  setActiveSessionId('');
  notify('API key activated for this browser.');
  return true;
}

function useModalKey() {
  if (!state.keyModal.token) {
    notify('No API key is available in the popup.', 'error');
    return;
  }
  setApiKey(state.keyModal.token);
  setActiveSessionId('');
  hideKeyModal();
  notify('API key activated for this browser.');
  refresh().catch((error) => notify(error.message, 'error'));
}

function attachHandlers() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });

  el('model-settings').addEventListener('submit', saveModelSettings);
  el('interpreter-settings').addEventListener('submit', saveInterpreters);
  el('api-key-form').addEventListener('submit', createServerKey);
  el('refresh-auth').addEventListener('click', () => refresh().catch((error) => notify(error.message, 'error')));
  el('default-llm').addEventListener('change', () => renderTagRail('default-llm-tags', el('default-llm').value));
  el('default-llm-tag-filter').addEventListener('change', (event) => {
    state.modelFilter = event.target.value;
    renderModels();
    syncAuthority();
  });

  el('auth-current-access').addEventListener('click', (event) => {
    if (event.target.closest('[data-open-bootstrap-modal]')) {
      showKeyModal('bootstrap-create');
      return;
    }
    if (event.target.closest('[data-copy-current-key]')) {
      copyText(getApiKey()).then(() => notify('API key copied.')).catch((error) => notify(error.message, 'error'));
      return;
    }
    if (event.target.closest('#login-api-key')) {
      if (loginWithApiKey()) {
        refresh().catch((error) => notify(error.message, 'error'));
      }
      return;
    }
    if (event.target.closest('#clear-api-key')) {
      setApiKey('');
      setActiveSessionId('');
      notify('Stale API key cleared.');
      refresh().catch((error) => notify(error.message, 'error'));
    }
  });

  el('api-key-list').addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-copy-key]');
    if (copyButton) {
      const entry = state.keys.find((item) => item.id === copyButton.dataset.copyKey);
      const token = entry ? copyableTokenForEntry(entry) : '';
      if (!token) {
        notify('This browser does not have a local copy of that API key.', 'error');
        return;
      }
      copyText(token).then(() => notify('API key copied.')).catch((error) => notify(error.message, 'error'));
      return;
    }
    const revokeButton = event.target.closest('[data-revoke-key]');
    if (revokeButton) {
      revokeKey(revokeButton.dataset.revokeKey);
    }
  });

  el('settings-key-modal').addEventListener('click', (event) => {
    if (event.target === el('settings-key-modal') || event.target.closest('[data-close-key-modal]')) {
      hideKeyModal();
      return;
    }
    if (event.target.closest('#settings-bootstrap-submit')) {
      createBootstrapKey().catch((error) => notify(error.message, 'error'));
      return;
    }
    if (event.target.closest('#settings-key-modal-copy')) {
      copyText(state.keyModal.token).then(() => notify('API key copied.')).catch((error) => notify(error.message, 'error'));
      return;
    }
    if (event.target.closest('#settings-key-modal-remember')) {
      if (state.keyModal.token) {
        rememberApiKey(state.keyModal.token, state.keyModal.record?.label || state.keyModal.record?.id || 'Saved key');
        notify('API key saved locally.');
      }
      return;
    }
    if (event.target.closest('#settings-key-modal-use')) {
      useModalKey();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.keyModal.mode) {
      hideKeyModal();
    }
  });
}

attachHandlers();
activateTab('settings-models-tab');
refresh()
  .then(() => {
    if (!canEditGlobalState() || !getApiKey()) {
      activateTab('settings-auth-tab');
    }
  })
  .catch((error) => notify(error.message, 'error'));

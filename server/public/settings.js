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
  const container = el(containerId);
  if (!container) {
    return;
  }
  container.innerHTML = model
    ? (model.tags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')
    : '<span class="muted small">No tag metadata.</span>';
}

function renderAuthorityStrip() {
  const ctx = state.config?.system_context || {};
  renderSystemContext(el('settings-system-context'), ctx);
  el('settings-authority-strip').innerHTML = ctx.can_edit_global_state
    ? '<span class="badge">Global settings writable</span>'
    : '<span class="badge">Read-only view</span>';
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
  renderInterpreterModelBindings();
}

function modelRoutingTargets() {
  return state.config?.model_routing_targets || [];
}

function currentBindingFor(name) {
  return state.config?.profile_bindings?.[name]
    ?? { model: state.config?.interpreter_mappings?.[name] ?? '', tier: 'standard', taskTag: '' };
}

function renderInterpreterModelBindings() {
  const container = el('interpreter-model-bindings');
  const interpreters = modelRoutingTargets();
  if (!container) {
    return;
  }
  if (interpreters.length === 0) {
    container.innerHTML = '<div class="muted small">No LLM routing targets are currently available.</div>';
    return;
  }

  container.innerHTML = interpreters.map((entry) => {
    const binding = currentBindingFor(entry.name);
    const selectedId = resolveModelId(binding.model, state.modelFilter);
    const options = filterModels(state.modelFilter, selectedId)
      .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === selectedId ? 'selected' : ''}>${escapeHtml(modelLabel(model))}</option>`)
      .join('');
    const tagRailId = `interpreter-model-tags-${entry.name}`;
    return `
      <div class="settings-binding-card stack">
        <div class="settings-binding-header">
          <div class="stack compact">
            <strong>${escapeHtml(entry.name)}</strong>
            <div class="muted small">${escapeHtml(entry.purpose || entry.name)}</div>
          </div>
          <div class="row wrap">
            <span class="badge">${escapeHtml(entry.owner_label || 'LLM routing')}</span>
            <span class="badge">${escapeHtml(binding.tier || entry.cost_class || 'standard')}</span>
            ${binding.taskTag ? `<span class="badge">${escapeHtml(binding.taskTag)}</span>` : ''}
          </div>
        </div>
        <label class="stack">
          <span class="small muted">Model</span>
          <select data-interpreter-model="${escapeHtml(entry.name)}">${options}</select>
        </label>
        <div id="${escapeHtml(tagRailId)}" class="row wrap"></div>
      </div>
    `;
  }).join('');

  interpreters.forEach((entry) => {
    const binding = currentBindingFor(entry.name);
    const selectedId = resolveModelId(binding.model, state.modelFilter);
    renderTagRail(`interpreter-model-tags-${entry.name}`, selectedId);
  });
}

function renderInterpreters() {
  el('interpreter-list').innerHTML = (state.config?.interpreters || []).map((entry) => `
    <label class="interpreter-row">
      <div class="interpreter-main">
        <strong>${escapeHtml(entry.name)}</strong>
        <span class="muted small">${escapeHtml(entry.purpose || entry.name)}</span>
      </div>
      <div class="interpreter-meta">
        <span class="badge">${escapeHtml(entry.component_type || 'Component')}</span>
        <span class="badge">${escapeHtml(entry.cost_class || 'normal')}</span>
        <span class="badge">${entry.uses_llm_adapter ? 'llm-assisted' : 'deterministic'}</span>
      </div>
      <div class="interpreter-toggle">
        <input
          type="checkbox"
          data-interpreter="${escapeHtml(entry.name)}"
          data-disableable="${entry.disableable === false ? 'false' : 'true'}"
          ${entry.enabled ? 'checked' : ''}
          ${entry.disableable === false ? 'disabled' : ''}
        >
        <span class="small muted">${entry.disableable === false ? 'Always on' : 'Enabled'}</span>
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
  if (canEditGlobalState()) {
    el('bootstrap-status').innerHTML = '<span class="badge status-enabled">API key management is writable.</span>';
    return;
  }
  el('bootstrap-status').innerHTML = '<span class="badge status-error">An admin API key is required to manage issued keys.</span>';
}

function renderAuthCreateCard() {
  const auth = state.config?.auth || {};
  const canEdit = canEditGlobalState();
  if (!auth.has_api_keys) {
    el('auth-create-card').innerHTML = `
      <div class="stack compact">
        <div class="eyebrow">Provisioning</div>
        <h4>Create bootstrap admin key</h4>
        <div class="muted small">The first server key is created in a popup and the full value is shown only once.</div>
      </div>
      <div class="settings-inline-actions">
        <button id="open-create-key-modal" type="button" ${auth.bootstrap_admin_available ? '' : 'disabled'}>Create bootstrap admin key</button>
      </div>
    `;
    return;
  }
  el('auth-create-card').innerHTML = `
    <div class="stack compact">
      <div class="eyebrow">Provisioning</div>
      <h4>Create server key</h4>
      <div class="muted small">Create new admin or user keys in a popup. The inventory below keeps only ids and prefixes; the full key appears once after creation.</div>
    </div>
    <div class="settings-inline-actions">
      <button id="open-create-key-modal" type="button" ${canEdit ? '' : 'disabled'}>Create key</button>
    </div>
  `;
}

function renderIssuedKeys() {
  const auth = state.config?.auth || {};
  el('issued-keys-summary').textContent = state.keys.length
    ? `${state.keys.length} valid key(s)`
    : auth.has_api_keys
      ? 'Admin authority required.'
      : 'No keys issued yet.';
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
  renderIssuedKeys();
  renderAuthCreateCard();
}

function syncAuthority() {
  const canEdit = canEditGlobalState();
  const auth = state.config?.auth || {};
  const canBootstrap = !auth.has_api_keys && auth.bootstrap_admin_available;
  el('save-model-settings').disabled = !canEdit;
  el('save-interpreters').disabled = !canEdit;
  el('default-llm').disabled = !canEdit;
  el('default-llm-tag-filter').disabled = !canEdit;
  if (el('open-create-key-modal')) {
    el('open-create-key-modal').disabled = auth.has_api_keys ? !canEdit : !auth.bootstrap_admin_available;
  }
  if (el('settings-key-modal-label')) {
    el('settings-key-modal-label').disabled = !(canEdit || canBootstrap);
  }
  if (el('settings-key-modal-role')) {
    el('settings-key-modal-role').disabled = !canEdit;
  }
  document.querySelectorAll('[data-interpreter-model]').forEach((node) => {
    node.disabled = !canEdit;
  });
  document.querySelectorAll('#settings-interpreters-tab input[type="checkbox"]').forEach((node) => {
    node.disabled = !canEdit || node.dataset.disableable === 'false';
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
    const interpreterMappings = {};
    document.querySelectorAll('[data-interpreter-model]').forEach((select) => {
      interpreterMappings[select.dataset.interpreterModel] = select.value;
    });
    await fetchJson('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        default_llm: el('default-llm').value,
        interpreter_mappings: interpreterMappings,
      }),
    });
    notify('Model routing updated.');
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
  el('settings-key-modal-create').hidden = !(mode === 'bootstrap-create' || mode === 'create');
  el('settings-key-modal-reveal').hidden = mode !== 'reveal';
  if (mode === 'bootstrap-create') {
    el('settings-key-modal-title').textContent = 'Create bootstrap admin key';
    el('settings-key-modal-status').textContent = 'This is a one-time setup step. The server stores only a hash, so copy the key when it appears.';
    el('settings-key-modal-label').value = 'Bootstrap admin';
    el('settings-key-modal-role-wrap').hidden = true;
    el('settings-key-modal-role').value = 'admin';
    el('settings-key-modal-submit').textContent = 'Create bootstrap admin key';
    return;
  }
  if (mode === 'create') {
    el('settings-key-modal-title').textContent = 'Create server key';
    el('settings-key-modal-status').textContent = 'Choose the label and role, then copy the new key when it appears.';
    el('settings-key-modal-label').value = '';
    el('settings-key-modal-role-wrap').hidden = false;
    el('settings-key-modal-role').value = 'admin';
    el('settings-key-modal-submit').textContent = 'Create key';
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

async function createServerKey() {
  try {
    const payload = await fetchJson('/api/auth/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: el('settings-key-modal-label').value.trim(),
        role: el('settings-key-modal-role').value,
      }),
    });
    rememberApiKey(payload.api_key, payload.record.label);
    showKeyModal('reveal', { token: payload.api_key, record: payload.record });
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
  el('refresh-auth').addEventListener('click', () => refresh().catch((error) => notify(error.message, 'error')));
  el('model-settings').addEventListener('change', (event) => {
    if (event.target.id === 'default-llm') {
      renderTagRail('default-llm-tags', el('default-llm').value);
      return;
    }
    if (event.target.id === 'default-llm-tag-filter') {
      state.modelFilter = event.target.value;
      renderModels();
      syncAuthority();
      return;
    }
    const select = event.target.closest('[data-interpreter-model]');
    if (select) {
      renderTagRail(`interpreter-model-tags-${select.dataset.interpreterModel}`, select.value);
    }
  });

  el('settings-auth-tab').addEventListener('click', (event) => {
    if (event.target.closest('#open-create-key-modal')) {
      if ((state.config?.auth?.has_api_keys ?? false) === false) {
        showKeyModal('bootstrap-create');
      } else {
        showKeyModal('create');
      }
      return;
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
    if (event.target.closest('#settings-key-modal-submit')) {
      const action = state.keyModal.mode === 'bootstrap-create' ? createBootstrapKey : createServerKey;
      action().catch((error) => notify(error.message, 'error'));
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

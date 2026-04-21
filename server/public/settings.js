import {
  clearNotice,
  el,
  escapeHtml,
  fetchJson,
  forgetApiKey,
  formatDate,
  getApiKey,
  getSavedApiKeys,
  notify,
  renderSystemContext,
  setActiveSessionId,
  setApiKey,
  statusClass,
} from './shared.js';

const state = {
  config: null,
  keys: [],
  models: [],
  availableTags: [],
  modelFilters: {
    default: '',
    profiles: {},
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

function findModel(modelId) {
  return state.models.find((entry) => entry.id === modelId) || null;
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

function inferPreferenceTags(reference, binding, profile) {
  const source = [
    reference,
    binding?.taskTag,
    binding?.tier,
    profile,
  ].filter(Boolean).join(' ').toLowerCase();
  const inferred = [];
  if (/fast|cheap|mini|lite/.test(source)) inferred.push('fast');
  if (/code|coder|codex/.test(source)) inferred.push('coding');
  if (/write|writer|doc/.test(source)) inferred.push('writing');
  if (/reason|deep|analysis|strong/.test(source)) inferred.push('reasoning');
  if (/plan|agent|orchestr/.test(source)) inferred.push('agentic');
  if (inferred.length === 0) inferred.push('general');
  return unique(inferred).filter((tag) => state.availableTags.includes(tag));
}

function resolveModelId(reference, filterTag = '', binding = null, profile = '') {
  if (state.models.length === 0) {
    return reference || '';
  }
  const exact = state.models.find((model) => modelMatchesReference(model, reference));
  if (exact) {
    return exact.id;
  }
  const tags = unique([
    normalizeText(filterTag),
    ...inferPreferenceTags(reference, binding, profile),
  ]);
  if (tags.length > 0) {
    const tagged = state.models.find((model) => tags.some((tag) => modelTags(model).includes(tag)));
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
  const container = el(containerId);
  const model = findModel(modelId);
  container.innerHTML = model
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
  const canEdit = canEditGlobalState();
  el('settings-permission-message').textContent = canEdit
    ? 'Admin authority is active. Model bindings, interpreter enablement, and server key provisioning are writable.'
    : 'Non-admin mode: global settings stay read-only. Use the Authentication tab to switch to another API key.';
}

function ensureModelFilters() {
  if (!state.modelFilters.default) {
    state.modelFilters.default = inferPreferenceTags(state.config?.default_llm, null, 'default')[0] || '';
  }
  for (const [profile, binding] of Object.entries(state.config?.profile_bindings || {})) {
    if (!state.modelFilters.profiles[profile]) {
      state.modelFilters.profiles[profile] = inferPreferenceTags(binding.model, binding, profile)[0] || '';
    }
  }
}

function renderModels() {
  ensureModelFilters();
  const defaultSelectedId = resolveModelId(state.config?.default_llm, state.modelFilters.default);
  el('default-llm-tag-filter').innerHTML = tagOptionsMarkup(state.modelFilters.default);
  el('default-llm').innerHTML = filterModels(state.modelFilters.default, defaultSelectedId)
    .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === defaultSelectedId ? 'selected' : ''}>${escapeHtml(modelLabel(model))}</option>`)
    .join('');
  renderTagRail('default-llm-tags', el('default-llm').value);

  const bindings = state.config?.profile_bindings || {};
  el('profile-bindings').innerHTML = Object.entries(bindings).map(([profile, binding]) => {
    const filterTag = state.modelFilters.profiles[profile] || '';
    const selectedId = resolveModelId(binding.model, filterTag, binding, profile);
    const options = filterModels(filterTag, selectedId)
      .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === selectedId ? 'selected' : ''}>${escapeHtml(modelLabel(model))}</option>`)
      .join('');
    const selectedModel = findModel(selectedId);
    return `
      <div class="settings-binding-card stack compact">
        <div class="settings-binding-header">
          <div class="stack compact">
            <strong>${escapeHtml(profile)}</strong>
            <div class="muted small">${escapeHtml(binding.taskTag || binding.tier || 'general')}</div>
          </div>
        </div>
        <label class="stack">
          <span class="small muted">Filter by tag</span>
          <select data-profile-filter="${escapeHtml(profile)}">
            ${tagOptionsMarkup(filterTag)}
          </select>
        </label>
        <label class="stack">
          <span class="small muted">Model</span>
          <select data-profile="${escapeHtml(profile)}">
            ${options}
          </select>
        </label>
        <div class="row wrap" data-profile-tags="${escapeHtml(profile)}">
          ${selectedModel
            ? (selectedModel.tags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')
            : '<span class="muted small">No tags.</span>'}
        </div>
      </div>
    `;
  }).join('');
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

function renderSavedApiKeys() {
  const items = getSavedApiKeys();
  el('saved-key-options').innerHTML = items.map((entry) => `
    <option value="${escapeHtml(entry.token)}">${escapeHtml(entry.label)}</option>
  `).join('');
  el('saved-api-keys').innerHTML = items.length
    ? items.map((entry) => `
      <div class="saved-key-row">
        <div class="stack compact">
          <strong>${escapeHtml(entry.label)}</strong>
          <div class="muted small">${escapeHtml(entry.id)} · saved ${escapeHtml(formatDate(entry.saved_at))}</div>
        </div>
        <div class="row wrap">
          <button class="secondary" type="button" data-use-saved-key="${escapeHtml(entry.token)}">Use</button>
          <button class="secondary" type="button" data-forget-saved-key="${escapeHtml(entry.id)}">Forget</button>
        </div>
      </div>
    `).join('')
    : '<div class="muted small">No browser-saved API keys yet.</div>';
}

function renderBootstrapState() {
  const bootstrap = state.config?.auth || {};
  const currentApiKey = getApiKey();
  const statusParts = [];
  statusParts.push(`<span class="badge">${bootstrap.has_api_keys ? 'API keys configured' : 'No API keys yet'}</span>`);
  if (bootstrap.bootstrap_admin_available) {
    statusParts.push('<span class="badge status-active">Bootstrap available</span>');
  } else if (bootstrap.bootstrap_admin_session_id) {
    statusParts.push(`<span class="badge">${escapeHtml(bootstrap.bootstrap_admin_session_id)}</span>`);
  }
  if (currentApiKey) {
    statusParts.push('<span class="badge status-enabled">Current key loaded</span>');
  } else if (bootstrap.has_api_keys) {
    statusParts.push('<span class="badge status-error">API key required</span>');
  }
  el('bootstrap-status').innerHTML = statusParts.join('');
  el('bootstrap-key').disabled = bootstrap.has_api_keys || !bootstrap.bootstrap_admin_available;
}

function renderIssuedKeys() {
  el('issued-keys-summary').textContent = state.keys.length ? `${state.keys.length} key(s)` : 'Admin authority required.';
  el('api-key-list').innerHTML = state.keys.length
    ? state.keys.map((entry) => `
      <div class="issued-key-row">
        <div class="stack compact">
          <strong>${escapeHtml(entry.label)}</strong>
          <div class="muted small">${escapeHtml(entry.id)} · ${escapeHtml(entry.role)} · ${escapeHtml(entry.token_prefix)}</div>
          <div class="muted small">Created ${escapeHtml(formatDate(entry.created_at))} · last used ${escapeHtml(formatDate(entry.last_used_at))}</div>
        </div>
        <button class="secondary" type="button" data-revoke-key="${escapeHtml(entry.id)}">Revoke</button>
      </div>
    `).join('')
    : '<div class="muted small">No key inventory visible.</div>';
}

function renderAuthPanel() {
  const currentToken = getApiKey();
  const savedCurrent = getSavedApiKeys().find((entry) => entry.token === currentToken);
  el('api-key-input').value = currentToken;
  el('api-key-label').value = savedCurrent?.label || '';
  renderSavedApiKeys();
  renderBootstrapState();
  renderIssuedKeys();
}

function syncAuthority() {
  const canEdit = canEditGlobalState();
  el('save-model-settings').disabled = !canEdit;
  el('save-interpreters').disabled = !canEdit;
  el('create-key').disabled = !canEdit;
  el('new-key-label').disabled = !canEdit;
  el('new-key-role').disabled = !canEdit;
  document.querySelectorAll('#settings-models-tab select, #settings-interpreters-tab input[type="checkbox"]').forEach((node) => {
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
}

async function saveModelSettings(event) {
  event.preventDefault();
  try {
    const interpreterMappings = {};
    document.querySelectorAll('#profile-bindings [data-profile]').forEach((input) => {
      interpreterMappings[input.dataset.profile] = input.value;
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
    setApiKey(payload.api_key, { remember: true, label: payload.record.label });
    setActiveSessionId('');
    el('api-key-input').value = payload.api_key;
    el('api-key-label').value = payload.record.label;
    notify(`Created ${payload.record.role} API key ${payload.record.id}.`);
    await refresh();
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function createBootstrapKey() {
  try {
    const payload = await fetchJson('/api/auth/bootstrap-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: el('bootstrap-key-label').value.trim() || 'Bootstrap admin',
      }),
    });
    setApiKey(payload.api_key, { remember: true, label: payload.record.label });
    setActiveSessionId('');
    el('api-key-input').value = payload.api_key;
    el('api-key-label').value = payload.record.label;
    notify('Bootstrap admin key created and stored locally.');
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
    notify('API key revoked.');
    await refresh();
  } catch (error) {
    notify(error.message, 'error');
  }
}

function useApiKeyInput({ remember = false } = {}) {
  const token = el('api-key-input').value.trim();
  const label = el('api-key-label').value.trim();
  if (!token) {
    notify('Provide an API key first.', 'error');
    return false;
  }
  setApiKey(token, { remember, label });
  setActiveSessionId('');
  notify(remember ? 'API key stored locally and activated.' : 'API key activated for this browser.');
  return true;
}

function attachHandlers() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) {
        return;
      }
      activateTab(button.dataset.tab);
    });
  });

  el('model-settings').addEventListener('submit', saveModelSettings);
  el('interpreter-settings').addEventListener('submit', saveInterpreters);
  el('api-key-form').addEventListener('submit', createServerKey);
  el('refresh-auth').addEventListener('click', () => refresh().catch((error) => notify(error.message, 'error')));
  el('bootstrap-key').addEventListener('click', () => createBootstrapKey().catch((error) => notify(error.message, 'error')));
  el('save-api-key').addEventListener('click', () => {
    if (useApiKeyInput({ remember: false })) {
      refresh().catch((error) => notify(error.message, 'error'));
    }
  });
  el('remember-api-key').addEventListener('click', () => {
    if (useApiKeyInput({ remember: true })) {
      refresh().catch((error) => notify(error.message, 'error'));
    }
  });
  el('clear-api-key').addEventListener('click', () => {
    setApiKey('');
    setActiveSessionId('');
    notify('Current API key cleared.');
    refresh().catch((error) => notify(error.message, 'error'));
  });
  el('default-llm').addEventListener('change', () => {
    renderTagRail('default-llm-tags', el('default-llm').value);
  });
  el('default-llm-tag-filter').addEventListener('change', (event) => {
    state.modelFilters.default = event.target.value;
    renderModels();
    syncAuthority();
  });
  el('profile-bindings').addEventListener('change', (event) => {
    const filterSelect = event.target.closest('[data-profile-filter]');
    if (filterSelect) {
      state.modelFilters.profiles[filterSelect.dataset.profileFilter] = filterSelect.value;
      renderModels();
      syncAuthority();
      return;
    }
    const select = event.target.closest('[data-profile]');
    if (!select) {
      return;
    }
    const tagsContainer = document.querySelector(`[data-profile-tags="${select.dataset.profile}"]`);
    const model = findModel(select.value);
    tagsContainer.innerHTML = model
      ? (model.tags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('')
      : '<span class="muted small">No tags.</span>';
  });
  el('saved-api-keys').addEventListener('click', (event) => {
    const useButton = event.target.closest('[data-use-saved-key]');
    if (useButton) {
      const token = useButton.dataset.useSavedKey;
      const saved = getSavedApiKeys().find((entry) => entry.token === token);
      setApiKey(token);
      setActiveSessionId('');
      el('api-key-input').value = token;
      el('api-key-label').value = saved?.label || '';
      notify('Saved API key activated.');
      refresh().catch((error) => notify(error.message, 'error'));
      return;
    }
    const forgetButton = event.target.closest('[data-forget-saved-key]');
    if (forgetButton) {
      forgetApiKey(forgetButton.dataset.forgetSavedKey);
      renderAuthPanel();
      notify('Saved API key removed from this browser.');
    }
  });
  el('api-key-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-revoke-key]');
    if (!button) {
      return;
    }
    revokeKey(button.dataset.revokeKey);
  });
}

attachHandlers();
activateTab('settings-models-tab');
refresh()
  .then(() => {
    if (!canEditGlobalState() || (state.config?.auth?.has_api_keys && !getApiKey())) {
      activateTab('settings-auth-tab');
    }
  })
  .catch((error) => notify(error.message, 'error'));

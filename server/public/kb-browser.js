import {
  clearNotice,
  el,
  escapeHtml,
  fetchJson,
  notify,
  queryParam,
} from './shared.js';

const SCOPE_ORDER = ['default', 'global', 'session'];
const TYPE_ORDER = ['caller_profile', 'prompt_asset', 'template_asset', 'policy_asset', 'content'];

const state = {
  items: [],
  summary: null,
  selected: null,
  auth: null,
  sessionId: queryParam('session_id') || localStorage.getItem('mrpvm.activeSessionId'),
  search: '',
  typeFilter: '',
  openNodes: new Set(),
};

function scopeLabel(scope) {
  return { default: 'Default KUs', global: 'Global KUs', session: 'Session KUs' }[scope] || scope;
}

function typeLabel(type) {
  return {
    caller_profile: 'Caller profiles',
    prompt_asset: 'Prompt assets',
    template_asset: 'Template assets',
    policy_asset: 'Policy assets',
    content: 'Content',
  }[type] || type || 'Unclassified';
}

function summaryTile(label, value) {
  return `<div class="kb-summary-tile"><div class="count">${escapeHtml(String(value ?? 0))}</div><div class="label">${escapeHtml(label)}</div></div>`;
}

function summarizeItems() {
  const s = state.summary || {};
  el('kb-summary').innerHTML = [
    summaryTile('Total', s.total_ku_count || 0),
    summaryTile('Default', s.default_ku_count || 0),
    summaryTile('Global', s.global_ku_count || 0),
    summaryTile('Session', s.session_ku_count || 0),
    summaryTile('Prompt assets', s.prompt_asset_count || 0),
    summaryTile('Overrides', s.overridden_item_count || 0),
  ].join('');
}

function filteredItems() {
  return state.items.filter((item) => {
    if (state.typeFilter && item.meta?.ku_type !== state.typeFilter) {
      return false;
    }
    if (!state.search) {
      return true;
    }
    const query = state.search.toLowerCase();
    const haystack = [
      item.ku_id,
      item.meta?.title,
      item.meta?.summary,
      item.meta?.ku_type,
      item.content,
      ...(item.meta?.tags ?? []),
      ...(item.meta?.commands ?? []),
      ...(item.meta?.interpreters ?? []),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function groupItems(items) {
  const grouped = new Map();
  for (const scope of SCOPE_ORDER) {
    grouped.set(scope, new Map());
  }
  for (const item of items) {
    const scopeMap = grouped.get(item.scope) ?? new Map();
    const type = item.meta?.ku_type || 'content';
    const bucket = scopeMap.get(type) ?? [];
    bucket.push(item);
    scopeMap.set(type, bucket);
    grouped.set(item.scope, scopeMap);
  }
  for (const scopeMap of grouped.values()) {
    for (const bucket of scopeMap.values()) {
      bucket.sort((left, right) => left.ku_id.localeCompare(right.ku_id));
    }
  }
  return grouped;
}

function ensureSelectionVisible(item) {
  if (!item) {
    return;
  }
  const type = item.meta?.ku_type || 'content';
  state.openNodes.add('root');
  state.openNodes.add(`scope:${item.scope}`);
  state.openNodes.add(`type:${item.scope}:${type}`);
}

function buildTreeMarkup() {
  const groups = groupItems(filteredItems());
  const rootOpen = state.openNodes.has('root');
  const children = SCOPE_ORDER.map((scope) => {
    const scopeId = `scope:${scope}`;
    const scopeOpen = state.openNodes.has(scopeId);
    const scopeMap = groups.get(scope) ?? new Map();
    const total = [...scopeMap.values()].reduce((sum, bucket) => sum + bucket.length, 0);
    const typeMarkup = TYPE_ORDER.filter((type) => scopeMap.has(type)).map((type) => {
      const typeId = `type:${scope}:${type}`;
      const typeOpen = state.openNodes.has(typeId);
      const items = scopeMap.get(type) || [];
      return `
        <div class="kb-tree-node">
          <button class="kb-tree-toggle ${typeOpen ? 'open' : ''}" type="button" data-tree-node="${typeId}">
            <span class="chevron">▸</span>
            <span>${escapeHtml(typeLabel(type))}</span>
            <span class="badge">${items.length}</span>
          </button>
          <div class="kb-tree-children ${typeOpen ? 'open' : ''}">
            ${items.map((item) => {
              const isActive = state.selected?.ku_id === item.ku_id && state.selected?.scope === item.scope;
              const badges = [
                item.flags?.active ? '<span class="badge status-active">active</span>' : '',
                item.flags?.shadowed ? '<span class="badge status-error">shadowed</span>' : '',
                item.flags?.superseded ? '<span class="badge status-partially_failed">superseded</span>' : '',
              ].filter(Boolean).join('');
              return `
                <div class="kb-tree-leaf ${isActive ? 'active' : ''}" data-ku-id="${escapeHtml(item.ku_id)}" data-scope="${escapeHtml(item.scope)}">
                  <div class="kb-tree-leaf-main">
                    <span class="kb-tree-leaf-id">${escapeHtml(item.ku_id)}</span>
                    <span class="kb-tree-leaf-title">${escapeHtml(item.meta?.title || item.meta?.summary || '')}</span>
                  </div>
                  <div class="kb-tree-leaf-badges">${badges}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="kb-tree-node">
        <button class="kb-tree-toggle ${scopeOpen ? 'open' : ''}" type="button" data-tree-node="${scopeId}">
          <span class="chevron">▸</span>
          <span>${escapeHtml(scopeLabel(scope))}</span>
          <span class="badge">${total}</span>
        </button>
        <div class="kb-tree-children ${scopeOpen ? 'open' : ''}">
          ${typeMarkup || '<div class="muted small kb-tree-empty">No KUs in this scope.</div>'}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="kb-tree-node">
      <button class="kb-tree-toggle ${rootOpen ? 'open' : ''}" type="button" data-tree-node="root">
        <span class="chevron">▸</span>
        <span>All KUs</span>
        <span class="badge">${filteredItems().length}</span>
      </button>
      <div class="kb-tree-children ${rootOpen ? 'open' : ''}">
        ${children}
      </div>
    </div>
  `;
}

function renderTree() {
  const container = el('kb-tree');
  const items = filteredItems();
  if (!items.length) {
    container.innerHTML = '<div class="kb-tree-empty muted small">No KUs match the current filters.</div>';
    return;
  }
  container.innerHTML = buildTreeMarkup();
}

function findDefaultVariant(kuId) {
  return state.items.find((entry) => entry.ku_id === kuId && entry.scope === 'default') || null;
}

function renderPermissionMessage() {
  const canGlobal = state.auth?.caller?.role === 'admin';
  el('kb-permission-message').textContent = canGlobal
    ? 'Admin mode is active. You can save either session or global overrides.'
    : 'User mode is active. Global KU edits stay disabled; save session overrides instead.';
}

function renderInspector() {
  const item = state.selected;
  if (!item) {
    el('kb-details-body').innerHTML = '<div class="muted small">Select a KU from the tree to inspect or edit it.</div>';
    return;
  }
  const badges = [
    `<span class="badge">${escapeHtml(item.scope)}</span>`,
    `<span class="badge">${escapeHtml(item.meta?.ku_type || 'content')}</span>`,
    ...(item.meta?.tags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`),
    ...(item.meta?.commands || []).map((tag) => `<span class="badge dependency-pill">${escapeHtml(tag)}</span>`),
    ...(item.meta?.interpreters || []).map((tag) => `<span class="badge dependency-pill">${escapeHtml(tag)}</span>`),
  ];
  el('kb-details-body').innerHTML = `
    <div class="stack compact">
      <strong>${escapeHtml(item.ku_id)}</strong>
      <div class="muted small">${escapeHtml(item.meta?.title || '')}</div>
      <div class="muted small">${escapeHtml(item.meta?.summary || '')}</div>
      <div class="row wrap">${badges.join('')}</div>
    </div>
  `;
}

function renderEditor() {
  const item = state.selected;
  const defaultVariant = item ? findDefaultVariant(item.ku_id) : null;
  const canGlobal = state.auth?.caller?.role === 'admin';
  const scopeInput = el('editor-scope');
  scopeInput.innerHTML = `
    <option value="session">session</option>
    <option value="global" ${canGlobal ? '' : 'disabled'}>global</option>
  `;
  scopeInput.value = item?.scope === 'global' && canGlobal ? 'global' : 'session';
  el('editor-file-name').value = item
    ? item.file_path?.split('/').pop() || `${item.ku_id.replace(/[^a-zA-Z0-9_-]/g, '_')}.sop`
    : '';
  el('editor-source').value = item?.source_text || '';
  el('load-default-ku').disabled = !defaultVariant;
  renderPermissionMessage();
}

async function loadKb() {
  const params = new URLSearchParams();
  if (state.sessionId) {
    params.set('session_id', state.sessionId);
  }
  const data = await fetchJson(`/api/kb/catalog?${params.toString()}`);
  state.items = data.items || [];
  state.summary = data.summary || {};
}

async function loadAuth() {
  state.auth = await fetchJson('/api/auth/context');
}

async function saveKu(event) {
  event.preventDefault();
  try {
    const scope = el('editor-scope').value;
    const fileName = el('editor-file-name').value.trim();
    const sopText = el('editor-source').value;
    if (!fileName || !sopText.trim()) {
      notify('Provide a file name and SOP source before saving.', 'error');
      return;
    }
    if (scope === 'global') {
      await fetchJson('/api/kb/global', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file_name: fileName, sop_text: sopText }),
      });
    } else {
      if (!state.sessionId) {
        notify('Open or create a chat session before saving a session KU.', 'error');
        return;
      }
      await fetchJson(`/api/sessions/${state.sessionId}/kb`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file_name: fileName, sop_text: sopText }),
      });
    }
    notify('KU saved.');
    await loadKb();
    summarizeItems();
    renderTree();
  } catch (error) {
    notify(error.message, 'error');
  }
}

function loadDefaultIntoEditor() {
  if (!state.selected) {
    return;
  }
  const defaultVariant = findDefaultVariant(state.selected.ku_id);
  if (!defaultVariant) {
    notify('No default KU exists for this entry.', 'error');
    return;
  }
  el('editor-source').value = defaultVariant.source_text || '';
  if (state.selected.scope === 'default') {
    el('editor-scope').value = 'session';
  }
  notify('Loaded the default KU source into the editor.');
}

function attachHandlers() {
  el('kb-search').addEventListener('input', (event) => {
    state.search = event.target.value.trim();
    renderTree();
  });
  el('kb-type').addEventListener('change', (event) => {
    state.typeFilter = event.target.value;
    renderTree();
  });
  el('kb-refresh').addEventListener('click', () => {
    Promise.all([loadKb(), loadAuth()])
      .then(() => {
        summarizeItems();
        renderTree();
        renderEditor();
      })
      .catch((error) => notify(error.message, 'error'));
  });
  el('kb-tree').addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-tree-node]');
    if (toggle) {
      const id = toggle.dataset.treeNode;
      if (state.openNodes.has(id)) {
        state.openNodes.delete(id);
      } else {
        state.openNodes.add(id);
      }
      renderTree();
      return;
    }
    const leaf = event.target.closest('[data-ku-id][data-scope]');
    if (!leaf) {
      return;
    }
    state.selected = state.items.find((item) => item.ku_id === leaf.dataset.kuId && item.scope === leaf.dataset.scope) || null;
    ensureSelectionVisible(state.selected);
    renderTree();
    renderInspector();
    renderEditor();
  });
  el('kb-editor').addEventListener('submit', saveKu);
  el('load-default-ku').addEventListener('click', loadDefaultIntoEditor);
}

async function init() {
  clearNotice();
  attachHandlers();
  await Promise.all([loadKb(), loadAuth()]);
  summarizeItems();
  renderTree();
  renderInspector();
  renderEditor();
}

init().catch((error) => notify(error.message, 'error'));

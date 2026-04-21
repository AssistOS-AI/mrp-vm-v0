import {
  clearNotice,
  copyText,
  el,
  escapeHtml,
  fetchJson,
  formatDate,
  notify,
  queryParam,
  renderSystemContext,
  setActiveSessionId,
  statusClass,
} from './shared.js';

const state = {
  payload: null,
  requestId: queryParam('request_id'),
  sessionId: queryParam('session_id') || localStorage.getItem('mrpvm.activeSessionId'),
  activeVariableId: null,
  activeVariableTab: 'value',
};

function humanizeStatus(status) {
  return String(status || 'unknown').replace(/_/g, ' ');
}

function previewText(value, fallback, maxLength = 160) {
  const text = String(value || '').trim();
  if (!text) {
    return fallback;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function stringify(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  return JSON.stringify(value, null, 2);
}

function renderTimeline() {
  const container = el('timeline');
  const items = state.payload?.timeline ?? [];
  if (items.length === 0) {
    container.innerHTML = '<div class="muted small">No requests yet.</div>';
    return;
  }
  container.innerHTML = items.map((item) => `
    <button
      class="trace-timeline-item ${item.request_id === state.requestId ? 'active' : ''}"
      type="button"
      data-request-id="${escapeHtml(item.request_id)}"
      title="${escapeHtml(item.request_preview || '')}"
    >
      <div class="trace-timeline-row">
        <span class="badge ${statusClass(item.status || 'unknown')}">${escapeHtml(humanizeStatus(item.status || 'unknown'))}</span>
        <span class="trace-timeline-id">#${escapeHtml(item.request_id.slice(-6))}</span>
      </div>
      <div class="trace-timeline-preview">${escapeHtml(previewText(item.request_preview, 'No request text.'))}</div>
      <div class="trace-timeline-response muted small">${escapeHtml(previewText(item.response_preview, 'No response captured.', 110))}</div>
    </button>
  `).join('');
}

function renderHeaderMeta() {
  const selected = state.payload?.selected_request || {};
  el('trace-title').textContent = `Request ${state.requestId ? state.requestId.slice(-8) : 'trace'}`;
  el('trace-meta').innerHTML = `
    <span class="badge ${statusClass(selected.status || 'unknown')}">${escapeHtml(humanizeStatus(selected.status || 'unknown'))}</span>
    <span class="badge">${escapeHtml(formatDate(selected.created_at))}</span>
  `;
}

function renderSop() {
  el('sop-content').textContent = state.payload?.sop_lang || '; No SOP snapshot captured.';
}

function renderVariantCards(variable) {
  const variants = variable?.variants ?? [];
  if (variants.length === 0) {
    return '<div class="muted small">No variable versions were captured.</div>';
  }
  return `
    <div class="variable-version-list">
      ${variants.map((variant) => `
        <div class="variable-version-card ${variant.id === variable.active_version_id ? 'active' : ''}">
          <div class="between">
            <div class="stack compact">
              <strong>${escapeHtml(variant.id)}</strong>
              <div class="muted small">${escapeHtml(variant.provenance_summary || 'No provenance summary.')}</div>
            </div>
            <div class="row wrap">
              <span class="badge ${statusClass(variant.status || 'unknown')}">${escapeHtml(humanizeStatus(variant.status || 'unknown'))}</span>
              ${variant.score == null ? '' : `<span class="badge">score ${escapeHtml(String(variant.score))}</span>`}
            </div>
          </div>
          <pre>${escapeHtml(stringify(variant.value))}</pre>
        </div>
      `).join('')}
    </div>
  `;
}

function renderVariableMeta(variable) {
  return `
    <div class="stack">
      <div class="variable-meta-grid">
        <div class="inset-card stack compact">
          <h4>Family metadata</h4>
          <pre>${escapeHtml(stringify(variable.family_meta || {}))}</pre>
        </div>
        <div class="inset-card stack compact">
          <h4>Active value metadata</h4>
          <pre>${escapeHtml(stringify(variable.current_meta || {}))}</pre>
        </div>
      </div>
      <div class="inset-card stack compact">
        <h4>Version history</h4>
        ${renderVariantCards(variable)}
      </div>
    </div>
  `;
}

function renderVariableDetails(variable) {
  if (!variable) {
    return `
      <div class="variable-empty-state muted small">
        Select a variable from the left panel to inspect its current value, metadata, and definition.
      </div>
    `;
  }

  return `
    <div class="variable-detail-header">
      <div class="stack compact">
        <h3>${escapeHtml(variable.family_id)}</h3>
        <div class="muted small">${escapeHtml(variable.command_name || 'No command recorded')}</div>
      </div>
      <span class="badge ${statusClass(variable.status)}">${escapeHtml(humanizeStatus(variable.status))}</span>
    </div>
    <div class="trace-tabs-bar trace-tabs-bar--nested">
      <button class="tab-button ${state.activeVariableTab === 'value' ? 'active' : ''}" data-variable-tab="value" type="button">Current value</button>
      <button class="tab-button ${state.activeVariableTab === 'meta' ? 'active' : ''}" data-variable-tab="meta" type="button">Metadata</button>
      <button class="tab-button ${state.activeVariableTab === 'definition' ? 'active' : ''}" data-variable-tab="definition" type="button">Definition</button>
    </div>
    <div class="variable-detail-panel ${state.activeVariableTab === 'value' ? 'active' : ''}" data-variable-panel="value">
      <pre class="code-panel">${escapeHtml(stringify(variable.current_value))}</pre>
    </div>
    <div class="variable-detail-panel ${state.activeVariableTab === 'meta' ? 'active' : ''}" data-variable-panel="meta">
      ${renderVariableMeta(variable)}
    </div>
    <div class="variable-detail-panel ${state.activeVariableTab === 'definition' ? 'active' : ''}" data-variable-panel="definition">
      <pre class="code-panel">${escapeHtml(variable.definition?.text || '; No declaration definition found.')}</pre>
    </div>
  `;
}

function renderVariables() {
  const panel = el('variables-tab');
  const variables = state.payload?.variables ?? [];
  if (variables.length === 0) {
    panel.innerHTML = '<div class="inset-card muted small">No variables captured for this request.</div>';
    return;
  }

  if (!state.activeVariableId || !variables.some((item) => item.family_id === state.activeVariableId)) {
    state.activeVariableId = variables[0].family_id;
  }
  const activeVariable = variables.find((item) => item.family_id === state.activeVariableId) || null;

  panel.innerHTML = `
    <div class="variables-shell">
      <div class="variables-list">
        ${variables.map((variable) => `
          <button class="variable-list-row ${variable.family_id === state.activeVariableId ? 'active' : ''}" type="button" data-variable-id="${escapeHtml(variable.family_id)}">
            <div class="variable-list-main">
              <span class="variable-list-name">${escapeHtml(variable.family_id)}</span>
              <span class="variable-list-command">${escapeHtml(variable.command_name || 'No command')}</span>
            </div>
            <span class="badge ${statusClass(variable.status)}">${escapeHtml(humanizeStatus(variable.status))}</span>
          </button>
        `).join('')}
      </div>
      <div class="variable-detail-shell">
        ${renderVariableDetails(activeVariable)}
      </div>
    </div>
  `;
}

function truncateNodeLabel(value, length = 22) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function drawGraphEdges() {
  const inner = el('execution-graph-inner');
  const svg = el('execution-graph-svg');
  if (!inner || !svg) {
    return;
  }
  const nodes = new Map([...inner.querySelectorAll('[data-node-id]')].map((node) => [node.dataset.nodeId, node]));
  const innerRect = inner.getBoundingClientRect();
  const width = Math.max(inner.scrollWidth, inner.clientWidth);
  const height = Math.max(inner.scrollHeight, inner.clientHeight);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  const edgeMarkup = (state.payload?.execution_graph?.edges || []).map((edge) => {
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    if (!fromNode || !toNode) {
      return '';
    }
    const fromRect = fromNode.getBoundingClientRect();
    const toRect = toNode.getBoundingClientRect();
    const x1 = fromRect.right - innerRect.left;
    const y1 = fromRect.top - innerRect.top + fromRect.height / 2;
    const x2 = toRect.left - innerRect.left;
    const y2 = toRect.top - innerRect.top + toRect.height / 2;
    const dx = Math.max(44, (x2 - x1) / 2);
    return `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" class="graph-edge-path"></path>`;
  }).join('');

  svg.innerHTML = `
    <defs>
      <marker id="graph-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#6e7a96"></path>
      </marker>
    </defs>
    ${edgeMarkup}
  `;
}

function renderKnowledgeUnits(node) {
  const selectedKus = node.details?.context_package?.selected_knowledge_units || [];
  if (selectedKus.length === 0) {
    return '<div class="muted small">No KU references were captured for this node.</div>';
  }
  return `
    <div class="stack compact">
      ${selectedKus.map((ku, index) => `
        <details>
          <summary>${escapeHtml(ku.ku_id || ku.title || `KU ${index + 1}`)}</summary>
          <div class="stack compact">
            ${ku.summary ? `<div class="muted small">${escapeHtml(ku.summary)}</div>` : ''}
            <pre>${escapeHtml(stringify(ku))}</pre>
          </div>
        </details>
      `).join('')}
    </div>
  `;
}

function nodeDetailsMarkup(node) {
  return `
    <div class="split">
      <div class="stack">
        <div class="inset-card">
          <h4>Declaration definition</h4>
          <pre>${escapeHtml(node.details?.declaration_definition?.body || node.body || '')}</pre>
        </div>
        <div class="inset-card">
          <h4>Resolved runtime context</h4>
          <pre>${escapeHtml(node.details?.runtime_context || 'none')}</pre>
        </div>
        <div class="inset-card">
          <h4>Dependencies</h4>
          <pre>${escapeHtml(JSON.stringify(node.details?.resolved_dependencies || [], null, 2))}</pre>
        </div>
        <div class="inset-card">
          <h4>Execution layer</h4>
          <pre>${escapeHtml(JSON.stringify({
            topological_level: node.topological_level,
            epochs: node.epoch_ids || [],
          }, null, 2))}</pre>
        </div>
      </div>
      <div class="stack">
        <div class="inset-card">
          <h4>Outputs</h4>
          <pre>${escapeHtml(JSON.stringify(node.details?.outputs || [], null, 2))}</pre>
        </div>
        <div class="inset-card">
          <h4>Diagnostics and retries</h4>
          <pre>${escapeHtml(JSON.stringify({
            diagnostics: node.details?.diagnostics || [],
            retries: node.details?.retries || [],
          }, null, 2))}</pre>
        </div>
        <div class="inset-card stack compact">
          <h4>Knowledge units</h4>
          ${renderKnowledgeUnits(node)}
        </div>
      </div>
    </div>
  `;
}

function renderGraph() {
  const panel = el('graph-tab');
  const graph = state.payload?.execution_graph ?? { strata: [], nodes: [], edges: [] };
  if (!graph.strata?.length) {
    panel.innerHTML = '<div class="inset-card muted small">No execution graph captured.</div>';
    return;
  }

  const nodesById = new Map((graph.nodes || []).map((node) => [node.id, node]));
  panel.innerHTML = `
    <div class="graph-overview graph-overview--topline">
      <span class="badge">${graph.nodes.length} nodes</span>
      <span class="badge">${graph.edges.length} edges</span>
      <span class="badge">${graph.strata.length} layers</span>
    </div>
    <div class="execution-graph-shell">
      <div class="execution-graph-scroll">
        <div id="execution-graph-inner" class="execution-graph-inner">
          <svg id="execution-graph-svg" class="execution-graph-svg" aria-hidden="true"></svg>
          <div class="execution-graph-layers">
            ${graph.strata.map((layer) => `
              <div class="execution-graph-layer">
                <div class="execution-graph-layer-label">Layer ${layer.layer + 1}</div>
                <div class="execution-graph-column">
                  ${layer.node_ids.map((nodeId) => {
                    const node = nodesById.get(nodeId);
                    if (!node) {
                      return '';
                    }
                    return `
                      <button class="execution-graph-node ${statusClass(node.status)}" type="button" data-node-id="${escapeHtml(node.id)}">
                        <span class="execution-graph-node-family">${escapeHtml(truncateNodeLabel(node.target_family, 20))}</span>
                        <span class="execution-graph-node-command">${escapeHtml(truncateNodeLabel((node.commands || []).join(', '), 24))}</span>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  requestAnimationFrame(drawGraphEdges);
}

function renderTabs() {
  document.querySelectorAll('.tab-button[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-button[data-tab]').forEach((node) => node.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
      button.classList.add('active');
      el(button.dataset.tab).classList.add('active');
      if (button.dataset.tab === 'graph-tab') {
        requestAnimationFrame(drawGraphEdges);
      }
    });
  });
}

async function loadTraceability(requestId = state.requestId) {
  clearNotice();
  state.requestId = requestId;
  setActiveSessionId(state.sessionId);
  state.payload = await fetchJson(`/api/sessions/${state.sessionId}/requests/${requestId}/traceability`);
  renderHeaderMeta();
  renderTimeline();
  renderSop();
  renderVariables();
  renderGraph();
}

function attachHandlers() {
  renderTabs();
  el('timeline').addEventListener('click', (event) => {
    const button = event.target.closest('[data-request-id]');
    if (!button) {
      return;
    }
    loadTraceability(button.dataset.requestId).catch((error) => notify(error.message, 'error'));
  });
  el('copy-sop').addEventListener('click', async () => {
    await copyText(state.payload?.sop_lang || '');
    notify('SOP copied.');
  });
  el('variables-tab').addEventListener('click', (event) => {
    const variableButton = event.target.closest('[data-variable-id]');
    if (variableButton) {
      state.activeVariableId = variableButton.dataset.variableId;
      renderVariables();
      return;
    }
    const tabButton = event.target.closest('[data-variable-tab]');
    if (tabButton) {
      state.activeVariableTab = tabButton.dataset.variableTab;
      renderVariables();
    }
  });
  el('graph-tab').addEventListener('click', (event) => {
    const button = event.target.closest('[data-node-id]');
    if (!button) {
      return;
    }
    const node = (state.payload?.execution_graph?.nodes || []).find((entry) => entry.id === button.dataset.nodeId);
    if (!node) {
      return;
    }
    el('node-modal-title').textContent = `${node.target_family} · ${(node.commands || []).join(', ')}`;
    el('node-modal-body').innerHTML = nodeDetailsMarkup(node);
    el('node-modal').classList.add('visible');
  });
  el('close-node-modal').addEventListener('click', () => {
    el('node-modal').classList.remove('visible');
  });
  window.addEventListener('resize', () => {
    requestAnimationFrame(drawGraphEdges);
  });
}

async function init() {
  if (!state.sessionId) {
    notify('Select a session from Chat first.', 'error');
    return;
  }
  const auth = await fetchJson('/api/auth/context');
  renderSystemContext(el('trace-system-context'), {
    role: auth.caller.role,
    session_origin: auth.caller.session_origin,
    auth_mode: auth.caller.auth_mode,
    can_edit_global_state: auth.caller.role === 'admin',
  });
  if (!state.requestId) {
    const session = await fetchJson(`/api/sessions/${state.sessionId}`);
    state.requestId = session.request_history?.at(-1)?.request_id;
  }
  attachHandlers();
  if (!state.requestId) {
    notify('This session has no requests yet.', 'error');
    return;
  }
  await loadTraceability(state.requestId);
}

init().catch((error) => notify(error.message, 'error'));

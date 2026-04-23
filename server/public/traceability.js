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
  activeNodeId: null,
  activeNodeTab: 'declaration',
  graphNodeOffsets: new Map(),
  activeGraphDrag: null,
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

function formatDuration(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) {
    return 'n/a';
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`;
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
    ${selected.outcome?.error?.message ? `<span class="badge ${statusClass(selected.status || 'failed')}">${escapeHtml(previewText(selected.outcome.error.message, '', 90))}</span>` : ''}
  `;
}

function renderSop() {
  const source = state.payload?.sop_lang || '; No SOP snapshot captured.';
  el('sop-content').innerHTML = source
    .split('\n')
    .map((line) => renderSopLine(line))
    .join('\n');
}

function highlightSopReferences(text) {
  return escapeHtml(text)
    .replace(/(\$[A-Za-z_][A-Za-z0-9_:]*)/g, '<span class="sop-ref sop-ref-value">$1</span>')
    .replace(/(~[A-Za-z_][A-Za-z0-9_:]*)/g, '<span class="sop-ref sop-ref-handle">$1</span>');
}

function renderSopLine(line) {
  const headerMatch = /^@([A-Za-z_][A-Za-z0-9_]*)(\s+)(.+)$/.exec(line);
  if (headerMatch) {
    return `<span class="sop-line"><span class="sop-family">@${escapeHtml(headerMatch[1])}</span>${headerMatch[2]}<span class="sop-command">${escapeHtml(headerMatch[3])}</span></span>`;
  }
  return `<span class="sop-line">${highlightSopReferences(line)}</span>`;
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
              ${variant.timing?.duration_ms == null ? '' : `<span class="badge">${escapeHtml(formatDuration(variant.timing.duration_ms))}</span>`}
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
      <div class="row wrap">
        <span class="badge ${statusClass(variable.status)}">${escapeHtml(humanizeStatus(variable.status))}</span>
        ${variable.timing?.duration_ms == null ? '' : `<span class="badge">${escapeHtml(formatDuration(variable.timing.duration_ms))}</span>`}
      </div>
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
              ${variable.status_reason && variable.status !== 'completed'
                ? `<span class="variable-list-note">${escapeHtml(previewText(variable.status_reason, '', 90))}</span>`
                : ''}
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
  let maxRight = inner.clientWidth;
  let maxBottom = inner.clientHeight;
  for (const node of nodes.values()) {
    const rect = node.getBoundingClientRect();
    maxRight = Math.max(maxRight, rect.right - innerRect.left + 48);
    maxBottom = Math.max(maxBottom, rect.bottom - innerRect.top + 48);
  }
  const width = Math.max(inner.scrollWidth, inner.clientWidth, maxRight);
  const height = Math.max(inner.scrollHeight, inner.clientHeight, maxBottom);
  inner.style.width = `${width}px`;
  inner.style.minHeight = `${height}px`;
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
    const dx = Math.max(96, (x2 - x1) / 2);
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

function graphNodeOffsetKey(nodeId) {
  return `${state.requestId || 'request'}::${nodeId}`;
}

function getGraphNodeOffset(nodeId) {
  return state.graphNodeOffsets.get(graphNodeOffsetKey(nodeId)) ?? { x: 0, y: 0 };
}

function applyGraphNodeOffset(node) {
  const offset = getGraphNodeOffset(node.dataset.nodeId);
  node.style.transform = offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : '';
}

function applyStoredGraphNodeOffsets() {
  document.querySelectorAll('#graph-tab [data-node-id]').forEach((node) => {
    applyGraphNodeOffset(node);
  });
}

function startGraphNodeDrag(event) {
  if (event.button !== 0) {
    return;
  }
  const node = event.target.closest('[data-node-id]');
  if (!node) {
    return;
  }
  const offset = getGraphNodeOffset(node.dataset.nodeId);
  state.activeGraphDrag = {
    node,
    nodeId: node.dataset.nodeId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: offset.x,
    baseY: offset.y,
    moved: false,
  };
  node.classList.add('dragging');
}

function updateGraphNodeDrag(event) {
  const drag = state.activeGraphDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;
  if (!drag.moved && Math.abs(deltaX) < 3 && Math.abs(deltaY) < 3) {
    return;
  }
  drag.moved = true;
  state.graphNodeOffsets.set(graphNodeOffsetKey(drag.nodeId), {
    x: drag.baseX + deltaX,
    y: drag.baseY + deltaY,
  });
  applyGraphNodeOffset(drag.node);
  requestAnimationFrame(drawGraphEdges);
}

function stopGraphNodeDrag(event) {
  const drag = state.activeGraphDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }
  drag.node.classList.remove('dragging');
  if (drag.moved) {
    drag.node.dataset.justDragged = '1';
    window.setTimeout(() => {
      delete drag.node.dataset.justDragged;
    }, 0);
  }
  state.activeGraphDrag = null;
  requestAnimationFrame(drawGraphEdges);
}

function renderKnowledgeUnits(node) {
  const selectedKus = node.details?.context_package?.selected_knowledge_units || [];
  if (selectedKus.length === 0) {
    return '<div class="muted small">No KU references were captured for this node.</div>';
  }
  return `
    <div class="stack compact">
      ${selectedKus.map((ku, index) => `
        <div class="issued-key-row">
          <div class="stack compact">
            <strong>${escapeHtml(ku.ku_id || ku.title || `KU ${index + 1}`)}</strong>
            <div class="muted small">${escapeHtml(ku.title || 'Untitled KU')} · ${escapeHtml(ku.scope || 'default')} · rev ${escapeHtml(String(ku.rev ?? '?'))}</div>
            ${ku.summary ? `<div class="muted small">${escapeHtml(ku.summary)}</div>` : ''}
          </div>
          <div class="row wrap">
            ${Array.isArray(ku.tags) ? ku.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('') : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function nodeModalTabs() {
  return [
    ['declaration', 'Declaration'],
    ['input', 'Input'],
    ['context', 'Context'],
    ['output', 'Output'],
    ['diagnostics', 'Diagnostics'],
    ['knowledge', 'Knowledge Units'],
  ];
}

function renderNodePanel(node, tab) {
  const details = node.details || {};
  const contextSections = details.context_sections || {};
  if (tab === 'declaration') {
    return `
      <div class="stack">
        <div class="inset-card stack compact">
          <h4>Declaration body</h4>
          <pre>${escapeHtml(details.declaration_definition?.body || node.body || '')}</pre>
        </div>
        <div class="inset-card stack compact">
          <h4>Declaration metadata</h4>
          <pre>${escapeHtml(JSON.stringify({
            target: details.declaration_definition?.target ?? node.target_family,
            commands: details.declaration_definition?.commands ?? node.commands,
            declaration_kind: details.declaration_definition?.declaration_kind ?? node.declaration_kind,
            references: details.declaration_definition?.references ?? [],
          }, null, 2))}</pre>
        </div>
      </div>
    `;
  }
  if (tab === 'input') {
    return `
      <div class="stack">
        <div class="inset-card stack compact">
          <h4>Task and request</h4>
          <pre>${escapeHtml(JSON.stringify({
            target_family: contextSections.task?.target_family ?? node.target_family,
            declaration_body: contextSections.task?.body ?? node.body,
            user_request: contextSections.user_request ?? '',
          }, null, 2))}</pre>
        </div>
        <div class="inset-card stack compact">
          <h4>Resolved dependencies</h4>
          <pre>${escapeHtml(JSON.stringify(details.resolved_dependencies || [], null, 2))}</pre>
        </div>
      </div>
    `;
  }
  if (tab === 'context') {
    return `
      <div class="stack">
        <div class="inset-card stack compact">
          <h4>Resolved family state</h4>
          <pre>${escapeHtml(JSON.stringify(contextSections.resolved_family_state || [], null, 2))}</pre>
        </div>
        <div class="inset-card stack compact">
          <h4>Analytic summaries</h4>
          <pre>${escapeHtml(JSON.stringify(contextSections.analytic_summaries || [], null, 2))}</pre>
        </div>
        <div class="inset-card stack compact">
          <h4>Planning notes</h4>
          <pre>${escapeHtml(JSON.stringify(contextSections.planning_notes || [], null, 2))}</pre>
        </div>
      </div>
    `;
  }
  if (tab === 'output') {
    return `
      <div class="stack">
        <div class="inset-card stack compact">
          <h4>Outputs</h4>
          <pre>${escapeHtml(JSON.stringify(details.outputs || [], null, 2))}</pre>
        </div>
      </div>
    `;
  }
  if (tab === 'diagnostics') {
    return `
      <div class="stack">
        <div class="inset-card stack compact">
          <h4>Status and failure</h4>
          <pre>${escapeHtml(JSON.stringify({
            status: node.status,
            status_reason: node.status_reason ?? null,
            failure: details.failure ?? null,
            skipped_by: details.skipped_by ?? [],
            retries: details.retries || 0,
          }, null, 2))}</pre>
        </div>
        <div class="inset-card stack compact">
          <h4>Execution environment</h4>
          <pre>${escapeHtml(JSON.stringify({
            timing: details.timing || {},
            execution_layer: details.execution_layer ?? node.topological_level,
            epochs: node.epoch_ids || [],
            invoked_as: details.invoked_as ?? null,
            environment: details.execution_environment ?? {},
          }, null, 2))}</pre>
        </div>
        <div class="inset-card stack compact">
          <h4>Raw diagnostics</h4>
          <pre>${escapeHtml(JSON.stringify({
            diagnostics: details.diagnostics || [],
          }, null, 2))}</pre>
        </div>
      </div>
    `;
  }
  return `
    <div class="inset-card stack compact">
      <h4>Knowledge unit references</h4>
      ${renderKnowledgeUnits(node)}
    </div>
  `;
}

function renderNodeModal() {
  const node = (state.payload?.execution_graph?.nodes || []).find((entry) => entry.id === state.activeNodeId);
  if (!node) {
    return;
  }
  el('node-modal-heading').innerHTML = `
    <span class="node-modal-heading-main">@${escapeHtml(node.target_family)}</span>
    <span class="node-modal-heading-command">${escapeHtml((node.commands || []).join(', ') || 'No command')}</span>
    <span class="badge ${statusClass(node.status)}">${escapeHtml(humanizeStatus(node.status))}</span>
    <span class="badge">layer ${escapeHtml(String((node.topological_level ?? 0) + 1))}</span>
    ${node.duration_ms == null ? '' : `<span class="badge">${escapeHtml(formatDuration(node.duration_ms))}</span>`}
  `;
  el('node-modal-tabs').innerHTML = nodeModalTabs().map(([id, label]) => `
    <button class="tab-button ${state.activeNodeTab === id ? 'active' : ''}" data-node-tab="${escapeHtml(id)}" type="button">${escapeHtml(label)}</button>
  `).join('');
  el('node-modal-body').innerHTML = `
    <div class="node-modal-panel">
      ${renderNodePanel(node, state.activeNodeTab)}
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
  const summary = graph.summary || {};
  const countOrder = ['completed', 'failed', 'skipped', 'pending', 'running'];
  const countBadges = countOrder
    .filter((status) => Number(summary.counts?.[status] ?? 0) > 0)
    .map((status) => `<span class="badge ${statusClass(status)}">${escapeHtml(String(summary.counts[status]))} ${escapeHtml(humanizeStatus(status))}</span>`)
    .join('');
  const requestError = state.payload?.selected_request?.outcome?.error || summary.error || null;
  panel.innerHTML = `
    <div class="graph-overview graph-overview--topline graph-overview--wrap">
      <span class="badge">${graph.nodes.length} nodes</span>
      <span class="badge">${graph.edges.length} edges</span>
      <span class="badge">${graph.strata.length} layers</span>
      ${countBadges}
      <span class="badge ${statusClass(summary.request_stop_reason || state.payload?.selected_request?.status || 'unknown')}">${escapeHtml(humanizeStatus(summary.request_stop_reason || state.payload?.selected_request?.status || 'unknown'))}</span>
    </div>
    ${requestError ? `
      <div class="trace-error-banner">
        <strong>Execution failed:</strong> ${escapeHtml(requestError.message || 'Unknown execution error.')}
      </div>
    ` : ''}
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
                      <button class="execution-graph-node ${statusClass(node.status)}" type="button" data-node-id="${escapeHtml(node.id)}" title="${escapeHtml(node.status_reason || node.label)}">
                        <span class="execution-graph-node-status-row">
                          <span class="badge ${statusClass(node.status)}">${escapeHtml(humanizeStatus(node.status))}</span>
                        </span>
                        <span class="execution-graph-node-family">${escapeHtml(truncateNodeLabel(node.target_family, 20))}</span>
                        <span class="execution-graph-node-command">${escapeHtml(truncateNodeLabel((node.commands || []).join(', '), 24))}</span>
                        ${node.status_reason ? `<span class="execution-graph-node-note">${escapeHtml(truncateNodeLabel(node.status_reason, 42))}</span>` : ''}
                        ${node.duration_ms == null ? '' : `<span class="execution-graph-node-duration">${escapeHtml(formatDuration(node.duration_ms))}</span>`}
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

  applyStoredGraphNodeOffsets();
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
  state.activeNodeId = null;
  state.activeNodeTab = 'declaration';
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
    if (button.dataset.justDragged === '1') {
      return;
    }
    const node = (state.payload?.execution_graph?.nodes || []).find((entry) => entry.id === button.dataset.nodeId);
    if (!node) {
      return;
    }
    state.activeNodeId = node.id;
    state.activeNodeTab = 'declaration';
    renderNodeModal();
    el('node-modal').classList.add('visible');
  });
  el('close-node-modal').addEventListener('click', () => {
    el('node-modal').classList.remove('visible');
  });
  el('node-modal').addEventListener('click', (event) => {
    if (event.target === el('node-modal')) {
      el('node-modal').classList.remove('visible');
      return;
    }
    const tabButton = event.target.closest('[data-node-tab]');
    if (!tabButton) {
      return;
    }
    state.activeNodeTab = tabButton.dataset.nodeTab;
    renderNodeModal();
  });
  el('graph-tab').addEventListener('pointerdown', startGraphNodeDrag);
  window.addEventListener('pointermove', updateGraphNodeDrag);
  window.addEventListener('pointerup', stopGraphNodeDrag);
  window.addEventListener('pointercancel', stopGraphNodeDrag);
  window.addEventListener('resize', () => {
    requestAnimationFrame(drawGraphEdges);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      el('node-modal').classList.remove('visible');
    }
  });
}

async function init() {
  if (!state.sessionId) {
    notify('Select a session from Chat first.', 'error');
    return;
  }
  const auth = await fetchJson('/api/auth/context');
  renderSystemContext(el('trace-system-context'), {
    session_origin: auth.caller.session_origin,
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

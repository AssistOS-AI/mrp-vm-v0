import {
  clearNotice,
  copyText,
  el,
  escapeHtml,
  fetchJson,
  formatDate,
  notify,
  queryParam,
  reportClientError,
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
  graphLayerWidths: new Map(),
  graphManualLayerLayouts: new Set(),
  activeGraphLayerDrag: null,
};

const GRAPH_LAYER_MIN_WIDTH = 138;
const GRAPH_LAYER_MAX_WIDTH = 210;
const GRAPH_DIVIDER_WIDTH = 16;
const GRAPH_NODE_FAMILY_LABEL_LENGTH = 18;
const GRAPH_NODE_COMMAND_LABEL_LENGTH = 18;
const GRAPH_NODE_NOTE_LABEL_LENGTH = 30;
const GRAPH_NODE_CHAR_WIDTH_PX = 7;
const GRAPH_NODE_HORIZONTAL_PADDING_PX = 34;

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

function describeMissingResponse(item = {}) {
  if (item.response_preview) {
    return item.response_preview;
  }
  if (item.error_message) {
    return item.error_message;
  }
  const stopReason = String(item.status || 'unknown');
  if (stopReason === 'unknown_outcome') {
    return 'No terminal response was captured before execution stopped.';
  }
  if (stopReason === 'execution_error') {
    return 'Execution failed before a terminal response was produced.';
  }
  if (stopReason === 'active_request') {
    return 'Another request is already active for this session.';
  }
  return `No response captured (${humanizeStatus(stopReason)}).`;
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
      <div class="trace-timeline-response muted small">${escapeHtml(previewText(item.response_preview || describeMissingResponse(item), 'No response captured.', 110))}</div>
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

function renderErrors() {
  const panel = el('errors-tab');
  const errors = state.payload?.errors ?? [];
  if (errors.length === 0) {
    panel.innerHTML = '<div class="inset-card muted small">No execution or planning errors were captured for this request.</div>';
    return;
  }

  panel.innerHTML = `
    <div class="stack">
      ${errors.map((entry, index) => `
        <article class="trace-error-card stack compact">
          <div class="between">
            <div class="row wrap">
              <span class="badge ${statusClass(entry.kind || 'execution_error')}">${escapeHtml(humanizeStatus(entry.kind || 'execution_error'))}</span>
              <span class="badge">${escapeHtml(entry.stage || 'request')}</span>
              ${entry.phase ? `<span class="badge">${escapeHtml(entry.phase)}</span>` : ''}
              ${entry.origin ? `<span class="badge">${escapeHtml(entry.origin)}</span>` : ''}
            </div>
            <span class="muted small">${escapeHtml(formatDate(entry.created_at))}</span>
          </div>
          <div class="trace-error-card-message">${escapeHtml(entry.message || `Error ${index + 1}`)}</div>
          <div class="row wrap">
            ${entry.target_family ? `<span class="badge">target ${escapeHtml(entry.target_family)}</span>` : ''}
            ${entry.declaration_id ? `<span class="badge">${escapeHtml(entry.declaration_id)}</span>` : ''}
            ${entry.code ? `<span class="badge">${escapeHtml(entry.code)}</span>` : ''}
            ${entry.execution_timing?.duration_ms == null ? '' : `<span class="badge">${escapeHtml(formatDuration(entry.execution_timing.duration_ms))}</span>`}
          </div>
          ${entry.stack ? `
            <details class="trace-error-details">
              <summary>Stack</summary>
              <pre>${escapeHtml(entry.stack)}</pre>
            </details>
          ` : ''}
          ${entry.details ? `
            <details class="trace-error-details">
              <summary>Details</summary>
              <pre>${escapeHtml(stringify(entry.details))}</pre>
            </details>
          ` : ''}
        </article>
      `).join('')}
    </div>
  `;
}

function truncateNodeLabel(value, length = 22) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function getGraphViewportWidth() {
  const scroll = document.querySelector('#graph-tab .execution-graph-scroll');
  return Math.max(0, (scroll?.clientWidth ?? 0) - 32);
}

function drawGraphEdges() {
  const inner = el('execution-graph-inner');
  const svg = el('execution-graph-svg');
  if (!inner || !svg) {
    return;
  }
  const layers = inner.querySelector('.execution-graph-layers');
  const scroll = inner.closest('.execution-graph-scroll');
  const nodes = new Map([...inner.querySelectorAll('[data-node-id]')].map((node) => [node.dataset.nodeId, node]));
  const innerRect = inner.getBoundingClientRect();
  const viewportWidth = getGraphViewportWidth() || scroll?.clientWidth || inner.clientWidth;
  const layersRect = layers?.getBoundingClientRect() ?? innerRect;
  const layersWidth = layers
    ? Math.max(layers.scrollWidth, Math.ceil(layersRect.width))
    : viewportWidth;
  let maxRight = Math.max(
    viewportWidth,
    layersWidth + 12,
  );
  let maxBottom = Math.max(inner.clientHeight, layersRect.bottom - innerRect.top + 24);
  for (const node of nodes.values()) {
    const rect = node.getBoundingClientRect();
    maxRight = Math.max(maxRight, rect.right - innerRect.left + 28);
    maxBottom = Math.max(maxBottom, rect.bottom - innerRect.top + 32);
  }
  const width = Math.max(maxRight, viewportWidth);
  const height = Math.max(inner.scrollHeight, inner.clientHeight, maxBottom);
  inner.style.width = width <= viewportWidth ? '100%' : `${width}px`;
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
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#16a34a"></path>
      </marker>
    </defs>
    ${edgeMarkup}
  `;
}

function graphRequestLayoutKey() {
  return state.requestId || 'request';
}

function graphLayerWidthKey(layerIndex) {
  return `${graphRequestLayoutKey()}::layer:${layerIndex}`;
}

function getGraphLayerWidth(layerIndex) {
  return state.graphLayerWidths.get(graphLayerWidthKey(layerIndex)) ?? null;
}

function setGraphLayerWidths(widths = []) {
  widths.forEach((width, index) => {
    state.graphLayerWidths.set(graphLayerWidthKey(index), Math.max(GRAPH_LAYER_MIN_WIDTH, Math.round(width)));
  });
}

function hasStoredGraphLayerWidths(layerCount) {
  if (layerCount <= 0) {
    return false;
  }
  for (let index = 0; index < layerCount; index += 1) {
    if (getGraphLayerWidth(index) == null) {
      return false;
    }
  }
  return true;
}

function estimateGraphLayerWidth(layer = {}, nodesById = new Map()) {
  const longestVisibleLabel = Math.max(0, ...(layer.node_ids || []).map((nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node) {
      return 0;
    }
    const familyLength = truncateNodeLabel(node.target_family, GRAPH_NODE_FAMILY_LABEL_LENGTH).length;
    const commandLength = truncateNodeLabel((node.commands || []).join(', '), GRAPH_NODE_COMMAND_LABEL_LENGTH).length;
    return Math.max(familyLength, commandLength);
  }));
  return Math.max(
    GRAPH_LAYER_MIN_WIDTH,
    Math.min(
      GRAPH_LAYER_MAX_WIDTH,
      Math.round((Math.max(longestVisibleLabel, 11) * GRAPH_NODE_CHAR_WIDTH_PX) + GRAPH_NODE_HORIZONTAL_PADDING_PX),
    ),
  );
}

function computeDefaultGraphLayerWidths(strata = []) {
  if (!Array.isArray(strata) || strata.length <= 0) {
    return [];
  }
  const nodesById = new Map((state.payload?.execution_graph?.nodes || []).map((node) => [node.id, node]));
  return strata.map((layer) => estimateGraphLayerWidth(layer, nodesById));
}

function applyGraphLayerWidths(options = {}) {
  const layers = document.querySelector('#graph-tab .execution-graph-layers');
  const layerNodes = [...document.querySelectorAll('#graph-tab .execution-graph-layer[data-layer-index]')];
  if (layerNodes.length === 0) {
    return;
  }
  const requestKey = graphRequestLayoutKey();
  const shouldAutoSize = options.forceAuto
    || !state.graphManualLayerLayouts.has(requestKey)
    || !hasStoredGraphLayerWidths(layerNodes.length);
  const widths = shouldAutoSize
    ? computeDefaultGraphLayerWidths(state.payload?.execution_graph?.strata ?? [])
    : layerNodes.map((_, index) => getGraphLayerWidth(index) ?? GRAPH_LAYER_MIN_WIDTH);
  setGraphLayerWidths(widths);
  layerNodes.forEach((node, index) => {
    const width = widths[index] ?? GRAPH_LAYER_MIN_WIDTH;
    node.style.width = `${width}px`;
    node.style.flexBasis = `${width}px`;
  });
  if (layers) {
    const totalDividerWidth = Math.max(0, layerNodes.length - 1) * GRAPH_DIVIDER_WIDTH;
    const totalLayerWidth = widths.reduce((sum, width) => sum + width, 0) + totalDividerWidth;
    const availableWidth = getGraphViewportWidth();
    layers.style.width = `${Math.max(totalLayerWidth, availableWidth)}px`;
  }
}

function startGraphLayerDrag(event) {
  if (event.button !== 0) {
    return false;
  }
  const label = event.target.closest('[data-layer-drag-index]');
  if (!label) {
    return false;
  }
  const index = Number(label.dataset.layerDragIndex);
  const layerNodes = [...document.querySelectorAll('#graph-tab .execution-graph-layer[data-layer-index]')];
  if (layerNodes.length < 2) {
    return false;
  }
  const pair = index >= layerNodes.length - 1
    ? { leftIndex: layerNodes.length - 2, rightIndex: layerNodes.length - 1, anchor: 'right' }
    : { leftIndex: index, rightIndex: index + 1, anchor: 'left' };
  const leftLayer = layerNodes[pair.leftIndex];
  const rightLayer = layerNodes[pair.rightIndex];
  if (!leftLayer || !rightLayer) {
    return false;
  }
  state.activeGraphLayerDrag = {
    label,
    pointerId: event.pointerId,
    leftIndex: pair.leftIndex,
    rightIndex: pair.rightIndex,
    anchor: pair.anchor,
    startX: event.clientX,
    leftWidth: leftLayer.getBoundingClientRect().width,
    rightWidth: rightLayer.getBoundingClientRect().width,
  };
  label.classList.add('dragging');
  document.body.classList.add('is-resizing');
  state.graphManualLayerLayouts.add(graphRequestLayoutKey());
  event.preventDefault();
  return true;
}

function updateGraphLayerDrag(event) {
  const drag = state.activeGraphLayerDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }
  const totalWidth = drag.leftWidth + drag.rightWidth;
  const rawDeltaX = event.clientX - drag.startX;
  const deltaX = drag.anchor === 'right' ? -rawDeltaX : rawDeltaX;
  const nextLeftWidth = Math.min(
    totalWidth - GRAPH_LAYER_MIN_WIDTH,
    Math.max(GRAPH_LAYER_MIN_WIDTH, drag.leftWidth + deltaX),
  );
  const nextRightWidth = totalWidth - nextLeftWidth;
  const layerNodes = [...document.querySelectorAll('#graph-tab .execution-graph-layer[data-layer-index]')];
  const widths = layerNodes.map((_, index) => getGraphLayerWidth(index) ?? GRAPH_LAYER_MIN_WIDTH);
  widths[drag.leftIndex] = nextLeftWidth;
  widths[drag.rightIndex] = nextRightWidth;
  setGraphLayerWidths(widths);
  applyGraphLayerWidths();
  requestAnimationFrame(drawGraphEdges);
}

function stopGraphLayerDrag(event) {
  const drag = state.activeGraphLayerDrag;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }
  drag.label.classList.remove('dragging');
  document.body.classList.remove('is-resizing');
  state.activeGraphLayerDrag = null;
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
    if (details.synthetic_kind === 'initial_planning') {
      return `
        <div class="stack">
          <div class="inset-card stack compact">
            <h4>Workflow role</h4>
            <pre>${escapeHtml(JSON.stringify({
              role: node.workflow_role,
              status: node.status,
              layer: node.topological_level,
            }, null, 2))}</pre>
          </div>
          <div class="inset-card stack compact">
            <h4>Accepted plan</h4>
            <pre>${escapeHtml(details.planning?.planned_declarations || '; Planning did not accept a graph.')}</pre>
          </div>
        </div>
      `;
    }
    if (details.synthetic_kind === 'request_final') {
      return `
        <div class="stack">
          <div class="inset-card stack compact">
            <h4>Workflow role</h4>
            <pre>${escapeHtml(JSON.stringify({
              role: node.workflow_role,
              status: node.status,
              layer: node.topological_level,
            }, null, 2))}</pre>
          </div>
          <div class="inset-card stack compact">
            <h4>Final response</h4>
            <pre>${escapeHtml(stringify(details.response))}</pre>
          </div>
        </div>
      `;
    }
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
    if (details.synthetic_kind === 'initial_planning') {
      return `
        <div class="stack">
          <div class="inset-card stack compact">
            <h4>Request metadata</h4>
            <pre>${escapeHtml(JSON.stringify(contextSections.request_metadata || {}, null, 2))}</pre>
          </div>
          <div class="inset-card stack compact">
            <h4>Planning retrieval</h4>
            <pre>${escapeHtml(JSON.stringify(details.planning?.knowledge_retrieval || {}, null, 2))}</pre>
          </div>
          <div class="inset-card stack compact">
            <h4>Graph snapshot</h4>
            <pre>${escapeHtml(JSON.stringify({
              graph_snapshot: details.planning?.graph_snapshot || null,
              graph_snapshot_error: details.planning?.graph_snapshot_error || null,
            }, null, 2))}</pre>
          </div>
        </div>
      `;
    }
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
    if (details.synthetic_kind === 'initial_planning') {
      return `
        <div class="stack">
          <div class="inset-card stack compact">
            <h4>Planning outcome</h4>
            <pre>${escapeHtml(JSON.stringify({
              outcome: details.planning?.outcome ?? null,
              accepted_actions: details.planning?.accepted_actions ?? [],
              rejected_actions: details.planning?.rejected_actions ?? [],
              required_prompt_group: details.planning?.required_prompt_group ?? null,
            }, null, 2))}</pre>
          </div>
          <div class="inset-card stack compact">
            <h4>Attempts</h4>
            <pre>${escapeHtml(JSON.stringify(details.planning?.attempts ?? [], null, 2))}</pre>
          </div>
          <div class="inset-card stack compact">
            <h4>Raw planning events</h4>
            <pre>${escapeHtml(JSON.stringify(details.outputs || [], null, 2))}</pre>
          </div>
        </div>
      `;
    }
    if (details.synthetic_kind === 'request_final') {
      return `
        <div class="stack">
          <div class="inset-card stack compact">
            <h4>Final outcome</h4>
            <pre>${escapeHtml(JSON.stringify(details.outcome || {}, null, 2))}</pre>
          </div>
          <div class="inset-card stack compact">
            <h4>Raw final events</h4>
            <pre>${escapeHtml(JSON.stringify(details.outputs || [], null, 2))}</pre>
          </div>
        </div>
      `;
    }
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
  const headingMain = node.workflow_role === 'start'
    ? 'Workflow start'
    : node.workflow_role === 'final'
      ? 'Workflow final'
      : `@${node.target_family}`;
  el('node-modal-heading').innerHTML = `
    <span class="node-modal-heading-main">${escapeHtml(headingMain)}</span>
    <span class="node-modal-heading-command">${escapeHtml((node.commands || []).join(', ') || 'No command')}</span>
    <span class="badge ${statusClass(node.status)}">${escapeHtml(humanizeStatus(node.status))}</span>
    <span class="badge">layer ${escapeHtml(String(node.topological_level ?? 0))}</span>
    ${node.workflow_role ? `<span class="badge">${escapeHtml(`workflow ${node.workflow_role}`)}</span>` : ''}
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
              <div class="execution-graph-layer" data-layer-index="${escapeHtml(String(layer.layer))}">
                <div class="execution-graph-layer-label" data-layer-drag-index="${escapeHtml(String(layer.layer))}" title="Drag to resize this layer column">Layer ${layer.layer}</div>
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
                        <span class="execution-graph-node-family">${escapeHtml(truncateNodeLabel(node.target_family, GRAPH_NODE_FAMILY_LABEL_LENGTH))}</span>
                        <span class="execution-graph-node-command">${escapeHtml(truncateNodeLabel((node.commands || []).join(', '), GRAPH_NODE_COMMAND_LABEL_LENGTH))}</span>
                        ${node.workflow_role ? `<span class="execution-graph-node-note">${escapeHtml(`workflow ${node.workflow_role}`)}</span>` : ''}
                        ${node.status_reason ? `<span class="execution-graph-node-note">${escapeHtml(truncateNodeLabel(node.status_reason, GRAPH_NODE_NOTE_LABEL_LENGTH))}</span>` : ''}
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

  applyGraphLayerWidths({ forceAuto: !state.graphManualLayerLayouts.has(graphRequestLayoutKey()) });
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
        applyGraphLayerWidths({ forceAuto: !state.graphManualLayerLayouts.has(graphRequestLayoutKey()) });
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
  renderErrors();
  renderGraph();
}

function attachHandlers() {
  renderTabs();
  el('timeline').addEventListener('click', (event) => {
    const button = event.target.closest('[data-request-id]');
    if (!button) {
      return;
    }
    loadTraceability(button.dataset.requestId).catch((error) => reportClientError(error, 'traceability.load-request'));
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
  el('graph-tab').addEventListener('pointerdown', (event) => {
    startGraphLayerDrag(event);
  });
  window.addEventListener('pointermove', (event) => {
    updateGraphLayerDrag(event);
  });
  window.addEventListener('pointerup', (event) => {
    stopGraphLayerDrag(event);
  });
  window.addEventListener('pointercancel', (event) => {
    stopGraphLayerDrag(event);
  });
  window.addEventListener('resize', () => {
    if (!state.graphManualLayerLayouts.has(graphRequestLayoutKey())) {
      applyGraphLayerWidths({ forceAuto: true });
    }
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

init().catch((error) => reportClientError(error, 'traceability.init'));

import http from 'node:http';
import path from 'node:path';
import { createRuntime, compileGraph, KbStore, MRPVM, listAchillesModels } from '../src/index.mjs';
import { parseUrl, json, html, text, notFound, badRequest, forbidden, unauthorized, readJsonBody, readRequestBody, parseMultipart, startSse, writeSseEvent } from './http-helpers.mjs';
import { loadPublicAsset, loadTemplate } from './asset-loader.mjs';
import { AuthStore } from './auth-store.mjs';

function parsePathname(pathname) {
  return pathname.split('/').filter(Boolean);
}

function getCallerRole(callerContext) {
  if (callerContext.apiKey?.role) {
    return callerContext.apiKey.role;
  }
  if (callerContext.callerSession?.effective_role) {
    return callerContext.callerSession.effective_role;
  }
  if (callerContext.callerSession?.is_admin) {
    return 'admin';
  }
  return 'anonymous';
}

function getCallerIdentity(callerContext) {
  return (callerContext.apiKey ? `api_key:${callerContext.apiKey.id}` : null)
    ?? callerContext.callerSession?.owner_identity
    ?? null;
}

function isAdminCaller(callerContext) {
  return getCallerRole(callerContext) === 'admin';
}

function summarizeText(value, maxLength = 180) {
  const textValue = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (textValue.length <= maxLength) {
    return textValue;
  }
  return `${textValue.slice(0, maxLength - 3)}...`;
}

function extractApiKey(request, url) {
  const headerToken = request.headers['x-api-key'];
  if (headerToken) {
    return String(headerToken);
  }
  const authorization = request.headers.authorization;
  if (authorization && authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }
  const queryToken = url?.searchParams?.get('api_key');
  if (queryToken) {
    return queryToken.trim();
  }
  return null;
}

async function resolveCallerContext(runtime, authStore, request, url) {
  const apiKey = await authStore.authenticate(extractApiKey(request, url));
  const sessionId = request.headers['x-session-id'] ?? url.searchParams.get('session_id');
  let callerSession = null;
  if (sessionId) {
    callerSession = await getKnownSession(runtime, sessionId);
  }
  return {
    apiKey,
    callerSession,
    bootstrap: await authStore.getBootstrapStatus(),
  };
}

async function getKnownSession(runtime, sessionId) {
  const existing = runtime.sessions.get(sessionId);
  if (existing) {
    return existing;
  }
  const probe = new MRPVM(runtime.rootDir, {
    runtimeConfig: runtime.runtimeConfig,
  });
  const manifest = await probe.sessionManager.loadSession(sessionId);
  if (!manifest) {
    return null;
  }
  return runtime.createSession({ sessionId });
}

function sessionAccessAllowed(callerContext, session) {
  if (!session) {
    return false;
  }
  if (isAdminCaller(callerContext)) {
    return true;
  }
  const callerIdentity = getCallerIdentity(callerContext);
  if (callerContext.apiKey) {
    return Boolean(callerIdentity && session.owner_identity && callerIdentity === session.owner_identity);
  }
  if (callerContext.bootstrap?.has_api_keys) {
    return false;
  }
  if (callerContext.callerSession?.session_id === session.session_id) {
    return true;
  }
  return Boolean(callerIdentity && callerIdentity === session.owner_identity);
}

function requireAdmin(response, callerContext, message = 'admin_required') {
  if (!isAdminCaller(callerContext)) {
    forbidden(response, message);
    return false;
  }
  return true;
}

function requireConfiguredApiKey(response, callerContext, message = 'api_key_required') {
  if (callerContext.bootstrap?.has_api_keys && !callerContext.apiKey) {
    unauthorized(response, message);
    return false;
  }
  return true;
}

async function requireSessionAccess(runtime, response, callerContext, sessionId) {
  const session = await getKnownSession(runtime, sessionId);
  if (!session) {
    notFound(response);
    return null;
  }
  if (!sessionAccessAllowed(callerContext, session)) {
    forbidden(response, 'session_access_denied');
    return null;
  }
  return session;
}

async function parseRequestPayload(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (contentType.startsWith('multipart/form-data')) {
    const boundaryMatch = /boundary=([^;]+)/i.exec(contentType);
    if (!boundaryMatch) {
      return { request: '', files: [] };
    }
    const body = await readRequestBody(request);
    const parts = parseMultipart(body, boundaryMatch[1]);
    const result = {
      request: '',
      files: [],
    };
    for (const part of parts) {
      const disposition = part.headers['content-disposition'] ?? '';
      const nameMatch = /name="([^"]+)"/.exec(disposition);
      const fileMatch = /filename="([^"]+)"/.exec(disposition);
      const name = nameMatch?.[1];
      if (fileMatch) {
        result.files.push({
          name: fileMatch[1],
          content: part.content,
        });
      } else if (name === 'request') {
        result.request = part.content;
      } else if (name === 'budgets') {
        result.budgets = JSON.parse(part.content);
      }
    }
    return result;
  }
  return readJsonBody(request);
}

function chooseRepresentative(variants = []) {
  const usable = variants.filter((variant) => !['error', 'refused', 'blocked', 'withdrawn', 'unknown'].includes(variant.meta?.status ?? 'active'));
  const source = usable.length > 0 ? usable : variants;
  if (source.length === 0) {
    return null;
  }
  return [...source].sort((left, right) => {
    const rightScore = Number(right.meta?.score ?? right.meta?.score_pct ?? 0);
    const leftScore = Number(left.meta?.score ?? left.meta?.score_pct ?? 0);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return Number(String(right.id).split(':v')[1] ?? 0) - Number(String(left.id).split(':v')[1] ?? 0);
  })[0];
}

function toVariableView(familyState = [], definitionMap = new Map()) {
  return familyState.map((family) => {
    const representative = chooseRepresentative(family.variants);
    const declaration = definitionMap.get(family.familyId) ?? null;
    return {
      family_id: family.familyId,
      status: family.familyMeta?.status ?? 'unknown',
      representative_id: representative?.id ?? null,
      active_version_id: representative?.id ?? null,
      command_name: declaration?.commands?.join(
        declaration?.declaration_kind === 'fallback'
          ? ' | '
          : declaration?.declaration_kind === 'multi_attempt'
            ? ' & '
            : ', ',
      ) ?? null,
      definition: declaration ? {
        ...declaration,
        text: declaration.body
          ? `@${declaration.target} ${declaration.commands.join(
            declaration.declaration_kind === 'fallback'
              ? ' | '
              : declaration.declaration_kind === 'multi_attempt'
                ? ' & '
                : ' ',
          )}\n${declaration.body}`
          : `@${declaration.target} ${declaration.commands.join(' ')}`,
      } : null,
      family_meta: family.familyMeta ?? {},
      current_value: representative?.value ?? representative?.rendered ?? null,
      current_meta: representative?.meta ?? {},
      variants: (family.variants ?? []).map((variant) => ({
        id: variant.id,
        value: variant.value ?? variant.rendered ?? '',
        meta: variant.meta ?? {},
        status: variant.meta?.status ?? 'active',
        score: variant.meta?.score ?? variant.meta?.score_pct ?? null,
        provenance_summary: summarizeText([
          variant.meta?.origin,
          variant.meta?.source_interpreter,
          variant.meta?.reason,
        ].filter(Boolean).join(' | '), 240),
      })),
    };
  });
}

function groupEventsByDeclaration(traceEvents = []) {
  const grouped = new Map();
  for (const event of traceEvents) {
    if (!event.declaration_id) {
      continue;
    }
    const bucket = grouped.get(event.declaration_id) ?? [];
    bucket.push(event);
    grouped.set(event.declaration_id, bucket);
  }
  return grouped;
}

function buildExecutionGraph(planText, traceEvents = []) {
  if (!planText?.trim()) {
    return {
      nodes: [],
      edges: [],
      strata: [],
    };
  }
  const graph = compileGraph(planText);
  const eventsByDeclaration = groupEventsByDeclaration(traceEvents);
  return {
    edges: graph.edges,
    strata: graph.strata.map((stratum, index) => ({
      layer: index,
      node_ids: stratum.map((node) => node.id),
    })),
    nodes: graph.nodes.map((node) => {
      const nodeEvents = eventsByDeclaration.get(node.id) ?? [];
      const contextEvent = nodeEvents.find((event) => event.event === 'context_packaged') ?? null;
      const invokedEvent = nodeEvents.find((event) => event.event === 'command_invoked' || event.event === 'interpreter_invoked') ?? null;
      const outputEvents = nodeEvents.filter((event) => ['variant_emitted', 'metadata_updated', 'failure_recorded', 'declarations_inserted'].includes(event.event));
      const firstAt = nodeEvents[0]?.created_at ?? null;
      const lastAt = nodeEvents.at(-1)?.created_at ?? null;
      const status = nodeEvents.some((event) => event.event === 'failure_recorded')
        ? 'failed'
        : outputEvents.some((event) => event.event === 'variant_emitted' || event.event === 'metadata_updated')
          ? 'completed'
          : invokedEvent
            ? 'running'
            : 'pending';
      return {
        id: node.id,
        label: `${node.targetFamily} <- ${node.declaration.commands.join(node.declaration.declaration_kind === 'fallback' ? ' | ' : node.declaration.declaration_kind === 'multi_attempt' ? ' & ' : '')}`,
        target_family: node.targetFamily,
        declaration_kind: node.declaration.declaration_kind,
        commands: node.declaration.commands,
        body: node.declaration.body,
        status,
        dependencies: node.dependencies,
        external_dependencies: node.externalDependencies,
        topological_level: node.topologicalLevel,
        epoch_ids: [...new Set(nodeEvents.map((event) => event.epoch_id).filter(Boolean))],
        details: {
          declaration_definition: {
            target: node.declaration.target,
            commands: node.declaration.commands,
            body: node.declaration.body,
            declaration_kind: node.declaration.declaration_kind,
            references: node.declaration.references,
          },
          runtime_context: contextEvent?.context_markdown ?? '',
          resolved_dependencies: contextEvent?.resolved_dependencies ?? [],
          context_package: {
            byte_count: contextEvent?.byte_counts ?? 0,
            selected_items: contextEvent?.selected_items ?? [],
            pruned_items: contextEvent?.pruned_items ?? [],
            selected_knowledge_units: contextEvent?.selected_knowledge_units ?? [],
          },
          outputs: outputEvents,
          diagnostics: nodeEvents.filter((event) => event.event === 'failure_recorded'),
          retries: Math.max(0, nodeEvents.filter((event) => event.event === 'command_invoked' || event.event === 'interpreter_invoked').length - 1),
          timing: {
            started_at: firstAt,
            finished_at: lastAt,
          },
          execution_layer: node.topologicalLevel,
          invoked_as: invokedEvent?.command_id ?? invokedEvent?.interpreter_id ?? null,
        },
      };
    }),
  };
}

async function loadKbCatalog(kbStore, sessionId = null) {
  const catalog = [
    ...(await kbStore.loadKuFiles(kbStore.getDefaultCallersDir(), 'default')),
    ...(await kbStore.loadKuFiles(kbStore.getDefaultKusDir(), 'default')),
    ...(await kbStore.loadKuFiles(kbStore.getGlobalKusDir(), 'global')),
  ];
  if (sessionId) {
    catalog.push(...await kbStore.loadKuFiles(kbStore.getSessionKusDir(sessionId), 'session'));
  }
  return catalog;
}

function decorateKbCatalog(catalog) {
  const scopeOrder = { default: 1, global: 2, session: 3 };
  const grouped = new Map();
  for (const entry of catalog) {
    const items = grouped.get(entry.kuId) ?? [];
    items.push(entry);
    grouped.set(entry.kuId, items);
  }
  return catalog.map((entry) => {
    const siblings = [...(grouped.get(entry.kuId) ?? [])].sort((left, right) => {
      if (scopeOrder[right.scope] !== scopeOrder[left.scope]) {
        return scopeOrder[right.scope] - scopeOrder[left.scope];
      }
      return Number(right.meta.rev ?? 0) - Number(left.meta.rev ?? 0);
    });
    const winner = siblings[0];
    const higherScopeSibling = siblings.find((candidate) => scopeOrder[candidate.scope] > scopeOrder[entry.scope]);
    const higherRevSibling = siblings.find((candidate) => candidate.scope === entry.scope && Number(candidate.meta.rev ?? 0) > Number(entry.meta.rev ?? 0));
    return {
      ku_id: entry.kuId,
      file_path: entry.filePath,
      scope: entry.scope,
      content: entry.content,
      source_text: entry.sourceText,
      meta: entry.meta,
      flags: {
        active: winner.filePath === entry.filePath,
        shadowed: Boolean(higherScopeSibling),
        superseded: Boolean(higherRevSibling),
        inherited_unchanged: entry.scope === 'default' && winner.filePath === entry.filePath,
      },
    };
  });
}

function filterKbCatalog(items, searchParams) {
  const scopeFilter = searchParams.get('scope');
  const typeFilter = searchParams.get('ku_type');
  const query = searchParams.get('q')?.toLowerCase().trim() ?? '';
  return items.filter((item) => !scopeFilter || item.scope === scopeFilter)
    .filter((item) => !typeFilter || item.meta.ku_type === typeFilter)
    .filter((item) => {
      if (!query) {
        return true;
      }
      const haystack = [
        item.ku_id,
        item.meta.title,
        item.meta.summary,
        item.meta.ku_type,
        item.content,
        ...(item.meta.tags ?? []),
        ...(item.meta.commands ?? []),
        ...(item.meta.interpreters ?? []),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
}

function summarizeKbCatalog(items) {
  return {
    total_ku_count: items.length,
    default_ku_count: items.filter((item) => item.scope === 'default').length,
    global_ku_count: items.filter((item) => item.scope === 'global').length,
    session_ku_count: items.filter((item) => item.scope === 'session').length,
    prompt_asset_count: items.filter((item) => item.meta.ku_type === 'prompt_asset').length,
    overridden_item_count: items.filter((item) => item.flags.shadowed || item.flags.superseded).length,
  };
}

function buildModelCandidates(runtimeConfig) {
  const uniqueModels = new Map();
  const addModel = (model, source) => {
    if (!model) {
      return;
    }
    const key = String(model);
    const current = uniqueModels.get(key) ?? {
      model: key,
      sources: [],
      heuristic_profiles: [],
    };
    current.sources.push(source);
    const lower = key.toLowerCase();
    const heuristicProfiles = new Set(current.heuristic_profiles);
    if (/fast|mini|lite|small/.test(lower)) {
      heuristicProfiles.add('fastLLM');
    }
    if (/deep|reason|max|premium|strong/.test(lower)) {
      heuristicProfiles.add('deepLLM');
      heuristicProfiles.add('plannerLLM');
    }
    if (/code|coder|codex/.test(lower)) {
      heuristicProfiles.add('codeGeneratorLLM');
    }
    if (/write|writer|doc/.test(lower)) {
      heuristicProfiles.add('writerLLM');
    }
    if (/plan|orchestr/.test(lower)) {
      heuristicProfiles.add('plannerLLM');
    }
    current.heuristic_profiles = [...heuristicProfiles];
    uniqueModels.set(key, current);
  };

  for (const [tier, model] of Object.entries(runtimeConfig.llm.modelTiers ?? {})) {
    addModel(model, `tier:${tier}`);
  }
  for (const [profile, binding] of Object.entries(runtimeConfig.llm.profileBindings ?? {})) {
    addModel(binding.model, `profile:${profile}`);
  }

  return [...uniqueModels.values()].sort((left, right) => left.model.localeCompare(right.model));
}

function normalizeModelToken(value) {
  return String(value || '').trim().toLowerCase();
}

function collectModelNames(model) {
  return [model?.id, model?.name].filter(Boolean).map((value) => String(value));
}

function collectModelTags(model) {
  return [...new Set((model?.tags ?? []).map((tag) => normalizeModelToken(tag)).filter(Boolean))];
}

function modelMatchesReference(model, reference) {
  const target = normalizeModelToken(reference);
  if (!target) {
    return false;
  }
  return collectModelNames(model).some((value) => {
    const normalized = normalizeModelToken(value);
    return normalized === target || normalized.endsWith(`/${target}`) || normalized.endsWith(`:${target}`);
  });
}

function inferHeuristicTags(reference) {
  const lower = normalizeModelToken(reference);
  const tags = [];
  if (/fast|mini|lite|small/.test(lower)) tags.push('fast');
  if (/code|coder|codex/.test(lower)) tags.push('coding');
  if (/write|writer|doc/.test(lower)) tags.push('writing');
  if (/reason|deep|think|max|strong|plan/.test(lower)) tags.push('reasoning');
  if (/plan|agent|orchestr/.test(lower)) tags.push('agentic');
  return [...new Set(tags)];
}

function resolveModelChoice(modelsList, requestedModel, preferredTags = []) {
  if (!Array.isArray(modelsList) || modelsList.length === 0) {
    return requestedModel || '';
  }
  const exact = modelsList.find((model) => modelMatchesReference(model, requestedModel));
  if (exact) {
    return exact.id;
  }
  const normalizedTags = [...new Set(preferredTags.map((tag) => normalizeModelToken(tag)).filter(Boolean))];
  if (normalizedTags.length > 0) {
    const tagged = modelsList.find((model) => normalizedTags.every((tag) => collectModelTags(model).includes(tag)));
    if (tagged) {
      return tagged.id;
    }
  }
  const heuristicTags = inferHeuristicTags(requestedModel);
  if (heuristicTags.length > 0) {
    const heuristic = modelsList.find((model) => heuristicTags.some((tag) => collectModelTags(model).includes(tag)));
    if (heuristic) {
      return heuristic.id;
    }
  }
  return modelsList[0].id;
}

function buildSystemContext(callerContext) {
  return {
    role: getCallerRole(callerContext),
    session_origin: callerContext.callerSession?.session_origin ?? null,
    auth_mode: callerContext.apiKey ? 'api_key' : (callerContext.callerSession?.auth_mode ?? 'anonymous'),
    owner_identity: getCallerIdentity(callerContext),
    can_edit_global_state: isAdminCaller(callerContext),
  };
}

function createInterpreterSnapshot(runtime) {
  const existingHandle = runtime.sessions.values().next().value;
  if (existingHandle) {
    return existingHandle.executor.externalInterpreters.listContracts();
  }
  const probe = new MRPVM(runtime.rootDir, {
    runtimeConfig: runtime.runtimeConfig,
  });
  return probe.externalInterpreters.listContracts();
}

async function buildConfigView(runtime, policies, authStore, callerContext) {
  const config = runtime.runtimeConfig;
  const interpreters = createInterpreterSnapshot(runtime);
  return {
    llm_adapter: config.llm.adapter,
    default_llm: config.llm.defaultModel,
    interpreter_mappings: Object.fromEntries(
      Object.entries(config.llm.profileBindings).map(([profile, binding]) => [profile, binding.model]),
    ),
    model_tiers: config.llm.modelTiers,
    profile_bindings: config.llm.profileBindings,
    interpreter_states: Object.fromEntries(interpreters.map((entry) => [entry.name, entry.enabled])),
    interpreters: interpreters.map((entry) => ({
      name: entry.name,
      purpose: entry.purpose,
      uses_llm_adapter: entry.uses_llm_adapter,
      cost_class: entry.cost_class,
      enabled: entry.enabled,
      assigned_model_role: entry.name,
    })),
    model_candidates: buildModelCandidates(config),
    model_selection_heuristics: 'Model candidates are populated from AchillesAgentLib when available. Tag filters apply directly to that catalog.',
    policies,
    auth: await authStore.getBootstrapStatus(),
    system_context: buildSystemContext(callerContext),
  };
}

function applyConfigPatch(runtime, policies, patch = {}) {
  if (patch.default_llm) {
    runtime.runtimeConfig.llm.defaultModel = patch.default_llm;
  }
  if (patch.interpreter_mappings) {
    for (const [profile, model] of Object.entries(patch.interpreter_mappings)) {
      const current = runtime.runtimeConfig.llm.profileBindings[profile] ?? { tier: 'standard', taskTag: runtime.runtimeConfig.llm.taskTags.orchestration };
      runtime.runtimeConfig.llm.profileBindings[profile] = {
        ...current,
        model,
      };
    }
  }
  if (patch.model_tiers) {
    Object.assign(runtime.runtimeConfig.llm.modelTiers, patch.model_tiers);
  }
  if (patch.task_tags) {
    Object.assign(runtime.runtimeConfig.llm.taskTags, patch.task_tags);
  }
  if (patch.profile_bindings) {
    for (const [profile, binding] of Object.entries(patch.profile_bindings)) {
      runtime.runtimeConfig.llm.profileBindings[profile] = {
        ...(runtime.runtimeConfig.llm.profileBindings[profile] ?? {}),
        ...binding,
      };
    }
  }
  if (patch.interpreters) {
    runtime.runtimeConfig.interpreterStates = {
      ...(runtime.runtimeConfig.interpreterStates ?? {}),
    };
    for (const [name, config] of Object.entries(patch.interpreters)) {
      runtime.runtimeConfig.interpreterStates[name] = Boolean(config.enabled);
      for (const handle of runtime.sessions.values()) {
        if (handle.executor.externalInterpreters.has(name)) {
          handle.executor.externalInterpreters.setEnabled(name, config.enabled);
        }
      }
    }
  }
  if (patch.policies) {
    Object.assign(policies, patch.policies);
  }
}

async function servePage(response, templateName) {
  html(response, 200, await loadTemplate(templateName));
}

function buildSessionSummaries(sessions) {
  return sessions.map((session) => ({
    session_id: session.session_id,
    policy_profile: session.policy_profile,
    is_admin: session.is_admin,
    effective_role: session.effective_role ?? (session.is_admin ? 'admin' : 'user'),
    session_origin: session.session_origin ?? 'client',
    auth_mode: session.auth_mode ?? (session.is_admin ? 'bootstrap_admin' : 'anonymous'),
    owner_identity: session.owner_identity ?? null,
    auth_key_id: session.auth_key_id ?? null,
    active_request_id: session.active_request_id ?? null,
    last_activity_at: session.last_activity_at ?? session.updated_at ?? session.created_at ?? null,
    status: session.status ?? (session.active_request_id ? 'active' : 'idle'),
    created_at: session.created_at ?? null,
  }));
}

async function buildTraceabilityPayload(runtime, session, requestId) {
  const [sessionDetails, requestDetails, traceEvents] = await Promise.all([
    runtime.inspectSession(session),
    session.executor.inspectRequestPublic(requestId),
    session.executor.getTraceEvents(requestId),
  ]);
  const executionGraph = buildExecutionGraph(requestDetails?.plan_snapshot ?? '', traceEvents);
  const definitionMap = new Map((executionGraph.nodes ?? []).map((node) => [
    node.target_family,
    node.details?.declaration_definition,
  ]));
  const variables = toVariableView(requestDetails?.family_state ?? [], definitionMap);
  return {
    session_id: session.session_id,
    request_id: requestId,
    selected_request: {
      request_id: requestId,
      status: requestDetails?.outcome?.stop_reason ?? requestDetails?.status ?? 'unknown',
      request_text: requestDetails?.request_text ?? requestDetails?.envelope?.user_text ?? '',
      response: requestDetails?.outcome?.response ?? null,
      outcome: requestDetails?.outcome ?? null,
      created_at: requestDetails?.envelope?.created_at ?? requestDetails?.outcome?.created_at ?? null,
    },
    timeline: (sessionDetails.request_history ?? []).map((item) => ({
      request_id: item.request_id,
      status: item.stop_reason ?? item.status ?? 'unknown',
      last_activity_at: item.created_at ?? null,
      request_preview: summarizeText(item.request_text, 120),
      response_preview: summarizeText(item.response, 140),
    })),
    sop_lang: requestDetails?.plan_snapshot ?? '',
    variables,
    execution_graph: executionGraph,
    trace_events: traceEvents,
  };
}

export function createServer(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const runtimeOptions = {
    ...(options.runtimeOptions ?? {}),
  };
  if (options.allowFakeLlm && !runtimeOptions.runtimeConfig && !runtimeOptions.llmAdapter) {
    runtimeOptions.manualOverrides = {
      ...(runtimeOptions.manualOverrides ?? {}),
      forceFakeLlm: true,
    };
  }
  const runtime = options.runtime ?? createRuntime({
    rootDir,
    ...runtimeOptions,
  });
  if (!options.allowFakeLlm && runtime.runtimeConfig?.llm?.adapter === 'fake') {
    throw new Error('Fake LLM adapter is disabled for the server runtime. Install AchillesAgentLib or provide a managed llmAdapter.');
  }
  if (!options.allowFakeLlm && !runtime.runtimeConfig?.dependencies?.achillesAgentLib && !runtimeOptions.llmAdapter) {
    throw new Error('AchillesAgentLib could not be resolved for the server runtime. Install it in the project root, a parent directory, or node_modules.');
  }
  const kbStore = new KbStore(rootDir);
  const authStore = new AuthStore(rootDir);
  const policies = {
    allow_session_ku_promotion: false,
    enable_cross_request_analytic_memory: true,
    ...(options.policies ?? {}),
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = parseUrl(request);
      const parts = parsePathname(url.pathname);
      const callerContext = await resolveCallerContext(runtime, authStore, request, url);

      if (url.pathname === '/' || (request.method === 'GET' && url.pathname === '/chat')) {
        await servePage(response, 'chat.html');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/traceability') {
        await servePage(response, 'traceability.html');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/kb-browser') {
        await servePage(response, 'kb-browser.html');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/settings') {
        await servePage(response, 'settings.html');
        return;
      }
      if (request.method === 'GET' && parts[0] === 'assets' && parts.length >= 2) {
        const asset = await loadPublicAsset(parts.slice(1).join('/'));
        if (!asset) {
          notFound(response);
          return;
        }
        text(response, 200, asset.body, asset.contentType);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/auth/context') {
        json(response, 200, {
          bootstrap: callerContext.bootstrap,
          caller: {
            role: getCallerRole(callerContext),
            api_key_id: callerContext.apiKey?.id ?? callerContext.callerSession?.auth_key_id ?? null,
            session_id: callerContext.callerSession?.session_id ?? null,
            session_origin: callerContext.callerSession?.session_origin ?? null,
            auth_mode: callerContext.apiKey ? 'api_key' : (callerContext.callerSession?.auth_mode ?? 'anonymous'),
            owner_identity: getCallerIdentity(callerContext),
            api_key_required: Boolean(callerContext.bootstrap?.has_api_keys),
          },
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/bootstrap-key') {
        const status = await authStore.getBootstrapStatus();
        if (status.has_api_keys) {
          forbidden(response, 'bootstrap_complete');
          return;
        }
        const body = await readJsonBody(request);
        const created = await authStore.createBootstrapAdminKey({
          label: body.label,
          sessionId: callerContext.callerSession?.session_id ?? null,
          createdBy: callerContext.callerSession?.session_id ?? 'bootstrap',
        });
        json(response, 201, {
          api_key: created.token,
          record: {
            id: created.record.id,
            label: created.record.label,
            role: created.record.role,
            status: created.record.status,
            token_prefix: created.record.token_prefix,
            created_at: created.record.created_at,
          },
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/auth/keys') {
        if (!requireAdmin(response, callerContext)) {
          return;
        }
        const keys = await authStore.listKeys();
        json(response, 200, {
          items: keys.map((entry) => ({
            id: entry.id,
            label: entry.label,
            role: entry.role,
            status: entry.status,
            token_prefix: entry.token_prefix,
            created_at: entry.created_at,
            created_by: entry.created_by,
            last_used_at: entry.last_used_at,
            revoked_at: entry.revoked_at ?? null,
          })),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/keys') {
        if (!requireAdmin(response, callerContext)) {
          return;
        }
        const body = await readJsonBody(request);
        const created = await authStore.createApiKey({
          label: body.label,
          role: body.role,
          createdBy: callerContext.callerSession?.session_id ?? callerContext.apiKey?.id ?? 'admin',
        });
        json(response, 201, {
          api_key: created.token,
          record: {
            id: created.record.id,
            label: created.record.label,
            role: created.record.role,
            status: created.record.status,
            token_prefix: created.record.token_prefix,
            created_at: created.record.created_at,
          },
        });
        return;
      }

      if (request.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'auth' && parts[2] === 'keys' && parts.length === 4) {
        if (!requireAdmin(response, callerContext)) {
          return;
        }
        const record = await authStore.revokeApiKey(parts[3]);
        json(response, 200, { record });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/sessions') {
        if (!requireConfiguredApiKey(response, callerContext)) {
          return;
        }
        const body = await readJsonBody(request);
        const sessionId = body.session_id ?? runtime.tools.createId('session');
        let effectiveRole = callerContext.apiKey?.role ?? 'user';
        let authMode = callerContext.apiKey ? 'api_key' : 'anonymous';
        let ownerIdentity = callerContext.apiKey ? `api_key:${callerContext.apiKey.id}` : null;
        let authKeyId = callerContext.apiKey?.id ?? null;

        if (!callerContext.apiKey && body.session_origin !== 'internal' && await authStore.claimBootstrapAdmin(sessionId)) {
          effectiveRole = 'admin';
          authMode = 'bootstrap_admin';
          ownerIdentity = 'bootstrap-admin';
        }

        const session = await runtime.createSession({
          sessionId,
          policyProfile: body.policy_profile ?? 'default',
          effectiveRole,
          isAdmin: effectiveRole === 'admin',
          sessionOrigin: body.session_origin ?? 'client',
          authMode,
          ownerIdentity,
          authKeyId,
        });
        json(response, 201, {
          session_id: session.session_id,
          policy_profile: session.policy_profile,
          is_admin: session.is_admin,
          effective_role: session.effective_role,
          session_origin: session.session_origin,
          auth_mode: session.auth_mode,
          owner_identity: session.owner_identity,
          auth_key_id: session.auth_key_id,
          bootstrap: await authStore.getBootstrapStatus(),
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/sessions') {
        const sessions = buildSessionSummaries(await runtime.listSessions());
        const filtered = sessions.filter((session) => sessionAccessAllowed(callerContext, session));
        json(response, 200, { sessions: filtered });
        return;
      }

      if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts.length === 3) {
        const session = await requireSessionAccess(runtime, response, callerContext, parts[2]);
        if (!session) {
          return;
        }
        const details = await runtime.inspectSession(session);
        json(response, 200, {
          ...details,
          system_context: buildSystemContext(callerContext),
        });
        return;
      }

      if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'requests' && parts.length === 4) {
        const session = await requireSessionAccess(runtime, response, callerContext, parts[2]);
        if (!session) {
          return;
        }
        const payload = await parseRequestPayload(request);
        const started = await runtime.submitRequest(session, {
          requestText: payload.request ?? payload.requestText ?? '',
          files: payload.files ?? [],
          budgets: payload.budgets,
          effectiveRole: session.effective_role,
          sessionOrigin: session.session_origin,
          authMode: session.auth_mode,
          ownerIdentity: session.owner_identity,
          authKeyId: session.auth_key_id,
        });
        started.done.catch(() => {});
        json(response, 202, {
          session_id: session.session_id,
          request_id: started.request_id,
          status: 'accepted',
        });
        return;
      }

      if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'requests' && parts.length >= 5) {
        const session = await requireSessionAccess(runtime, response, callerContext, parts[2]);
        if (!session) {
          return;
        }
        const requestId = parts[4];

        if (parts.length === 5) {
          const details = await session.executor.inspectRequestPublic(requestId);
          json(response, 200, details ?? { request_id: requestId, status: 'unknown' });
          return;
        }

        if (parts[5] === 'plan') {
          const details = await session.executor.inspectRequestPublic(requestId);
          text(response, 200, details?.plan_snapshot ?? '');
          return;
        }

        if (parts[5] === 'state') {
          const details = await session.executor.inspectRequestPublic(requestId);
          json(response, 200, {
            request_id: requestId,
            family_state: details?.family_state ?? [],
          });
          return;
        }

        if (parts[5] === 'trace') {
          const events = await session.executor.getTraceEvents(requestId, {
            eventType: url.searchParams.get('event'),
          });
          json(response, 200, {
            request_id: requestId,
            events,
          });
          return;
        }

        if (parts[5] === 'traceability') {
          json(response, 200, await buildTraceabilityPayload(runtime, session, requestId));
          return;
        }

        if (parts[5] === 'stream') {
          const lastEventId = Number(request.headers['last-event-id'] ?? 0);
          startSse(response);
          const replay = session.executor.getBufferedTrace(requestId, lastEventId).length > 0
            ? session.executor.getBufferedTrace(requestId, lastEventId)
            : await session.executor.getTraceEvents(requestId, { afterEventId: lastEventId });
          for (const event of replay) {
            writeSseEvent(response, event);
          }

          const listener = (event) => {
            if (event.request_id === requestId && Number(event.event_id ?? 0) > lastEventId) {
              writeSseEvent(response, event);
            }
          };
          session.executor.onTrace(listener);
          request.on('close', () => {
            session.executor.offTrace(listener);
          });
          return;
        }
      }

      if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'kb' && parts.length === 4) {
        const session = await requireSessionAccess(runtime, response, callerContext, parts[2]);
        if (!session) {
          return;
        }
        const catalog = decorateKbCatalog(await loadKbCatalog(kbStore, session.session_id))
          .filter((item) => item.scope === 'session');
        json(response, 200, {
          session_id: session.session_id,
          items: catalog,
          summary: summarizeKbCatalog(catalog),
        });
        return;
      }

      if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'kb' && parts.length === 4) {
        const session = await requireSessionAccess(runtime, response, callerContext, parts[2]);
        if (!session) {
          return;
        }
        const body = await readJsonBody(request);
        await session.executor.kbStore.upsertSessionKu(session.session_id, {
          fileName: body.file_name,
          sopText: body.sop_text,
        });
        json(response, 201, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/kb/global') {
        const items = decorateKbCatalog(await loadKbCatalog(kbStore, null))
          .filter((item) => item.scope === 'global');
        json(response, 200, {
          items,
          summary: summarizeKbCatalog(items),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/kb/global') {
        if (!requireAdmin(response, callerContext)) {
          return;
        }
        const body = await readJsonBody(request);
        const targetPath = await kbStore.upsertGlobalKu({
          fileName: body.file_name,
          sopText: body.sop_text,
        });
        json(response, 201, {
          ok: true,
          target_path: targetPath,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/kb/catalog') {
        const requestedSessionId = url.searchParams.get('session_id');
        if (requestedSessionId) {
          const session = await requireSessionAccess(runtime, response, callerContext, requestedSessionId);
          if (!session) {
            return;
          }
        }
        const items = filterKbCatalog(
          decorateKbCatalog(await loadKbCatalog(kbStore, requestedSessionId)),
          url.searchParams,
        );
        json(response, 200, {
          items,
          summary: summarizeKbCatalog(items),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/kb/promote') {
        if (!requireAdmin(response, callerContext)) {
          return;
        }
        const body = await readJsonBody(request);
        await kbStore.promoteSessionKu(body.session_id, body.file_name, body.target_file_name);
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        json(response, 200, await buildConfigView(runtime, policies, authStore, callerContext));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/models') {
        const config = runtime.runtimeConfig;
        const achillesModels = await listAchillesModels(config);
        let modelsList = achillesModels.map((entry) => ({
          id: entry.id,
          name: entry.name,
          tier: entry.tier,
          tags: entry.tags?.length ? entry.tags : ['general'],
          is_default: false,
        }));

        if (modelsList.length === 0) {
          const allModels = new Set();
          for (const [, model] of Object.entries(config.llm.modelTiers ?? {})) {
            allModels.add(model);
          }
          for (const [, binding] of Object.entries(config.llm.profileBindings ?? {})) {
            allModels.add(binding.model);
          }
          modelsList = [...allModels].map((model) => {
            const lower = model.toLowerCase();
            const tier = /fast|mini|lite|small/.test(lower)
              ? 'fast'
              : /deep|reason|max|premium|strong/.test(lower)
                ? 'premium'
                : 'standard';
            const tags = [];
            if (/fast|mini|lite/.test(lower)) tags.push('fast');
            if (/code|coder/.test(lower)) tags.push('coding');
            if (/write|writer/.test(lower)) tags.push('writing');
            if (/reason|deep/.test(lower)) tags.push('reasoning');
            if (/plan|orchestr/.test(lower)) tags.push('agentic');
            if (tags.length === 0) tags.push('general');
            return {
              id: model,
              name: model,
              tier,
              tags,
              is_default: false,
            };
          });
        }
        const defaultModel = config.llm.defaultModel;
        const selectedDefault = resolveModelChoice(modelsList, defaultModel);
        for (const m of modelsList) {
          m.is_default = m.id === selectedDefault;
        }
        const allTags = [...new Set(modelsList.flatMap((m) => m.tags))].sort();
        const defaultTag = allTags.includes('general') ? 'general' : (allTags[0] ?? '');
        json(response, 200, {
          models: modelsList,
          available_tags: allTags,
          active_tag_filter: defaultTag,
          default_model: selectedDefault,
        });
        return;
      }

      if (request.method === 'PUT' && url.pathname === '/api/config') {
        if (!requireAdmin(response, callerContext)) {
          return;
        }
        const body = await readJsonBody(request);
        applyConfigPatch(runtime, policies, body);
        json(response, 200, await buildConfigView(runtime, policies, authStore, callerContext));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = await readJsonBody(request);
        const requestedSessionId = request.headers.session_id ?? request.headers['x-session-id'] ?? body.session_id;
        let session = null;
        if (requestedSessionId) {
          session = await requireSessionAccess(runtime, response, callerContext, requestedSessionId);
          if (!session) {
            return;
          }
        } else {
          if (!requireConfiguredApiKey(response, callerContext)) {
            return;
          }
          const sessionId = runtime.tools.createId('session');
          let effectiveRole = callerContext.apiKey?.role ?? 'user';
          let authMode = callerContext.apiKey ? 'api_key' : 'anonymous';
          let ownerIdentity = callerContext.apiKey ? `api_key:${callerContext.apiKey.id}` : null;
          let authKeyId = callerContext.apiKey?.id ?? null;
          if (!callerContext.apiKey && await authStore.claimBootstrapAdmin(sessionId)) {
            effectiveRole = 'admin';
            authMode = 'bootstrap_admin';
            ownerIdentity = 'bootstrap-admin';
          }
          session = await runtime.createSession({
            sessionId,
            sessionOrigin: 'openai_api',
            effectiveRole,
            isAdmin: effectiveRole === 'admin',
            authMode,
            ownerIdentity,
            authKeyId,
          });
        }

        const started = await runtime.submitRequest(session, {
          requestText: (body.messages ?? []).map((message) => message.content).join('\n'),
          budgets: body.budgets,
          effectiveRole: session.effective_role,
          sessionOrigin: session.session_origin,
          authMode: session.auth_mode,
          ownerIdentity: session.owner_identity,
          authKeyId: session.auth_key_id,
        });
        const outcome = await started.done;
        json(response, 200, {
          id: outcome.request_id,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: String(outcome.response ?? ''),
            },
          }],
          session_id: session.session_id,
        });
        return;
      }

      notFound(response);
    } catch (error) {
      if (error.code === 'ACTIVE_REQUEST') {
        json(response, 409, {
          error: 'active_request',
          message: error.message,
        });
        return;
      }
      if (String(error.message).includes('disabled')) {
        forbidden(response, error.message);
        return;
      }
      if (String(error.message).includes('api key')) {
        unauthorized(response, error.message);
        return;
      }
      badRequest(response, error.message);
    }
  });

  server.runtime = runtime;
  Object.defineProperty(server, 'config', {
    get() {
      return runtime.runtimeConfig;
    },
  });
  return server;
}

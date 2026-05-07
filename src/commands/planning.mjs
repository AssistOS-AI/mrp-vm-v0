import { parsePlan } from '../lang/parser.mjs';
import { compileGraph } from '../runtime/graph.mjs';
import { createEmptyEffects } from '../runtime/effects.mjs';
import { createFailureRecord, normalizeErrorLike } from '../utils/errors.mjs';

const REQUIRED_GROUPS = {
  new_session_request: 'planning_init_core',
  continuing_session_request: 'planning_continue_core',
  error_triggered_repair: 'planning_repair_core',
};

const MAX_PLANNING_ATTEMPTS = 3;

function normalizeMalformedDeclarationHeaders(text, availableRoutes = []) {
  const routes = [...new Set(availableRoutes.map((route) => String(route).trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('@') || /\s/.test(trimmed)) {
        return line;
      }
      const raw = trimmed.slice(1);
      for (const route of routes) {
        const suffix = `_${route}`;
        if (!raw.endsWith(suffix)) {
          continue;
        }
        const family = raw.slice(0, -suffix.length);
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(family)) {
          return line.replace(trimmed, `@${family} ${route}`);
        }
      }
      return line;
    })
    .join('\n');
}

function normalizeSopProposal(text, availableRoutes = []) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  const trimmed = text.trim();
  // Strip markdown code fences: ```sop_proposal ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```[a-z_]*\s*\n([\s\S]*?)```\s*$/i);
  if (fenceMatch) {
    return normalizeMalformedDeclarationHeaders(fenceMatch[1].trim(), availableRoutes);
  }
  return normalizeMalformedDeclarationHeaders(trimmed, availableRoutes);
}

function isLogicEvalBody(body) {
  const text = String(body ?? '').trim();
  if (!text) {
    return false;
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.every((line) => ['use ', 'when ', 'and ', 'or ', 'then '].some((prefix) => line.startsWith(prefix)))) {
    return true;
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }
  const lower = text.toLowerCase();
  const narrativeBlockers = [
    'in prose',
    'write a memo',
    'draft the response',
    'explain why',
    'polished prose',
    'leadership summary',
    'operator announcement',
    'external update',
  ];
  if (narrativeBlockers.some((entry) => lower.includes(entry))) {
    return false;
  }
  const solverCues = [
    'solve',
    'determine',
    'check whether',
    'find path',
    'shortest path',
    'reachable',
    'topological',
    'graph',
    'constraint',
    'domain',
    'assignment',
    'search',
    'state',
    'goal',
    'minimal sequence',
    'derive',
    'fact',
    'rule',
    'numeric',
    'interval',
    'bounded',
  ];
  return solverCues.some((entry) => lower.includes(entry));
}

function isJavaScriptBody(body) {
  const source = String(body ?? '').trim();
  if (!source) {
    return false;
  }
  const normalized = source
    .replace(/\$[A-Za-z_][A-Za-z0-9_:]*/g, '__sop_values.__value')
    .replace(/~[A-Za-z_][A-Za-z0-9_:]*/g, '__sop_refs.__value');
  try {
    // Validate syntax only; execution happens later inside js-eval.
    // eslint-disable-next-line no-new-func
    new Function(`return (async () => {\n${normalized}\n})();`);
    const definedNames = new Set([
      ...source.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g),
      ...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g),
    ].map((match) => match[1]));
    const allowedCalls = new Set([
      'if',
      'for',
      'while',
      'switch',
      'catch',
      'Math',
      'JSON',
      'Number',
      'String',
      'Boolean',
      'Array',
      'Object',
      'Set',
      'Map',
      'Date',
      'RegExp',
      'parseInt',
      'parseFloat',
      'isNaN',
      'isFinite',
    ]);
    for (const match of source.matchAll(/(^|[^.\w$])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const name = match[2];
      if (allowedCalls.has(name) || definedNames.has(name) || name === 'sop') {
        continue;
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isTemplateEvalBody(body) {
  const trimmed = String(body ?? '').trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('{')) {
    const lower = trimmed.toLowerCase();
    if (lower.includes('"description"') || lower.includes('"input"') || lower.includes('"logic"')
      || lower.includes('"response_format"') || lower.includes('"final_output"') || lower.includes('"body"')) {
      return false;
    }
  }
  if (/^(compose|generate|provide|create)\b/i.test(trimmed) && !trimmed.includes('$')) {
    return false;
  }
  return true;
}

function templateNeedsStructuredDependencies(body) {
  const text = String(body ?? '');
  return /\{\{#each\b/.test(text)
    || /\$[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_]+/.test(text)
    || /\$\{[A-Za-z_][A-Za-z0-9_]*\.[^}]+\}/.test(text);
}

function pickNarrativeFallback(enabledInterpreters) {
  return ['writerLLM', 'deepLLM', 'fastLLM'].find((name) => enabledInterpreters.includes(name)) ?? null;
}

function pickReasoningFallback(enabledInterpreters) {
  return ['deepLLM', 'writerLLM', 'fastLLM'].find((name) => enabledInterpreters.includes(name)) ?? null;
}

function normalizeDeclaration(declaration, enabledInterpreters) {
  if (declaration.declaration_kind !== 'single') {
    return declaration;
  }
  const commandName = declaration.commands[0];
  if (commandName === 'logic-eval' && !isLogicEvalBody(declaration.body)) {
    const fallback = pickNarrativeFallback(enabledInterpreters);
    if (!fallback) {
      return declaration;
    }
    return {
      ...declaration,
      commands: [fallback],
    };
  }
  if (commandName === 'js-eval' && !isJavaScriptBody(declaration.body)) {
    const fallback = pickReasoningFallback(enabledInterpreters);
    if (!fallback) {
      return declaration;
    }
    return {
      ...declaration,
      commands: [fallback],
    };
  }
  if (commandName === 'template-eval' && !isTemplateEvalBody(declaration.body)) {
    const fallback = pickNarrativeFallback(enabledInterpreters);
    if (!fallback) {
      return declaration;
    }
    return {
      ...declaration,
      commands: [fallback],
    };
  }
  return declaration;
}

function normalizeDeclarations(declarations, nativeCommands, enabledInterpreters) {
  const normalized = declarations.map((declaration) => normalizeDeclaration(declaration, enabledInterpreters));
  const producerByFamily = new Map(normalized.map((declaration) => [declaration.target, declaration.commands[0]]));
  const safeStructuredProducers = new Set(['js-eval', 'analytic-memory', 'logic-eval', 'kb']);
  return normalized.map((declaration) => {
    if (declaration.declaration_kind !== 'single' || declaration.commands[0] !== 'template-eval') {
      return declaration;
    }
    if (!templateNeedsStructuredDependencies(declaration.body)) {
      return declaration;
    }
    const unsafeStructuredRef = declaration.references.some((reference) => {
      const producer = producerByFamily.get(reference.family);
      return producer && !safeStructuredProducers.has(producer);
    });
    if (!unsafeStructuredRef) {
      return declaration;
    }
    const fallback = pickNarrativeFallback(enabledInterpreters);
    if (!fallback) {
      return declaration;
    }
    return {
      ...declaration,
      commands: [fallback],
    };
  });
}

function renderPlan(parsed) {
  return parsed.declarations.map((declaration) => {
    const separator = declaration.declaration_kind === 'fallback'
      ? ' | '
      : declaration.declaration_kind === 'multi_attempt'
        ? ' & '
        : ' ';
    const header = `@${declaration.target} ${declaration.commands.join(separator)}`;
    return declaration.body
      ? `${header}\n${declaration.body}`
      : header;
  }).join('\n\n').trim();
}

function createDeclarationReference(target) {
  return {
    kind: '$',
    family: target,
    variant: null,
    raw: `$${target}`,
  };
}

function reindexDeclarations(declarations) {
  return declarations.map((declaration, index) => ({
    ...declaration,
    declaration_id: `decl-${String(index + 1).padStart(4, '0')}`,
  }));
}

function createUniqueResponsePreparationTarget(declarations, preferredTarget = 'response_prepared') {
  const takenTargets = new Set(declarations.map((declaration) => declaration.target));
  let candidate = preferredTarget;
  let suffix = 2;
  while (takenTargets.has(candidate) || candidate === 'response') {
    candidate = `${preferredTarget}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function usesNarrativeRoute(routeName) {
  return ['writerLLM', 'deepLLM', 'fastLLM'].includes(routeName);
}

function usesPreparationRoute(routeName) {
  return routeName === 'template-eval' || usesNarrativeRoute(routeName);
}

function isSimpleReferenceOnlyBody(body) {
  return /^\s*\$[A-Za-z_][A-Za-z0-9_:]*\s*$/.test(String(body ?? ''))
    || /^\s*\$\{[A-Za-z_][A-Za-z0-9_:]*\}\s*$/.test(String(body ?? ''));
}

function requestLikelyNeedsStructuredWorkflow(requestText) {
  const lower = String(requestText ?? '').toLowerCase().trim();
  if (!lower) {
    return true;
  }
  const structuralCues = [
    'step',
    'steps',
    'pas',
    'pasi',
    'section',
    'sections',
    'format',
    'formatted',
    'structure',
    'structured',
    'template',
    'explain',
    'why',
    'conclusion',
    'summary',
    'plan',
    'checklist',
    'table',
    'compare',
    'json',
    'markdown',
  ];
  return structuralCues.some((cue) => lower.includes(cue)) || lower.split(/\s+/).length >= 12;
}

function ensureResponseDeclaration(declarations, nativeCommands, enabledInterpreters) {
  if (declarations.some((declaration) => declaration.target === 'response')) {
    return declarations;
  }
  const lastTarget = declarations.at(-1)?.target;
  if (!lastTarget) {
    return declarations;
  }
  if (nativeCommands.includes('template-eval')) {
    return declarations.concat({
      declaration_id: `decl-${String(declarations.length + 1).padStart(4, '0')}`,
      target: 'response',
      declaration_kind: 'single',
      commands: ['template-eval'],
      body: `$${lastTarget}`,
      references: [{
        kind: '$',
        family: lastTarget,
        variant: null,
        raw: `$${lastTarget}`,
      }],
    });
  }
  const fallback = ['writerLLM', 'deepLLM', 'fastLLM'].find((name) => enabledInterpreters.includes(name));
  if (!fallback) {
    return declarations;
  }
  return declarations.concat({
    declaration_id: `decl-${String(declarations.length + 1).padStart(4, '0')}`,
    target: 'response',
    declaration_kind: 'single',
    commands: [fallback],
    body: `Using $${lastTarget}, produce the final user-facing answer that preserves the requested structure and conclusions.`,
    references: [createDeclarationReference(lastTarget)],
  });
}

function wrapDirectResponseDeclaration(declarations, nativeCommands) {
  if (!nativeCommands.includes('template-eval')) {
    return declarations;
  }
  const responseIndex = declarations.findIndex((declaration) => declaration.target === 'response');
  if (responseIndex === -1) {
    return declarations;
  }
  const responseDeclaration = declarations[responseIndex];
  if (responseDeclaration.declaration_kind !== 'single' || responseDeclaration.commands[0] === 'template-eval') {
    return declarations;
  }
  const responsePreparationTarget = createUniqueResponsePreparationTarget(declarations);
  const upstreamTargets = declarations
    .filter((declaration, index) => index !== responseIndex && declaration.target !== 'response')
    .map((declaration) => declaration.target);
  let wrappedDeclaration = {
    ...responseDeclaration,
    target: responsePreparationTarget,
  };
  if (wrappedDeclaration.references.length === 0 && upstreamTargets.length > 0 && usesNarrativeRoute(wrappedDeclaration.commands[0])) {
    const requiredTarget = upstreamTargets.at(-1);
    const guidanceLine = `Use $${requiredTarget} as a required source for the final answer.`;
    const body = String(wrappedDeclaration.body ?? '').trim();
    wrappedDeclaration = {
      ...wrappedDeclaration,
      body: body ? `${body}\n\n${guidanceLine}` : guidanceLine,
      references: [createDeclarationReference(requiredTarget)],
    };
  }
  const finalResponseDeclaration = {
    declaration_id: responseDeclaration.declaration_id,
    target: 'response',
    declaration_kind: 'single',
    commands: ['template-eval'],
    body: `$${responsePreparationTarget}`,
    references: [createDeclarationReference(responsePreparationTarget)],
  };
  const nextDeclarations = [
    ...declarations.slice(0, responseIndex),
    ...declarations.slice(responseIndex + 1),
    wrappedDeclaration,
    finalResponseDeclaration,
  ];
  return reindexDeclarations(nextDeclarations);
}

function ensureResponseIsFinal(declarations) {
  const responseIndex = declarations.findIndex((declaration) => declaration.target === 'response');
  if (responseIndex === -1 || responseIndex === declarations.length - 1) {
    return declarations;
  }
  const responseDeclaration = declarations[responseIndex];
  const nextDeclarations = [
    ...declarations.slice(0, responseIndex),
    ...declarations.slice(responseIndex + 1),
    responseDeclaration,
  ];
  return reindexDeclarations(nextDeclarations);
}

function appendResponseDependencies(declarations) {
  const responseIndex = declarations.findIndex((declaration) => declaration.target === 'response');
  if (responseIndex === -1) {
    return declarations;
  }
  const responseDeclaration = declarations[responseIndex];
  const upstreamTargets = declarations
    .slice(0, responseIndex)
    .map((declaration) => declaration.target)
    .filter((target) => target !== 'response');
  if (upstreamTargets.length === 0) {
    return declarations;
  }
  if (responseDeclaration.references.length > 0) {
    return declarations;
  }
  const missingTargets = [upstreamTargets.at(-1)];

  const dependencyAppendix = responseDeclaration.commands[0] === 'template-eval'
    ? missingTargets.map((target) => `$${target}`).join('\n')
    : [
      missingTargets.length === 1
        ? `Use $${missingTargets[0]} as a required source for the final answer.`
        : 'Use the following required sources in the final answer:',
      ...(missingTargets.length === 1 ? [] : missingTargets.map((target) => `- $${target}`)),
    ].join('\n');
  const body = String(responseDeclaration.body ?? '').trim();
  const updatedDeclaration = {
    ...responseDeclaration,
    body: body
      ? `${body}\n\n${dependencyAppendix}`
      : dependencyAppendix,
    references: responseDeclaration.references.concat(
      missingTargets.map((target) => createDeclarationReference(target)),
    ),
  };

  return declarations.map((declaration, index) => (index === responseIndex ? updatedDeclaration : declaration));
}

function normalizePlannedProgram(text, nativeCommands, enabledInterpreters) {
  const normalizedText = normalizeSopProposal(text, [...nativeCommands, ...enabledInterpreters]);
  try {
    const parsed = parsePlan(normalizedText);
    const normalizedDeclarations = normalizeDeclarations(parsed.declarations, nativeCommands, enabledInterpreters);
    const withResponseDeclaration = ensureResponseDeclaration(normalizedDeclarations, nativeCommands, enabledInterpreters);
    const withWrappedResponse = wrapDirectResponseDeclaration(withResponseDeclaration, nativeCommands);
    const finalizedDeclarations = ensureResponseIsFinal(
      appendResponseDependencies(withWrappedResponse),
    );
    return renderPlan({
      declarations: finalizedDeclarations,
    });
  } catch {
    return normalizedText;
  }
}

function summarizeDiagnostics(diagnostics = []) {
  return diagnostics.join(' ');
}

function buildPlanValidation(normalizedPlanText, nativeCommands = [], enabledInterpreters = [], requestText = '') {
  const diagnostics = [];
  let parsed = null;
  try {
    parsed = parsePlan(normalizedPlanText);
  } catch (error) {
    return {
      valid: false,
      parsed: null,
      graph: null,
      diagnostics: [`Planner output could not be parsed as SOP Lang: ${error.message}`],
    };
  }

  if (parsed.declarations.length === 0) {
    diagnostics.push('Planner output must contain at least one declaration.');
  }

  const targets = new Map();
  for (const declaration of parsed.declarations) {
    const nextCount = (targets.get(declaration.target) ?? 0) + 1;
    targets.set(declaration.target, nextCount);
  }
  const duplicateTargets = [...targets.entries()]
    .filter(([, count]) => count > 1)
    .map(([target]) => target);
  if (duplicateTargets.length > 0) {
    diagnostics.push(`Family ids must be unique inside one plan. Duplicate targets: ${duplicateTargets.join(', ')}.`);
  }

  const responseDeclarations = parsed.declarations.filter((declaration) => declaration.target === 'response');
  const responseDeclaration = responseDeclarations[0] ?? null;
  if (responseDeclarations.length !== 1) {
    diagnostics.push(`The plan must contain exactly one @response declaration. Found ${responseDeclarations.length}.`);
  }
  if (parsed.declarations.at(-1)?.target !== 'response') {
    diagnostics.push('The final declaration in the plan must target response.');
  }
  if (parsed.declarations.length > 1 && responseDeclarations.length === 1 && responseDeclarations[0].references.length === 0) {
    diagnostics.push('The final @response declaration must depend on at least one earlier family when the plan has intermediate declarations.');
  }
  if (responseDeclaration && nativeCommands.includes('template-eval') && responseDeclaration.commands[0] !== 'template-eval') {
    diagnostics.push('When template-eval is available, the final @response declaration must use template-eval rather than a solver or prose route directly.');
  }
  if (requestLikelyNeedsStructuredWorkflow(requestText) && nativeCommands.includes('template-eval') && parsed.declarations.length < 3) {
    diagnostics.push('Non-trivial plans should contain at least three declarations so solving or extraction, response preparation, and final template assembly remain explicit.');
  }
  if (responseDeclaration && responseDeclaration.commands[0] === 'template-eval' && requestLikelyNeedsStructuredWorkflow(requestText)) {
    const responseIndex = parsed.declarations.findIndex((declaration) => declaration.target === 'response');
    const upstreamDeclarations = parsed.declarations.slice(0, responseIndex);
    const hasPreparationStep = upstreamDeclarations.some((declaration) => usesPreparationRoute(declaration.commands[0]));
    if (!hasPreparationStep && isSimpleReferenceOnlyBody(responseDeclaration.body)) {
      diagnostics.push('Add an explicit response-preparation step before the final @response template. Do not feed a raw solver or deterministic result directly into the final response assembly.');
    }
  }

  let graph = null;
  try {
    graph = compileGraph(normalizedPlanText);
  } catch (error) {
    diagnostics.push(`Planner output produced an invalid declaration graph: ${error.message}`);
    return {
      valid: false,
      parsed,
      graph: null,
      diagnostics,
    };
  }

  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }

  const terminalNodes = graph.nodes.filter((node) => (outgoing.get(node.id)?.length ?? 0) === 0);
  if (terminalNodes.length !== 1 || terminalNodes[0]?.targetFamily !== 'response') {
    diagnostics.push('The declaration graph must converge into one final sink node named response.');
  }

  const responseNode = graph.nodes.find((node) => node.targetFamily === 'response') ?? null;
  if (responseNode) {
    const contributing = new Set();
    const queue = [responseNode.id];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (contributing.has(currentId)) {
        continue;
      }
      contributing.add(currentId);
      for (const previousId of incoming.get(currentId) ?? []) {
        queue.push(previousId);
      }
    }

    const orphanTargets = graph.nodes
      .filter((node) => !contributing.has(node.id))
      .map((node) => node.targetFamily);
    if (orphanTargets.length > 0) {
      diagnostics.push(`Every declaration must contribute to @response. Unused families: ${orphanTargets.join(', ')}.`);
    }
  }

  return {
    valid: diagnostics.length === 0,
    parsed,
    graph,
    diagnostics,
  };
}

function validatePlannedProgram(text, nativeCommands, enabledInterpreters, requestText = '') {
  const normalizedPlanText = normalizePlannedProgram(text, nativeCommands, enabledInterpreters);
  return {
    text: normalizedPlanText,
    ...buildPlanValidation(normalizedPlanText, nativeCommands, enabledInterpreters, requestText),
  };
}

function extractPlannerProposalText(adapterEffects) {
  if (adapterEffects.declarationInsertions.length > 0) {
    return String(adapterEffects.declarationInsertions[0].text ?? '');
  }
  if (adapterEffects.emittedVariants.length > 0) {
    return String(adapterEffects.emittedVariants[0].value ?? '');
  }
  return '';
}

export async function executePlanning(context) {
  const effects = createEmptyEffects();
  const planningTrace = {
    mode: context.mode,
    request_text: context.request.requestText,
    required_prompt_group: null,
    kb_summary: null,
    graph_snapshot: null,
    graph_snapshot_error: null,
    attempts: [],
    accepted_attempt: null,
    accepted_plan_text: null,
  };
  effects.planningTrace = planningTrace;
  const requiredGroup = REQUIRED_GROUPS[context.mode];
  if (!requiredGroup) {
    throw new Error(`Unknown planning mode: ${context.mode}`);
  }
  planningTrace.required_prompt_group = requiredGroup;

  const kbResult = await context.runtime.retrieveKnowledge(context.request.kbSnapshot, {
    callerName: 'planning',
    retrievalMode: 'planning_bootstrap',
    desiredKuTypes: ['prompt_asset', 'content', 'policy_asset', 'caller_profile'],
    requiredPromptGroups: [requiredGroup],
    requestText: context.request.requestText,
    domainHints: context.request.domainHints ?? [],
    byteBudget: 12_288,
  });
  planningTrace.kb_summary = {
    mode: kbResult.mode,
    selected_count: kbResult.selected.length,
    pruned_count: kbResult.pruned.length,
    selected_knowledge_units: kbResult.selected.map((entry) => ({
      ku_id: entry.kuId,
      title: entry.meta.title ?? entry.kuId,
      ku_type: entry.meta.ku_type ?? 'content',
      mandatory_group: entry.meta.mandatory_group ?? null,
      scope: entry.scope,
      usage_reference: entry.usage_reference ?? null,
      aspect_ids: entry.aspect_ids ?? [],
    })),
  };

  if (!kbResult.selected.some((entry) => entry.meta.mandatory_group === requiredGroup)) {
    effects.failure = createFailureRecord({
      kind: 'resolution_error',
      message: `Missing required planning prompt group: ${requiredGroup}`,
      origin: 'planning',
      repairable: false,
      details: {
        required_prompt_group: requiredGroup,
        kb_summary: planningTrace.kb_summary,
      },
    });
    return effects;
  }

  const nativeCommandContracts = context.runtime.commandRegistry
    .listContracts()
    .filter((contract) => contract.name !== 'planning');
  const nativeCommands = nativeCommandContracts.map((contract) => contract.name);
  const enabledInterpreterContracts = context.runtime.externalInterpreters
    .listContracts()
    .filter((contract) => contract.enabled);
  const enabledInterpreters = enabledInterpreterContracts.map((contract) => contract.name);

  const planText = context.request.planText ?? '';
  let graphSnapshot = null;
  let graphSnapshotError = null;
  if (planText.trim()) {
    try {
      const graph = compileGraph(planText);
      graphSnapshot = {
        nodes: graph.nodes.map((node) => ({
          target_family: node.targetFamily,
          commands: node.declaration.commands,
          dependencies: node.dependencies.map((dep) => dep.raw || dep.familyId),
          topological_level: node.topologicalLevel,
        })),
        edges: graph.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
        })),
        layer_count: graph.strata.length,
      };
    } catch (error) {
      graphSnapshotError = error instanceof Error ? error.message : String(error);
    }
  }
  planningTrace.graph_snapshot = graphSnapshot;
  planningTrace.graph_snapshot_error = graphSnapshotError;
  const attemptHistory = [];

  for (let attempt = 1; attempt <= MAX_PLANNING_ATTEMPTS; attempt += 1) {
    const lastAttempt = attemptHistory.at(-1) ?? null;
    const adapterEffects = await context.runtime.externalInterpreters.invoke('plannerLLM', {
      body: context.request.requestText,
      targetFamily: context.targetFamily,
      promptAssets: kbResult.selected,
      expectedOutputMode: 'sop_proposal',
      traceContext: {
        session_id: context.sessionId,
        request_id: context.requestId,
        epoch_id: context.epochNumber,
        mode: context.mode,
        planning_attempt: attempt,
      },
      contextPackage: {
        markdown: JSON.stringify({
          mode: context.mode,
          trigger_reason: context.mode,
          current_plan: (lastAttempt?.text ?? planText) || null,
          request_text: context.request.requestText,
          file_descriptors: context.request.files ?? [],
          session_summary: context.request.sessionSummary ?? {},
          family_state_summary: context.runtime.stateStore.listFamilies(),
          budgets: context.request.budgets,
          planning_notes: [
            ...(context.request.planningNotes ?? []),
            ...attemptHistory.map((entry, index) => `Attempt ${index + 1} rejected: ${summarizeDiagnostics(entry.diagnostics)}`),
          ],
          plan_validation_feedback: lastAttempt?.diagnostics ?? [],
          planning_attempt: attempt,
          planning_attempt_limit: MAX_PLANNING_ATTEMPTS,
          available_commands: {
            native: nativeCommands,
            interpreters: enabledInterpreters,
          },
          available_component_catalog: {
            native_commands: nativeCommandContracts.map((contract) => ({
              name: contract.name,
              purpose: contract.purpose ?? null,
              input_contract: contract.input_contract ?? [],
              output_shapes: contract.output_shapes ?? [],
              deterministic: contract.deterministic ?? false,
              category: contract.category ?? 'native_command',
            })),
            interpreters: enabledInterpreterContracts.map((contract) => ({
              name: contract.name,
              purpose: contract.purpose ?? contract.name,
              input_contract: contract.input_contract ?? [],
              output_shapes: contract.output_shapes ?? [],
              cost_class: contract.cost_class ?? 'normal',
              capability_profile: contract.capability_profile ?? null,
              can_insert_declarations: contract.can_insert_declarations ?? false,
              enabled: contract.enabled ?? true,
            })),
          },
          graph_snapshot: graphSnapshot,
          graph_snapshot_error: graphSnapshotError,
        }, null, 2),
      },
    });

    if (adapterEffects.failure) {
      const normalizedFailure = normalizeErrorLike(adapterEffects.failure, {
        defaultCode: 'PLANNING_ERROR',
        defaultKind: 'execution_error',
        defaultMessage: 'Planner invocation failed.',
      });
      planningTrace.attempts.push({
        attempt,
        adapter_failure: normalizedFailure,
        proposed_plan_text: '',
        normalized_plan_text: '',
        valid: false,
        diagnostics: normalizedFailure.message ? [normalizedFailure.message] : [],
      });
      adapterEffects.planningTrace = planningTrace;
      return adapterEffects;
    }

    const proposedPlanText = extractPlannerProposalText(adapterEffects);
    const validation = validatePlannedProgram(proposedPlanText, nativeCommands, enabledInterpreters, context.request.requestText);
    const attemptRecord = {
      attempt,
      proposed_plan_text: proposedPlanText,
      normalized_plan_text: validation.text,
      valid: validation.valid,
      diagnostics: validation.diagnostics,
    };
    planningTrace.attempts.push(attemptRecord);
    if (validation.valid) {
      effects.declarationInsertions.push({
        text: validation.text,
        meta: {
          source_interpreter: 'plannerLLM',
        },
      });
      planningTrace.accepted_attempt = attempt;
      planningTrace.accepted_plan_text = validation.text;
      return effects;
    }

    attemptHistory.push({
      text: validation.text,
      diagnostics: validation.diagnostics,
    });
  }

  const lastAttempt = attemptHistory.at(-1);
  effects.failure = createFailureRecord({
    kind: 'resolution_error',
    message: `Planner failed to produce a connected SOP graph after ${MAX_PLANNING_ATTEMPTS} attempts. ${summarizeDiagnostics(lastAttempt?.diagnostics ?? [])}`,
    origin: 'planning',
    repairable: true,
    details: {
      attempts: planningTrace.attempts,
      graph_snapshot: graphSnapshot,
      graph_snapshot_error: graphSnapshotError,
    },
  });
  return effects;
}

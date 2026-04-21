import { parsePlan } from '../lang/parser.mjs';
import { compileGraph } from '../runtime/graph.mjs';
import { createEmptyEffects } from '../runtime/effects.mjs';

const REQUIRED_GROUPS = {
  new_session_request: 'planning_init_core',
  continuing_session_request: 'planning_continue_core',
  error_triggered_repair: 'planning_repair_core',
};

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
  const lines = String(body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return false;
  }
  return lines.every((line) => ['use ', 'when ', 'and ', 'or ', 'then '].some((prefix) => line.startsWith(prefix)));
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
    references: [{
      kind: '$',
      family: lastTarget,
      variant: null,
      raw: `$${lastTarget}`,
    }],
  });
}

function normalizePlannedProgram(text, nativeCommands, enabledInterpreters) {
  const normalizedText = normalizeSopProposal(text, [...nativeCommands, ...enabledInterpreters]);
  try {
    const parsed = parsePlan(normalizedText);
    const normalizedDeclarations = normalizeDeclarations(parsed.declarations, nativeCommands, enabledInterpreters);
    const finalizedDeclarations = ensureResponseDeclaration(normalizedDeclarations, nativeCommands, enabledInterpreters);
    return renderPlan({
      declarations: finalizedDeclarations,
    });
  } catch {
    return normalizedText;
  }
}

export async function executePlanning(context) {
  const effects = createEmptyEffects();
  const requiredGroup = REQUIRED_GROUPS[context.mode];
  if (!requiredGroup) {
    throw new Error(`Unknown planning mode: ${context.mode}`);
  }

  const kbResult = context.runtime.kbStore.retrieve(context.request.kbSnapshot, {
    callerName: 'planning',
    retrievalMode: 'planning_bootstrap',
    desiredKuTypes: ['prompt_asset', 'content', 'policy_asset', 'caller_profile'],
    requiredPromptGroups: [requiredGroup],
    requestText: context.request.requestText,
    domainHints: context.request.domainHints ?? [],
    byteBudget: 12_288,
  });

  if (!kbResult.selected.some((entry) => entry.meta.mandatory_group === requiredGroup)) {
    effects.failure = {
      kind: 'resolution_error',
      message: `Missing required planning prompt group: ${requiredGroup}`,
      origin: 'planning',
      repairable: false,
    };
    return effects;
  }

  const nativeCommands = [...context.runtime.commandRegistry.commands.keys()].filter(
    (name) => name !== 'planning',
  );
  const enabledInterpreters = context.runtime.externalInterpreters
    .listContracts()
    .filter((contract) => contract.enabled)
    .map((contract) => contract.name);

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
    },
    contextPackage: {
      markdown: JSON.stringify({
        mode: context.mode,
        trigger_reason: context.mode,
        current_plan: planText || null,
        request_text: context.request.requestText,
        file_descriptors: context.request.files ?? [],
        session_summary: context.request.sessionSummary ?? {},
        family_state_summary: context.runtime.stateStore.listFamilies(),
        budgets: context.request.budgets,
        planning_notes: context.request.planningNotes ?? [],
        available_commands: {
          native: nativeCommands,
          interpreters: enabledInterpreters,
        },
        graph_snapshot: graphSnapshot,
        graph_snapshot_error: graphSnapshotError,
      }, null, 2),
    },
  });

  if (adapterEffects.failure) {
    return adapterEffects;
  }

  if (adapterEffects.declarationInsertions.length > 0) {
    effects.declarationInsertions.push(
        ...adapterEffects.declarationInsertions.map((insertion) => ({
          ...insertion,
          text: normalizePlannedProgram(insertion.text, nativeCommands, enabledInterpreters),
        })),
      );
      return effects;
  }

  if (adapterEffects.emittedVariants.length > 0) {
    effects.declarationInsertions.push({
      text: normalizePlannedProgram(String(adapterEffects.emittedVariants[0].value), nativeCommands, enabledInterpreters),
      meta: {
        source_interpreter: 'plannerLLM',
      },
    });
  }

  return effects;
}

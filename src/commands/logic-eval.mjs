import { createEmptyEffects } from '../runtime/effects.mjs';
import { createFailureRecord } from '../utils/errors.mjs';
import { canonicalText } from '../utils/text.mjs';

const LLM_WRAPPER_PROFILES = new Set([
  'fastLLM',
  'deepLLM',
  'codeGeneratorLLM',
  'writerLLM',
  'plannerLLM',
]);

function parseBodyJson(body) {
  const trimmed = String(body ?? '').trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"'))) {
    return { parsed: null, attempted: false };
  }
  return {
    parsed: JSON.parse(trimmed),
    attempted: true,
  };
}

function resolveReferenceEntry(context, token) {
  return context.resolvedDependencies?.get(token) ?? null;
}

function renderReferenceText(context, token) {
  const resolved = resolveReferenceEntry(context, token);
  if (!resolved) {
    return `[missing ${token}]`;
  }
  return typeof resolved.rendered === 'string' && resolved.rendered
    ? resolved.rendered
    : canonicalText(resolved.value);
}

function interpolateReferenceText(text, context) {
  let output = String(text ?? '');
  const references = [...new Set((context.node?.dependencies ?? []).map((reference) => reference.raw))]
    .sort((left, right) => right.length - left.length);
  for (const token of references) {
    output = output.split(token).join(renderReferenceText(context, token));
  }
  return output;
}

function materializeEmbeddedReferences(value, context) {
  if (Array.isArray(value)) {
    return value.map((entry) => materializeEmbeddedReferences(entry, context));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, materializeEmbeddedReferences(entry, context)]),
    );
  }
  if (typeof value === 'string') {
    const resolved = resolveReferenceEntry(context, value);
    if (resolved) {
      return resolved.value;
    }
  }
  return value;
}

function normalizeResultMode(value) {
  return value === 'text' ? 'text' : 'structured';
}

function normalizeEnvelope(context) {
  const trimmed = String(context.body ?? '').trim();
  const directReference = resolveReferenceEntry(context, trimmed);
  if (directReference && typeof directReference.value === 'object' && directReference.value !== null) {
    const referenced = directReference.value;
    return {
      problem: referenced.problem ?? referenced.rewritten_problem ?? canonicalText(referenced),
      preferredInterpreters: referenced.preferred_interpreters ?? [],
      resultMode: normalizeResultMode(referenced.result_mode),
      answerRequirements: referenced.answer_requirements ?? [],
      decompositionHints: referenced.decomposition_hints ?? [],
    };
  }

  const { parsed, attempted } = parseBodyJson(trimmed);
  if (attempted) {
    const materialized = materializeEmbeddedReferences(parsed, context);
    if (typeof materialized === 'object' && materialized !== null && !Array.isArray(materialized)) {
      return {
        problem: materialized.problem
          ?? materialized.text
          ?? materialized.description
          ?? materialized.rewritten_problem
          ?? interpolateReferenceText(trimmed, context),
        preferredInterpreters: materialized.preferred_interpreters ?? materialized.reasoning_interpreters ?? [],
        resultMode: normalizeResultMode(materialized.result_mode),
        answerRequirements: materialized.answer_requirements ?? [],
        decompositionHints: materialized.decomposition_hints ?? [],
      };
    }
  }

  return {
    problem: interpolateReferenceText(trimmed, context),
    preferredInterpreters: [],
    resultMode: 'structured',
    answerRequirements: [],
    decompositionHints: [],
  };
}

function listConfiguredReasoningInterpreters(runtime) {
  return runtime.externalInterpreters
    .listContracts()
    .filter((contract) => contract.enabled)
    .filter((contract) => !LLM_WRAPPER_PROFILES.has(contract.name))
    .map((contract) => contract.name);
}

function pickPreferredInterpreters(context, envelope) {
  const configured = listConfiguredReasoningInterpreters(context.runtime);
  const callerProfileList = Array.isArray(context.kbResult?.callerProfile?.meta?.preferred_external_interpreters)
    ? context.kbResult.callerProfile.meta.preferred_external_interpreters
    : [];
  const explicit = Array.isArray(envelope.preferredInterpreters) ? envelope.preferredInterpreters : [];
  const preferred = [...new Set([...explicit, ...callerProfileList])].filter((name) => configured.includes(name));
  return preferred.length > 0 ? preferred : configured;
}

function buildRewriteInstruction(envelope, preferredInterpreters) {
  return [
    'Return strict JSON only.',
    'Fields: status, rewritten_problem, preferred_interpreters, decomposition_hints, answer_requirements, planner_hint.',
    'Do not solve the problem. Rewrite it so an external bounded reasoning interpreter can solve it.',
    `Allowed interpreters: ${preferredInterpreters.join(', ') || '[none]'}.`,
    `Problem:\n${envelope.problem}`,
  ].join('\n\n');
}

function parseRewriteResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function buildHeuristicRewrite(envelope, preferredInterpreters) {
  return {
    status: 'rewrite_ready',
    rewritten_problem: envelope.problem,
    preferred_interpreters: preferredInterpreters,
    decomposition_hints: [
      'Preserve the explicit entities, constraints, and target question.',
      'Keep the task finite, inspectable, and solver-oriented.',
      'Separate exact reasoning from later prose polish when that helps.',
      ...envelope.decompositionHints,
    ],
    answer_requirements: envelope.answerRequirements,
    planner_hint: preferredInterpreters.length > 0
      ? `Route the rewritten problem to ${preferredInterpreters.join(', ')}.`
      : 'No external reasoning interpreter is currently enabled.',
  };
}

export async function executeLogicEval(context) {
  const effects = createEmptyEffects();
  const envelope = normalizeEnvelope(context);
  const preferredInterpreters = pickPreferredInterpreters(context, envelope);

  if (preferredInterpreters.length === 0) {
    effects.failure = createFailureRecord({
      kind: 'resolution_error',
      message: 'logic-eval could not find any enabled external reasoning interpreter.',
      origin: 'logic-eval',
      familyId: context.targetFamily,
      repairable: false,
    });
    return effects;
  }

  let rewriteBrief = buildHeuristicRewrite(envelope, preferredInterpreters);
  const llmAdapter = context.runtime.externalInterpreters?.llmAdapter ?? null;
  if (llmAdapter) {
    try {
      const adapterResult = await llmAdapter.invoke({
        profile: 'logicGeneratorLLM',
        model_class: 'premium',
        prompt_assets: [],
        context_package: context.contextPackage?.markdown ?? '',
        instruction: buildRewriteInstruction(envelope, preferredInterpreters),
        expected_output_mode: 'structured_json',
        input_budget: {},
        output_budget: {},
        trace_context: {
          ...(context.traceContext ?? {}),
          origin: 'logic-eval',
          mode: 'rewrite_brief',
        },
      });
      const parsed = parseRewriteResult(adapterResult.value ?? adapterResult);
      if (parsed) {
        rewriteBrief = {
          ...rewriteBrief,
          ...parsed,
          preferred_interpreters: Array.isArray(parsed.preferred_interpreters) && parsed.preferred_interpreters.length > 0
            ? parsed.preferred_interpreters.filter((name) => preferredInterpreters.includes(name))
            : rewriteBrief.preferred_interpreters,
        };
      }
    } catch {
      // Keep the heuristic rewrite brief as a safe fallback.
    }
  }

  const emittedValue = envelope.resultMode === 'text'
    ? canonicalText(rewriteBrief)
    : rewriteBrief;

  effects.emittedVariants.push({
    familyId: context.targetFamily,
    value: emittedValue,
    meta: {
      origin: 'logic-eval',
      source_interpreter: 'logic-eval',
      logic_eval_mode: 'orchestrator',
      preferred_interpreters: rewriteBrief.preferred_interpreters,
      result_mode: envelope.resultMode,
      rewritten: true,
    },
  });
  return effects;
}

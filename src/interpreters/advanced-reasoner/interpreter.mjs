import vm from 'node:vm';
import { canonicalText } from '../../utils/text.mjs';
import { createFailureRecord } from '../../utils/errors.mjs';
import { createEmptyEffects } from '../../runtime/effects.mjs';
import { AdvancedExecutionContext } from './execution-context.mjs';
import { AdvancedReasonerPreflightAnalyzer, ADVANCED_REASONER_VERDICTS } from './preflight-analyzer.mjs';
import { ReasonerResponse } from './reasoner-response.mjs';
import {
  AbductiveReasoningProblem,
  ProbabilisticReasoningProblem,
  CausalReasoningProblem,
  ArgumentationProblem,
  BeliefRevisionProblem,
  LegalReasoningProblem,
  ScientificSynthesisProblem,
  OptimizationReasoningProblem,
  FormalProofRoutingProblem,
  SMTReasoningProblem,
  PragmaticInterpretationProblem,
  AnalogicalReasoningProblem,
  EthicalDeliberationProblem,
  CreativeEvaluationProblem,
} from './solver-wrappers.mjs';

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

function stripCodeFence(text) {
  const trimmed = String(text ?? '').trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```\s*$/);
  return match ? match[1].trim() : trimmed;
}

function normalizeGeneratedProgramSource(text) {
  let source = stripCodeFence(text);
  source = source.replace(/^\s*export\s+default\s+/, '');
  source = source.replace(/^\s*export\s+(const|let|var|function)\b/gm, '$1');
  return source.trim();
}

function buildPromptPrelude(promptAssets = []) {
  return promptAssets
    .map((entry) => entry.content?.trim())
    .filter(Boolean)
    .join('\n\n');
}

function normalizeResultMode(value) {
  return value === 'structured' ? 'structured' : 'text';
}

function normalizeReferenceAlias(token) {
  return String(token ?? '')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[^a-zA-Z0-9_$]+/g, '_');
}

function buildExecutionRefs(context) {
  const refs = {};
  for (const [token, resolved] of context.resolvedDependencies?.entries() ?? []) {
    const value = resolved?.value ?? resolved?.rendered ?? null;
    refs[token] = value;
    const alias = normalizeReferenceAlias(token);
    if (alias && !(alias in refs)) {
      refs[alias] = value;
    }
  }
  return refs;
}

function buildExecutionInput(envelope, context) {
  return {
    task_text: envelope.problem,
    rewrite_brief: envelope.rewriteBrief ?? null,
    refs: buildExecutionRefs(context),
    selected_context: context.kbResult?.selected?.map((entry) => ({
      ku_id: entry.kuId,
      title: entry.meta.title,
      summary: entry.meta.summary,
    })) ?? [],
    policy_flags: {
      can_assume: true,
      can_recommend_engine: true,
    },
    allowed_output_target: context.targetFamily,
    request_text: context.request?.requestText ?? '',
  };
}

function buildProgramInstruction(envelope, context) {
  const promptPrelude = buildPromptPrelude(context.promptAssets);
  return [
    promptPrelude,
    'Return only bounded JavaScript source. No markdown fences. No explanation.',
    'Create `const ctx = new ExecutionContext();` and terminate only through `ctx.returnResponse(ReasonerResponse.*(...))`.',
    'Do not call providers, filesystems, or external engines directly from generated code.',
    'Use typed reasoning classes and produce conservative certainty, evidence, and promotion metadata.',
    `Problem:\n${envelope.problem}`,
    envelope.rewriteBrief ? `Rewrite brief:\n${canonicalText(envelope.rewriteBrief)}` : '',
  ].filter(Boolean).join('\n\n');
}

function normalizeEnvelope(context) {
  const trimmed = String(context.body ?? '').trim();
  const directReference = resolveReferenceEntry(context, trimmed);
  if (directReference && typeof directReference.value === 'object' && directReference.value !== null) {
    const referenced = directReference.value;
    return {
      problem: referenced.rewritten_problem ?? referenced.problem ?? canonicalText(referenced),
      rewriteBrief: referenced,
      resultMode: normalizeResultMode(referenced.result_mode),
      program: referenced.program ?? referenced.reasoner_program ?? null,
      generatorProfile: referenced.generator_profile ?? 'logicGeneratorLLM',
    };
  }

  const { parsed, attempted } = parseBodyJson(trimmed);
  if (attempted) {
    const materialized = materializeEmbeddedReferences(parsed, context);
    if (typeof materialized === 'object' && materialized !== null && !Array.isArray(materialized)) {
      return {
        problem: materialized.rewritten_problem
          ?? materialized.problem
          ?? materialized.text
          ?? materialized.description
          ?? interpolateReferenceText(trimmed, context),
        rewriteBrief: materialized.rewritten_problem ? materialized : null,
        resultMode: normalizeResultMode(materialized.result_mode),
        program: materialized.program ?? materialized.reasoner_program ?? null,
        generatorProfile: materialized.generator_profile ?? 'logicGeneratorLLM',
      };
    }
  }

  return {
    problem: interpolateReferenceText(trimmed, context),
    rewriteBrief: null,
    resultMode: 'text',
    program: null,
    generatorProfile: 'logicGeneratorLLM',
  };
}

function extractProgramSource(result) {
  if (typeof result === 'string') {
    return normalizeGeneratedProgramSource(result);
  }
  if (result && typeof result === 'object') {
    return normalizeGeneratedProgramSource(result.program ?? result.code ?? result.value ?? '');
  }
  return '';
}

function formatMetaSurface(response) {
  const lines = [
    `status ${response.status}`,
    'interpreter AdvancedReasoner',
    `mode ${response.mode ?? 'advanced_reasoning'}`,
  ];
  if (response.recommendedEngine) {
    lines.push(`recommended_engine ${response.recommendedEngine}`);
  }
  if (response.certainty) {
    lines.push(`certainty ${response.certainty}`);
  }
  if (response.evidenceQuality) {
    lines.push(`evidence_quality ${response.evidenceQuality}`);
  }
  if (response.assumptionRisk) {
    lines.push(`assumption_risk ${response.assumptionRisk}`);
  }
  if (response.openWorldRisk) {
    lines.push(`open_world_risk ${response.openWorldRisk}`);
  }
  if (response.formalizationQuality) {
    lines.push(`formalization_quality ${response.formalizationQuality}`);
  }
  if (response.promotion) {
    lines.push(`promotion_allowed ${response.promotion}`);
  }
  return lines.join('\n');
}

function formatStructuredObjectSurface(record) {
  return Object.entries(record)
    .map(([key, value]) => `${key}: ${canonicalText(value)}`)
    .join('\n');
}

function pushSupplementalVariants(effects, targetFamily, response) {
  effects.emittedVariants.push({
    familyId: `${targetFamily}:meta`,
    value: formatMetaSurface(response),
    meta: {
      origin: 'AdvancedReasoner',
      source_interpreter: 'AdvancedReasoner',
      advanced_reasoner_surface: 'meta',
    },
  });
  if (Array.isArray(response.requiredInputs) && response.requiredInputs.length > 0) {
    effects.emittedVariants.push({
      familyId: `${targetFamily}:engine_requirements`,
      value: response.requiredInputs.join('\n'),
      meta: {
        origin: 'AdvancedReasoner',
        source_interpreter: 'AdvancedReasoner',
        advanced_reasoner_surface: 'engine_requirements',
      },
    });
  }
  if (Array.isArray(response.openQuestions) && response.openQuestions.length > 0) {
    effects.emittedVariants.push({
      familyId: `${targetFamily}:open_questions`,
      value: response.openQuestions.join('\n'),
      meta: {
        origin: 'AdvancedReasoner',
        source_interpreter: 'AdvancedReasoner',
        advanced_reasoner_surface: 'open_questions',
      },
    });
  }
  if (Array.isArray(response.trace) && response.trace.length > 0) {
    effects.emittedVariants.push({
      familyId: `${targetFamily}:trace`,
      value: response.trace.join('\n'),
      meta: {
        origin: 'AdvancedReasoner',
        source_interpreter: 'AdvancedReasoner',
        advanced_reasoner_surface: 'trace',
      },
    });
  }
}

function executeProgram(programSource, envelope, context) {
  const executionInput = buildExecutionInput(envelope, context);
  const BoundExecutionContext = class extends AdvancedExecutionContext {
    constructor(input = executionInput) {
      super(input);
    }

    returnResponse(response) {
      if (this.state.response) {
        throw new Error('AdvancedReasoner response was already returned.');
      }
      const normalized = ReasonerResponse.from(response);
      this.state.response = normalized;
      this.addTrace(`return ${normalized.status}`);
      return normalized;
    }
  };
  const sandbox = {
    ExecutionContext: BoundExecutionContext,
    ReasonerResponse,
    AbductiveReasoningProblem,
    ProbabilisticReasoningProblem,
    CausalReasoningProblem,
    ArgumentationProblem,
    BeliefRevisionProblem,
    LegalReasoningProblem,
    ScientificSynthesisProblem,
    OptimizationReasoningProblem,
    FormalProofRoutingProblem,
    SMTReasoningProblem,
    PragmaticInterpretationProblem,
    AnalogicalReasoningProblem,
    EthicalDeliberationProblem,
    CreativeEvaluationProblem,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
  };
  const source = [
    '"use strict";',
    '(() => {',
    programSource,
    'if (typeof ctx === "undefined") { throw new Error("AdvancedReasoner program must define `ctx`."); }',
    'return ctx;',
    '})()',
  ].join('\n');
  const script = new vm.Script(source, { filename: 'advanced-reasoner.program.js' });
  const runtimeContext = script.runInNewContext(sandbox, { timeout: 800 });
  if (!(runtimeContext instanceof BoundExecutionContext)) {
    throw new Error('AdvancedReasoner program did not return an ExecutionContext instance.');
  }
  return runtimeContext.finalize();
}

async function generateProgram(llmAdapter, envelope, context) {
  const adapterResult = await llmAdapter.invoke({
    profile: envelope.generatorProfile ?? 'logicGeneratorLLM',
    model_class: 'premium',
    prompt_assets: context.promptAssets ?? [],
    context_package: context.contextPackage?.markdown ?? '',
    instruction: buildProgramInstruction(envelope, context),
    expected_output_mode: 'code_block',
    input_budget: {},
    output_budget: {},
    trace_context: {
      ...(context.traceContext ?? {}),
      origin: 'AdvancedReasoner',
    },
  });

  if (adapterResult.status === 'semantic_refusal') {
    throw createFailureRecord({
      kind: 'contract_refusal',
      message: adapterResult.message ?? 'AdvancedReasoner generation refused the task.',
      origin: 'AdvancedReasoner',
      familyId: context.targetFamily,
      repairable: true,
    });
  }

  if (adapterResult.status === 'provider_failure') {
    throw createFailureRecord({
      kind: 'provider_failure',
      message: adapterResult.message ?? 'AdvancedReasoner generation failed at provider boundary.',
      origin: 'AdvancedReasoner',
      familyId: context.targetFamily,
      repairable: true,
    });
  }

  return extractProgramSource(adapterResult.value ?? adapterResult);
}

export async function executeAdvancedReasoner(context, dependencies = {}) {
  const effects = createEmptyEffects();
  const envelope = normalizeEnvelope(context);
  const llmAdapter = dependencies.llmAdapter ?? context.runtime?.externalInterpreters?.llmAdapter ?? null;
  if (!llmAdapter && !envelope.program) {
    effects.failure = createFailureRecord({
      kind: 'provider_failure',
      message: 'AdvancedReasoner requires a managed LLM adapter.',
      origin: 'AdvancedReasoner',
      familyId: context.targetFamily,
      repairable: true,
    });
    return effects;
  }

  try {
    const programSource = envelope.program
      ? extractProgramSource(envelope.program)
      : await generateProgram(llmAdapter, envelope, context);
    const preflight = AdvancedReasonerPreflightAnalyzer.analyze(programSource);
    if (preflight.verdict === ADVANCED_REASONER_VERDICTS.INVALID_PROGRAM) {
      effects.failure = createFailureRecord({
        kind: 'contract_refusal',
        message: preflight.reason,
        origin: 'AdvancedReasoner',
        familyId: context.targetFamily,
        repairable: true,
        details: {
          diagnostics: preflight.diagnostics,
        },
      });
      return effects;
    }
    if (preflight.verdict === ADVANCED_REASONER_VERDICTS.TOO_COMPLEX) {
      effects.failure = createFailureRecord({
        kind: 'execution_error',
        message: preflight.reason,
        origin: 'AdvancedReasoner',
        familyId: context.targetFamily,
        repairable: true,
      });
      return effects;
    }

    const finalized = executeProgram(programSource, envelope, context);
    if (!finalized.response) {
      effects.failure = createFailureRecord({
        kind: 'execution_error',
        message: 'AdvancedReasoner program did not return a ReasonerResponse.',
        origin: 'AdvancedReasoner',
        familyId: context.targetFamily,
        repairable: true,
      });
      return effects;
    }

    const response = finalized.response;
    const responseTrace = [...new Set([...(response.trace ?? []), ...(finalized.trace ?? [])])];
    response.trace = responseTrace;
    const mainValue = envelope.resultMode === 'structured'
      ? {
        text: response.text,
        meta: formatMetaSurface(response),
        open_questions: response.openQuestions ?? [],
        engine_requirements: response.requiredInputs ?? [],
        trace: responseTrace,
        response,
      }
      : response.text;

    effects.emittedVariants.push({
      familyId: context.targetFamily,
      value: mainValue,
      meta: {
        origin: 'AdvancedReasoner',
        source_interpreter: 'AdvancedReasoner',
        advanced_reasoner_status: response.status,
        result_mode: envelope.resultMode,
        generator_profile: envelope.generatorProfile ?? 'logicGeneratorLLM',
        program_source: envelope.program ? 'inline' : 'generated',
        response,
      },
    });
    if (finalized.assumptions && Object.keys(finalized.assumptions).length > 0) {
      effects.emittedVariants.push({
        familyId: `${context.targetFamily}:assumptions`,
        value: formatStructuredObjectSurface(finalized.assumptions),
        meta: {
          origin: 'AdvancedReasoner',
          source_interpreter: 'AdvancedReasoner',
          advanced_reasoner_surface: 'assumptions',
        },
      });
    }
    if (finalized.results && Object.keys(finalized.results).length > 0) {
      effects.emittedVariants.push({
        familyId: `${context.targetFamily}:results`,
        value: formatStructuredObjectSurface(finalized.results),
        meta: {
          origin: 'AdvancedReasoner',
          source_interpreter: 'AdvancedReasoner',
          advanced_reasoner_surface: 'results',
        },
      });
    }
    pushSupplementalVariants(effects, context.targetFamily, response);
    return effects;
  } catch (error) {
    effects.failure = error?.kind
      ? error
      : createFailureRecord({
        kind: 'execution_error',
        message: error.message,
        origin: 'AdvancedReasoner',
        familyId: context.targetFamily,
        repairable: true,
      });
    return effects;
  }
}

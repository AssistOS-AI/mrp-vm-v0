import vm from 'node:vm';
import { canonicalText } from '../../utils/text.mjs';
import { createFailureRecord } from '../../utils/errors.mjs';
import { createEmptyEffects } from '../../runtime/effects.mjs';
import { HumanLikeExecutionContext } from './execution-context.mjs';
import { HumanLikePreflightAnalyzer, HUMAN_LIKE_VERDICTS } from './preflight-analyzer.mjs';
import {
  RuleProblem,
  ConstraintProblem,
  GraphProblem,
  SearchProblem,
  NumericProblem,
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

function buildProgramInstruction(envelope, context) {
  const promptPrelude = buildPromptPrelude(context.promptAssets);
  const lines = [
    promptPrelude,
    'Return only a bounded JavaScript program.',
    'The program must create `const ctx = new ExecutionContext(...)`, use only approved solver classes, avoid loops, avoid async constructs, and finish by calling `ctx.emit(...)`.',
    'Prefer constraint, graph, search, and numeric reasoning with explicit intermediate results.',
    `Problem:\n${envelope.problem}`,
  ].filter(Boolean);

  if (envelope.rewriteBrief) {
    lines.push(`Rewrite brief:\n${canonicalText(envelope.rewriteBrief)}`);
  }

  return lines.join('\n\n').trim();
}

function buildExecutionInput(envelope, context) {
  return {
    problem: envelope.problem,
    rewrite_brief: envelope.rewriteBrief ?? null,
    request_text: context.request?.requestText ?? '',
    target_family: context.targetFamily,
    knowledge_units: context.kbResult?.selected?.map((entry) => ({
      ku_id: entry.kuId,
      title: entry.meta.title,
      summary: entry.meta.summary,
    })) ?? [],
  };
}

function normalizeResultMode(value) {
  return value === 'structured' ? 'structured' : 'text';
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
      program: referenced.program ?? referenced.solver_program ?? null,
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
        program: materialized.program ?? materialized.solver_program ?? null,
        generatorProfile: materialized.generator_profile ?? 'logicGeneratorLLM',
      };
    }
    return {
      problem: canonicalText(materialized),
      rewriteBrief: null,
      resultMode: 'text',
      program: null,
      generatorProfile: 'logicGeneratorLLM',
    };
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

function executeProgram(programSource, envelope, context) {
  const executionInput = buildExecutionInput(envelope, context);
  const BoundExecutionContext = class extends HumanLikeExecutionContext {
    constructor(input = executionInput, options = {}) {
      super(input, options);
    }
  };
  const sandbox = {
    ExecutionContext: BoundExecutionContext,
    RuleProblem,
    ConstraintProblem,
    GraphProblem,
    SearchProblem,
    NumericProblem,
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
    'if (typeof ctx === "undefined") { throw new Error("HumanLikeReasoner program must define `ctx`."); }',
    'return ctx;',
    '})()',
  ].join('\n');
  const script = new vm.Script(source, { filename: 'human-like-reasoner.program.js' });
  const runtimeContext = script.runInNewContext(sandbox, {
    timeout: 500,
  });
  if (!(runtimeContext instanceof BoundExecutionContext)) {
    throw new Error('HumanLikeReasoner program did not return an ExecutionContext instance.');
  }
  return runtimeContext.finalize();
}

function pickPrimaryOutput(finalized, targetFamily) {
  const outputs = finalized.outputs ?? [];
  if (outputs.length === 0) {
    return null;
  }
  return outputs.find((entry) => entry.target === targetFamily)
    ?? outputs.find((entry) => entry.target === 'answer')
    ?? outputs[0];
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
      origin: 'HumanLikeReasoner',
    },
  });

  if (adapterResult.status === 'semantic_refusal') {
    throw createFailureRecord({
      kind: 'contract_refusal',
      message: adapterResult.message ?? 'HumanLikeReasoner generation refused the task.',
      origin: 'HumanLikeReasoner',
      familyId: context.targetFamily,
      repairable: true,
    });
  }

  if (adapterResult.status === 'provider_failure') {
    throw createFailureRecord({
      kind: 'provider_failure',
      message: adapterResult.message ?? 'HumanLikeReasoner generation failed at provider boundary.',
      origin: 'HumanLikeReasoner',
      familyId: context.targetFamily,
      repairable: true,
    });
  }

  return extractProgramSource(adapterResult.value ?? adapterResult);
}

export async function executeHumanLikeReasoner(context, dependencies = {}) {
  const effects = createEmptyEffects();
  const llmAdapter = dependencies.llmAdapter ?? context.runtime?.externalInterpreters?.llmAdapter ?? null;
  if (!llmAdapter) {
    effects.failure = createFailureRecord({
      kind: 'provider_failure',
      message: 'HumanLikeReasoner requires a managed LLM adapter.',
      origin: 'HumanLikeReasoner',
      familyId: context.targetFamily,
      repairable: true,
    });
    return effects;
  }

  try {
    const envelope = normalizeEnvelope(context);
    const programSource = envelope.program
      ? extractProgramSource(envelope.program)
      : await generateProgram(llmAdapter, envelope, context);

    const preflight = HumanLikePreflightAnalyzer.analyze(programSource);
    if (preflight.verdict === HUMAN_LIKE_VERDICTS.INVALID_PROGRAM) {
      effects.failure = createFailureRecord({
        kind: 'contract_refusal',
        message: preflight.reason,
        origin: 'HumanLikeReasoner',
        familyId: context.targetFamily,
        repairable: true,
        details: {
          diagnostics: preflight.diagnostics,
        },
      });
      return effects;
    }
    if (preflight.verdict === HUMAN_LIKE_VERDICTS.TOO_COMPLEX) {
      effects.failure = createFailureRecord({
        kind: 'execution_error',
        message: preflight.reason,
        origin: 'HumanLikeReasoner',
        familyId: context.targetFamily,
        repairable: true,
      });
      return effects;
    }

    const finalized = executeProgram(programSource, envelope, context);
    const primaryOutput = pickPrimaryOutput(finalized, context.targetFamily);
    if (!primaryOutput) {
      effects.failure = createFailureRecord({
        kind: 'execution_error',
        message: 'HumanLikeReasoner program did not emit a final answer.',
        origin: 'HumanLikeReasoner',
        familyId: context.targetFamily,
        repairable: true,
      });
      return effects;
    }

    const emittedValue = envelope.resultMode === 'structured'
      ? {
        text: primaryOutput.text,
        meta: primaryOutput.meta,
        trace: finalized.trace,
        assumptions: finalized.assumptions,
        rewrite_brief: envelope.rewriteBrief ?? null,
      }
      : primaryOutput.text;

    effects.emittedVariants.push({
      familyId: context.targetFamily,
      value: emittedValue,
      meta: {
        origin: 'HumanLikeReasoner',
        source_interpreter: 'HumanLikeReasoner',
        human_like_status: 'solved',
        result_mode: envelope.resultMode,
        program_source: envelope.program ? 'inline' : 'generated',
        generator_profile: envelope.generatorProfile ?? 'logicGeneratorLLM',
        emitted_target: primaryOutput.target,
      },
    });
    return effects;
  } catch (error) {
    effects.failure = error?.kind
      ? error
      : createFailureRecord({
        kind: 'execution_error',
        message: error.message,
        origin: 'HumanLikeReasoner',
        familyId: context.targetFamily,
        repairable: true,
      });
    return effects;
  }
}

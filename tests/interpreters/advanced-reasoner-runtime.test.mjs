import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../src/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';
import {
  executeAdvancedReasoner,
  AdvancedExecutionContext,
  ReturnResponseSignal,
  ReasonerResponse,
} from '../../src/interpreters/advanced-reasoner/index.mjs';

function buildContext(runtime, body, options = {}) {
  const dependencies = options.dependencies ?? [];
  return {
    runtime,
    targetFamily: options.targetFamily ?? 'answer',
    body,
    node: {
      dependencies: dependencies.map((raw) => ({ raw })),
    },
    resolvedDependencies: new Map(options.resolvedDependencies ?? []),
    contextPackage: { markdown: '' },
    kbResult: { selected: [] },
    promptAssets: [],
    request: {
      requestText: typeof body === 'string' ? body : JSON.stringify(body),
    },
  };
}

function findVariant(effects, familyId) {
  return effects.emittedVariants.find((entry) => entry.familyId === familyId) ?? null;
}

test('AdvancedReasoner runtime: ReasonerResponse and ExecutionContext preserve structured state', () => {
  const ctx = new AdvancedExecutionContext({
    refs: {
      policy: { mode: 'strict' },
    },
  });

  ctx.set('draft', 'ready');
  ctx.storeResult('posterior', {
    toJSON() {
      return { yes: 0.9, no: 0.1 };
    },
  });
  ctx.assume('closed_world', { enabled: false });
  ctx.addTrace('loaded refs');

  let signal = null;
  try {
    ctx.returnResponse(ReasonerResponse.solved({
      text: 'Structured result ready.',
      mode: 'probabilistic_reasoning',
      certainty: 'high',
      evidenceQuality: 'structural',
      assumptionRisk: 'low',
      promotion: 'yes',
      trace: ctx.trace(),
    }));
  } catch (error) {
    signal = error;
  }

  assert.ok(signal instanceof ReturnResponseSignal);
  assert.equal(signal.response.toJSON().status, 'solved');

  const finalized = ctx.finalize();
  assert.equal(finalized.response.status, 'solved');
  assert.equal(finalized.vars.draft, 'ready');
  assert.deepEqual(finalized.results.posterior, { yes: 0.9, no: 0.1 });
  assert.deepEqual(finalized.assumptions.closed_world, { enabled: false });
  assert.match(finalized.trace.join('\n'), /loaded refs/);
  assert.match(finalized.trace.join('\n'), /return solved/);
});

test('AdvancedReasoner runtime: interpreter is registered and executes inline programs with rendered surfaces', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  const program = [
    'const ctx = new ExecutionContext();',
    'const input = ctx.input();',
    'ctx.assume("policy_mode", input.refs.causalPolicy.mode);',
    'ctx.addTrace("loaded causal policy");',
    'ctx.returnResponse(ReasonerResponse.reasoned({',
    '  text: "Using policy mode " + input.refs.causalPolicy.mode + ".",',
    '  mode: "causal_reasoning",',
    '  certainty: "medium",',
    '  evidenceQuality: "moderate",',
    '  assumptionRisk: "medium",',
    '  promotion: "with_review",',
    '  openQuestions: ["Need a cohort split."],',
    '  trace: ctx.trace(),',
    '}));',
  ].join('\n');

  const effects = await runtime.externalInterpreters.invoke('AdvancedReasoner', buildContext(runtime, JSON.stringify({
    problem: 'Read an already resolved policy reference.',
    program,
  }), {
    dependencies: ['~causalPolicy'],
    resolvedDependencies: [[
      '~causalPolicy',
      {
        value: { mode: 'strict' },
        rendered: 'mode strict',
      },
    ]],
  }));

  assert.equal(effects.failure, null);
  assert.equal(findVariant(effects, 'answer')?.meta.source_interpreter, 'AdvancedReasoner');
  assert.match(String(findVariant(effects, 'answer')?.value), /policy mode strict/);
  assert.match(String(findVariant(effects, 'answer:meta')?.value), /status reasoned/);
  assert.match(String(findVariant(effects, 'answer:open_questions')?.value), /Need a cohort split/);
  assert.match(String(findVariant(effects, 'answer:assumptions')?.value), /policy_mode: strict/);
  assert.match(String(findVariant(effects, 'answer:trace')?.value), /loaded causal policy/);
});

test('AdvancedReasoner runtime: inline causal program renders engine requirements and trace', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  const program = [
    'const ctx = new ExecutionContext();',
    'const p = new CausalReasoningProblem("activation");',
    'p.variable({ id: "onboarding", role: "treatment", domain: ["old", "new"], observed: true });',
    'p.variable({ id: "activation", role: "outcome", scale: "percentage", observed: true });',
    'p.variable({ id: "marketing_spend", role: "confounder_candidate", scale: "numeric", observed: true });',
    'p.association({',
    '  x: "onboarding",',
    '  y: "activation",',
    '  description: "activation increased after the onboarding change",',
    '  source: "given"',
    '});',
    'p.confounderCandidate({ variable: "marketing_spend", reason: "spend also changed", observed: true });',
    'p.claim({ treatment: "onboarding", outcome: "activation", claimType: "causal_effect" });',
    'const r = p.assess({ requiredStandard: "causal_effect", allowLocalDAGCheck: true });',
    'ctx.returnResponse(ReasonerResponse.needsEngine({',
    '  text: r.cautionText(),',
    '  mode: "causal_reasoning",',
    '  recommendedEngine: "CausalDAGEngine",',
    '  reason: r.engineReason(),',
    '  requiredInputs: r.requiredInputs(),',
    '  openQuestions: r.openQuestions(),',
    '  certainty: "low",',
    '  evidenceQuality: "weak",',
    '  assumptionRisk: "high",',
    '  promotion: "no",',
    '  trace: r.trace(),',
    '}));',
  ].join('\n');

  const effects = await executeAdvancedReasoner(buildContext(runtime, JSON.stringify({
    problem: 'Can we infer a causal effect?',
    program,
  })));

  assert.equal(effects.failure, null);
  assert.match(String(findVariant(effects, 'answer')?.value), /No reliable causal conclusion/);
  assert.match(String(findVariant(effects, 'answer:meta')?.value), /recommended_engine CausalDAGEngine/);
  assert.match(String(findVariant(effects, 'answer:engine_requirements')?.value), /candidate confounders/);
  assert.match(String(findVariant(effects, 'answer:open_questions')?.value), /randomized/);
  assert.match(String(findVariant(effects, 'answer:trace')?.value), /Local causal identification is insufficient/);
});

test('AdvancedReasoner runtime: preflight rejects ctx.emit as an exit surface', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  const effects = await executeAdvancedReasoner(buildContext(runtime, JSON.stringify({
    problem: 'Invalid program',
    program: [
      'const ctx = new ExecutionContext();',
      'ctx.emit("answer", "wrong");',
      'ctx.returnResponse(ReasonerResponse.reasoned({',
      '  text: "wrong",',
      '  mode: "abduction",',
      '  certainty: "low",',
      '  evidenceQuality: "weak",',
      '  assumptionRisk: "high",',
      '  promotion: "no"',
      '}));',
    ].join('\n'),
  })));

  assert.equal(effects.failure?.kind, 'contract_refusal');
  assert.match(String(effects.failure?.message), /emit/);
});

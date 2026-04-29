import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../src/index.mjs';
import { executeAdvancedReasoner } from '../../src/interpreters/advanced-reasoner/interpreter.mjs';
import { AdvancedExecutionContext, ReturnResponseSignal } from '../../src/interpreters/advanced-reasoner/execution-context.mjs';
import { ReasonerResponse } from '../../src/interpreters/advanced-reasoner/response.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

function buildContext(runtime, program) {
  return {
    runtime,
    targetFamily: 'answer',
    body: JSON.stringify({
      problem: 'test problem',
      program,
    }),
    node: { dependencies: [] },
    resolvedDependencies: new Map(),
    contextPackage: { markdown: '' },
    kbResult: { selected: [] },
    request: { requestText: 'test problem' },
  };
}

async function runInlineProgram(program) {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  const effects = await executeAdvancedReasoner(buildContext(runtime, program));
  assert.equal(effects.failure, null);
  return effects;
}

test('ReasonerResponse and AdvancedExecutionContext finalize a returned response', () => {
  const ctx = new AdvancedExecutionContext({ task_text: 'demo' });
  ctx.set('x', 1);
  ctx.assume('bounded', { ok: true });
  ctx.addTrace('prepared');
  assert.throws(() => {
    ctx.returnResponse(ReasonerResponse.reasoned({
      text: 'done',
      mode: 'abductive_reasoning',
      certainty: 'medium',
    }));
  }, ReturnResponseSignal);
  const finalized = ctx.finalize();
  assert.equal(finalized.response.status, 'reasoned');
  assert.equal(finalized.response.text, 'done');
  assert.equal(finalized.trace.includes('prepared'), true);
  assert.equal(finalized.vars.x, 1);
});

test('AdvancedReasoner executes an inline abductive program', async () => {
  const effects = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const problem = new AbductiveReasoningProblem("loginFailure");',
    'problem.hypothesis({ id: "h_auth", description: "Authentication service misconfigured", prior: "medium" });',
    'problem.hypothesis({ id: "h_gateway", description: "Network gateway is down", prior: "medium" });',
    'problem.observation({ id: "o_401", proposition: { type: "error_code", value: 401 }, reliability: "high" });',
    'problem.supports({ observation: "o_401", hypothesis: "h_auth", strength: "strong" });',
    'problem.contradicts({ observation: "o_401", hypothesis: "h_gateway", strength: "weak" });',
    'const result = problem.evaluate({ maxHypotheses: 5 });',
    'ctx.returnResponse(ReasonerResponse.reasoned({',
    '  text: result.bestExplanationText(),',
    '  mode: "bounded_abduction",',
    '  certainty: result.certainty(),',
    '  evidenceQuality: result.evidenceQuality(),',
    '  assumptionRisk: result.assumptionRisk(),',
    '  promotion: "with_review",',
    '  openQuestions: result.nextChecks(),',
    '  trace: result.trace(),',
    '}));',
  ].join('\n'));

  assert.match(String(effects.emittedVariants[0].value), /Authentication service misconfigured/);
  assert.ok(effects.emittedVariants.some((entry) => entry.familyId === 'answer:meta'));
  assert.ok(effects.emittedVariants.some((entry) => entry.familyId === 'answer:trace'));
});

test('AdvancedReasoner executes a bounded probabilistic program', async () => {
  const effects = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const problem = new ProbabilisticReasoningProblem("diagnosticTest");',
    'problem.variable({ id: "disease", domain: ["yes", "no"] });',
    'problem.variable({ id: "test", domain: ["positive", "negative"] });',
    'problem.prior({ variable: "disease", distribution: { yes: 0.01, no: 0.99 }, source: "given" });',
    'problem.conditional({ child: "test", parents: ["disease"], table: { "disease=yes": { positive: 0.95, negative: 0.05 }, "disease=no": { positive: 0.10, negative: 0.90 } }, source: "given" });',
    'problem.evidence({ variable: "test", value: "positive", reliability: "assumed_exact" });',
    'problem.query({ variable: "disease" });',
    'const result = problem.infer({ method: "exact_enumeration", maxJointStates: 100 });',
    'ctx.returnResponse(ReasonerResponse.reasoned({',
    '  text: result.posteriorText("disease"),',
    '  mode: "probabilistic_reasoning",',
    '  certainty: result.certainty(),',
    '  evidenceQuality: result.evidenceQuality(),',
    '  assumptionRisk: result.assumptionRisk(),',
    '  promotion: "yes",',
    '  trace: result.trace(),',
    '}));',
  ].join('\n'));

  assert.match(String(effects.emittedVariants[0].value), /disease:/i);
  assert.match(String(effects.emittedVariants[0].value), /yes=/i);
});

test('AdvancedReasoner returns engine recommendations for causal-effect gaps', async () => {
  const effects = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const problem = new CausalReasoningProblem("onboardingActivation");',
    'problem.variable({ id: "onboarding_change", role: "treatment", observed: true });',
    'problem.variable({ id: "activation_rate", role: "outcome", observed: true });',
    'problem.association({ x: "onboarding_change", y: "activation_rate", source: "given" });',
    'problem.confounderCandidate({ variable: "marketing_spend", reason: "marketing also changed", observed: true });',
    'problem.claim({ treatment: "onboarding_change", outcome: "activation_rate", claimType: "causal_effect" });',
    'const result = problem.assess({ requiredStandard: "causal_effect", allowLocalDAGCheck: true });',
    'ctx.returnResponse(ReasonerResponse.needsEngine({',
    '  text: result.cautionText(),',
    '  mode: "causal_reasoning",',
    '  recommendedEngine: "CausalEngine",',
    '  reason: result.engineReason(),',
    '  requiredInputs: result.requiredInputs(),',
    '  openQuestions: result.openQuestions(),',
    '  certainty: result.certainty(),',
    '  evidenceQuality: result.evidenceQuality(),',
    '  assumptionRisk: result.assumptionRisk(),',
    '  promotion: "no",',
    '  trace: result.trace(),',
    '}));',
  ].join('\n'));

  const main = effects.emittedVariants.find((entry) => entry.familyId === 'answer');
  assert.match(String(main.value), /causal/i);
  assert.ok(effects.emittedVariants.some((entry) => entry.familyId === 'answer:engine_requirements'));
  assert.ok(effects.emittedVariants.some((entry) => entry.familyId === 'answer:open_questions'));
});

test('AdvancedReasoner evaluates argumentation and returns a partial bounded result', async () => {
  const effects = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const problem = new ArgumentationProblem("deploymentDecision");',
    'problem.argument({ id: "a_speed", claim: "Deployment reduces manual review time", source: "given" });',
    'problem.argument({ id: "a_audit", claim: "Deployment should not proceed without audit logs", source: "given" });',
    'problem.relation({ from: "a_audit", to: "a_speed", type: "attacks", validated: false });',
    'const result = problem.evaluate({ semantics: "grounded" });',
    'ctx.returnResponse(ReasonerResponse.partial({',
    '  text: result.summaryText(),',
    '  mode: "argumentation",',
    '  resolvedParts: result.acceptedArguments(),',
    '  unresolvedParts: result.unresolvedConflicts(),',
    '  certainty: result.certainty(),',
    '  evidenceQuality: result.evidenceQuality(),',
    '  assumptionRisk: result.assumptionRisk(),',
    '  promotion: "with_review",',
    '  trace: result.trace(),',
    '}));',
  ].join('\n'));

  assert.match(String(effects.emittedVariants[0].value), /Accepted arguments|No argument is accepted/i);
});

test('AdvancedReasoner can solve a tiny optimization problem locally', async () => {
  const effects = await runInlineProgram([
    'const ctx = new ExecutionContext();',
    'const problem = new OptimizationReasoningProblem("tinyAssignment");',
    'problem.decisionVariable({ id: "x", domain: [0, 1, 2], type: "integer" });',
    'problem.decisionVariable({ id: "y", domain: [0, 1, 2], type: "integer" });',
    'problem.constraint({ id: "sum", expression: { type: "eq", left: { type: "add", left: { type: "var", id: "x" }, right: { type: "var", id: "y" } }, right: { type: "const", value: 2 } }, kind: "linear" });',
    'problem.objective({ direction: "maximize", expression: "x", kind: "linear" });',
    'const result = problem.tryTinySolve({ maxDomainProduct: 16, maxEvaluations: 32 });',
    'ctx.returnResponse(ReasonerResponse.solved({',
    '  text: result.summaryText(),',
    '  mode: "optimization_reasoning",',
    '  certainty: result.certainty(),',
    '  evidenceQuality: result.evidenceQuality(),',
    '  assumptionRisk: result.assumptionRisk(),',
    '  promotion: "yes",',
    '  trace: result.trace(),',
    '}));',
  ].join('\n'));

  assert.match(String(effects.emittedVariants[0].value), /Feasible optimum found/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AbductiveReasoningProblem,
  ProbabilisticReasoningProblem,
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
} from '../../src/interpreters/advanced-reasoner/index.mjs';

test('AdvancedReasoner catalog: abductive reasoning ranks the strongest explanation conservatively', () => {
  const problem = new AbductiveReasoningProblem('loginFailure');
  problem.hypothesis({
    id: 'h_auth',
    description: 'Authentication service misconfigured',
    prior: 'medium',
  });
  problem.hypothesis({
    id: 'h_gateway',
    description: 'Network gateway is down',
    prior: 'medium',
  });
  problem.observation({
    id: 'o_401',
    proposition: { type: 'error_code', value: 401 },
    reliability: 'high',
  });
  problem.observation({
    id: 'o_ping',
    proposition: { type: 'network_ping', target: 'gateway', value: 'responds' },
    reliability: 'high',
  });
  problem.supports({
    observation: 'o_401',
    hypothesis: 'h_auth',
    strength: 'strong',
  });
  problem.contradicts({
    observation: 'o_ping',
    hypothesis: 'h_gateway',
    strength: 'strong',
  });

  const result = problem.evaluate();
  assert.equal(result.status(), 'reasoned');
  assert.match(result.bestExplanationText(), /Authentication service misconfigured/);
  assert.match(result.trace().join('\n'), /Hypothesis h_auth/);
});

test('AdvancedReasoner catalog: probabilistic reasoning performs bounded exact enumeration', () => {
  const problem = new ProbabilisticReasoningProblem('diagnosticTest');
  problem.variable({
    id: 'disease',
    domain: ['yes', 'no'],
  });
  problem.variable({
    id: 'test',
    domain: ['positive', 'negative'],
  });
  problem.prior({
    variable: 'disease',
    distribution: { yes: 0.01, no: 0.99 },
  });
  problem.conditional({
    child: 'test',
    parents: ['disease'],
    table: {
      'disease=yes': { positive: 0.95, negative: 0.05 },
      'disease=no': { positive: 0.1, negative: 0.9 },
    },
  });
  problem.evidence({
    variable: 'test',
    value: 'positive',
    reliability: 'assumed_exact',
  });
  problem.query({ variable: 'disease' });

  const result = problem.infer({ method: 'exact_enumeration', maxJointStates: 32 });
  assert.equal(result.status(), 'reasoned');
  assert.match(result.posteriorText('disease'), /yes=0\.0876/);
  assert.equal(result.certainty(), 'high');
});

test('AdvancedReasoner catalog: argumentation grounded semantics keeps unresolved conflicts explicit', () => {
  const problem = new ArgumentationProblem('deploymentDecision');
  problem.argument({
    id: 'a_speed',
    claim: 'Deployment reduces manual review time',
    source: 'given',
  });
  problem.argument({
    id: 'a_audit',
    claim: 'Deployment should not proceed without audit logs',
    source: 'given',
  });
  problem.argument({
    id: 'a_logs',
    claim: 'Audit logging is already enabled',
    source: 'given',
  });
  problem.relation({
    from: 'a_audit',
    to: 'a_speed',
    type: 'attacks',
    strength: 'medium',
    validated: true,
  });
  problem.relation({
    from: 'a_logs',
    to: 'a_audit',
    type: 'attacks',
    strength: 'medium',
    validated: true,
  });

  const result = problem.evaluate({ semantics: 'grounded' });
  assert.match(result.summaryText(), /Accepted arguments/);
  assert.deepEqual(result.acceptedArguments().map((entry) => entry.id).sort(), ['a_logs', 'a_speed']);
});

test('AdvancedReasoner catalog: optimization reasoning solves a tiny bounded assignment', () => {
  const problem = new OptimizationReasoningProblem('tinySchedule');
  problem.decisionVariable({
    id: 'x',
    domain: { min: 0, max: 3 },
    type: 'integer',
  });
  problem.decisionVariable({
    id: 'y',
    domain: { min: 0, max: 3 },
    type: 'integer',
  });
  problem.constraint({
    id: 'sum',
    kind: 'linear',
    expression: {
      op: 'eq',
      left: { type: 'add', left: { type: 'var', id: 'x' }, right: { type: 'var', id: 'y' } },
      right: { type: 'const', value: 3 },
    },
  });
  problem.objective({
    direction: 'maximize',
    expression: {
      type: 'sub',
      left: { type: 'mul', left: { type: 'const', value: 2 }, right: { type: 'var', id: 'x' } },
      right: { type: 'var', id: 'y' },
    },
    kind: 'linear',
  });

  const result = problem.tryTinySolve({ maxDomainProduct: 32 });
  assert.equal(result.status(), 'solved');
  assert.equal(result.objectiveValue(), 6);
  assert.deepEqual(Object.fromEntries(result.bestAssignment()), { x: 3, y: 0 });
});

test('AdvancedReasoner catalog: pragmatic interpretation asks for clarification when frames are close and action-relevant', () => {
  const problem = new PragmaticInterpretationProblem('ambiguousInstruction');
  problem.utterance({
    id: 'u1',
    text: 'Ship it tomorrow.',
  });
  problem.frame({
    id: 'f_release',
    interpretation: 'Release the product tomorrow',
    assumptions: ['ship means deploy'],
  });
  problem.frame({
    id: 'f_send',
    interpretation: 'Send the package tomorrow',
    assumptions: ['ship means dispatch'],
  });
  problem.contextEvidence({
    id: 'e1',
    text: 'The team was discussing launch timing.',
    supportsFrame: 'f_release',
    strength: 'medium',
  });
  problem.contextEvidence({
    id: 'e2',
    text: 'The warehouse also asked about delivery.',
    supportsFrame: 'f_send',
    strength: 'medium',
  });
  problem.impact({
    frame: 'f_release',
    affectsAction: true,
    severity: 'high',
  });
  problem.impact({
    frame: 'f_send',
    affectsAction: true,
    severity: 'high',
  });

  const result = problem.rankFrames({
    requireClarificationIfClose: true,
    closenessThreshold: 0.6,
  });
  assert.equal(result.status(), 'needs_clarification');
  assert.match(result.summaryText(), /too close to choose safely/);
  assert.match(result.questions()[0], /Did the speaker mean/);
});

test('AdvancedReasoner catalog: belief revision proposes a minimal bounded retraction', () => {
  const problem = new BeliefRevisionProblem('releaseSignals');
  problem.assumption({
    id: 'a_cache',
    proposition: 'The cache metrics are trustworthy',
    retractable: true,
    priority: 'low',
  });
  problem.assumption({
    id: 'a_client',
    proposition: 'Client retries did not change',
    retractable: true,
    priority: 'high',
  });
  problem.contradiction({
    left: 'stable_latency',
    right: 'cache_timeout_spike',
  });

  const result = problem.revise();
  assert.equal(result.status(), 'partial');
  assert.match(result.summaryText(), /retract assumption a_cache/i);
  assert.equal(result.toJSON().resolvedParts?.[0]?.id, 'a_cache');
});

test('AdvancedReasoner catalog: legal reasoning flags disputed normative issues for review', () => {
  const problem = new LegalReasoningProblem('retentionException');
  problem.issue({
    id: 'issue_retention',
    question: 'Can the team keep raw traces for 90 days?',
  });
  problem.fact({
    id: 'fact_purpose',
    proposition: 'The retention exception is justified by incident review needs',
    disputed: true,
  });

  const result = problem.assessApplicability({
    issue: 'issue_retention',
    requireReview: true,
  });
  assert.equal(result.status(), 'needs_review');
  assert.match(result.summaryText(), /normative or disputed elements remain/i);
  assert.match(result.engineReason(), /requires expert legal review/i);
});

test('AdvancedReasoner catalog: scientific synthesis keeps contradictory evidence visible', () => {
  const problem = new ScientificSynthesisProblem('featureImpact');
  problem.claim({
    id: 'claim_ctr',
    statement: 'The onboarding change improves activation',
  });
  problem.study({ id: 's1', description: 'A/B test week 1' });
  problem.study({ id: 's2', description: 'A/B test week 2' });
  problem.quality({ study: 's1', level: 'strong' });
  problem.quality({ study: 's2', level: 'moderate' });
  problem.finding({ study: 's1', claim: 'claim_ctr', direction: 'supports', strength: 'strong' });
  problem.finding({ study: 's2', claim: 'claim_ctr', direction: 'contradicts', strength: 'moderate' });
  problem.limitation({ study: 's2', type: 'sample_bias', description: 'The second week had a smaller segment.' });

  const result = problem.synthesize({ claim: 'claim_ctr', includeNextEvidence: true });
  assert.equal(result.status(), 'partial');
  assert.match(result.summaryText(), /support=/i);
  assert.match(result.questions()[0], /additional study/i);
});

test('AdvancedReasoner catalog: proof routing can prepare arithmetic tasks for SMT translation', () => {
  const problem = new FormalProofRoutingProblem('arithLemma');
  problem.statement({
    id: 'st1',
    domain: 'arithmetic',
    informalText: 'For all integers x, if x > 2 then x + 1 > 3.',
  });

  const result = problem.prepare({
    targetSystem: 'SMTEngine',
    allowInformalSketch: true,
  });
  assert.equal(result.status(), 'partial');
  assert.match(result.summaryText(), /prepared for SMT translation/i);
});

test('AdvancedReasoner catalog: tiny SMT fragments solve locally and expose a model', () => {
  const problem = new SMTReasoningProblem('tinySMT');
  problem.const({ id: 'x', sort: 'Int' });
  problem.const({ id: 'y', sort: 'Int' });
  problem.assert({
    op: 'eq',
    left: { type: 'add', left: { type: 'var', id: 'x' }, right: { type: 'var', id: 'y' } },
    right: { type: 'const', value: 3 },
  });
  problem.assert({
    op: 'eq',
    left: { type: 'var', id: 'x' },
    right: { type: 'const', value: 1 },
  });
  problem.query({ type: 'model' });

  const result = problem.prepareOrSolve({ localLinearIntegerLimit: 4 });
  assert.equal(result.status(), 'solved');
  assert.match(result.summaryText(), /satisfying model/i);
  assert.equal(result.model().get('x'), 1);
});

test('AdvancedReasoner catalog: analogical reasoning scores preserved relational structure', () => {
  const problem = new AnalogicalReasoningProblem('migrationAnalogy');
  problem.sourceEntity({ id: 'cacheA' });
  problem.sourceEntity({ id: 'gatewayA' });
  problem.targetEntity({ id: 'queueB' });
  problem.targetEntity({ id: 'routerB' });
  problem.sourceRelation({ predicate: 'feeds', args: ['cacheA', 'gatewayA'], weight: 2 });
  problem.targetRelation({ predicate: 'feeds', args: ['queueB', 'routerB'], weight: 2 });
  problem.candidateMapping({ source: 'cacheA', target: 'queueB' });
  problem.candidateMapping({ source: 'gatewayA', target: 'routerB' });

  const result = problem.scoreMappings();
  assert.equal(result.status(), 'reasoned');
  assert.match(result.summaryText(), /relational structure/i);
  assert.match(result.trace().join('\n'), /Analogical score/);
});

test('AdvancedReasoner catalog: ethical deliberation blocks promotion when hard constraints are violated', () => {
  const problem = new EthicalDeliberationProblem('incidentResponse');
  problem.option({ id: 'opt_fast', description: 'Ship the change immediately' });
  problem.option({ id: 'opt_reviewed', description: 'Hold the change for manual review' });
  problem.impact({ option: 'opt_fast', stakeholder: 'customers', type: 'benefit', severity: 'critical', likelihood: 'high' });
  problem.impact({ option: 'opt_fast', stakeholder: 'auditors', type: 'harm', severity: 'high', likelihood: 'high' });
  problem.impact({ option: 'opt_reviewed', stakeholder: 'customers', type: 'benefit', severity: 'low', likelihood: 'medium' });
  problem.constraint({ id: 'audit_gate', mustNotViolate: true, violatedBy: ['opt_fast'] });

  const result = problem.compare({ requireReviewForHighRisk: true });
  assert.equal(result.status(), 'needs_review');
  assert.match(result.summaryText(), /cannot be promoted without review/i);
});

test('AdvancedReasoner catalog: creative evaluation reports rubric failures and next revision question', () => {
  const problem = new CreativeEvaluationProblem('operatorNote');
  problem.artifact({
    id: 'draft1',
    content: 'This operator note is intentionally too long and repeats the same deployment summary so it exceeds the small bounded rubric word limit quickly.',
  });
  problem.criterion({ id: 'clarity', weight: 'medium' });
  problem.constraint({ id: 'length', checkType: 'length', maxWords: 10 });

  const result = problem.evaluate({ recommendRevision: true });
  assert.equal(result.status(), 'partial');
  assert.match(result.summaryText(), /failed length/i);
  assert.match(result.questions()[0], /Which revision should address the failed constraints first/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../../src/index.mjs';
import { executeLogicEval } from '../../../src/commands/logic-eval.mjs';
import { createTempRuntimeRoot } from '../../fixtures/runtime-root.mjs';

test('logic-eval emits a structured rewrite brief for external reasoning interpreters', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: {
        logicGeneratorLLM: [JSON.stringify({
          status: 'rewrite_ready',
          rewritten_problem: 'Assign owners under the stated constraints and preserve the requested sections.',
          preferred_interpreters: ['HumanLikeReasoner'],
          decomposition_hints: ['Solve the assignment first, then preserve the requested sections.'],
          answer_requirements: ['Owner assignment', 'Quick wins', 'Parallel work'],
        })],
      },
    },
  });

  const effects = await executeLogicEval({
    runtime,
    targetFamily: 'reasoning_brief',
    body: 'Determine a valid owner assignment and keep the requested sections explicit.',
    node: { dependencies: [] },
    resolvedDependencies: new Map(),
    contextPackage: { markdown: '' },
    kbResult: { callerProfile: null, selected: [] },
  });

  assert.equal(effects.failure, null);
  assert.equal(effects.emittedVariants[0].familyId, 'reasoning_brief');
  assert.equal(effects.emittedVariants[0].meta.logic_eval_mode, 'orchestrator');
  assert.deepEqual(effects.emittedVariants[0].value.preferred_interpreters, ['HumanLikeReasoner']);
  assert.match(effects.emittedVariants[0].value.rewritten_problem, /Assign owners/);
});

test('logic-eval falls back to a heuristic rewrite brief when no scripted LLM rewrite is available', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });

  const effects = await executeLogicEval({
    runtime,
    targetFamily: 'reasoning_brief',
    body: 'Solve the lab assignment and the follow-up graph reachability question.',
    node: { dependencies: [] },
    resolvedDependencies: new Map(),
    contextPackage: { markdown: '' },
    kbResult: { callerProfile: null, selected: [] },
  });

  assert.equal(effects.failure, null);
  assert.equal(effects.emittedVariants[0].meta.logic_eval_mode, 'orchestrator');
  assert.ok(Array.isArray(effects.emittedVariants[0].value.preferred_interpreters));
  assert.match(effects.emittedVariants[0].value.planner_hint, /HumanLikeReasoner/);
});

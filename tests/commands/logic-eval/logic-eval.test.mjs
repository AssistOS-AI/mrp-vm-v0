import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM } from '../../../src/index.mjs';
import { executeLogicEval } from '../../../src/commands/logic-eval.mjs';
import { createTempRuntimeRoot } from '../../fixtures/runtime-root.mjs';

test('logic-eval runs line-oriented rules and emits set actions', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });
  runtime.stateStore.emitVariant('input', 'ok', { created_epoch: 0 });

  const effects = await executeLogicEval({
    runtime,
    targetFamily: 'response',
    body: [
      'when exists input',
      'then set ~response = "accepted" with {"origin":"logic-eval"}',
    ].join('\n'),
  });

  assert.equal(effects.emittedVariants[0].familyId, 'response');
  assert.equal(effects.emittedVariants[0].value, 'accepted');
});

test('logic-eval executes inline SolverProgram bodies and emits structured output', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, { deterministic: {} });

  const effects = await executeLogicEval({
    runtime,
    targetFamily: 'solution',
    body: JSON.stringify({
      result_mode: 'structured',
      program_steps: [
        { op: 'createSolver', varName: 'g', className: 'GraphProblem', options: {} },
        { op: 'solverCall', varName: 'g', method: 'node', args: ['A'] },
        { op: 'solverCall', varName: 'g', method: 'node', args: ['B'] },
        { op: 'solverCall', varName: 'g', method: 'edge', args: ['A', 'B'] },
        { op: 'solverCall', varName: 'g', method: 'findPath', args: ['A', 'B'] },
        { op: 'solverSolve', varName: 'g', resultName: 'path' },
        { op: 'setFinal', value: ['ref', 'results.path.solution.path'] },
      ],
    }),
    node: { dependencies: [] },
    resolvedDependencies: new Map(),
  });

  assert.equal(effects.emittedVariants[0].familyId, 'solution');
  assert.deepEqual(effects.emittedVariants[0].value, ['A', 'B']);
  assert.equal(effects.emittedVariants[0].meta.logic_eval_mode, 'solver');
});

test('logic-eval can formalize a natural-language request through logicGeneratorLLM', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedResponses: {
        'logicGeneratorLLM::default::Find a path from A to B in a tiny graph with one direct edge.': {
          steps: [
            { op: 'createSolver', varName: 'g', className: 'GraphProblem', options: {} },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['A'] },
            { op: 'solverCall', varName: 'g', method: 'node', args: ['B'] },
            { op: 'solverCall', varName: 'g', method: 'edge', args: ['A', 'B'] },
            { op: 'solverCall', varName: 'g', method: 'findPath', args: ['A', 'B'] },
            { op: 'solverSolve', varName: 'g', resultName: 'path' },
            { op: 'setFinal', value: ['ref', 'results.path.solution.path'] },
          ],
        },
      },
    },
  });

  const effects = await executeLogicEval({
    runtime,
    targetFamily: 'solution',
    body: JSON.stringify({
      problem: 'Find a path from A to B in a tiny graph with one direct edge.',
      result_mode: 'structured',
    }),
    node: { dependencies: [] },
    resolvedDependencies: new Map(),
  });

  assert.deepEqual(effects.emittedVariants[0].value, ['A', 'B']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { solveText } from '../../src/logic-eval/solve-text.mjs';
import { FakeLlmAdapter } from '../../src/interpreters/fake-llm-adapter.mjs';

test('solveText executes a full program with fake LLM', async () => {
  const adapter = new FakeLlmAdapter({
    scriptedResponses: {
      'logicGeneratorLLM::default::Find a path from A to B': {
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
    defaultBehavior: 'echo',
  });

  const result = await solveText(adapter, 'Find a path from A to B');
  assert.equal(result.status, 'solved');
  assert.deepEqual(result.result, ['A', 'B']);
});

test('solveText returns needs_clarification for missing obligations', async () => {
  const adapter = new FakeLlmAdapter({
    scriptedResponses: {
      'logicGeneratorLLM::default::Solve something': {
        steps: [
          { op: 'createSolver', varName: 'r', className: 'RuleProblem', options: {} },
          { op: 'solverSolve', varName: 'r', resultName: 'rr' },
          { op: 'setFinal', value: 1 },
        ],
      },
    },
    defaultBehavior: 'echo',
  });

  const result = await solveText(adapter, 'Solve something');
  assert.equal(result.status, 'needs_clarification');
  assert.ok(Array.isArray(result.questions));
  assert.ok(result.questions.length > 0);
});

test('solveText returns invalid_program for bad syntax', async () => {
  const adapter = new FakeLlmAdapter({
    scriptedResponses: {
      'logicGeneratorLLM::default::Bad program': {
        steps: [
          { op: 'badOp', value: 1 },
          { op: 'setFinal', value: 1 },
        ],
      },
    },
    defaultBehavior: 'echo',
  });

  const result = await solveText(adapter, 'Bad program');
  assert.equal(result.status, 'invalid_program');
});

test('solveText skips LLM when programSteps provided', async () => {
  const adapter = new FakeLlmAdapter({ defaultBehavior: 'echo' });
  const result = await solveText(adapter, 'ignored', {
    programSteps: [
      { op: 'createSolver', varName: 'np', className: 'NumericProblem', options: {} },
      { op: 'solverCall', varName: 'np', method: 'variable', args: ['x', 1, 2] },
      { op: 'solverCall', varName: 'np', method: 'constraint', args: [['eq', ['ref', '$x'], 2]] },
      { op: 'solverCall', varName: 'np', method: 'query', args: ['val'] },
      { op: 'solverSolve', varName: 'np', resultName: 'nr' },
      { op: 'setFinal', value: ['ref', 'results.nr.solution.x'] },
    ],
    formatResult: (final) => `The value is ${final}`,
  });
  assert.equal(result.status, 'solved');
  assert.equal(result.text, 'The value is 2');
});

test('solveText handles execution failure gracefully', async () => {
  const adapter = new FakeLlmAdapter({ defaultBehavior: 'echo' });
  const result = await solveText(adapter, 'crash', {
    programSteps: [
      { op: 'assert', expr: false, message: 'boom' },
      { op: 'setFinal', value: 1 },
    ],
    formatResult: (final) => String(final),
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.text.includes('boom'));
});

test('solveText uses custom formatResult function', async () => {
  const adapter = new FakeLlmAdapter({ defaultBehavior: 'echo' });
  const result = await solveText(adapter, 'hello', {
    programSteps: [
      { op: 'set', name: 'msg', value: 'world' },
      { op: 'setFinal', value: ['ref', '$msg'] },
    ],
    formatResult: (final) => `Hello, ${final}!`,
  });
  assert.equal(result.text, 'Hello, world!');
});

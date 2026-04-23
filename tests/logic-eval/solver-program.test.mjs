import test from 'node:test';
import assert from 'node:assert/strict';
import { SolverProgram } from '../../src/logic-eval/solve-text.mjs';
import { ExecutionContext } from '../../src/logic-eval/execution-context.mjs';

test('SolverProgram runs a simple variable sequence', async () => {
  const steps = [
    { op: 'set', name: 'x', value: 10 },
    { op: 'set', name: 'y', value: 20 },
    { op: 'setFinal', value: ['add', ['ref', '$x'], ['ref', '$y']] },
  ];
  const ctx = new ExecutionContext();
  const program = new SolverProgram(steps);
  const final = await program.run(ctx);
  assert.equal(final, 30);
});

test('SolverProgram creates and solves a GraphProblem', async () => {
  const steps = [
    { op: 'createSolver', varName: 'g', className: 'GraphProblem', options: {} },
    { op: 'solverCall', varName: 'g', method: 'node', args: ['A'] },
    { op: 'solverCall', varName: 'g', method: 'node', args: ['B'] },
    { op: 'solverCall', varName: 'g', method: 'edge', args: ['A', 'B'] },
    { op: 'solverCall', varName: 'g', method: 'findPath', args: ['A', 'B'] },
    { op: 'solverSolve', varName: 'g', resultName: 'path' },
    { op: 'setFinal', value: ['ref', 'results.path.solution.path'] },
  ];
  const ctx = new ExecutionContext();
  const program = new SolverProgram(steps);
  const final = await program.run(ctx);
  assert.deepEqual(final, ['A', 'B']);
});

test('SolverProgram handles if branching', async () => {
  const steps = [
    { op: 'set', name: 'flag', value: true },
    {
      op: 'if',
      condition: ['ref', '$flag'],
      then: [{ op: 'set', name: 'out', value: 'yes' }],
      else: [{ op: 'set', name: 'out', value: 'no' }],
    },
    { op: 'setFinal', value: ['ref', '$out'] },
  ];
  const ctx = new ExecutionContext();
  const program = new SolverProgram(steps);
  const final = await program.run(ctx);
  assert.equal(final, 'yes');
});

test('SolverProgram assert halts on failure', async () => {
  const steps = [
    { op: 'assert', expr: false, message: 'expected failure' },
    { op: 'setFinal', value: 1 },
  ];
  const ctx = new ExecutionContext();
  const program = new SolverProgram(steps);
  await assert.rejects(() => program.run(ctx), /expected failure/);
});

test('SolverProgram stores and reads results', async () => {
  const steps = [
    { op: 'createSolver', varName: 'np', className: 'NumericProblem', options: {} },
    { op: 'solverCall', varName: 'np', method: 'variable', args: ['x', 1, 3] },
    { op: 'solverCall', varName: 'np', method: 'query', args: ['val'] },
    { op: 'solverSolve', varName: 'np', resultName: 'nr' },
    { op: 'storeResult', name: 'nr', result: ['ref', 'results.nr'] },
    { op: 'setFinal', value: ['ref', 'results.nr.status'] },
  ];
  const ctx = new ExecutionContext();
  const program = new SolverProgram(steps);
  const final = await program.run(ctx);
  assert.equal(final, 'solved');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { NumericProblem } from '../../../src/logic-eval/solvers/numeric-problem.mjs';

test('NumericProblem solves simple bounded constraints', () => {
  const np = new NumericProblem();
  np.variable('x', 1, 5);
  np.variable('y', 1, 5);
  np.constraint(['gt', ['ref', '$x'], ['ref', '$y']]);
  np.query('values');

  const result = np.solve();
  assert.equal(result.status, 'solved');
  assert.ok(result.solution.x > result.solution.y);
});

test('NumericProblem detects empty interval', () => {
  const np = new NumericProblem();
  assert.throws(() => np.variable('x', 5, 1), /Invalid interval/);
});

test('NumericProblem respects maxProductOfDomains', () => {
  const np = new NumericProblem({ maxProductOfDomains: 10 });
  np.variable('x', 1, 10);
  np.variable('y', 1, 10);
  const result = np.solve();
  assert.equal(result.status, 'too_complex');
});

test('NumericProblem handles objective minimization', () => {
  const np = new NumericProblem();
  np.variable('x', 1, 5);
  np.variable('y', 1, 5);
  np.constraint(['gte', ['add', ['ref', '$x'], ['ref', '$y']], 6]);
  np.objective(['add', ['ref', '$x'], ['ref', '$y']]);
  const result = np.solve();
  assert.equal(result.status, 'solved');
  assert.equal(result.solution._objective, 6);
});

test('NumericProblem returns unsat for impossible constraints', () => {
  const np = new NumericProblem();
  np.variable('x', 1, 3);
  np.constraint(['gt', ['ref', '$x'], 3]);
  const result = np.solve();
  assert.equal(result.status, 'unsat_early');
});

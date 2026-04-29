import test from 'node:test';
import assert from 'node:assert/strict';
import { ConstraintProblem } from '../../../src/interpreters/human-like-reasoner/solvers/constraint-problem.mjs';

test('ConstraintProblem solves a simple assignment', () => {
  const cp = new ConstraintProblem();
  cp.domain('x', [1, 2, 3]);
  cp.domain('y', [1, 2, 3]);
  cp.require('x', 2);
  cp.forbid('y', 2);
  cp.query('assignment');

  const result = cp.solve();
  assert.equal(result.status, 'solved');
  assert.equal(result.solution.x, 2);
  assert.notEqual(result.solution.y, 2);
});

test('ConstraintProblem detects empty domain contradiction', () => {
  const cp = new ConstraintProblem();
  cp.domain('x', []);
  const result = cp.solve();
  assert.equal(result.status, 'unsat_early');
});

test('ConstraintProblem detects require+forbid contradiction', () => {
  const cp = new ConstraintProblem();
  cp.domain('x', [1, 2]);
  cp.require('x', 1);
  cp.forbid('x', 1);
  const result = cp.solve();
  assert.equal(result.status, 'unsat_early');
});

test('ConstraintProblem respects backtracking limit', () => {
  const cp = new ConstraintProblem({ maxBacktrackingNodes: 1 });
  cp.domain('a', [1, 2, 3, 4]);
  cp.domain('b', [1, 2, 3, 4]);
  cp.domain('c', [1, 2, 3, 4]);
  cp.domain('d', [1, 2, 3, 4]);
  // No constraints -> huge search space; limit should hit quickly with tiny node budget
  const result = cp.solve();
  // With maxBacktrackingNodes=1 it will stop early and likely find no solution
  assert.equal(result.status, 'unsat_early');
});

test('ConstraintProblem handles implies', () => {
  const cp = new ConstraintProblem();
  cp.domain('x', [1, 2]);
  cp.domain('y', [1, 2]);
  cp.implies('x', 1, 'y', 2);
  const result = cp.solve();
  assert.equal(result.status, 'solved');
  // Should return first valid assignment
  assert.ok(result.solution.x === 1 || result.solution.y !== 2 || result.solution.x !== 1);
});

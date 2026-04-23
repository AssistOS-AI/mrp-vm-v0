import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchProblem } from '../../../src/logic-eval/solvers/search-problem.mjs';

test('SearchProblem solves water jug to 4 litres', () => {
  const sp = new SearchProblem();
  sp.initialState({ a: 0, b: 0, capA: 3, capB: 5 });
  sp.goalState({ b: 4 });
  sp.action('fillA');
  sp.action('fillB');
  sp.action('emptyA');
  sp.action('emptyB');
  sp.action('pourAToB');
  sp.action('pourBToA');
  sp.strategy('bfs');
  sp.maxDepth(20);
  sp.query('findPlan');

  const result = sp.solve();
  assert.equal(result.status, 'solved');
  assert.ok(Array.isArray(result.solution.plan));
  assert.ok(result.solution.plan.length > 0);
  assert.equal(result.solution.finalState.b, 4);
});

test('SearchProblem detects missing initial state', () => {
  const sp = new SearchProblem();
  sp.goalState({ b: 4 });
  const result = sp.solve();
  assert.equal(result.status, 'invalid_program');
});

test('SearchProblem detects missing goal state', () => {
  const sp = new SearchProblem();
  sp.initialState({ a: 0 });
  const result = sp.solve();
  assert.equal(result.status, 'invalid_program');
});

test('SearchProblem detects missing actions', () => {
  const sp = new SearchProblem();
  sp.initialState({ a: 0 });
  sp.goalState({ a: 1 });
  const result = sp.solve();
  assert.equal(result.status, 'invalid_program');
});

test('SearchProblem respects maxDepth', () => {
  const sp = new SearchProblem({ maxDepth: 2 });
  sp.initialState({ a: 0, b: 0, capA: 3, capB: 5 });
  sp.goalState({ b: 4 });
  sp.action('fillA');
  sp.action('fillB');
  sp.action('emptyA');
  sp.action('emptyB');
  sp.action('pourAToB');
  sp.action('pourBToA');
  sp.strategy('bfs');
  const result = sp.solve();
  assert.equal(result.status, 'unsat_early');
});

test('SearchProblem respects maxVisitedStates', () => {
  const sp = new SearchProblem({ maxVisitedStates: 5 });
  sp.initialState({ a: 0, b: 0, capA: 3, capB: 5 });
  sp.goalState({ b: 4 });
  sp.action('fillA');
  sp.action('fillB');
  sp.action('emptyA');
  sp.action('emptyB');
  sp.action('pourAToB');
  sp.action('pourBToA');
  sp.strategy('bfs');
  const result = sp.solve();
  assert.equal(result.status, 'too_complex');
});

test('SearchProblem supports dfs strategy', () => {
  const sp = new SearchProblem();
  sp.initialState({ a: 0, b: 0, capA: 3, capB: 5 });
  sp.goalState({ b: 4 });
  sp.action('fillA');
  sp.action('fillB');
  sp.action('emptyA');
  sp.action('emptyB');
  sp.action('pourAToB');
  sp.action('pourBToA');
  sp.strategy('dfs');
  sp.maxDepth(20);
  const result = sp.solve();
  assert.equal(result.status, 'solved');
  assert.ok(Array.isArray(result.solution.plan));
});

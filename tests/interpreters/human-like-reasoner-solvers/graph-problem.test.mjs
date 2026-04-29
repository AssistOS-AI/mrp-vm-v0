import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphProblem } from '../../../src/interpreters/human-like-reasoner/solvers/graph-problem.mjs';

test('GraphProblem findPath returns a path', () => {
  const gp = new GraphProblem();
  gp.node('A').node('B').node('C');
  gp.edge('A', 'B').edge('B', 'C');
  gp.findPath('A', 'C');
  const result = gp.solve();
  assert.equal(result.status, 'solved');
  assert.deepEqual(result.solution.path, ['A', 'B', 'C']);
});

test('GraphProblem findShortestPath with weights', () => {
  const gp = new GraphProblem();
  gp.node('A').node('B').node('C').node('D');
  gp.edge('A', 'B', 1).edge('B', 'D', 3);
  gp.edge('A', 'C', 2).edge('C', 'D', 1);
  gp.findShortestPath('A', 'D');
  const result = gp.solve();
  assert.equal(result.status, 'solved');
  assert.deepEqual(result.solution.path, ['A', 'C', 'D']);
  assert.equal(result.solution.cost, 3);
});

test('GraphProblem findReachableFrom', () => {
  const gp = new GraphProblem();
  gp.node('A').node('B').node('C').node('D');
  gp.edge('A', 'B').edge('B', 'C');
  gp.findReachableFrom('A');
  const result = gp.solve();
  assert.equal(result.status, 'solved');
  assert.ok(result.solution.reachable.includes('A'));
  assert.ok(result.solution.reachable.includes('B'));
  assert.ok(result.solution.reachable.includes('C'));
  assert.equal(result.solution.reachable.includes('D'), false);
});

test('GraphProblem findTopologicalOrder', () => {
  const gp = new GraphProblem();
  gp.node('x').node('y').node('z');
  gp.edge('x', 'y').edge('y', 'z');
  gp.findTopologicalOrder();
  const result = gp.solve();
  assert.equal(result.status, 'solved');
  assert.deepEqual(result.solution.order, ['x', 'y', 'z']);
});

test('GraphProblem detects cycle in topological order', () => {
  const gp = new GraphProblem();
  gp.node('a').node('b');
  gp.edge('a', 'b').edge('b', 'a');
  gp.findTopologicalOrder();
  const result = gp.solve();
  assert.equal(result.status, 'unsat_early');
});

test('GraphProblem detects nonexistent node query', () => {
  const gp = new GraphProblem();
  gp.node('A');
  gp.findPath('A', 'Z');
  const result = gp.solve();
  assert.equal(result.status, 'unsat_early');
});

test('GraphProblem respects maxExpansions', () => {
  const gp = new GraphProblem({ maxExpansions: 2 });
  gp.node('A').node('B').node('C').node('D');
  gp.edge('A', 'B').edge('B', 'C').edge('C', 'D');
  gp.findPath('A', 'D');
  const result = gp.solve();
  assert.equal(result.status, 'too_complex');
});

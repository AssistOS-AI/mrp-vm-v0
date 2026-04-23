import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionContext } from '../../src/logic-eval/execution-context.mjs';

test('ExecutionContext initializes registers', () => {
  const ctx = new ExecutionContext({ text: 'hello' });
  const inspect = ctx.toInspect();
  assert.equal(inspect.input.text, 'hello');
  assert.deepEqual(inspect.given, {});
  assert.deepEqual(inspect.vars, {});
  assert.deepEqual(inspect.results, {});
  assert.deepEqual(inspect.assumptions, {});
  assert.deepEqual(inspect.unknown, []);
  assert.deepEqual(inspect.conflicts, []);
  assert.deepEqual(inspect.trace, []);
  assert.equal(inspect.final, undefined);
});

test('set and get work with literals', () => {
  const ctx = new ExecutionContext();
  ctx.set('x', 10);
  assert.equal(ctx.get(['ref', '$x']), 10);
  assert.equal(ctx.has('x'), true);
  assert.equal(ctx.has('y'), false);
});

test('append and extend on lists', () => {
  const ctx = new ExecutionContext();
  ctx.set('items', [1]);
  ctx.append('items', 2);
  ctx.extend('items', [3, 4]);
  assert.deepEqual(ctx.get(['ref', '$items']), [1, 2, 3, 4]);
});

test('project extracts fields', () => {
  const ctx = new ExecutionContext();
  ctx.set('users', [{ name: 'Alice' }, { name: 'Bob' }]);
  ctx.project('names', ['ref', '$users'], 'name');
  assert.deepEqual(ctx.get(['ref', '$names']), ['Alice', 'Bob']);
});

test('filter and map collections', () => {
  const ctx = new ExecutionContext();
  ctx.set('nums', [1, 2, 3, 4]);
  // filter with a property name is not applicable here; use function predicate via value
  // We'll test map with property name and filter with function via literal (not expr-eval function support)
  // Our filter/map accept functions passed as actual JS functions when set directly
  ctx.set('evens', (n) => n % 2 === 0);
  ctx.filter('result', ['ref', '$nums'], ['ref', '$evens']);
  assert.deepEqual(ctx.get(['ref', '$result']), [2, 4]);

  ctx.set('double', (n) => n * 2);
  ctx.map('doubled', ['ref', '$nums'], ['ref', '$double']);
  assert.deepEqual(ctx.get(['ref', '$doubled']), [2, 4, 6, 8]);
});

test('unique removes duplicates', () => {
  const ctx = new ExecutionContext();
  ctx.set('items', [1, 2, 2, 3, 1]);
  ctx.unique('distinct', ['ref', '$items']);
  assert.deepEqual(ctx.get(['ref', '$distinct']), [1, 2, 3]);
});

test('sort orders collections', () => {
  const ctx = new ExecutionContext();
  ctx.set('scores', [{ v: 3 }, { v: 1 }, { v: 2 }]);
  ctx.sort('ordered', ['ref', '$scores'], 'v');
  assert.deepEqual(ctx.get(['ref', '$ordered']), [{ v: 1 }, { v: 2 }, { v: 3 }]);
});

test('count stores cardinality', () => {
  const ctx = new ExecutionContext();
  ctx.set('list', [10, 20, 30]);
  ctx.count('n', ['ref', '$list']);
  assert.equal(ctx.get(['ref', '$n']), 3);
});

test('assert passes and fails', () => {
  const ctx = new ExecutionContext();
  ctx.assert(true, 'should pass');
  assert.throws(() => ctx.assert(false, 'boom'), /boom/);
  assert.equal(ctx.toInspect().conflicts.length, 1);
});

test('assume records hypothesis', () => {
  const ctx = new ExecutionContext();
  ctx.assume('h1', 42);
  assert.equal(ctx.toInspect().assumptions.h1, 42);
});

test('storeResult and result round-trip', () => {
  const ctx = new ExecutionContext();
  ctx.storeResult('r1', { status: 'solved', solution: 7 });
  assert.equal(ctx.result('r1').solution, 7);
});

test('setFinal sets final register', () => {
  const ctx = new ExecutionContext();
  ctx.setFinal({ answer: 42 });
  assert.equal(ctx.toInspect().final.answer, 42);
});

test('trace records operations', () => {
  const ctx = new ExecutionContext();
  ctx.set('a', 1);
  ctx.append('b', 2);
  const trace = ctx.toInspect().trace;
  assert.equal(trace.length, 2);
  assert.equal(trace[0].op, 'set');
  assert.equal(trace[1].op, 'append');
});

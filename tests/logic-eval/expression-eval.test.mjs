import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, isExpr } from '../../src/logic-eval/expression-eval.mjs';
import { ExecutionContext } from '../../src/logic-eval/execution-context.mjs';

function makeCtx(vars = {}) {
  const ctx = new ExecutionContext();
  for (const [k, v] of Object.entries(vars)) {
    ctx.set(k, v);
  }
  return ctx;
}

test('isExpr detects expression arrays', () => {
  assert.equal(isExpr(['ref', 'x']), true);
  assert.equal(isExpr(['eq', 1, 2]), true);
  assert.equal(isExpr('literal'), false);
  assert.equal(isExpr(42), false);
  assert.equal(isExpr(null), false);
});

test('ref resolves context variables', () => {
  const ctx = makeCtx({ name: 'Alice', age: 30 });
  assert.equal(evaluateExpression(['ref', '$name'], ctx), 'Alice');
  assert.equal(evaluateExpression(['ref', '$age'], ctx), 30);
});

test('ref resolves nested paths', () => {
  const ctx = makeCtx({ user: { profile: { score: 99 } } });
  assert.equal(evaluateExpression(['ref', '$user.profile.score'], ctx), 99);
});

test('ref resolves array index paths', () => {
  const ctx = makeCtx({ items: ['a', 'b', 'c'] });
  assert.equal(evaluateExpression(['ref', '$items[1]'], ctx), 'b');
});

test('eq and neq work', () => {
  const ctx = makeCtx({ x: 5 });
  assert.equal(evaluateExpression(['eq', ['ref', '$x'], 5], ctx), true);
  assert.equal(evaluateExpression(['neq', ['ref', '$x'], 5], ctx), false);
});

test('comparisons work', () => {
  const ctx = makeCtx({ a: 10, b: 20 });
  assert.equal(evaluateExpression(['gt', ['ref', '$b'], ['ref', '$a']], ctx), true);
  assert.equal(evaluateExpression(['lt', ['ref', '$a'], ['ref', '$b']], ctx), true);
  assert.equal(evaluateExpression(['gte', ['ref', '$a'], 10], ctx), true);
  assert.equal(evaluateExpression(['lte', ['ref', '$b'], 20], ctx), true);
});

test('and / or / not logic', () => {
  const ctx = makeCtx({});
  assert.equal(evaluateExpression(['and', true, true, false], ctx), false);
  assert.equal(evaluateExpression(['or', false, true, false], ctx), true);
  assert.equal(evaluateExpression(['not', true], ctx), false);
});

test('count operator', () => {
  const ctx = makeCtx({ list: [1, 2, 3], text: 'hello', obj: { a: 1, b: 2 } });
  assert.equal(evaluateExpression(['count', ['ref', '$list']], ctx), 3);
  assert.equal(evaluateExpression(['count', ['ref', '$text']], ctx), 5);
  assert.equal(evaluateExpression(['count', ['ref', '$obj']], ctx), 2);
});

test('path slicing', () => {
  const ctx = makeCtx({ arr: [10, 20, 30, 40] });
  assert.deepEqual(evaluateExpression(['path', ['ref', '$arr'], 1, 3], ctx), [20, 30]);
  assert.equal(evaluateExpression(['path', ['ref', '$arr'], 0], ctx), 10);
});

test('arithmetic operators', () => {
  const ctx = makeCtx({ x: 6, y: 3 });
  assert.equal(evaluateExpression(['add', ['ref', '$x'], ['ref', '$y']], ctx), 9);
  assert.equal(evaluateExpression(['sub', ['ref', '$x'], ['ref', '$y']], ctx), 3);
  assert.equal(evaluateExpression(['mul', ['ref', '$x'], ['ref', '$y']], ctx), 18);
  assert.equal(evaluateExpression(['div', ['ref', '$x'], ['ref', '$y']], ctx), 2);
});

test('in and contains operators', () => {
  const ctx = makeCtx({ list: ['a', 'b'], text: 'hello' });
  assert.equal(evaluateExpression(['in', 'a', ['ref', '$list']], ctx), true);
  assert.equal(evaluateExpression(['contains', ['ref', '$text'], 'ell'], ctx), true);
});

test('literal passthrough', () => {
  const ctx = makeCtx({});
  assert.equal(evaluateExpression(42, ctx), 42);
  assert.equal(evaluateExpression('hello', ctx), 'hello');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGraph } from '../../src/index.mjs';

test('compileGraph orders dependent declarations topologically', () => {
  const plan = [
    '@input writerLLM',
    'hello',
    '',
    '@response js-eval',
    'return $input;',
  ].join('\n');

  const graph = compileGraph(plan);
  assert.equal(graph.strata.length, 2);
  assert.equal(graph.strata[0][0].targetFamily, 'input');
  assert.equal(graph.strata[1][0].targetFamily, 'response');
});

test('compileGraph rejects static cycles', () => {
  const plan = [
    '@a js-eval',
    'return $b;',
    '',
    '@b js-eval',
    'return $a;',
  ].join('\n');

  assert.throws(() => compileGraph(plan), /cycle/i);
});

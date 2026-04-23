import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleProblem } from '../../../src/logic-eval/solvers/rule-problem.mjs';

test('RuleProblem deduces transitive facts', () => {
  const rp = new RuleProblem();
  rp.fact('mentor', ['alice', 'bob']);
  rp.fact('mentor', ['bob', 'carol']);
  rp.rule(
    { predicate: 'before', args: ['?x', '?y'] },
    [{ predicate: 'mentor', args: ['?x', '?y'] }],
  );
  rp.rule(
    { predicate: 'before', args: ['?x', '?z'] },
    [
      { predicate: 'mentor', args: ['?x', '?y'] },
      { predicate: 'before', args: ['?y', '?z'] },
    ],
  );
  rp.queryAll('before');

  const result = rp.solve();
  assert.equal(result.status, 'solved');
  const beforeFacts = result.solution.answers[0].result;
  assert.equal(beforeFacts.length, 3); // alice->bob, bob->carol, alice->carol
});

test('RuleProblem queryFact returns correct boolean', () => {
  const rp = new RuleProblem();
  rp.fact('color', ['sky', 'blue']);
  rp.queryFact('color', ['sky', 'blue']);
  rp.queryFact('color', ['sky', 'green']);

  const result = rp.solve();
  assert.equal(result.status, 'solved');
  assert.equal(result.solution.answers[0].result, true);
  assert.equal(result.solution.answers[1].result, false);
});

test('RuleProblem respects maxDerivedFacts limit', () => {
  const rp = new RuleProblem({ maxDerivedFacts: 1 });
  rp.fact('link', ['a', 'b']);
  rp.fact('link', ['b', 'c']);
  rp.rule(
    { predicate: 'link', args: ['?x', '?z'] },
    [
      { predicate: 'link', args: ['?x', '?y'] },
      { predicate: 'link', args: ['?y', '?z'] },
    ],
  );

  const result = rp.solve();
  assert.equal(result.status, 'too_complex');
});

test('RuleProblem stats are populated', () => {
  const rp = new RuleProblem();
  rp.fact('x', ['a']);
  rp.queryAll('x');
  const result = rp.solve();
  assert.equal(result.stats.iterations >= 1, true);
  assert.equal(result.stats.derivedFacts >= 0, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionGenerator } from '../../src/logic-eval/question-generator.mjs';

test('QuestionGenerator returns empty for empty obligations', () => {
  const qs = QuestionGenerator.generate([]);
  assert.deepEqual(qs, []);
});

test('QuestionGenerator produces structural questions', () => {
  const missing = [
    'Missing query for RuleProblem',
    'Missing nodes for GraphProblem',
    'Missing constraints for ConstraintProblem',
  ];
  const qs = QuestionGenerator.generate(missing);
  assert.equal(qs.length, 3);
  assert.equal(qs[0].kind, 'structural');
  assert.equal(qs[0].source, 'obligation');
  assert.ok(qs[0].text.includes('query') || qs[0].text.includes('Please clarify'));
});

test('QuestionGenerator uses templates for known keywords', () => {
  const qs = QuestionGenerator.generate(['What are the possible values for "color"?']);
  assert.equal(qs.length, 1);
  assert.ok(qs[0].text.length > 0);
});

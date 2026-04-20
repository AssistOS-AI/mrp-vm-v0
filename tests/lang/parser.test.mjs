import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, parseSopModule } from '../../src/index.mjs';

test('parsePlan preserves bodies and references', () => {
  const source = [
    '@draft js-eval',
    'return $input;',
    '',
    '@response template-eval',
    '{{default final "none"}}',
    '',
  ].join('\n');

  const parsed = parsePlan(source);
  assert.equal(parsed.declarations.length, 2);
  assert.equal(parsed.declarations[0].target, 'draft');
  assert.equal(parsed.declarations[0].references[0].raw, '$input');
  assert.equal(parsed.declarations[1].declaration_kind, 'single');
  assert.equal(parsed.declarations[1].body, '{{default final "none"}}\n');
});

test('parseSopModule reads declaration-style SOP module entries', () => {
  const source = [
    '@ku_sample text',
    'Hello',
    'World',
    '@ku_sample:meta json',
    '{"rev":1,"ku_type":"content"}',
  ].join('\n');

  const entries = parseSopModule(source);
  assert.equal(entries.get('ku_sample'), 'Hello\nWorld');
  assert.deepEqual(entries.get('ku_sample:meta'), { rev: 1, ku_type: 'content' });
});

test('parseSopModule keeps legacy assignment syntax readable during migration', () => {
  const source = [
    'ku_sample = """',
    'Hello',
    'World',
    '"""',
    'ku_sample:meta = {"rev":1,"ku_type":"content"}',
  ].join('\n');

  const entries = parseSopModule(source);
  assert.equal(entries.get('ku_sample'), 'Hello\nWorld');
  assert.deepEqual(entries.get('ku_sample:meta'), { rev: 1, ku_type: 'content' });
});

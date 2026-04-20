import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { KbStore } from '../../../src/index.mjs';
import { createTempRuntimeRoot } from '../../fixtures/runtime-root.mjs';

test('kb snapshot loads default caller profiles and prompt assets', async () => {
  const rootDir = await createTempRuntimeRoot();
  const store = new KbStore(rootDir);
  const catalog = await store.snapshotForRequest('session-1');

  assert.ok(catalog.some((entry) => entry.kuId === 'planning'));
  assert.ok(catalog.some((entry) => entry.meta.mandatory_group === 'planning_init_core'));
});

test('kb retrieval uses lexical search for explicit queries and session precedence', async () => {
  const rootDir = await createTempRuntimeRoot();
  const sessionFile = path.join(rootDir, 'data', 'sessions', 'session-2', 'kb', 'notes.sop');
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, [
    '@ku_session_note text',
    'Alpha project note with deterministic retrieval',
    '@ku_session_note:meta json',
    '{"rev":1,"ku_type":"content","scope":"session","status":"active","title":"Alpha note","summary":"Session note","priority":1,"trust":"trusted","domains":["runtime"],"commands":["kb"],"interpreters":[],"tags":["alpha"],"input_patterns":[]}',
  ].join('\n'));

  const store = new KbStore(rootDir);
  const catalog = await store.snapshotForRequest('session-2');
  const result = store.retrieve(catalog, {
    callerName: 'kb',
    retrievalMode: 'explicit_kb_query',
    requestText: 'Alpha retrieval',
    queryTokens: ['Alpha retrieval'],
    desiredKuTypes: ['content'],
    byteBudget: 2048,
  });

  assert.equal(result.selected[0].kuId, 'ku_session_note');
});

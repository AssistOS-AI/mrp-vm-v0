import test from 'node:test';
import assert from 'node:assert/strict';
import { MRPVM, executeDocumentScalePlanner } from '../../src/index.mjs';
import { JsonDocument, MarkdownDocument } from '../../src/interpreters/document-scale-planner/index.mjs';
import { createTempRuntimeRoot } from '../fixtures/runtime-root.mjs';

function buildContext(body, dependencyMap = new Map()) {
  return {
    targetFamily: 'document_plan',
    body,
    request: {
      requestText: typeof body === 'string' ? body : JSON.stringify(body),
    },
    node: {
      dependencies: [...dependencyMap.keys()].map((raw) => ({ raw })),
    },
    resolvedDependencies: dependencyMap,
  };
}

test('markdown and json planning primitives expose deterministic structural units', () => {
  const markdown = MarkdownDocument.from({
    content: [
      '# Planning',
      'Bounded plans should stay explicit.',
      '',
      '# Execution',
      'Traceability should stay visible.',
    ].join('\n'),
  });
  const sections = markdown.sections({ fromHeadingLevel: 1, toHeadingLevel: 1 });
  assert.equal(sections.length, 2);
  assert.match(sections[0].structuralPath, /h1_01/);

  const json = JsonDocument.from({
    content: {
      chapters: [
        { title: 'Planning', text: 'Explicit plans.' },
        { title: 'Execution', text: 'Visible traces.' },
      ],
    },
  });
  const units = json.units({
    path: 'chapters',
    unitType: 'record',
    textField: 'text',
  });
  assert.equal(units.length, 2);
  assert.equal(units[1].title, 'Execution');
});

test('DocumentScalePlanner emits explicit declaration insertions for markdown idea extraction', async () => {
  const dependencyMap = new Map([
    ['~memo', {
      value: [
        '# Reliability review',
        'Every risky deploy now gets a dry run with operator notes.',
        '',
        '# Knowledge hygiene',
        'Incident notes now record the owning interpreter and SOP revision.',
      ].join('\n'),
    }],
  ]);

  const effects = await executeDocumentScalePlanner(buildContext(JSON.stringify({
    document_ref: '~memo',
    operation: 'extract_ideas',
    granularity: 'chapter',
    final_target: 'ideas_global',
    task: 'Preserve sections Key ideas, Source coverage, and Next focus.',
  }), dependencyMap));

  assert.equal(effects.failure, null);
  assert.equal(effects.declarationInsertions.length, 1);
  assert.match(effects.declarationInsertions[0].text, /@chunk_/);
  assert.match(effects.declarationInsertions[0].text, /@ideas_global writerLLM/);
  assert.match(effects.declarationInsertions[0].text, /@document_plan template-eval/);
  const summary = effects.emittedVariants.find((entry) => entry.familyId === 'document_plan:plan_summary');
  assert.match(String(summary?.value), /Status: plan_ready/);
  assert.match(String(summary?.value), /Final target: ideas_global/);
});

test('DocumentScalePlanner returns too_large when declaration estimate exceeds the configured bound', async () => {
  const dependencyMap = new Map([
    ['~memo', {
      value: [
        '# Planning',
        'One paragraph.',
        '',
        '# Execution',
        'Second paragraph.',
        '',
        '# Traceability',
        'Third paragraph.',
      ].join('\n'),
    }],
  ]);

  const effects = await executeDocumentScalePlanner(buildContext(JSON.stringify({
    document_ref: '~memo',
    operation: 'extract_ideas',
    granularity: 'chapter',
    max_declarations_per_plan: 2,
  }), dependencyMap));

  assert.equal(effects.declarationInsertions.length, 0);
  const summary = effects.emittedVariants.find((entry) => entry.familyId === 'document_plan');
  assert.match(String(summary?.value), /Status: too_large/);
});

test('runtime executes a planner-generated document-scale plan end-to-end', async () => {
  const rootDir = await createTempRuntimeRoot();
  const runtime = new MRPVM(rootDir, {
    deterministic: {},
    fakeAdapterConfig: {
      scriptedSequences: {
        plannerLLM: [[
          '@bookDraft js-eval',
          `return ${JSON.stringify([
            '# Reliability review',
            'Every risky deploy now gets a dry run with operator notes.',
            '',
            '# Knowledge hygiene',
            'Incident notes now record the owning interpreter and SOP revision.',
          ].join('\n'))};`,
          '',
          '@document_plan DocumentScalePlanner',
          'document_ref ~bookDraft',
          JSON.stringify({
            document_ref: '~bookDraft',
            operation: 'extract_ideas',
            granularity: 'chapter',
            final_target: 'ideas_global',
            task: 'Preserve sections Key ideas, Source coverage, and Next focus.',
          }),
          '',
          '@response template-eval',
          '$document_plan',
        ].join('\n')],
        writerLLM: [
          'Key ideas:\n- Risky deploys now require a rehearsal.\n\nSource coverage:\n- Chunk 1.\n\nNext focus:\n- Compare rehearsal quality.',
          'Key ideas:\n- Incident notes now carry interpreter and SOP provenance.\n\nSource coverage:\n- Chunk 2.\n\nNext focus:\n- Standardize the provenance field.',
          'Key ideas:\n- Reliability chapter merged.\n\nSource coverage:\n- Group 1.\n\nNext focus:\n- Audit the rehearsal path.',
          'Key ideas:\n- Knowledge-hygiene chapter merged.\n\nSource coverage:\n- Group 2.\n\nNext focus:\n- Audit provenance completeness.',
          'Key ideas:\n- Risky deploys now require a rehearsal.\n- Incident notes now carry interpreter and SOP provenance.\n\nSource coverage:\n- Both chapters were covered.\n\nNext focus:\n- Standardize rehearsal and provenance templates.',
        ],
      },
    },
  });

  const outcome = await runtime.submitRequest({
    requestText: [
      'Use DocumentScalePlanner for the bounded Markdown memo.',
      'Preserve sections Key ideas, Source coverage, and Next focus.',
    ].join('\n'),
  });

  assert.equal(outcome.stop_reason, 'completed');
  assert.match(String(outcome.response), /Key ideas:/);
  assert.match(String(outcome.response), /Source coverage:/);
  const inspection = await runtime.inspectRequestPublic(outcome.request_id);
  assert.match(inspection.plan_snapshot, /@document_plan DocumentScalePlanner/);
  assert.match(inspection.plan_snapshot, /@ideas_global writerLLM/);
  assert.match(inspection.plan_snapshot, /@document_plan template-eval/);
});

import { createEmptyEffects } from '../../runtime/effects.mjs';
import { createFailureRecord } from '../../utils/errors.mjs';
import { canonicalText, hashText, normalizeWhitespace, stableStringify } from '../../utils/text.mjs';
import {
  CoverageValidator,
  ChunkPipelineTemplate,
  ChunkPlanner,
  ChunkVariableBuilder,
  CompositionPlanner,
  DocumentPlanResponse,
  DocumentPlanningContext,
  JsonDocument,
  MarkdownDocument,
} from './planning-primitives.mjs';

const DEFAULT_MAX_DECLARATIONS_PER_PLAN = 48;
const DEFAULT_MAX_TOKENS_PER_CHUNK = 900;

const OPERATION_CATALOG = [
  {
    id: 'extract_ideas',
    matches: [/idea/i, /insight/i, /theme/i, /technically useful/i, /philosophically important/i],
    targetPrefix: 'ideas',
    perChunkCommand: 'writerLLM',
    perChunkPrompt: 'Extract original, technically useful, or philosophically important ideas from the resolved direct dependency chunk. Preserve provenance, source chunk, structural path, offsets, and confidence.',
    aggregatePrompt: 'Merge the resolved idea results, group them by theme, deduplicate close paraphrases, preserve provenance, and rank the most useful ideas first.',
    outputSchema: 'ranked_ideas_by_theme_with_sources',
  },
  {
    id: 'chapter_profile',
    matches: [/profile/i, /dense idea region/i, /weak argument/i, /chapter/i],
    targetPrefix: 'profile',
    perChunkCommand: 'writerLLM',
    perChunkPrompt: 'Produce a document-unit profile for the resolved direct dependency chunk. Return central thesis, dominant topics, dense idea regions, weak argument regions, recommended expansion units, and confidence.',
    aggregatePrompt: 'Merge the resolved chapter or section profiles into one document-scale planning profile. Preserve selected regions and confidence notes.',
    outputSchema: 'document_profiles_with_recommended_expansion',
  },
  {
    id: 'summarize_sections',
    matches: [/summary/i, /summar/i, /thesis/i],
    targetPrefix: 'summary',
    perChunkCommand: 'writerLLM',
    perChunkPrompt: 'Summarize the resolved direct dependency chunk and preserve section-level provenance in a compact structured form.',
    aggregatePrompt: 'Merge the resolved chunk summaries into one coherent document summary while preserving provenance and section distinctions.',
    outputSchema: 'hierarchical_summary_with_sources',
  },
  {
    id: 'extract_claims',
    matches: [/claim/i, /evidence/i, /citation/i, /contradiction/i],
    targetPrefix: 'claims',
    perChunkCommand: 'writerLLM',
    perChunkPrompt: 'Extract explicit claims, cited evidence, contradictions, or verification issues from the resolved direct dependency chunk. Preserve provenance and confidence.',
    aggregatePrompt: 'Merge the resolved claim or evidence outputs into one grouped global report with provenance, contradictions, and unresolved checks.',
    outputSchema: 'claims_and_evidence_with_sources',
  },
];

function parseBodyJson(body) {
  const trimmed = String(body ?? '').trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"'))) {
    return { parsed: null, attempted: false };
  }
  return {
    parsed: JSON.parse(trimmed),
    attempted: true,
  };
}

function parseEmbeddedJsonObject(body) {
  const text = String(body ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { parsed: null, attempted: false };
  }
  const candidate = text.slice(start, end + 1).trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
    return { parsed: null, attempted: false };
  }
  return {
    parsed: JSON.parse(candidate),
    attempted: true,
  };
}

function parseFrontMatterLines(body) {
  const output = {};
  const fieldMap = new Map([
    ['document_ref', 'documentRef'],
    ['document_text', 'documentText'],
    ['document_json', 'documentJson'],
    ['operation', 'operation'],
    ['granularity', 'granularity'],
    ['final_target', 'finalTarget'],
    ['path', 'path'],
    ['text_field', 'textField'],
    ['task', 'task'],
    ['document_id', 'documentId'],
    ['max_declarations_per_plan', 'maxDeclarationsPerPlan'],
    ['max_tokens_per_chunk', 'maxTokensPerChunk'],
  ]);
  for (const line of String(body ?? '').split('\n')) {
    const match = /^([a-z_]+)\s*[:=]\s*(.+)$/.exec(line.trim()) ?? /^([a-z_]+)\s+(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const [, rawKey, rawValue] = match;
    const mappedKey = fieldMap.get(rawKey);
    if (!mappedKey) {
      continue;
    }
    output[mappedKey] = rawValue.trim();
  }
  return output;
}

function resolveReferenceEntry(context, token) {
  return context.resolvedDependencies?.get(token) ?? null;
}

function materializeEmbeddedReferences(value, context) {
  if (Array.isArray(value)) {
    return value.map((entry) => materializeEmbeddedReferences(entry, context));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, materializeEmbeddedReferences(entry, context)]),
    );
  }
  if (typeof value === 'string') {
    const resolved = resolveReferenceEntry(context, value);
    if (resolved) {
      return resolved.value;
    }
  }
  return value;
}

function normalizeReferenceAlias(token) {
  return String(token ?? '')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[^a-zA-Z0-9_$]+/g, '_');
}

function buildExecutionRefs(context) {
  const refs = {};
  for (const [token, resolved] of context.resolvedDependencies?.entries() ?? []) {
    const value = resolved?.value ?? resolved?.rendered ?? null;
    refs[token] = value;
    const alias = normalizeReferenceAlias(token);
    if (alias && !(alias in refs)) {
      refs[alias] = value;
    }
  }
  return refs;
}

function extractReferenceTokens(text, context) {
  const matches = String(text ?? '').match(/~[A-Za-z_][A-Za-z0-9_:]*/g) ?? [];
  const known = matches.filter((token) => resolveReferenceEntry(context, token));
  return [...new Set(known)];
}

function inferOperation(envelope, context) {
  if (envelope.operation) {
    return OPERATION_CATALOG.find((entry) => entry.id === envelope.operation) ?? null;
  }
  const sourceText = [
    envelope.task,
    context.request?.requestText ?? '',
    context.body ?? '',
  ].join('\n');
  return OPERATION_CATALOG.find((entry) => entry.matches.every((pattern) => pattern.test(sourceText)))
    ?? OPERATION_CATALOG.find((entry) => entry.matches.some((pattern) => pattern.test(sourceText)))
    ?? null;
}

function inferGranularity(envelope, documentHandle) {
  if (envelope.granularity) {
    return envelope.granularity;
  }
  const task = String(envelope.task ?? '');
  if (/paragraph/i.test(task)) {
    return 'paragraph';
  }
  if (/table/i.test(task)) {
    return 'table';
  }
  if (/section/i.test(task)) {
    return 'section';
  }
  if (documentHandle.type === 'json') {
    return 'record';
  }
  return 'chapter';
}

function inferJsonPath(envelope, documentHandle) {
  if (envelope.path) {
    return envelope.path;
  }
  const root = documentHandle.content;
  if (Array.isArray(root)) {
    return '.';
  }
  if (root && typeof root === 'object') {
    if (Array.isArray(root.chapters)) {
      return 'chapters';
    }
    if (Array.isArray(root.items)) {
      return 'items';
    }
  }
  return '.';
}

function buildDocumentHandle(envelope, context) {
  if (typeof envelope.documentText === 'string' && envelope.documentText.trim()) {
    return {
      token: null,
      documentId: envelope.documentId ?? 'inline_document',
      type: 'markdown',
      content: envelope.documentText,
      documentRevision: hashText(envelope.documentText),
      metadata: {},
    };
  }
  if (envelope.documentJson !== undefined && envelope.documentJson !== null) {
    const content = typeof envelope.documentJson === 'string' ? JSON.parse(envelope.documentJson) : envelope.documentJson;
    return {
      token: null,
      documentId: envelope.documentId ?? 'inline_json_document',
      type: 'json',
      content,
      documentRevision: hashText(canonicalText(content)),
      metadata: {},
    };
  }
  const candidateTokens = [
    envelope.documentRef,
    ...extractReferenceTokens(context.body, context),
    ...context.node?.dependencies?.map((entry) => entry.raw) ?? [],
  ].filter(Boolean);
  const token = candidateTokens.find((entry) => resolveReferenceEntry(context, entry));
  if (!token) {
    return null;
  }
  const resolved = resolveReferenceEntry(context, token);
  const raw = resolved?.value ?? resolved?.rendered ?? null;
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const content = JSON.parse(trimmed);
      return {
        token,
        documentId: envelope.documentId ?? (normalizeReferenceAlias(token) || 'json_document'),
        type: 'json',
        content,
        documentRevision: hashText(canonicalText(content)),
        metadata: resolved?.meta ?? {},
      };
    }
    return {
      token,
      documentId: envelope.documentId ?? (normalizeReferenceAlias(token) || 'markdown_document'),
      type: 'markdown',
      content: raw,
      documentRevision: hashText(raw),
      metadata: resolved?.meta ?? {},
    };
  }
  if (raw && typeof raw === 'object') {
    return {
      token,
      documentId: envelope.documentId ?? (normalizeReferenceAlias(token) || 'json_document'),
      type: 'json',
      content: raw,
      documentRevision: hashText(canonicalText(raw)),
      metadata: resolved?.meta ?? {},
    };
  }
  return {
    token,
    documentId: envelope.documentId ?? (normalizeReferenceAlias(token) || 'document'),
    type: 'unsupported',
    content: raw,
    documentRevision: hashText(canonicalText(raw)),
    metadata: resolved?.meta ?? {},
  };
}

function normalizeEnvelope(context) {
  const trimmed = String(context.body ?? '').trim();
  const frontMatter = parseFrontMatterLines(trimmed);
  const directReference = resolveReferenceEntry(context, trimmed);
  if (directReference && typeof directReference.value === 'object' && directReference.value !== null) {
    const referenced = directReference.value;
    return {
      task: referenced.task ?? referenced.problem ?? referenced.request ?? context.request?.requestText ?? '',
      documentRef: referenced.document_ref ?? referenced.source_ref ?? null,
      documentText: referenced.document_text ?? null,
      documentJson: referenced.document_json ?? null,
      operation: referenced.operation ?? null,
      granularity: referenced.granularity ?? null,
      finalTarget: referenced.final_target ?? null,
      path: referenced.path ?? null,
      textField: referenced.text_field ?? null,
      selectedPaths: referenced.selected_paths ?? null,
      maxDeclarationsPerPlan: referenced.max_declarations_per_plan ?? null,
      maxTokensPerChunk: referenced.max_tokens_per_chunk ?? null,
      documentId: referenced.document_id ?? null,
    };
  }
  const directJson = parseBodyJson(trimmed);
  const embeddedJson = !directJson.attempted ? parseEmbeddedJsonObject(trimmed) : { parsed: null, attempted: false };
  const { parsed, attempted } = directJson.attempted ? directJson : embeddedJson;
  if (attempted) {
    const materialized = materializeEmbeddedReferences(parsed, context);
    if (typeof materialized === 'object' && materialized !== null && !Array.isArray(materialized)) {
      return {
        task: materialized.task ?? materialized.problem ?? materialized.request ?? frontMatter.task ?? context.request?.requestText ?? '',
        documentRef: materialized.document_ref ?? materialized.source_ref ?? frontMatter.documentRef ?? extractReferenceTokens(trimmed, context)[0] ?? null,
        documentText: materialized.document_text ?? frontMatter.documentText ?? null,
        documentJson: materialized.document_json ?? frontMatter.documentJson ?? null,
        operation: materialized.operation ?? frontMatter.operation ?? null,
        granularity: materialized.granularity ?? frontMatter.granularity ?? null,
        finalTarget: materialized.final_target ?? frontMatter.finalTarget ?? null,
        path: materialized.path ?? frontMatter.path ?? null,
        textField: materialized.text_field ?? frontMatter.textField ?? null,
        selectedPaths: materialized.selected_paths ?? null,
        maxDeclarationsPerPlan: materialized.max_declarations_per_plan ?? frontMatter.maxDeclarationsPerPlan ?? null,
        maxTokensPerChunk: materialized.max_tokens_per_chunk ?? frontMatter.maxTokensPerChunk ?? null,
        documentId: materialized.document_id ?? frontMatter.documentId ?? null,
      };
    }
  }
  return {
    task: frontMatter.task ?? trimmed,
    documentRef: frontMatter.documentRef ?? extractReferenceTokens(trimmed, context)[0] ?? null,
    documentText: frontMatter.documentText ?? null,
    documentJson: frontMatter.documentJson ?? null,
    operation: frontMatter.operation ?? null,
    granularity: frontMatter.granularity ?? null,
    finalTarget: frontMatter.finalTarget ?? null,
    path: frontMatter.path ?? null,
    textField: frontMatter.textField ?? null,
    selectedPaths: null,
    maxDeclarationsPerPlan: frontMatter.maxDeclarationsPerPlan ?? null,
    maxTokensPerChunk: frontMatter.maxTokensPerChunk ?? null,
    documentId: frontMatter.documentId ?? null,
  };
}

function renderChunkPrompt(operation, chunk, taskText) {
  return [
    `${operation.perChunkPrompt}`,
    taskText ? `Original user objective:\n${taskText}` : '',
    `Chunk id: ${chunk.chunkId}.`,
    `Chunk path: ${chunk.structuralPath}.`,
    'Use the resolved direct dependency chunk descriptor as the source of truth.',
    'Keep the output compact and provenance-aware.',
  ].join('\n');
}

function renderRollupPrompt(operation, scopeLabel, taskText) {
  return [
    `${operation.aggregatePrompt}`,
    taskText ? `Original user objective:\n${taskText}` : '',
    `Current scope: ${scopeLabel}.`,
    'Use only the resolved direct dependency results as input evidence.',
    'Return one compact synthesis that stays provenance-aware.',
  ].join('\n');
}

function selectUnits(documentHandle, envelope, operation) {
  if (documentHandle.type === 'markdown') {
    const doc = MarkdownDocument.from({
      content: documentHandle.content,
    });
    const granularity = inferGranularity(envelope, documentHandle);
    if (granularity === 'paragraph') {
      return { granularity, units: doc.paragraphs(), estimate: doc.estimate() };
    }
    if (granularity === 'table') {
      return { granularity, units: doc.tables(), estimate: doc.estimate() };
    }
    if (granularity === 'section') {
      return { granularity, units: doc.sections({ fromHeadingLevel: 1, toHeadingLevel: 2 }), estimate: doc.estimate() };
    }
    const chapterUnits = doc.sections({ fromHeadingLevel: 1, toHeadingLevel: 1 });
    return {
      granularity: 'chapter',
      units: chapterUnits.length > 0 ? chapterUnits : doc.paragraphs(),
      estimate: doc.estimate(),
    };
  }
  if (documentHandle.type === 'json') {
    const doc = JsonDocument.from({
      content: documentHandle.content,
    });
    const path = inferJsonPath(envelope, documentHandle);
    const granularity = inferGranularity(envelope, documentHandle);
    const textField = envelope.textField ?? (operation?.id === 'chapter_profile' ? 'text' : 'text');
    return {
      granularity,
      units: doc.units({
        path,
        unitType: granularity === 'record' ? 'record' : granularity,
        textField,
      }),
      estimate: doc.estimate(),
      path,
    };
  }
  return { granularity: inferGranularity(envelope, documentHandle), units: [], estimate: {} };
}

function filterSelectedUnits(units, envelope) {
  const selected = Array.isArray(envelope.selectedPaths) ? new Set(envelope.selectedPaths) : null;
  if (!selected || selected.size === 0) {
    return units;
  }
  return units.filter((unit) => selected.has(unit.structuralPath) || selected.has(unit.parentId));
}

function renderMetaSurface(response) {
  const lines = [
    `status ${response.status}`,
    'interpreter DocumentScalePlanner',
    response.metadata?.documentType ? `document_type ${response.metadata.documentType}` : '',
    response.metadata?.operation ? `operation ${response.metadata.operation}` : '',
    response.metadata?.granularity ? `granularity ${response.metadata.granularity}` : '',
    Number.isFinite(response.metadata?.chunkCount) ? `chunk_count ${response.metadata.chunkCount}` : '',
    Number.isFinite(response.metadata?.estimatedDeclarations) ? `estimated_declarations ${response.metadata.estimatedDeclarations}` : '',
    response.metadata?.recommendedStrategy ? `recommended_strategy ${response.metadata.recommendedStrategy}` : '',
    response.metadata?.requiredInput ? `required_input ${response.metadata.requiredInput}` : '',
    response.metadata?.finalTarget ? `final_target ${response.metadata.finalTarget}` : '',
    'promotion_allowed no',
  ].filter(Boolean);
  return lines.join('\n');
}

function pushDocumentPlannerSurfaces(effects, targetFamily, response) {
  const awaitingInsertedPlan = response.status === 'plan_ready' || response.status === 'partial_plan';
  effects.emittedVariants.push({
    familyId: targetFamily,
    value: response.summary,
    meta: {
      origin: 'DocumentScalePlanner',
      source_interpreter: 'DocumentScalePlanner',
      status: awaitingInsertedPlan ? 'blocked' : 'active',
      reason: awaitingInsertedPlan ? 'awaiting_inserted_plan' : response.text,
    },
  });
  effects.emittedVariants.push({
    familyId: `${targetFamily}:plan_summary`,
    value: response.summary,
    meta: {
      origin: 'DocumentScalePlanner',
      source_interpreter: 'DocumentScalePlanner',
      document_scale_surface: 'plan_summary',
      status: 'active',
    },
  });
  effects.emittedVariants.push({
    familyId: `${targetFamily}:meta`,
    value: renderMetaSurface(response),
    meta: {
      origin: 'DocumentScalePlanner',
      source_interpreter: 'DocumentScalePlanner',
      document_scale_surface: 'meta',
    },
  });
  if (Array.isArray(response.trace) && response.trace.length > 0) {
    effects.emittedVariants.push({
      familyId: `${targetFamily}:trace`,
      value: response.trace.join('\n'),
      meta: {
        origin: 'DocumentScalePlanner',
        source_interpreter: 'DocumentScalePlanner',
        document_scale_surface: 'trace',
      },
    });
  }
}

function buildFinalTarget(operation, envelope) {
  return envelope.finalTarget ?? `${operation.targetPrefix}_global`;
}

function buildPlanResponse(envelope, context, documentHandle, operation, unitSelection) {
  const planningContext = new DocumentPlanningContext({
    task: envelope.task,
    refs: buildExecutionRefs(context),
  });
  planningContext.addTrace(`Normalized ${documentHandle.type} input.`);
  planningContext.addTrace(`Selected operation ${operation.id}.`);
  planningContext.addTrace(`Selected granularity ${unitSelection.granularity}.`);

  const planner = new ChunkPlanner();
  const taskText = normalizeWhitespace(envelope.task || context.request?.requestText || '').slice(0, 1400);
  const maxTokensPerChunk = Number(envelope.maxTokensPerChunk ?? DEFAULT_MAX_TOKENS_PER_CHUNK);
  let chunks = planner.fromUnits({
    units: unitSelection.units,
    maxTokens: maxTokensPerChunk,
    documentId: documentHandle.documentId,
    documentRevision: documentHandle.documentRevision,
    idPolicy: {
      idLength: 10,
    },
  });
  chunks = planner.splitLargeUnits({
    units: chunks,
    maxTokens: maxTokensPerChunk,
    strategy: unitSelection.granularity === 'paragraph' ? 'sentence' : 'paragraph',
    documentId: documentHandle.documentId,
    documentRevision: documentHandle.documentRevision,
    idPolicy: {
      idLength: 10,
    },
  });

  const estimate = planner.estimateDeclarations({
    chunks,
    pipelinesPerChunk: 1,
    validationDeclarations: 1,
  });
  const limit = Number(envelope.maxDeclarationsPerPlan ?? DEFAULT_MAX_DECLARATIONS_PER_PLAN);
  const finalTarget = buildFinalTarget(operation, envelope);

  if (estimate.totalDeclarations > limit) {
    planningContext.addTrace(`Estimated ${estimate.totalDeclarations} declarations, which exceeds limit ${limit}.`);
    return planningContext.returnPlan(DocumentPlanResponse.tooLarge({
      text: `The requested granularity would generate approximately ${estimate.totalDeclarations} declarations. A coarser first-pass strategy is recommended.`,
      estimatedDeclarations: estimate.totalDeclarations,
      limit,
      recommendedStrategy: unitSelection.granularity === 'paragraph'
        ? 'chapter_first_then_selective_paragraph_expansion'
        : 'section_first_then_selective_paragraph_expansion',
      trace: planningContext.trace(),
      metadata: {
        documentType: documentHandle.type,
        operation: operation.id,
        granularity: unitSelection.granularity,
      },
    }));
  }

  const sourceRef = documentHandle.token ?? null;
  const chunkSourceRef = sourceRef ? sourceRef : null;
  const inlineChunkBuilder = new ChunkVariableBuilder();
  const chunkDeclarations = sourceRef
    ? inlineChunkBuilder.materialize({
      chunks,
      sourceRef,
    })
    : {
      declarations: chunks.map((chunk) => {
        const payload = {
          chunk_id: chunk.chunkId,
          chunk_var: chunk.chunkVar,
          document_id: chunk.documentId,
          document_revision: chunk.documentRevision,
          structural_path: chunk.structuralPath,
          parent_id: chunk.parentId,
          ordinal: chunk.ordinal,
          token_estimate: chunk.tokenEstimate,
          text_hash: chunk.textHash,
          offsets: chunk.offsets ?? null,
          json_path: chunk.jsonPath ?? null,
          content: chunk.text,
        };
        return `@${chunk.chunkVar} js-eval\nreturn ${JSON.stringify(stableStringify(payload))};`;
      }),
    };

  const pipeline = new ChunkPipelineTemplate({
    name: operation.id,
    command: operation.perChunkCommand,
    targetPrefix: operation.targetPrefix,
    bodyTemplate: (chunk) => renderChunkPrompt(operation, chunk, taskText),
  }).instantiateMany(chunks);

  const chunkResultRecords = pipeline.records;
  const composition = new CompositionPlanner();
  const chapterRollups = composition.groupByParent({
    chunkResults: chunkResultRecords,
    targetPrefix: `${operation.targetPrefix}_group`,
    command: 'writerLLM',
    operation: operation.id,
  });
  chapterRollups.records = chapterRollups.records.map((entry, index) => ({
    ...entry,
    text: [
      `@${entry.resultVar} writerLLM`,
      renderRollupPrompt(operation, `group_${index + 1}`, taskText),
    ].join('\n'),
  }));
  chapterRollups.declarations = chapterRollups.records.map((entry) => entry.text);

  const globalRollup = composition.global({
    target: finalTarget,
    command: 'writerLLM',
    operation: operation.id,
    outputSchema: operation.outputSchema,
  });
  globalRollup.records = globalRollup.records.map((entry) => ({
    ...entry,
    text: [
      `@${entry.resultVar} writerLLM`,
      renderRollupPrompt(operation, 'global', taskText),
      `Preserve output schema ${operation.outputSchema}.`,
    ].join('\n'),
  }));
  globalRollup.declarations = globalRollup.records.map((entry) => entry.text);

  const coverage = new CoverageValidator()
    .expected({ chunks, level: 'chunk' })
    .produced({ resultVars: pipeline.resultVars(), expectedStatus: 'active' })
    .requireProvenance({ fields: ['source_chunk', 'source_path', 'offsets', 'confidence'] })
    .maxFailureRate({ rate: 0.05 })
    .emitValidationDeclarations({ targetPrefix: `${operation.targetPrefix}_coverage` });

  const declarations = [
    ...chunkDeclarations.declarations,
    ...pipeline.declarations,
    ...chapterRollups.declarations,
    ...globalRollup.declarations,
    ...coverage.declarations,
    `@${context.targetFamily} template-eval\n$${finalTarget}`,
  ];
  planningContext.addTrace(`Created ${chunks.length} chunk variables.`);
  planningContext.addTrace(`Created ${pipeline.declarations.length} per-chunk semantic declarations.`);
  planningContext.addTrace(`Created ${chapterRollups.declarations.length + globalRollup.declarations.length} rollup declarations.`);
  planningContext.addTrace('Created coverage validation declarations.');

  const responseFactory = Array.isArray(envelope.selectedPaths) && envelope.selectedPaths.length > 0
    ? DocumentPlanResponse.partialPlan
    : DocumentPlanResponse.plan;

  return planningContext.returnPlan(responseFactory({
    text: `Generated an explicit ${operation.id} plan over ${chunks.length} ${unitSelection.granularity} chunk(s).`,
    declarations,
    coverageEstimate: {
      expectedChunks: chunks.length,
      plannedChunkVariables: chunkDeclarations.declarations.length,
      plannedProcessingDeclarations: pipeline.declarations.length,
    },
    trace: planningContext.trace(),
    finalTarget,
    metadata: {
      documentType: documentHandle.type,
      operation: operation.id,
      granularity: unitSelection.granularity,
      chunkCount: chunks.length,
      estimatedDeclarations: estimate.totalDeclarations,
    },
  }));
}

export async function executeDocumentScalePlanner(context) {
  const effects = createEmptyEffects();
  try {
    const envelope = normalizeEnvelope(context);
    const documentHandle = buildDocumentHandle(envelope, context);
    if (!documentHandle) {
      const response = DocumentPlanResponse.needsClarification({
        text: 'Document-scale planning needs a document reference, inline document_text, or inline document_json payload.',
        metadata: {
          documentType: null,
        },
      });
      pushDocumentPlannerSurfaces(effects, context.targetFamily, response);
      return effects;
    }
    if (!['markdown', 'json'].includes(documentHandle.type)) {
      const response = DocumentPlanResponse.needsNormalization({
        metadata: {
          documentType: documentHandle.type,
        },
      });
      pushDocumentPlannerSurfaces(effects, context.targetFamily, response);
      return effects;
    }

    const operation = inferOperation(envelope, context);
    if (!operation) {
      const response = DocumentPlanResponse.needsClarification({
        text: 'Document-scale planning needs a clearer processing objective such as idea extraction, chapter profiling, summarization, or claim extraction.',
        metadata: {
          documentType: documentHandle.type,
        },
      });
      pushDocumentPlannerSurfaces(effects, context.targetFamily, response);
      return effects;
    }

    const unitSelection = selectUnits(documentHandle, envelope, operation);
    unitSelection.units = filterSelectedUnits(unitSelection.units, envelope);
    if (unitSelection.units.length === 0) {
      const response = DocumentPlanResponse.needsClarification({
        text: 'No document units matched the requested path or selection. Provide a valid path, granularity, or selected subset.',
        metadata: {
          documentType: documentHandle.type,
          operation: operation.id,
          granularity: unitSelection.granularity,
        },
      });
      pushDocumentPlannerSurfaces(effects, context.targetFamily, response);
      return effects;
    }

    const response = buildPlanResponse(envelope, context, documentHandle, operation, unitSelection);
    pushDocumentPlannerSurfaces(effects, context.targetFamily, response);
    if (response.status === 'plan_ready' || response.status === 'partial_plan') {
      effects.declarationInsertions.push({
        text: response.declarations.join('\n\n'),
        meta: {
          source_interpreter: 'DocumentScalePlanner',
          final_target: response.finalTarget,
        },
      });
    }
    return effects;
  } catch (error) {
    effects.failure = createFailureRecord({
      kind: 'execution_error',
      message: error.message,
      origin: 'DocumentScalePlanner',
      familyId: context.targetFamily,
      repairable: true,
    });
    return effects;
  }
}

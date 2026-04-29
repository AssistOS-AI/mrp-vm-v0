import { canonicalText, hashText, normalizeWhitespace, stableStringify } from '../../utils/text.mjs';

function estimateTokens(value) {
  const tokens = normalizeWhitespace(value).split(/\s+/).filter(Boolean);
  return Math.max(1, Math.ceil(tokens.length * 1.2));
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'unit';
}

function countLeadingHashes(line) {
  const match = /^(#+)\s+/.exec(line);
  return match ? match[1].length : 0;
}

function buildHeadingPath(heading, ancestors = []) {
  const pathParts = ancestors.map((entry) => entry.slug);
  pathParts.push(heading.slug);
  return `/${pathParts.join('/')}`;
}

function parseMarkdownHeadings(content) {
  const lines = String(content ?? '').split('\n');
  const headings = [];
  let offset = 0;
  let inFence = false;
  const countersByLevel = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
    }
    if (!inFence) {
      const level = countLeadingHashes(line);
      if (level > 0) {
        const title = line.replace(/^#+\s+/, '').trim();
        const ordinal = (countersByLevel.get(level) ?? 0) + 1;
        countersByLevel.set(level, ordinal);
        for (const knownLevel of [...countersByLevel.keys()]) {
          if (knownLevel > level) {
            countersByLevel.delete(knownLevel);
          }
        }
        headings.push({
          level,
          title,
          slug: `h${level}_${String(ordinal).padStart(2, '0')}_${slugify(title).slice(0, 32)}`,
          lineIndex: index,
          offsetStart: offset,
          line,
        });
      }
    }
    offset += line.length + 1;
  }

  const stack = [];
  return headings.map((heading, index) => {
    while (stack.length > 0 && stack.at(-1).level >= heading.level) {
      stack.pop();
    }
    const ancestors = [...stack];
    stack.push(heading);
    return {
      ...heading,
      ancestors,
      structuralPath: buildHeadingPath(heading, ancestors),
      offsetEnd: headings[index + 1]?.offsetStart ?? content.length,
      topAncestor: ancestors[0] ?? heading,
    };
  });
}

function matchParagraphs(content, headings = []) {
  const lines = String(content ?? '').split('\n');
  const paragraphs = [];
  let inFence = false;
  let buffer = [];
  let startOffset = 0;
  let runningOffset = 0;

  function flushParagraph(endOffset) {
    const text = buffer.join('\n').trim();
    if (!text) {
      buffer = [];
      return;
    }
    const containing = headings.find((heading) => startOffset >= heading.offsetStart && startOffset < heading.offsetEnd) ?? null;
    const ordinal = paragraphs.length + 1;
    paragraphs.push({
      unitId: `paragraph_${String(ordinal).padStart(3, '0')}`,
      unitType: 'paragraph',
      title: `Paragraph ${ordinal}`,
      structuralPath: `${containing?.structuralPath ?? '/document'}/paragraph_${String(ordinal).padStart(3, '0')}`,
      parentId: containing?.topAncestor?.slug ?? null,
      text,
      offsets: {
        charStart: startOffset,
        charEnd: endOffset,
      },
      tokenEstimate: estimateTokens(text),
    });
    buffer = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
    }
    const isBoundary = !inFence && (!trimmed || /^#{1,6}\s+/.test(line) || /^\|/.test(trimmed));
    if (isBoundary) {
      flushParagraph(runningOffset);
      runningOffset += line.length + 1;
      startOffset = runningOffset;
      continue;
    }
    if (buffer.length === 0) {
      startOffset = runningOffset;
    }
    buffer.push(line);
    runningOffset += line.length + 1;
  }
  flushParagraph(content.length);
  return paragraphs;
}

function matchTables(content, headings = []) {
  const lines = String(content ?? '').split('\n');
  const tables = [];
  let runningOffset = 0;
  let buffer = [];
  let startOffset = 0;

  function flushTable(endOffset) {
    if (buffer.length < 2) {
      buffer = [];
      return;
    }
    const text = buffer.join('\n');
    const containing = headings.find((heading) => startOffset >= heading.offsetStart && startOffset < heading.offsetEnd) ?? null;
    const ordinal = tables.length + 1;
    tables.push({
      unitId: `table_${String(ordinal).padStart(3, '0')}`,
      unitType: 'table',
      title: `Table ${ordinal}`,
      structuralPath: `${containing?.structuralPath ?? '/document'}/table_${String(ordinal).padStart(3, '0')}`,
      parentId: containing?.topAncestor?.slug ?? null,
      text,
      offsets: {
        charStart: startOffset,
        charEnd: endOffset,
      },
      tokenEstimate: estimateTokens(text),
    });
    buffer = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\|/.test(trimmed)) {
      if (buffer.length === 0) {
        startOffset = runningOffset;
      }
      buffer.push(line);
    } else {
      flushTable(runningOffset);
    }
    runningOffset += line.length + 1;
  }
  flushTable(content.length);
  return tables;
}

function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function jsonPathSegments(pathExpression) {
  const raw = String(pathExpression ?? '').trim();
  if (!raw || raw === '.') {
    return [];
  }
  return raw
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function resolveJsonPath(root, pathExpression) {
  return jsonPathSegments(pathExpression).reduce((current, segment) => {
    if (current == null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      return current[Number(segment)];
    }
    return current[segment];
  }, root);
}

function countJsonNodes(value) {
  if (Array.isArray(value)) {
    return 1 + value.reduce((sum, entry) => sum + countJsonNodes(entry), 0);
  }
  if (value && typeof value === 'object') {
    return 1 + Object.values(value).reduce((sum, entry) => sum + countJsonNodes(entry), 0);
  }
  return 1;
}

export class DocumentPlanningContext {
  constructor(input = {}) {
    this._input = input;
    this._state = new Map();
    this._trace = [];
    this._response = null;
  }

  input() {
    return this._input;
  }

  set(name, value) {
    this._state.set(String(name), value);
    return value;
  }

  get(name) {
    return this._state.get(String(name));
  }

  addTrace(message) {
    this._trace.push(String(message));
  }

  trace() {
    return [...this._trace];
  }

  returnPlan(response) {
    this._response = response;
    return response;
  }
}

export class MarkdownDocument {
  constructor(handle = {}) {
    this.handle = handle;
    this.content = String(handle.content ?? handle.value ?? handle.text ?? handle.rendered ?? handle ?? '');
    this.headings = parseMarkdownHeadings(this.content);
  }

  static from(ref) {
    return new MarkdownDocument(ref);
  }

  sections(config = {}) {
    const fromHeadingLevel = Number(config.fromHeadingLevel ?? 1);
    const toHeadingLevel = Number(config.toHeadingLevel ?? 6);
    return this.headings
      .filter((heading) => heading.level >= fromHeadingLevel && heading.level <= toHeadingLevel)
      .map((heading, index) => {
        const text = this.content.slice(heading.offsetStart, heading.offsetEnd).trim();
        const topAncestor = heading.topAncestor ?? heading;
        return {
          unitId: `section_${String(index + 1).padStart(3, '0')}`,
          unitType: heading.level === 1 ? 'chapter' : 'section',
          title: heading.title,
          structuralPath: heading.structuralPath,
          parentId: topAncestor.slug,
          text,
          offsets: {
            charStart: heading.offsetStart,
            charEnd: heading.offsetEnd,
          },
          tokenEstimate: estimateTokens(text),
          metadata: {
            heading_level: heading.level,
          },
        };
      });
  }

  paragraphs(config = {}) {
    const inside = config.inside ? new Set([].concat(config.inside)) : null;
    return matchParagraphs(this.content, this.headings).filter((unit) => !inside || inside.has(unit.parentId) || inside.has(unit.structuralPath));
  }

  tables(config = {}) {
    const inside = config.inside ? new Set([].concat(config.inside)) : null;
    return matchTables(this.content, this.headings).filter((unit) => !inside || inside.has(unit.parentId) || inside.has(unit.structuralPath));
  }

  blocks(config = {}) {
    const allowedTypes = new Set([].concat(config.types ?? []));
    const blocks = [];
    if (allowedTypes.size === 0 || allowedTypes.has('section')) {
      blocks.push(...this.sections({ fromHeadingLevel: 1, toHeadingLevel: 6 }));
    }
    if (allowedTypes.size === 0 || allowedTypes.has('paragraph')) {
      blocks.push(...this.paragraphs());
    }
    if (allowedTypes.size === 0 || allowedTypes.has('table')) {
      blocks.push(...this.tables());
    }
    return blocks;
  }

  estimate() {
    return {
      tokenEstimate: estimateTokens(this.content),
      headingCount: this.headings.length,
      paragraphCount: matchParagraphs(this.content, this.headings).length,
      tableCount: matchTables(this.content, this.headings).length,
    };
  }
}

export class JsonDocument {
  constructor(handle = {}) {
    const raw = handle.content ?? handle.value ?? handle.json ?? handle;
    this.handle = handle;
    this.root = typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  static from(ref) {
    return new JsonDocument(ref);
  }

  path(pathExpression) {
    return resolveJsonPath(this.root, pathExpression);
  }

  units(config = {}) {
    const pathExpression = config.path ?? '.';
    const unitType = config.unitType ?? 'record';
    const textField = config.textField ?? null;
    const resolved = this.path(pathExpression);
    if (Array.isArray(resolved)) {
      return resolved.map((entry, index) => {
        const text = textField && entry && typeof entry === 'object'
          ? canonicalText(entry[textField] ?? entry)
          : canonicalText(entry);
        return {
          unitId: `${unitType}_${String(index + 1).padStart(3, '0')}`,
          unitType,
          title: entry?.title ?? entry?.name ?? `${unitType} ${index + 1}`,
          structuralPath: `/${slugify(pathExpression || 'root')}/${index}`,
          parentId: slugify(pathExpression || 'root'),
          text,
          jsonPath: `${pathExpression || ''}[${index}]`.replace(/^\./, ''),
          tokenEstimate: estimateTokens(text),
        };
      });
    }
    if (resolved && typeof resolved === 'object') {
      const text = textField ? canonicalText(resolved[textField] ?? resolved) : canonicalText(resolved);
      return [{
        unitId: `${unitType}_001`,
        unitType,
        title: resolved.title ?? resolved.name ?? unitType,
        structuralPath: `/${slugify(pathExpression || 'root')}`,
        parentId: slugify(pathExpression || 'root'),
        text,
        jsonPath: pathExpression || '.',
        tokenEstimate: estimateTokens(text),
      }];
    }
    return [];
  }

  fields(config = {}) {
    const source = this.path(config.path ?? '.');
    const fields = Array.isArray(config.fields) ? config.fields : [];
    if (!source || typeof source !== 'object') {
      return {};
    }
    return Object.fromEntries(fields.map((field) => [field, source[field]]));
  }

  estimate() {
    return {
      tokenEstimate: estimateTokens(canonicalText(this.root)),
      nodeCount: countJsonNodes(this.root),
    };
  }
}

export class ChunkPlanner {
  fromUnits(config = {}) {
    return this.assignIds({
      chunks: (config.units ?? []).map((unit, index) => ({
        ...unit,
        ordinal: index + 1,
      })),
      documentId: config.documentId ?? 'document',
      documentRevision: config.documentRevision ?? hashText(canonicalText(config.units ?? [])),
      hashAlgorithm: config.idPolicy?.hashAlgorithm ?? 'sha1',
      idLength: config.idPolicy?.idLength ?? 10,
    });
  }

  splitLargeUnits(config = {}) {
    const {
      units = [],
      maxTokens = 1800,
      strategy = 'paragraph',
      documentId = 'document',
      documentRevision = null,
      idPolicy = {},
    } = config;
    const output = [];
    for (const unit of units) {
      if ((unit.tokenEstimate ?? 0) <= maxTokens) {
        output.push(unit);
        continue;
      }
      const parts = strategy === 'sentence'
        ? splitSentences(unit.text)
        : String(unit.text ?? '').split(/\n\s*\n+/).map((entry) => entry.trim()).filter(Boolean);
      if (parts.length <= 1) {
        output.push(unit);
        continue;
      }
      parts.forEach((text, index) => {
        output.push({
          ...unit,
          title: `${unit.title} part ${index + 1}`,
          structuralPath: `${unit.structuralPath}/part_${String(index + 1).padStart(2, '0')}`,
          text,
          tokenEstimate: estimateTokens(text),
          offsets: unit.offsets ?? null,
        });
      });
    }
    return this.assignIds({
      chunks: output.map((chunk, index) => ({ ...chunk, ordinal: index + 1 })),
      documentId,
      documentRevision,
      hashAlgorithm: idPolicy.hashAlgorithm ?? 'sha1',
      idLength: idPolicy.idLength ?? 10,
    });
  }

  semanticSplit(config = {}) {
    return this.splitLargeUnits({
      units: [config.unit].filter(Boolean),
      maxTokens: config.maxTokens ?? 1800,
      strategy: 'sentence',
      documentId: config.documentId,
      documentRevision: config.documentRevision,
      idPolicy: config.idPolicy,
    });
  }

  assignIds(config = {}) {
    const {
      chunks = [],
      documentId = 'document',
      documentRevision = hashText(documentId),
      idLength = 10,
    } = config;
    return chunks.map((chunk, index) => {
      const basis = [
        documentId,
        documentRevision,
        chunk.structuralPath,
        hashText(chunk.text ?? canonicalText(chunk)),
      ].join('::');
      const chunkId = hashText(basis).slice(0, idLength);
      return {
        ...chunk,
        ordinal: index + 1,
        chunkId,
        chunkVar: `chunk_${chunkId}`,
        documentId,
        documentRevision,
        textHash: hashText(chunk.text ?? ''),
      };
    });
  }

  estimateDeclarations(config = {}) {
    const chunks = config.chunks ?? [];
    const pipelinesPerChunk = Number(config.pipelinesPerChunk ?? 1);
    const parentGroups = new Set(chunks.map((chunk) => chunk.parentId || chunk.structuralPath)).size;
    const validationDeclarations = Number(config.validationDeclarations ?? 1);
    const bridgeDeclarations = Number(config.bridgeDeclarations ?? 1);
    const totalDeclarations = chunks.length
      + (chunks.length * pipelinesPerChunk)
      + parentGroups
      + 1
      + validationDeclarations
      + bridgeDeclarations;
    return {
      totalDeclarations,
      chunkVariables: chunks.length,
      processingDeclarations: chunks.length * pipelinesPerChunk,
      parentRollups: parentGroups,
      finalRollups: 1,
      validationDeclarations,
      bridgeDeclarations,
    };
  }
}

function renderJsString(value) {
  return JSON.stringify(String(value ?? ''));
}

function renderJsonPathReader(pathExpression) {
  const segments = jsonPathSegments(pathExpression);
  const serialized = JSON.stringify(segments);
  return [
    'const root = typeof __source === "string" ? JSON.parse(__source) : __source;',
    `const __segments = ${serialized};`,
    'let __value = root;',
    'for (const __segment of __segments) {',
    '  if (__value == null) { break; }',
    '  __value = Array.isArray(__value) ? __value[Number(__segment)] : __value[__segment];',
    '}',
    'const __content = __value;',
  ].join('\n');
}

function renderChunkPayload(chunk, inlineContentExpression) {
  return [
    'return JSON.stringify({',
    `  chunk_id: ${renderJsString(chunk.chunkId)},`,
    `  chunk_var: ${renderJsString(chunk.chunkVar)},`,
    `  document_id: ${renderJsString(chunk.documentId)},`,
    `  document_revision: ${renderJsString(chunk.documentRevision)},`,
    `  structural_path: ${renderJsString(chunk.structuralPath)},`,
    `  parent_id: ${chunk.parentId ? renderJsString(chunk.parentId) : 'null'},`,
    `  ordinal: ${Number(chunk.ordinal ?? 0)},`,
    `  token_estimate: ${Number(chunk.tokenEstimate ?? 0)},`,
    `  text_hash: ${renderJsString(chunk.textHash)},`,
    `  offsets: ${stableStringify(chunk.offsets ?? null)},`,
    `  json_path: ${chunk.jsonPath ? renderJsString(chunk.jsonPath) : 'null'},`,
    `  content: ${inlineContentExpression}`,
    '}, null, 2);',
  ].join('\n');
}

export class ChunkVariableBuilder {
  materialize(config = {}) {
    const chunks = config.chunks ?? [];
    const sourceRef = String(config.sourceRef ?? '~document');
    return {
      declarations: chunks.map((chunk) => this.bodyTemplate(chunk, sourceRef)),
      chunks,
    };
  }

  bodyTemplate(chunk, sourceRef) {
    const lines = [
      `@${chunk.chunkVar} js-eval`,
      'const __source = typeof ' + sourceRef + '.get === "function" ? ' + sourceRef + '.get() : null;',
    ];
    if (chunk.jsonPath) {
      lines.push(renderJsonPathReader(chunk.jsonPath));
      lines.push(renderChunkPayload(chunk, 'typeof __content === "string" ? __content : JSON.stringify(__content, null, 2)'));
    } else {
      lines.push(`const __text = String(__source ?? "").slice(${Number(chunk.offsets?.charStart ?? 0)}, ${Number(chunk.offsets?.charEnd ?? 0)});`);
      lines.push(renderChunkPayload(chunk, '__text'));
    }
    return lines.join('\n');
  }
}

class InstantiatedChunkPipeline {
  constructor(records) {
    this.records = records;
    this.declarations = records.map((entry) => entry.text);
  }

  resultVar(chunk) {
    return this.records.find((entry) => entry.chunk.chunkId === chunk.chunkId)?.resultVar ?? null;
  }

  resultVars() {
    return this.records.map((entry) => entry.resultVar);
  }
}

export class ChunkPipelineTemplate {
  constructor(config = {}) {
    this.name = config.name ?? 'chunkPipeline';
    this.command = config.command ?? 'writerLLM';
    this.targetPrefix = config.targetPrefix ?? 'result';
    this.bodyTemplateFactory = config.bodyTemplate ?? (() => '');
  }

  instantiate(chunk) {
    const resultVar = `${this.targetPrefix}_${chunk.chunkId}`;
    return {
      chunk,
      resultVar,
      text: [
        `@${resultVar} ${this.command}`,
        this.bodyTemplateFactory(chunk),
      ].join('\n'),
    };
  }

  instantiateMany(chunks) {
    return new InstantiatedChunkPipeline(chunks.map((chunk) => this.instantiate(chunk)));
  }
}

class RollupPlan {
  constructor(records) {
    this.records = records;
    this.declarations = records.map((entry) => entry.text);
  }

  resultVars() {
    return this.records.map((entry) => entry.resultVar);
  }
}

export class CompositionPlanner {
  rollup(config = {}) {
    return new RollupPlan([{
      resultVar: config.target,
      text: [
        `@${config.target} ${config.command ?? 'writerLLM'}`,
        `Use the resolved direct dependency results to perform operation ${config.operation ?? 'merge'}.`,
        config.outputSchema ? `Preserve output schema ${config.outputSchema}.` : '',
      ].filter(Boolean).join('\n'),
    }]);
  }

  groupByParent(config = {}) {
    const records = config.chunkResults ?? [];
    const grouped = new Map();
    for (const record of records) {
      const key = record.chunk?.parentId ?? record.chunk?.structuralPath ?? 'document';
      const bucket = grouped.get(key) ?? [];
      bucket.push(record);
      grouped.set(key, bucket);
    }
    return new RollupPlan([...grouped.entries()].map(([key, bucket], index) => ({
      resultVar: `${config.targetPrefix ?? 'rollup'}_${slugify(key || `group_${index + 1}`)}`,
      text: [
        `@${config.targetPrefix ?? 'rollup'}_${slugify(key || `group_${index + 1}`)} ${config.command ?? 'writerLLM'}`,
        `Merge the resolved direct dependency results for group ${key}.`,
        `Perform operation ${config.operation ?? 'merge'}.`,
        'Preserve provenance links and duplicate handling explicitly.',
      ].join('\n'),
    })));
  }

  global(config = {}) {
    return new RollupPlan([{
      resultVar: config.target,
      text: [
        `@${config.target} ${config.command ?? 'writerLLM'}`,
        `Merge the resolved direct dependency results into one global output.`,
        `Perform operation ${config.operation ?? 'merge'}.`,
        config.outputSchema ? `Preserve output schema ${config.outputSchema}.` : '',
        'Keep provenance references explicit.',
      ].filter(Boolean).join('\n'),
    }]);
  }
}

export class CoverageValidator {
  constructor() {
    this.expectedChunksConfig = null;
    this.producedConfig = null;
    this.requiredFieldsConfig = [];
    this.maxFailureRateConfig = 0;
  }

  expected(config = {}) {
    this.expectedChunksConfig = config;
    return this;
  }

  produced(config = {}) {
    this.producedConfig = config;
    return this;
  }

  requireProvenance(config = {}) {
    this.requiredFieldsConfig = [].concat(config.fields ?? []);
    return this;
  }

  maxFailureRate(config = {}) {
    this.maxFailureRateConfig = Number(config.rate ?? 0);
    return this;
  }

  emitValidationDeclarations(config = {}) {
    const chunks = this.expectedChunksConfig?.chunks ?? [];
    const resultVars = this.producedConfig?.resultVars ?? [];
    const target = `${config.targetPrefix ?? 'coverage'}_summary`;
    const jsBody = [
      `const expected = [${chunks.map((chunk) => `~${chunk.chunkVar}`).join(', ')}];`,
      `const produced = [${resultVars.map((familyId) => `~${familyId}`).join(', ')}];`,
      'const producedActive = produced.filter((ref) => ref.exists());',
      'const missing = produced.filter((ref) => !ref.exists()).map((ref) => ref.family());',
      'return JSON.stringify({',
      `  expected_count: ${chunks.length},`,
      '  produced_count: producedActive.length,',
      `  required_fields: ${stableStringify(this.requiredFieldsConfig)},`,
      `  max_failure_rate: ${this.maxFailureRateConfig},`,
      '  missing',
      '}, null, 2);',
    ].join('\n');
    return {
      declarations: [
        `@${target} js-eval\n${jsBody}`,
      ],
      resultVars() {
        return [target];
      },
    };
  }
}

function createSummaryText(status, text, metadata = {}) {
  const lines = [
    `Status: ${status}`,
    text ? `Summary: ${text}` : null,
    metadata.documentType ? `Document type: ${metadata.documentType}` : null,
    metadata.operation ? `Operation: ${metadata.operation}` : null,
    metadata.granularity ? `Granularity: ${metadata.granularity}` : null,
    Number.isFinite(metadata.chunkCount) ? `Chunks planned: ${metadata.chunkCount}` : null,
    Number.isFinite(metadata.estimatedDeclarations) ? `Estimated declarations: ${metadata.estimatedDeclarations}` : null,
    metadata.finalTarget ? `Final target: ${metadata.finalTarget}` : null,
    Number.isFinite(metadata.insertedDeclarations) ? `Inserted declarations: ${metadata.insertedDeclarations}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export class DocumentPlanResponse {
  static plan(config = {}) {
    const metadata = {
      ...config.metadata,
      finalTarget: config.finalTarget ?? null,
      insertedDeclarations: Array.isArray(config.declarations) ? config.declarations.length : 0,
    };
    return {
      status: 'plan_ready',
      text: config.text ?? 'A complete explicit document-scale SOP plan was generated.',
      declarations: config.declarations ?? [],
      coverageEstimate: config.coverageEstimate ?? {},
      trace: config.trace ?? [],
      metadata,
      finalTarget: config.finalTarget ?? null,
      summary: createSummaryText('plan_ready', config.text ?? 'A complete explicit document-scale SOP plan was generated.', {
        documentType: metadata.documentType,
        operation: metadata.operation,
        granularity: metadata.granularity,
        chunkCount: metadata.chunkCount,
        estimatedDeclarations: metadata.estimatedDeclarations,
        finalTarget: metadata.finalTarget,
        insertedDeclarations: metadata.insertedDeclarations,
      }),
    };
  }

  static partialPlan(config = {}) {
    const metadata = {
      ...config.metadata,
      finalTarget: config.finalTarget ?? null,
      insertedDeclarations: Array.isArray(config.declarations) ? config.declarations.length : 0,
    };
    return {
      status: 'partial_plan',
      text: config.text ?? 'A complete explicit plan was generated for a selected subset of the document.',
      declarations: config.declarations ?? [],
      coverageEstimate: config.coverageEstimate ?? {},
      trace: config.trace ?? [],
      metadata,
      finalTarget: config.finalTarget ?? null,
      summary: createSummaryText('partial_plan', config.text ?? 'A complete explicit plan was generated for a selected subset of the document.', {
        documentType: metadata.documentType,
        operation: metadata.operation,
        granularity: metadata.granularity,
        chunkCount: metadata.chunkCount,
        estimatedDeclarations: metadata.estimatedDeclarations,
        finalTarget: metadata.finalTarget,
        insertedDeclarations: metadata.insertedDeclarations,
      }),
    };
  }

  static tooLarge(config = {}) {
    const metadata = {
      ...config.metadata,
      estimatedDeclarations: config.estimatedDeclarations ?? null,
      recommendedStrategy: config.recommendedStrategy ?? null,
      limit: config.limit ?? null,
    };
    return {
      status: 'too_large',
      text: config.text ?? 'The requested plan exceeds configured declaration limits.',
      declarations: [],
      coverageEstimate: {},
      trace: config.trace ?? [],
      metadata,
      finalTarget: null,
      summary: createSummaryText('too_large', config.text ?? 'The requested plan exceeds configured declaration limits.', {
        documentType: metadata.documentType,
        operation: metadata.operation,
        granularity: metadata.granularity,
        estimatedDeclarations: metadata.estimatedDeclarations,
      }),
    };
  }

  static needsNormalization(config = {}) {
    return {
      status: 'needs_normalization',
      text: config.text ?? 'The referenced input should first be normalized as Markdown or JSON before document-scale planning.',
      declarations: [],
      coverageEstimate: {},
      trace: config.trace ?? [],
      metadata: {
        ...config.metadata,
        requiredInput: config.requiredInput ?? 'markdown_or_json',
      },
      finalTarget: null,
      summary: createSummaryText('needs_normalization', config.text ?? 'The referenced input should first be normalized as Markdown or JSON before document-scale planning.', {
        documentType: config.metadata?.documentType ?? null,
      }),
    };
  }

  static needsClarification(config = {}) {
    return {
      status: 'needs_clarification',
      text: config.text ?? 'Document-scale planning needs a clearer processing objective, path, or granularity.',
      declarations: [],
      coverageEstimate: {},
      trace: config.trace ?? [],
      metadata: config.metadata ?? {},
      finalTarget: null,
      summary: createSummaryText('needs_clarification', config.text ?? 'Document-scale planning needs a clearer processing objective, path, or granularity.', {
        documentType: config.metadata?.documentType ?? null,
      }),
    };
  }
}

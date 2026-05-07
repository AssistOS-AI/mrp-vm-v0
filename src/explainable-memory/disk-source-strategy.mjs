import path from 'node:path';
import { parseSopModule, renderSopModule } from '../lang/parser.mjs';
import { ensureDir, listFilesRecursive, readText, removePath, writeText } from '../storage/file-store.mjs';
import { canonicalText } from '../utils/text.mjs';

const DEFAULT_ASPECT_META = {
  rev: 1,
  status: 'candidate',
  aspect_type: 'operational',
  title: '',
  summary: '',
  priority: 0,
  domains: [],
  commands: [],
  interpreters: [],
  tags: [],
  query_terms: [],
};

function firstRootId(entries) {
  return [...entries.keys()].find((key) => !key.includes(':')) ?? null;
}

function parseArrayValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalText(entry)).filter(Boolean);
  }
  if (!value) {
    return [];
  }
  return [canonicalText(value)].filter(Boolean);
}

function helperValue(entries, aspectId, suffix, fallback = '') {
  return entries.get(`${aspectId}:${suffix}`) ?? fallback;
}

function parseAspectSource(filePath, sourceText) {
  const entries = parseSopModule(sourceText);
  const aspectId = firstRootId(entries);
  if (!aspectId) {
    throw new Error(`Aspect file ${filePath} has no root variable.`);
  }
  const rootValue = entries.get(aspectId);
  const inferredStatus = filePath.includes(`${path.sep}approved${path.sep}`) ? 'approved' : 'candidate';
  const meta = {
    ...DEFAULT_ASPECT_META,
    ...entries.get(`${aspectId}:meta`),
  };
  meta.status = meta.status === 'approved' ? 'approved' : inferredStatus;
  meta.title = meta.title || aspectId;
  meta.query_terms = parseArrayValue(entries.get(`${aspectId}:query_terms`) ?? meta.query_terms);
  return {
    aspectId,
    fileName: path.basename(filePath),
    filePath,
    sourceText,
    rootValue: typeof rootValue === 'string' ? rootValue : canonicalText(rootValue),
    meta: {
      ...meta,
      domains: parseArrayValue(meta.domains),
      commands: parseArrayValue(meta.commands),
      interpreters: parseArrayValue(meta.interpreters),
      tags: parseArrayValue(meta.tags),
      query_terms: parseArrayValue(meta.query_terms),
    },
    definition: helperValue(entries, aspectId, 'definition', typeof rootValue === 'string' ? rootValue : canonicalText(rootValue)),
    inclusionCriteria: helperValue(entries, aspectId, 'inclusion', ''),
    exclusionCriteria: helperValue(entries, aspectId, 'exclusion', ''),
    protocol: helperValue(entries, aspectId, 'protocol', ''),
    roleVocabulary: parseArrayValue(helperValue(entries, aspectId, 'role_vocabulary', [])),
    queryTerms: parseArrayValue(helperValue(entries, aspectId, 'query_terms', meta.query_terms)),
  };
}

function renderAspectEntries(input) {
  const aspectId = input.aspectId;
  const entries = new Map();
  entries.set(aspectId, input.rootValue || input.definition || input.meta?.summary || aspectId);
  entries.set(`${aspectId}:meta`, {
    ...DEFAULT_ASPECT_META,
    ...input.meta,
    status: input.meta?.status === 'approved' ? 'approved' : 'candidate',
    title: input.meta?.title || aspectId,
    domains: parseArrayValue(input.meta?.domains),
    commands: parseArrayValue(input.meta?.commands),
    interpreters: parseArrayValue(input.meta?.interpreters),
    tags: parseArrayValue(input.meta?.tags),
    query_terms: parseArrayValue(input.queryTerms ?? input.meta?.query_terms),
  });
  entries.set(`${aspectId}:definition`, input.definition || '');
  entries.set(`${aspectId}:inclusion`, input.inclusionCriteria || '');
  entries.set(`${aspectId}:exclusion`, input.exclusionCriteria || '');
  entries.set(`${aspectId}:protocol`, input.protocol || '');
  entries.set(`${aspectId}:role_vocabulary`, parseArrayValue(input.roleVocabulary));
  entries.set(`${aspectId}:query_terms`, parseArrayValue(input.queryTerms));
  return entries;
}

export class DiskExplainableMemorySourceStrategy {
  constructor(rootDir, kbStore) {
    this.rootDir = rootDir;
    this.kbStore = kbStore;
  }

  getApprovedAspectsDir() {
    return path.join(this.rootDir, 'data', 'kb', 'aspects', 'approved');
  }

  getCandidateAspectsDir() {
    return path.join(this.rootDir, 'data', 'kb', 'aspects', 'candidates');
  }

  async loadKnowledgeCatalog(sessionId = null) {
    const catalog = [
      ...(await this.kbStore.loadKuFiles(this.kbStore.getDefaultCallersDir(), 'default')),
      ...(await this.kbStore.loadKuFiles(this.kbStore.getDefaultKusDir(), 'default')),
      ...(await this.kbStore.loadKuFiles(this.kbStore.getGlobalKusDir(), 'global')),
    ];
    if (sessionId) {
      catalog.push(...await this.kbStore.loadKuFiles(this.kbStore.getSessionKusDir(sessionId), 'session'));
    }
    return catalog;
  }

  async listAspects() {
    const [approvedFiles, candidateFiles] = await Promise.all([
      listFilesRecursive(this.getApprovedAspectsDir(), '.sop'),
      listFilesRecursive(this.getCandidateAspectsDir(), '.sop'),
    ]);
    const approved = [];
    const candidates = [];

    for (const filePath of approvedFiles) {
      const sourceText = await readText(filePath, '');
      approved.push(parseAspectSource(filePath, sourceText));
    }
    for (const filePath of candidateFiles) {
      const sourceText = await readText(filePath, '');
      candidates.push(parseAspectSource(filePath, sourceText));
    }

    approved.sort((left, right) => left.aspectId.localeCompare(right.aspectId));
    candidates.sort((left, right) => left.aspectId.localeCompare(right.aspectId));
    return { approved, candidates };
  }

  async findAspect(aspectId) {
    const { approved, candidates } = await this.listAspects();
    return approved.find((entry) => entry.aspectId === aspectId)
      ?? candidates.find((entry) => entry.aspectId === aspectId)
      ?? null;
  }

  async upsertAspect(input) {
    const aspectId = String(input.aspectId || '').trim();
    if (!aspectId) {
      throw new Error('aspect_id is required.');
    }
    const existing = await this.findAspect(aspectId);
    const status = input.meta?.status === 'approved' ? 'approved' : 'candidate';
    const targetDir = status === 'approved' ? this.getApprovedAspectsDir() : this.getCandidateAspectsDir();
    const otherDir = status === 'approved' ? this.getCandidateAspectsDir() : this.getApprovedAspectsDir();
    const fileName = input.fileName || existing?.fileName || `${aspectId}.sop`;
    const meta = {
      ...(existing?.meta ?? {}),
      ...input.meta,
      status,
      title: input.meta?.title || existing?.meta?.title || aspectId,
    };
    const text = renderSopModule(renderAspectEntries({
      aspectId,
      fileName,
      rootValue: input.rootValue ?? existing?.rootValue ?? input.definition ?? '',
      meta,
      definition: input.definition ?? existing?.definition ?? '',
      inclusionCriteria: input.inclusionCriteria ?? existing?.inclusionCriteria ?? '',
      exclusionCriteria: input.exclusionCriteria ?? existing?.exclusionCriteria ?? '',
      protocol: input.protocol ?? existing?.protocol ?? '',
      roleVocabulary: input.roleVocabulary ?? existing?.roleVocabulary ?? [],
      queryTerms: input.queryTerms ?? existing?.queryTerms ?? [],
    }));
    await ensureDir(targetDir);
    await writeText(path.join(targetDir, fileName), text);
    if (existing?.filePath && path.dirname(existing.filePath) !== targetDir) {
      await removePath(existing.filePath);
    } else {
      const otherPath = path.join(otherDir, fileName);
      await removePath(otherPath);
    }
    return this.findAspect(aspectId);
  }

  async approveAspect(aspectId) {
    const existing = await this.findAspect(aspectId);
    if (!existing) {
      throw new Error(`Unknown aspect ${aspectId}.`);
    }
    return this.upsertAspect({
      aspectId,
      fileName: existing.fileName,
      rootValue: existing.rootValue,
      meta: {
        ...existing.meta,
        status: 'approved',
        rev: Number(existing.meta.rev ?? 0) + 1,
      },
      definition: existing.definition,
      inclusionCriteria: existing.inclusionCriteria,
      exclusionCriteria: existing.exclusionCriteria,
      protocol: existing.protocol,
      roleVocabulary: existing.roleVocabulary,
      queryTerms: existing.queryTerms,
    });
  }
}

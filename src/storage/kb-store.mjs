import path from 'node:path';
import { ensureDir, listFilesRecursive, readText, writeText } from './file-store.mjs';
import { parseSopModule, renderSopModule } from '../lang/parser.mjs';
import { byteLength, canonicalText, normalizeWhitespace, tokenize } from '../utils/text.mjs';
import { appendJsonl } from '../utils/jsonl.mjs';

function parsePatternList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

function compileRegexes(patterns) {
  return parsePatternList(patterns)
    .map((pattern) => {
      try {
        return new RegExp(pattern, 'gi');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function metadataArrayIncludes(metadataValue, expected) {
  if (!expected || expected.length === 0) {
    return true;
  }
  const source = Array.isArray(metadataValue) ? metadataValue : metadataValue ? [metadataValue] : [];
  return expected.some((value) => source.includes(value));
}

function computeLexicalScore(queryTokens, entry) {
  if (queryTokens.length === 0) {
    return 0;
  }

  const documentTokens = tokenize([
    entry.content,
    entry.meta.title,
    entry.meta.summary,
    ...(entry.meta.tags ?? []),
  ].join(' '));

  if (documentTokens.length === 0) {
    return 0;
  }

  const frequency = new Map();
  for (const token of documentTokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const token of queryTokens) {
    const termFrequency = frequency.get(token) ?? 0;
    if (termFrequency === 0) {
      continue;
    }
    const normalizedTf = termFrequency / documentTokens.length;
    score += 1.2 * normalizedTf + termFrequency;
  }
  return score;
}

function createCatalogEntry(filePath, scope, entries) {
  const rootIds = [...entries.keys()].filter((key) => !key.includes(':'));
  if (rootIds.length === 0) {
    throw new Error(`KU file ${filePath} has no root variable.`);
  }
  const rootId = rootIds[0];
  const content = entries.get(rootId);
  const meta = {
    rev: 1,
    ku_type: 'content',
    scope,
    status: 'active',
    title: rootId,
    summary: '',
    priority: 0,
    trust: 'normal',
    domains: [],
    commands: [],
    interpreters: [],
    tags: [],
    input_patterns: [],
    ...entries.get(`${rootId}:meta`),
  };

  const helpers = [...entries.entries()]
    .filter(([key]) => key !== rootId && key !== `${rootId}:meta`)
    .map(([key, value]) => ({ key, value }));

  return {
    kuId: rootId,
    filePath,
    scope,
    content: typeof content === 'string' ? content : canonicalText(content),
    rawContent: content,
    meta,
    helpers,
  };
}

export class KbStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  getDefaultCallersDir() {
    return path.join(this.rootDir, 'data', 'default', 'callers');
  }

  getDefaultKusDir() {
    return path.join(this.rootDir, 'data', 'default', 'kus');
  }

  getGlobalKusDir() {
    return path.join(this.rootDir, 'data', 'kb', 'global');
  }

  getSessionKusDir(sessionId) {
    return path.join(this.rootDir, 'data', 'sessions', sessionId, 'kb');
  }

  getSessionCatalogPath(sessionId) {
    return path.join(this.rootDir, 'data', 'sessions', sessionId, 'indexes', 'kb-catalog.jsonl');
  }

  getSessionKuPath(sessionId, fileName) {
    return path.join(this.getSessionKusDir(sessionId), fileName);
  }

  async loadKuFiles(rootPath, scope) {
    const files = await listFilesRecursive(rootPath, '.sop');
    const entries = [];

    for (const filePath of files) {
      const source = await readText(filePath, '');
      const parsed = parseSopModule(source);
      entries.push(createCatalogEntry(filePath, scope, parsed));
    }

    return entries;
  }

  async buildSnapshot(sessionId) {
    const catalog = [
      ...(await this.loadKuFiles(this.getDefaultCallersDir(), 'default')),
      ...(await this.loadKuFiles(this.getDefaultKusDir(), 'default')),
      ...(await this.loadKuFiles(this.getGlobalKusDir(), 'global')),
      ...(await this.loadKuFiles(this.getSessionKusDir(sessionId), 'session')),
    ];

    const catalogPath = this.getSessionCatalogPath(sessionId);
    await writeText(catalogPath, '');
    for (const entry of catalog) {
      await appendJsonl(catalogPath, {
        kuId: entry.kuId,
        scope: entry.scope,
        rev: entry.meta.rev,
        ku_type: entry.meta.ku_type,
        title: entry.meta.title,
        summary: entry.meta.summary,
      });
    }
    return catalog;
  }

  async snapshotForRequest(sessionId) {
    return this.buildSnapshot(sessionId);
  }

  async listSessionKus(sessionId) {
    return this.loadKuFiles(this.getSessionKusDir(sessionId), 'session');
  }

  async listGlobalKus() {
    return this.loadKuFiles(this.getGlobalKusDir(), 'global');
  }

  async upsertSessionKu(sessionId, input) {
    const {
      fileName,
      sopText = null,
      entries = null,
    } = input;

    await ensureDir(this.getSessionKusDir(sessionId));
    const targetFile = this.getSessionKuPath(sessionId, fileName);
    const text = sopText ?? renderSopModule(entries);
    await writeText(targetFile, text);
    return targetFile;
  }

  async promoteSessionKu(sessionId, fileName, targetFileName = fileName) {
    const sourcePath = this.getSessionKuPath(sessionId, fileName);
    const text = await readText(sourcePath, null);
    if (text === null) {
      throw new Error(`Unknown session KU file ${fileName} for session ${sessionId}.`);
    }
    const targetPath = path.join(this.getGlobalKusDir(), targetFileName);
    await writeText(targetPath, text);
    return targetPath;
  }

  findCallerProfile(catalog, callerName) {
    return catalog.find((entry) => entry.meta.ku_type === 'caller_profile' && entry.kuId === callerName) ?? null;
  }

  deriveLexicalTokens(body, callerProfile, requestText) {
    const tokens = tokenize(requestText ?? '');
    if (!body) {
      return tokens;
    }

    const patterns = compileRegexes(callerProfile?.meta.input_patterns);
    if (patterns.length === 0) {
      return [...tokens, ...tokenize(body)];
    }

    const extracted = [];
    for (const regex of patterns) {
      for (const match of body.matchAll(regex)) {
        extracted.push(match[0]);
      }
    }

    if (extracted.length === 0) {
      return tokens;
    }

    return [...tokens, ...tokenize(extracted.join(' '))];
  }

  retrieve(catalog, input) {
    const {
      callerName,
      retrievalMode,
      desiredKuTypes = [],
      requiredPromptGroups = [],
      acceptedModelClasses = [],
      domainHints = [],
      queryTokens = [],
      byteBudget = 4_096,
      targetCommand = null,
      targetInterpreter = null,
      requestText = '',
      bodyText = '',
      sessionOverrideAllowed = true,
    } = input;

    const callerProfile = callerName ? this.findCallerProfile(catalog, callerName) : null;
    const lexicalTokens = retrievalMode === 'explicit_kb_query'
      ? tokenize(queryTokens.join(' ') || requestText)
      : this.deriveLexicalTokens(bodyText, callerProfile, requestText);

    const filtered = catalog
      .filter((entry) => entry.meta.status === 'active')
      .filter((entry) => desiredKuTypes.length === 0 || desiredKuTypes.includes(entry.meta.ku_type))
      .filter((entry) => {
        if (!sessionOverrideAllowed && entry.scope === 'session') {
          return false;
        }
        return true;
      })
      .filter((entry) => requiredPromptGroups.length === 0
        || requiredPromptGroups.includes(entry.meta.mandatory_group))
      .filter((entry) => acceptedModelClasses.length === 0
        || metadataArrayIncludes(entry.meta.model_class, acceptedModelClasses)
        || metadataArrayIncludes(entry.meta.model_classes, acceptedModelClasses))
      .filter((entry) => metadataArrayIncludes(entry.meta.domains, domainHints))
      .filter((entry) => !targetCommand || metadataArrayIncludes(entry.meta.commands, [targetCommand]))
      .filter((entry) => !targetInterpreter || metadataArrayIncludes(entry.meta.interpreters, [targetInterpreter]));

    const scored = filtered.map((entry) => {
      let score = 0;

      if (entry.scope === 'session') {
        score += 30;
      } else if (entry.scope === 'global') {
        score += 20;
      } else {
        score += 10;
      }

      if (callerProfile) {
        if (metadataArrayIncludes(entry.meta.commands, [callerProfile.kuId])) {
          score += 12;
        }
        if (metadataArrayIncludes(entry.meta.interpreters, [callerProfile.kuId])) {
          score += 12;
        }
      }

      score += Number(entry.meta.priority ?? 0);
      score += entry.meta.trust === 'canonical' ? 15 : entry.meta.trust === 'trusted' ? 10 : entry.meta.trust === 'normal' ? 5 : 0;
      score += metadataArrayIncludes(entry.meta.domains, domainHints) ? 5 : 0;

      if (retrievalMode === 'explicit_kb_query' || lexicalTokens.length > 0) {
        score += computeLexicalScore(lexicalTokens, entry);
      }

      return { entry, score };
    });

    scored.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const scopeOrder = { session: 3, global: 2, default: 1 };
      if (scopeOrder[right.entry.scope] !== scopeOrder[left.entry.scope]) {
        return scopeOrder[right.entry.scope] - scopeOrder[left.entry.scope];
      }
      if ((right.entry.meta.priority ?? 0) !== (left.entry.meta.priority ?? 0)) {
        return (right.entry.meta.priority ?? 0) - (left.entry.meta.priority ?? 0);
      }
      return left.entry.kuId.localeCompare(right.entry.kuId);
    });

    const selected = [];
    const pruned = [];
    let usedBytes = 0;

    for (const item of scored) {
      const rendered = canonicalText(item.entry.content);
      const size = byteLength(rendered);
      if (usedBytes + size > byteBudget && selected.length > 0) {
        pruned.push({ kuId: item.entry.kuId, reason: 'byte_budget' });
        continue;
      }
      selected.push({
        ...item.entry,
        lexicalTokens,
        score: item.score,
      });
      usedBytes += size;
    }

    return {
      callerProfile,
      selected,
      pruned,
      usedBytes,
    };
  }
}

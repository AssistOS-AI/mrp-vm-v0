import MiniSearch from '../../deps/minisearch/dist/es/index.js';
import { byteLength, canonicalText, hashText, normalizeWhitespace, stableStringify, tokenize } from '../utils/text.mjs';

const SEARCH_OPTIONS = {
  fields: ['title', 'summary', 'content', 'tags', 'commands', 'interpreters', 'domains'],
  storeFields: ['kuId'],
};

function arrayOverlap(left = [], right = []) {
  const rightSet = new Set((right ?? []).filter(Boolean));
  return [...new Set((left ?? []).filter((entry) => rightSet.has(entry)))];
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter(Boolean).map((value) => String(value)))];
}

function aspectTokens(aspect) {
  return tokenize([
    aspect.aspectId,
    aspect.meta?.title,
    aspect.meta?.summary,
    aspect.definition,
    aspect.inclusionCriteria,
    aspect.exclusionCriteria,
    aspect.protocol,
    ...(aspect.queryTerms ?? []),
    ...(aspect.meta?.tags ?? []),
    ...(aspect.meta?.domains ?? []),
  ].join(' '));
}

function entryTokens(entry) {
  return tokenize([
    entry.kuId,
    entry.meta?.title,
    entry.meta?.summary,
    entry.content,
    ...(entry.meta?.tags ?? []),
    ...(entry.meta?.commands ?? []),
    ...(entry.meta?.interpreters ?? []),
    ...(entry.meta?.domains ?? []),
    ...((entry.helpers ?? []).map((helper) => canonicalText(helper.value))),
  ].join(' '));
}

function scoreAspectForEntry(aspect, entry) {
  const tokens = new Set(entryTokens(entry));
  const aTokens = aspectTokens(aspect);
  let score = 0;
  const reasons = [];
  for (const token of aTokens) {
    if (tokens.has(token)) {
      score += 2;
    }
  }
  if (score > 0) {
    reasons.push('token_overlap');
  }
  const domainOverlap = arrayOverlap(entry.meta?.domains, aspect.meta?.domains);
  if (domainOverlap.length > 0) {
    score += 6;
    reasons.push('domain_overlap');
  }
  const commandOverlap = arrayOverlap(entry.meta?.commands, aspect.meta?.commands);
  if (commandOverlap.length > 0) {
    score += 8;
    reasons.push('command_overlap');
  }
  const interpreterOverlap = arrayOverlap(entry.meta?.interpreters, aspect.meta?.interpreters);
  if (interpreterOverlap.length > 0) {
    score += 8;
    reasons.push('interpreter_overlap');
  }
  if (entry.meta?.ku_type === 'policy_asset' && aspect.meta?.aspect_type === 'axiological') {
    score += 4;
    reasons.push('policy_axiological_affinity');
  }
  if (entry.meta?.ku_type === 'caller_profile' && aspect.meta?.aspect_type === 'operational') {
    score += 4;
    reasons.push('caller_profile_operational_affinity');
  }
  return {
    score,
    reasons,
  };
}

function roleFromSignals(entry, aspectSignals = []) {
  const types = uniqueStrings(aspectSignals.map((signal) => signal.aspectType));
  if (types.includes('bias_oriented')) {
    return 'a cautionary reference';
  }
  if (types.includes('axiological')) {
    return 'a governance or value constraint';
  }
  if (types.includes('epistemological')) {
    return 'an evidence or assumption note';
  }
  if (entry.meta?.ku_type === 'prompt_asset') {
    return 'a prompt asset';
  }
  if (entry.meta?.ku_type === 'caller_profile') {
    return 'caller guidance';
  }
  return 'operational guidance';
}

function usageIndication(entry, aspectSignals = [], lexicalFallbackUsed = false) {
  const role = roleFromSignals(entry, aspectSignals);
  const aspectLabel = aspectSignals.length > 0
    ? ` through ${aspectSignals.map((signal) => signal.aspectId).join(', ')}`
    : '';
  const lexicalLabel = lexicalFallbackUsed ? ' Include it even though lexical fallback was needed to surface it.' : '';
  return `Use this KU as ${role}${aspectLabel}.${lexicalLabel} ~${entry.kuId}`;
}

function activeAspectScore(aspect, input) {
  const queryTokens = tokenize([
    ...(input.queryTokens ?? []),
    input.requestText ?? '',
    input.bodyText ?? '',
  ].join(' '));
  const tokenSet = new Set(queryTokens);
  let score = 0;
  const reasons = [];
  for (const token of aspectTokens(aspect)) {
    if (tokenSet.has(token)) {
      score += 3;
    }
  }
  if (score > 0) {
    reasons.push('query_overlap');
  }
  if (input.targetCommand && aspect.meta?.commands?.includes(input.targetCommand)) {
    score += 8;
    reasons.push('target_command');
  }
  if (input.targetInterpreter && aspect.meta?.interpreters?.includes(input.targetInterpreter)) {
    score += 8;
    reasons.push('target_interpreter');
  }
  if (input.callerName && aspect.meta?.commands?.includes(input.callerName)) {
    score += 5;
    reasons.push('caller_command');
  }
  if (input.callerName && aspect.meta?.interpreters?.includes(input.callerName)) {
    score += 5;
    reasons.push('caller_interpreter');
  }
  const domainOverlap = arrayOverlap(input.domainHints, aspect.meta?.domains);
  if (domainOverlap.length > 0) {
    score += 6;
    reasons.push('domain_hint');
  }
  return { score, reasons };
}

function versionDigest(catalog, aspects, sessionId = null) {
  return hashText(stableStringify({
    sessionId,
    catalog: catalog.map((entry) => ({
      kuId: entry.kuId,
      scope: entry.scope,
      rev: entry.meta?.rev ?? 0,
      status: entry.meta?.status ?? 'active',
      contentHash: hashText(entry.content),
    })),
    aspects: [...aspects.approved, ...aspects.candidates].map((aspect) => ({
      aspectId: aspect.aspectId,
      status: aspect.meta?.status,
      rev: aspect.meta?.rev ?? 0,
      digest: hashText(aspect.sourceText),
    })),
  }));
}

function lexicalDocument(entry) {
  return {
    id: `${entry.scope}:${entry.kuId}:${entry.meta?.rev ?? 0}`,
    kuId: entry.kuId,
    title: entry.meta?.title ?? entry.kuId,
    summary: entry.meta?.summary ?? '',
    content: entry.content ?? '',
    tags: (entry.meta?.tags ?? []).join(' '),
    commands: (entry.meta?.commands ?? []).join(' '),
    interpreters: (entry.meta?.interpreters ?? []).join(' '),
    domains: (entry.meta?.domains ?? []).join(' '),
  };
}

function byteBudgetSelect(items, byteBudget) {
  const selected = [];
  const pruned = [];
  let usedBytes = 0;
  for (const item of items) {
    const rendered = normalizeWhitespace([
      item.meta?.title,
      item.meta?.summary,
      item.content,
      item.usage,
    ].filter(Boolean).join('\n'));
    const size = byteLength(rendered);
    if (usedBytes + size > byteBudget && selected.length > 0) {
      pruned.push({ kuId: item.kuId, reason: 'byte_budget' });
      continue;
    }
    selected.push(item);
    usedBytes += size;
  }
  return { selected, pruned, usedBytes };
}

export class ExplainableMemory {
  constructor({ sourceStrategy, persistenceStrategy }) {
    this.sourceStrategy = sourceStrategy;
    this.persistenceStrategy = persistenceStrategy;
    this.searchCache = new Map();
  }

  async listAspects() {
    return this.sourceStrategy.listAspects();
  }

  async upsertAspect(input) {
    return this.sourceStrategy.upsertAspect(input);
  }

  async approveAspect(aspectId) {
    return this.sourceStrategy.approveAspect(aspectId);
  }

  createSearchIndex(documents = []) {
    const index = new MiniSearch(SEARCH_OPTIONS);
    index.addAll(documents);
    return index;
  }

  async loadSearchIndex(snapshot) {
    if (this.searchCache.has(snapshot.version)) {
      return this.searchCache.get(snapshot.version);
    }
    const index = snapshot.lexicalIndexJson
      ? MiniSearch.loadJSON(snapshot.lexicalIndexJson, SEARCH_OPTIONS)
      : this.createSearchIndex(snapshot.lexicalDocuments ?? []);
    this.searchCache.set(snapshot.version, index);
    return index;
  }

  async reanalyse(sessionId = null, catalog = null) {
    const startedAt = new Date().toISOString();
    await this.persistenceStrategy.markStarted(sessionId, { last_started_at: startedAt });
    try {
      const resolvedCatalog = catalog ?? await this.sourceStrategy.loadKnowledgeCatalog(sessionId);
      const aspects = await this.sourceStrategy.listAspects();
      const version = versionDigest(resolvedCatalog, aspects, sessionId);
      const existing = await this.persistenceStrategy.loadSnapshot(sessionId);
      if (existing?.version === version) {
        return {
          ...existing,
          sessionId,
          builtAt: existing.builtAt,
        };
      }
      const approvedAspects = aspects.approved.map((aspect) => ({
        ...aspect,
        tokens: aspectTokens(aspect),
      }));
      const kuRecords = resolvedCatalog.map((entry) => {
        const aspectSignals = approvedAspects.map((aspect) => {
          const signal = scoreAspectForEntry(aspect, entry);
          return {
            aspectId: aspect.aspectId,
            aspectType: aspect.meta?.aspect_type ?? 'operational',
            score: signal.score,
            reasons: signal.reasons,
          };
        }).filter((signal) => signal.score > 0);
        return {
          kuId: entry.kuId,
          scope: entry.scope,
          rev: entry.meta?.rev ?? 0,
          lexicalDocumentId: `${entry.scope}:${entry.kuId}:${entry.meta?.rev ?? 0}`,
          aspectSignals,
          indexedAt: startedAt,
        };
      });
      const inverseAspectView = {};
      for (const record of kuRecords) {
        for (const signal of record.aspectSignals) {
          const bucket = inverseAspectView[signal.aspectId] ?? [];
          bucket.push(record.kuId);
          inverseAspectView[signal.aspectId] = bucket;
        }
      }
      const lexicalDocuments = resolvedCatalog.map(lexicalDocument);
      const searchIndex = this.createSearchIndex(lexicalDocuments);
      const builtAt = new Date().toISOString();
      const snapshot = {
        version,
        sessionId,
        startedAt,
        builtAt,
        counts: {
          indexed_ku_count: kuRecords.length,
          approved_aspect_count: aspects.approved.length,
          candidate_aspect_count: aspects.candidates.length,
        },
        approvedAspects: aspects.approved.map((aspect) => ({
          aspectId: aspect.aspectId,
          meta: aspect.meta,
          definition: aspect.definition,
          inclusionCriteria: aspect.inclusionCriteria,
          exclusionCriteria: aspect.exclusionCriteria,
          protocol: aspect.protocol,
          roleVocabulary: aspect.roleVocabulary,
          queryTerms: aspect.queryTerms,
          fileName: aspect.fileName,
          filePath: aspect.filePath,
          sourceText: aspect.sourceText,
        })),
        candidateAspects: aspects.candidates.map((aspect) => ({
          aspectId: aspect.aspectId,
          meta: aspect.meta,
          definition: aspect.definition,
          inclusionCriteria: aspect.inclusionCriteria,
          exclusionCriteria: aspect.exclusionCriteria,
          protocol: aspect.protocol,
          roleVocabulary: aspect.roleVocabulary,
          queryTerms: aspect.queryTerms,
          fileName: aspect.fileName,
          filePath: aspect.filePath,
          sourceText: aspect.sourceText,
        })),
        kuRecords,
        inverseAspectView,
        lexicalDocuments,
        lexicalIndexJson: searchIndex.toJSON(),
      };
      await this.persistenceStrategy.saveSnapshot(sessionId, snapshot);
      this.searchCache.set(version, searchIndex);
      return snapshot;
    } catch (error) {
      await this.persistenceStrategy.markFailed(sessionId, error);
      throw error;
    }
  }

  async ensureSnapshot(sessionId = null, catalog = null) {
    return this.reanalyse(sessionId, catalog);
  }

  async getStatus(sessionId = null, catalog = null) {
    const snapshot = await this.ensureSnapshot(sessionId, catalog);
    const status = await this.persistenceStrategy.loadStatus(sessionId);
    return {
      mode: 'explainable_memory',
      snapshot_version: snapshot.version,
      counts: snapshot.counts,
      status,
      approved_aspects: snapshot.approvedAspects,
      candidate_aspects: snapshot.candidateAspects,
    };
  }

  selectActiveAspects(snapshot, input) {
    const scored = snapshot.approvedAspects.map((aspect) => {
      const signal = activeAspectScore(aspect, input);
      return {
        aspectId: aspect.aspectId,
        aspectType: aspect.meta?.aspect_type ?? 'operational',
        title: aspect.meta?.title ?? aspect.aspectId,
        score: signal.score + Number(aspect.meta?.priority ?? 0),
        reasons: signal.reasons,
      };
    }).filter((entry) => entry.score > 0);
    scored.sort((left, right) => right.score - left.score || left.aspectId.localeCompare(right.aspectId));
    return scored.slice(0, 4);
  }

  async queryRelevant(snapshot, baseResult, input) {
    const activeAspects = this.selectActiveAspects(snapshot, input);
    const activeAspectSet = new Set(activeAspects.map((entry) => entry.aspectId));
    const searchIndex = await this.loadSearchIndex(snapshot);
    const queryText = normalizeWhitespace([
      ...(input.queryTokens ?? []),
      input.requestText ?? '',
      input.bodyText ?? '',
    ].join(' '));
    const lexicalHits = queryText
      ? searchIndex.search(queryText, { prefix: true, fuzzy: 0.1 })
      : [];
    const lexicalScores = new Map();
    for (const hit of lexicalHits) {
      lexicalScores.set(hit.kuId, Math.max(lexicalScores.get(hit.kuId) ?? 0, Number(hit.score ?? 0)));
    }

    const recordsById = new Map(snapshot.kuRecords.map((record) => [record.kuId, record]));
    const ranked = (baseResult.candidates ?? []).map((entry) => {
      const record = recordsById.get(entry.kuId);
      const aspectSignals = (record?.aspectSignals ?? []).filter((signal) => activeAspectSet.has(signal.aspectId));
      const aspectScore = aspectSignals.reduce((sum, signal) => sum + signal.score, 0);
      const lexicalScore = lexicalScores.get(entry.kuId) ?? 0;
      const finalScore = Number(entry.baseScore ?? entry.score ?? 0) + (aspectScore * 2.5) + lexicalScore;
      const lexicalFallbackUsed = aspectSignals.length === 0 && lexicalScore > 0;
      return {
        ...entry,
        usage_reference: `~${entry.kuId}`,
        usage: usageIndication(entry, aspectSignals, lexicalFallbackUsed),
        aspect_ids: aspectSignals.map((signal) => signal.aspectId),
        aspect_signals: aspectSignals,
        lexical_fallback_used: lexicalFallbackUsed,
        index_state: {
          indexed: Boolean(record),
          indexed_at: record?.indexedAt ?? snapshot.builtAt,
          snapshot_version: snapshot.version,
          lexical_document_id: record?.lexicalDocumentId ?? null,
          matched_aspects: aspectSignals.map((signal) => signal.aspectId),
        },
        score_breakdown: {
          base: Number(entry.baseScore ?? entry.score ?? 0),
          aspect: aspectScore,
          lexical: lexicalScore,
          final: finalScore,
        },
        score: finalScore,
      };
    });

    ranked.sort((left, right) => right.score - left.score || left.kuId.localeCompare(right.kuId));
    const { selected, pruned, usedBytes } = byteBudgetSelect(ranked, input.byteBudget ?? 4_096);
    return {
      callerProfile: baseResult.callerProfile,
      mode: 'explainable_memory',
      selected,
      pruned,
      usedBytes,
      candidates: ranked,
      explanation: {
        snapshotVersion: snapshot.version,
        activeAspects,
        lexicalFallbackUsed: selected.some((entry) => entry.lexical_fallback_used),
      },
    };
  }
}

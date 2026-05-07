import { normalizeWhitespace, tokenize } from '../utils/text.mjs';

const DEFAULT_SCAN_LIMITS = {
  maxSessions: 12,
  maxRequestsPerSession: 8,
  maxProposals: 8,
};

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'allow', 'allows', 'also', 'among', 'analyse', 'analysis', 'another',
  'because', 'before', 'being', 'between', 'build', 'cache', 'calls', 'candidate', 'candidates', 'chat',
  'command', 'commands', 'common', 'context', 'current', 'detail', 'details', 'during', 'editor', 'entry',
  'every', 'explain', 'explainable', 'field', 'fields', 'focus', 'from', 'generated', 'global', 'governed',
  'guide', 'guidance', 'have', 'having', 'include', 'index', 'indexed', 'indexing', 'information', 'inspector',
  'into', 'just', 'knowledge', 'logs', 'memory', 'model', 'more', 'must', 'need', 'node', 'only', 'operator',
  'page', 'pages', 'pending', 'prompt', 'promote', 'promotion', 'recent', 'request', 'requests', 'response',
  'result', 'role', 'runtime', 'same', 'scan', 'scanned', 'select', 'selected', 'selection', 'server',
  'session', 'sessions', 'should', 'show', 'state', 'status', 'still', 'surface', 'surfaces', 'system',
  'task', 'text', 'that', 'their', 'them', 'there', 'these', 'they', 'this', 'through', 'trace', 'used',
  'using', 'value', 'visible', 'when', 'where', 'which', 'with', 'would',
]);

function clampCount(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function summarizeText(value, maxLength = 140) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function humanizeToken(token) {
  const value = String(token || '').replace(/[_-]+/g, ' ').trim();
  if (!value) {
    return '';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function aspectIdForToken(token) {
  return `aspect_scan_${String(token || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase()}`;
}

function collectAspectTokens(aspect) {
  return tokenize([
    aspect.aspectId,
    aspect.meta?.title,
    aspect.meta?.summary,
    aspect.definition,
    aspect.inclusionCriteria,
    aspect.exclusionCriteria,
    aspect.protocol,
    ...(aspect.queryTerms ?? []),
    ...(aspect.meta?.query_terms ?? []),
    ...(aspect.meta?.domains ?? []),
    ...(aspect.meta?.commands ?? []),
    ...(aspect.meta?.interpreters ?? []),
    ...(aspect.meta?.tags ?? []),
  ].join(' '));
}

function filterSignalTokens(text, coveredTokens) {
  return tokenize(text).filter((token) => (
    token.length >= 5
    && !STOPWORDS.has(token)
    && !coveredTokens.has(token)
    && !/^\d+$/.test(token)
  ));
}

function mergeTraceSignals(traceEvents = []) {
  const byRequest = new Map();
  for (const event of traceEvents) {
    const requestId = event.request_id;
    if (!requestId) {
      continue;
    }
    const current = byRequest.get(requestId) ?? {
      commands: new Set(),
      interpreters: new Set(),
    };
    if (event.command_id) {
      current.commands.add(String(event.command_id));
    }
    if (event.interpreter_id) {
      current.interpreters.add(String(event.interpreter_id));
    }
    if (event.originating_component) {
      current.commands.add(String(event.originating_component));
    }
    byRequest.set(requestId, current);
  }
  return byRequest;
}

function proposalTemplate(token, stats, existing = null) {
  const title = existing?.meta?.title || `${humanizeToken(token)} focus`;
  const summary = `Derived from ${stats.requestCount} recent request${stats.requestCount === 1 ? '' : 's'} mentioning "${token}".`;
  return {
    aspectId: aspectIdForToken(token),
    fileName: existing?.fileName || `${aspectIdForToken(token)}.sop`,
    rootValue: existing?.rootValue || `Use this aspect when recent runtime activity repeatedly points to "${token}".`,
    meta: {
      ...(existing?.meta ?? {}),
      status: 'proposed',
      aspect_type: existing?.meta?.aspect_type || 'operational',
      title,
      summary,
      priority: Number(existing?.meta?.priority ?? 0),
      domains: existing?.meta?.domains ?? [],
      commands: existing?.meta?.commands?.length ? existing.meta.commands : [...stats.commands],
      interpreters: existing?.meta?.interpreters?.length ? existing.meta.interpreters : [...stats.interpreters],
      tags: [...new Set([...(existing?.meta?.tags ?? []), 'log-scan'])],
      query_terms: existing?.meta?.query_terms?.length ? existing.meta.query_terms : [token],
      proposal_source: 'log_scan',
      observed_request_count: stats.requestCount,
      observed_session_count: stats.sessionIds.size,
      observed_commands: [...stats.commands],
      observed_interpreters: [...stats.interpreters],
      last_scanned_at: new Date().toISOString(),
    },
    definition: existing?.definition || `This proposed aspect was inferred symbolically from recent runtime logs that repeatedly mention "${token}".`,
    inclusionCriteria: existing?.inclusionCriteria || `Prefer this aspect when requests, prompt assets, or captured LLM instructions repeatedly mention "${token}".`,
    exclusionCriteria: existing?.exclusionCriteria || `Do not approve without review when the signal is incidental or already covered by an approved aspect.`,
    protocol: existing?.protocol || 'Treat this as a scan-derived proposal. Review, refine, then approve before it becomes active for ordinary retrieval.',
    roleVocabulary: existing?.roleVocabulary?.length ? existing.roleVocabulary : [token],
    queryTerms: existing?.queryTerms?.length ? existing.queryTerms : [token],
    scanPreview: stats.samples.map((sample) => summarizeText(sample, 120)),
  };
}

export class ExplainableMemoryLogProposalScanner {
  constructor({ sessionManager, traceStore, sourceStrategy }) {
    this.sessionManager = sessionManager;
    this.traceStore = traceStore;
    this.sourceStrategy = sourceStrategy;
  }

  async scanAndPersist(options = {}) {
    const limits = {
      maxSessions: clampCount(options.maxSessions, DEFAULT_SCAN_LIMITS.maxSessions),
      maxRequestsPerSession: clampCount(options.maxRequestsPerSession, DEFAULT_SCAN_LIMITS.maxRequestsPerSession),
      maxProposals: clampCount(options.maxProposals, DEFAULT_SCAN_LIMITS.maxProposals),
    };

    const aspects = await this.sourceStrategy.listAspects();
    const existingAspects = [
      ...(aspects.approved ?? []),
      ...(aspects.candidates ?? []),
      ...(aspects.proposed ?? []),
    ];
    const coveredTokens = new Set([
      ...(aspects.approved ?? []),
      ...(aspects.candidates ?? []),
    ].flatMap((aspect) => collectAspectTokens(aspect)));

    let sessions = await this.sessionManager.listSessions();
    if (options.sessionId) {
      sessions = sessions.filter((session) => session.session_id === options.sessionId);
    }
    sessions.sort((left, right) => {
      const rightTime = Date.parse(right.updated_at ?? right.last_activity_at ?? right.created_at ?? 0);
      const leftTime = Date.parse(left.updated_at ?? left.last_activity_at ?? left.created_at ?? 0);
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });

    const tokenStats = new Map();
    let scannedRequestCount = 0;

    for (const session of sessions.slice(0, limits.maxSessions)) {
      const requestSummaries = await this.sessionManager.readRequestSummaries(session.session_id);
      requestSummaries.sort((left, right) => {
        const rightTime = Date.parse(right.created_at ?? 0);
        const leftTime = Date.parse(left.created_at ?? 0);
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      });
      const selectedRequestIds = requestSummaries
        .map((summary) => summary.request_id)
        .filter(Boolean)
        .slice(0, limits.maxRequestsPerSession);

      if (selectedRequestIds.length === 0) {
        continue;
      }

      const sessionTrace = await this.traceStore.readAll(session.session_id);
      const traceSignals = mergeTraceSignals(sessionTrace);

      for (const requestId of selectedRequestIds) {
        const [envelope, outcome, cacheSnapshot] = await Promise.all([
          this.sessionManager.loadRequestEnvelope(session.session_id, requestId),
          this.sessionManager.loadRequestOutcome(session.session_id, requestId),
          this.sessionManager.loadRequestLlmCacheCandidates(session.session_id, requestId),
        ]);

        const requestSignals = traceSignals.get(requestId) ?? { commands: new Set(), interpreters: new Set() };
        const texts = [
          envelope?.request_text,
          envelope?.requestText,
          typeof outcome?.response === 'string' ? outcome.response : '',
          ...((cacheSnapshot?.items ?? []).flatMap((item) => [item.instruction, item.context_package])),
        ].filter(Boolean);

        const requestTokens = new Set(texts.flatMap((text) => filterSignalTokens(text, coveredTokens)));
        if (requestTokens.size === 0) {
          continue;
        }
        scannedRequestCount += 1;

        for (const token of requestTokens) {
          const current = tokenStats.get(token) ?? {
            requestCount: 0,
            sessionIds: new Set(),
            requestIds: new Set(),
            commands: new Set(),
            interpreters: new Set(),
            samples: [],
          };
          if (!current.requestIds.has(requestId)) {
            current.requestCount += 1;
          }
          current.sessionIds.add(session.session_id);
          current.requestIds.add(requestId);
          for (const commandId of requestSignals.commands) {
            current.commands.add(commandId);
          }
          for (const interpreterId of requestSignals.interpreters) {
            current.interpreters.add(interpreterId);
          }
          if (current.samples.length < 3) {
            current.samples.push(texts[0]);
          }
          tokenStats.set(token, current);
        }
      }
    }

    const rankedTokens = [...tokenStats.entries()]
      .sort((left, right) => {
        if (right[1].requestCount !== left[1].requestCount) {
          return right[1].requestCount - left[1].requestCount;
        }
        return left[0].localeCompare(right[0]);
      })
      .slice(0, limits.maxProposals);

    const saved = [];
    for (const [token, stats] of rankedTokens) {
      const aspectId = aspectIdForToken(token);
      const existing = existingAspects.find((aspect) => aspect.aspectId === aspectId) ?? null;
      if (existing?.meta?.status === 'approved' || existing?.meta?.status === 'candidate') {
        continue;
      }
      const proposal = proposalTemplate(token, stats, existing);
      const stored = await this.sourceStrategy.upsertAspect(proposal);
      if (stored) {
        saved.push(stored);
      }
    }
    return {
      scanned_session_count: Math.min(sessions.length, limits.maxSessions),
      scanned_request_count: scannedRequestCount,
      generated_count: saved.length,
      proposals: saved,
    };
  }
}

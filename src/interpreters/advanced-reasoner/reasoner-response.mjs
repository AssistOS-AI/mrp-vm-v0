const CERTAINTY_VALUES = new Set(['high', 'medium_high', 'medium', 'low', 'unknown']);
const EVIDENCE_VALUES = new Set(['strong', 'moderate', 'weak', 'conflicting', 'incomplete', 'absent', 'structural']);
const RISK_VALUES = new Set(['low', 'medium', 'high']);
const FORMALIZATION_VALUES = new Set(['complete', 'partial', 'weak', 'not_available']);
const PROMOTION_VALUES = new Set(['yes', 'with_review', 'no']);

function ensureObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function ensureString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeEnum(value, label, allowedValues, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }
  const normalized = String(value);
  if (!allowedValues.has(normalized)) {
    throw new Error(`${label} must be one of ${[...allowedValues].join(', ')}.`);
  }
  return normalized;
}

function normalizeList(value) {
  if (value == null) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

function clonePayload(payload) {
  return {
    ...payload,
    openQuestions: [...(payload.openQuestions ?? [])],
    requiredInputs: [...(payload.requiredInputs ?? [])],
    questions: [...(payload.questions ?? [])],
    missing: [...(payload.missing ?? [])],
    resolvedParts: Array.isArray(payload.resolvedParts) ? [...payload.resolvedParts] : payload.resolvedParts,
    unresolvedParts: Array.isArray(payload.unresolvedParts) ? [...payload.unresolvedParts] : payload.unresolvedParts,
    diagnostics: [...(payload.diagnostics ?? [])],
    trace: [...(payload.trace ?? [])],
  };
}

function buildSharedPayload(config, defaults = {}) {
  const input = ensureObject(config, 'ReasonerResponse config');
  const payload = {
    text: ensureString(input.text, 'text'),
    mode: input.mode ? String(input.mode) : defaults.mode ?? null,
    certainty: normalizeEnum(input.certainty, 'certainty', CERTAINTY_VALUES, defaults.certainty ?? null),
    evidenceQuality: normalizeEnum(input.evidenceQuality, 'evidenceQuality', EVIDENCE_VALUES, defaults.evidenceQuality ?? null),
    assumptionRisk: normalizeEnum(input.assumptionRisk, 'assumptionRisk', RISK_VALUES, defaults.assumptionRisk ?? null),
    openWorldRisk: normalizeEnum(input.openWorldRisk, 'openWorldRisk', RISK_VALUES, defaults.openWorldRisk ?? null),
    formalizationQuality: normalizeEnum(
      input.formalizationQuality,
      'formalizationQuality',
      FORMALIZATION_VALUES,
      defaults.formalizationQuality ?? null,
    ),
    promotion: normalizeEnum(input.promotion, 'promotion', PROMOTION_VALUES, defaults.promotion ?? 'no'),
    openQuestions: normalizeList(input.openQuestions),
    requiredInputs: normalizeList(input.requiredInputs),
    trace: normalizeList(input.trace),
  };

  if (!payload.mode && defaults.requireMode) {
    throw new Error('mode is required.');
  }

  return payload;
}

export class ReasonerResponse {
  constructor(payload) {
    this.payload = Object.freeze(clonePayload(payload));
  }

  get status() {
    return this.payload.status;
  }

  toJSON() {
    return clonePayload(this.payload);
  }

  static from(value) {
    if (value instanceof ReasonerResponse) {
      return value;
    }
    const input = ensureObject(value, 'ReasonerResponse');
    const status = ensureString(input.status, 'status');
    return new ReasonerResponse({
      ...buildSharedPayload(input, {
        requireMode: status !== 'error',
      }),
      ...input,
      status,
      openQuestions: normalizeList(input.openQuestions),
      requiredInputs: normalizeList(input.requiredInputs),
      questions: normalizeList(input.questions),
      missing: normalizeList(input.missing),
      diagnostics: normalizeList(input.diagnostics),
      trace: normalizeList(input.trace),
    });
  }

  static reasoned(config) {
    const payload = buildSharedPayload(config, {
      requireMode: true,
      certainty: 'medium',
      evidenceQuality: 'moderate',
      assumptionRisk: 'medium',
      promotion: 'with_review',
      formalizationQuality: 'partial',
    });
    return new ReasonerResponse({
      ...payload,
      status: 'reasoned',
    });
  }

  static solved(config) {
    const payload = buildSharedPayload(config, {
      requireMode: true,
      certainty: 'high',
      evidenceQuality: 'structural',
      assumptionRisk: 'low',
      promotion: 'yes',
      formalizationQuality: 'complete',
    });
    if (!['high', 'medium_high'].includes(payload.certainty ?? 'high')) {
      throw new Error('Solved responses require high or medium_high certainty.');
    }
    return new ReasonerResponse({
      ...payload,
      status: 'solved',
    });
  }

  static partial(config) {
    const input = ensureObject(config, 'ReasonerResponse.partial config');
    const payload = buildSharedPayload(input, {
      requireMode: true,
      certainty: 'medium',
      evidenceQuality: 'moderate',
      assumptionRisk: 'medium',
      promotion: 'with_review',
      formalizationQuality: 'partial',
    });
    return new ReasonerResponse({
      ...payload,
      status: 'partial',
      resolvedParts: Array.isArray(input.resolvedParts) ? input.resolvedParts : [],
      unresolvedParts: Array.isArray(input.unresolvedParts) ? input.unresolvedParts : [],
      recommendedEngine: input.recommendedEngine ? String(input.recommendedEngine) : null,
    });
  }

  static needsClarification(config) {
    const input = ensureObject(config, 'ReasonerResponse.needsClarification config');
    const payload = buildSharedPayload(input, {
      requireMode: true,
      certainty: 'unknown',
      evidenceQuality: 'incomplete',
      assumptionRisk: 'medium',
      promotion: 'no',
      formalizationQuality: 'weak',
    });
    return new ReasonerResponse({
      ...payload,
      status: 'needs_clarification',
      missing: normalizeList(input.missing),
      questions: normalizeList(input.questions),
      openQuestions: normalizeList(input.questions).length > 0 ? normalizeList(input.questions) : payload.openQuestions,
    });
  }

  static needsEngine(config) {
    const input = ensureObject(config, 'ReasonerResponse.needsEngine config');
    const payload = buildSharedPayload(input, {
      requireMode: true,
      certainty: 'low',
      evidenceQuality: 'weak',
      assumptionRisk: 'high',
      promotion: 'no',
      formalizationQuality: 'partial',
    });
    return new ReasonerResponse({
      ...payload,
      status: 'needs_engine',
      recommendedEngine: ensureString(input.recommendedEngine, 'recommendedEngine'),
      reason: ensureString(input.reason, 'reason'),
    });
  }

  static needsReview(config) {
    const input = ensureObject(config, 'ReasonerResponse.needsReview config');
    const payload = buildSharedPayload(input, {
      requireMode: true,
      certainty: 'low',
      evidenceQuality: 'moderate',
      assumptionRisk: 'high',
      promotion: 'with_review',
      formalizationQuality: 'partial',
    });
    return new ReasonerResponse({
      ...payload,
      status: 'needs_review',
      reviewReason: ensureString(input.reviewReason, 'reviewReason'),
    });
  }

  static inconclusive(config) {
    const input = ensureObject(config, 'ReasonerResponse.inconclusive config');
    const payload = buildSharedPayload(input, {
      requireMode: true,
      certainty: 'low',
      evidenceQuality: 'incomplete',
      assumptionRisk: 'medium',
      promotion: 'no',
      formalizationQuality: 'partial',
    });
    return new ReasonerResponse({
      ...payload,
      status: 'inconclusive',
      reason: input.reason ? String(input.reason) : null,
    });
  }

  static error(config) {
    const input = ensureObject(config, 'ReasonerResponse.error config');
    return new ReasonerResponse({
      status: 'error',
      text: ensureString(input.text, 'text'),
      mode: input.mode ? String(input.mode) : null,
      errorType: ensureString(input.errorType, 'errorType'),
      diagnostics: normalizeList(input.diagnostics),
      promotion: 'no',
      certainty: 'unknown',
      evidenceQuality: 'absent',
      assumptionRisk: 'high',
      openWorldRisk: null,
      formalizationQuality: 'not_available',
      openQuestions: [],
      requiredInputs: [],
      questions: [],
      missing: [],
      trace: normalizeList(input.trace),
    });
  }
}

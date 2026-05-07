export const ERROR_KINDS = Object.freeze([
  'parse_error',
  'resolution_error',
  'contract_refusal',
  'execution_error',
  'provider_failure',
  'policy_denied',
  'blocked_state',
  'budget_exhausted',
  'unknown_outcome',
]);

export const NON_USABLE_STATUSES = new Set([
  'error',
  'refused',
  'blocked',
  'withdrawn',
  'unknown',
]);

export function assertErrorKind(kind) {
  if (!ERROR_KINDS.includes(kind)) {
    throw new Error(`Unknown normalized error kind: ${kind}`);
  }
}

export function createFailureRecord(input) {
  const {
    kind,
    message,
    origin,
    familyId = null,
    provider = null,
    repairable = false,
    retryCount = 0,
    details = null,
  } = input;

  assertErrorKind(kind);

  return {
    kind,
    message,
    origin,
    familyId,
    provider,
    repairable,
    retryCount,
    details,
  };
}

function safeCloneDetails(details) {
  if (details == null) {
    return null;
  }
  if (Array.isArray(details)) {
    return details.map((item) => safeCloneDetails(item));
  }
  if (typeof details === 'object') {
    return Object.fromEntries(Object.entries(details).map(([key, value]) => [key, safeCloneDetails(value)]));
  }
  return details;
}

function normalizeMessage(error, defaultMessage) {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return defaultMessage;
}

export function normalizeErrorLike(error, options = {}) {
  const {
    defaultCode = 'EXECUTION_ERROR',
    defaultKind = 'execution_error',
    defaultMessage = 'Execution failed.',
  } = options;

  const kind = error?.kind ?? error?.failure_kind ?? defaultKind;
  const code = error?.code ?? String(kind || defaultCode).toUpperCase();
  const message = normalizeMessage(error, defaultMessage);
  const details = safeCloneDetails(error?.details ?? error?.failure?.details ?? null);
  return {
    code,
    kind,
    message,
    name: error?.name ?? null,
    origin: error?.origin ?? error?.originating_component ?? null,
    repairable: error?.repairable ?? null,
    retryCount: Number(error?.retryCount ?? error?.retry_count ?? 0) || 0,
    stack: typeof error?.stack === 'string' && error.stack.trim() ? error.stack : null,
    details,
  };
}

export function normalizeFailureDetails(error, extra = {}) {
  const normalized = normalizeErrorLike(error);
  const baseDetails = normalized.details && typeof normalized.details === 'object'
    ? normalized.details
    : normalized.details == null
      ? {}
      : { value: normalized.details };

  return {
    ...baseDetails,
    ...extra,
    error_code: normalized.code,
    error_name: normalized.name,
    stack: extra.stack ?? normalized.stack ?? baseDetails.stack ?? null,
  };
}

export function createFailureVariantMeta(input) {
  const {
    kind,
    origin,
    reason,
    repairable,
    createdEpoch,
    retryCount = 0,
  } = input;

  return {
    status: kind === 'contract_refusal' ? 'refused' : 'error',
    error_kind: kind,
    reason,
    repairable,
    origin,
    created_epoch: createdEpoch,
    retry_count: retryCount,
  };
}

export function isUsableStatus(status) {
  return !NON_USABLE_STATUSES.has(status);
}

export function isUsableVariant(variant) {
  return Boolean(variant) && isUsableStatus(variant.meta.status ?? 'active');
}

export function createBlockedState(familyId, origin, message) {
  return createFailureRecord({
    kind: 'blocked_state',
    message,
    origin,
    familyId,
    repairable: true,
  });
}

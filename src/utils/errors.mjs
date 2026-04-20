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

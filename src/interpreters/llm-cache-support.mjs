import { createHash } from 'node:crypto';

export function normalizePromptAssets(promptAssets = []) {
  return promptAssets.map((entry) => ({
    ku_id: entry.kuId ?? entry.ku_id,
    title: entry.meta?.title ?? entry.title ?? entry.kuId ?? entry.ku_id,
    summary: entry.meta?.summary ?? entry.summary ?? '',
    content: entry.content ?? entry.value ?? '',
  }));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = sortJsonValue(value[key]);
    return acc;
  }, {});
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

export function buildCacheLookupPayload(payload = {}) {
  return {
    profile: payload.profile ?? '',
    model_class: payload.model_class ?? '',
    expected_output_mode: payload.expected_output_mode ?? 'plain_value',
    instruction: normalizeText(payload.instruction),
    context_package: normalizeText(payload.context_package),
    prompt_assets: normalizePromptAssets(payload.prompt_assets).map((entry) => ({
      ku_id: entry.ku_id,
      title: entry.title,
      summary: entry.summary,
      content: entry.content,
    })),
  };
}

export function buildCacheLookupKey(payload = {}) {
  const canonical = JSON.stringify(sortJsonValue(buildCacheLookupPayload(payload)));
  return createHash('sha256').update(canonical).digest('hex');
}

export function createCacheCandidateRecord({
  payload = {},
  binding = null,
  normalizedResult = {},
  source = 'provider',
  lookupKey = buildCacheLookupKey(payload),
  traceContext = payload.trace_context ?? {},
  capturedAt = new Date().toISOString(),
}) {
  return {
    candidate_id: `${traceContext.request_id ?? 'request'}:${traceContext.declaration_id ?? 'llm'}:${lookupKey.slice(0, 12)}:${source}`,
    captured_at: capturedAt,
    source,
    lookup_key: lookupKey,
    session_id: traceContext.session_id ?? null,
    request_id: traceContext.request_id ?? null,
    epoch_id: traceContext.epoch_id ?? null,
    declaration_id: traceContext.declaration_id ?? null,
    target_family: traceContext.target_family ?? null,
    origin: traceContext.origin ?? null,
    profile: payload.profile ?? '',
    model_class: payload.model_class ?? '',
    expected_output_mode: payload.expected_output_mode ?? 'plain_value',
    instruction: normalizeText(payload.instruction),
    context_package: normalizeText(payload.context_package),
    prompt_assets: normalizePromptAssets(payload.prompt_assets).map((entry) => ({
      ku_id: entry.ku_id,
      title: entry.title,
      summary: entry.summary,
      content: entry.content,
    })),
    binding: binding ? {
      model: binding.model ?? null,
      model_tier: binding.tier ?? binding.modelTier ?? null,
      task_tag: binding.taskTag ?? binding.task_tag ?? null,
    } : {
      model: null,
      model_tier: null,
      task_tag: null,
    },
    response: {
      status: normalizedResult.status ?? 'success',
      output_mode: normalizedResult.output_mode ?? payload.expected_output_mode ?? 'plain_value',
      value: normalizedResult.value ?? null,
      message: normalizedResult.message ?? null,
    },
  };
}

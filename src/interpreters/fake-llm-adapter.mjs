import { ManagedLlmAdapter } from './llm-adapter.mjs';
import { buildCacheLookupKey, createCacheCandidateRecord } from './llm-cache-support.mjs';

export class FakeLlmAdapter extends ManagedLlmAdapter {
  constructor(options = {}) {
    super();
    this.scriptedResponses = new Map(Object.entries(options.scriptedResponses ?? {}));
    this.scriptedSequences = new Map(
      Object.entries(options.scriptedSequences ?? {}).map(([profile, responses]) => [profile, [...responses]]),
    );
    this.defaultBehavior = options.defaultBehavior ?? 'echo';
    this.cacheStore = options.cacheStore ?? null;
    this.recordInvocation = options.recordInvocation ?? null;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  setResponse(key, response) {
    this.scriptedResponses.set(key, response);
  }

  setSequence(profile, responses) {
    this.scriptedSequences.set(profile, [...responses]);
  }

  createKey(payload) {
    const mode = payload.trace_context?.mode ?? 'default';
    return `${payload.profile}::${mode}::${payload.instruction}`;
  }

  resolveScripted(payload) {
    const mode = payload.trace_context?.mode ?? 'default';
    const keys = [
      this.createKey(payload),
      `${payload.profile}::${payload.instruction}`,
      `${payload.profile}::${mode}`,
      payload.profile,
    ];
    for (const key of keys) {
      if (this.scriptedResponses.has(key)) {
        return this.scriptedResponses.get(key);
      }
    }
    const sequence = this.scriptedSequences.get(payload.profile);
    if (sequence && sequence.length > 0) {
      return sequence.shift();
    }
    return null;
  }

  wrapValue(payload, value) {
    let outputMode = payload.expected_output_mode ?? 'plain_value';
    if (payload.profile === 'plannerLLM') {
      outputMode = 'sop_proposal';
    } else if (payload.profile === 'codeGeneratorLLM') {
      outputMode = 'code_block';
    }
    return {
      status: 'success',
      output_mode: outputMode,
      value,
    };
  }

  normalizeResult(payload, result) {
    if (result && typeof result === 'object' && 'status' in result) {
      return result;
    }
    return this.wrapValue(payload, result);
  }

  async invoke(payload) {
    const lookupKey = buildCacheLookupKey(payload);
    const cachedEntry = await this.cacheStore?.resolveByLookupKey(lookupKey);
    if (cachedEntry) {
      const updatedEntry = await this.cacheStore.noteHit(cachedEntry.entry_id);
      const cachedResult = {
        status: cachedEntry.response?.status ?? 'success',
        output_mode: cachedEntry.response?.output_mode ?? payload.expected_output_mode ?? 'plain_value',
        value: cachedEntry.response?.value ?? null,
        message: cachedEntry.response?.message ?? null,
        cache_hit: true,
        cache_entry_id: cachedEntry.entry_id,
        cache_lookup_key: lookupKey,
      };
      await this.recordInvocation?.(createCacheCandidateRecord({
        payload,
        binding: null,
        normalizedResult: cachedResult,
        source: 'cache',
        lookupKey,
        traceContext: payload.trace_context ?? {},
        capturedAt: this.now(),
      }));
      return {
        ...cachedResult,
        cache_hit_count: updatedEntry?.hit_count ?? cachedEntry.hit_count ?? 0,
      };
    }

    let normalizedResult = null;
    const scripted = this.resolveScripted(payload);
    if (scripted !== null) {
      normalizedResult = this.normalizeResult(payload, scripted);
    } else if (payload.profile === 'plannerLLM') {
      normalizedResult = {
        status: 'success',
        output_mode: 'sop_proposal',
        value: `@response writerLLM\n${payload.instruction}`,
      };
    } else if (payload.profile === 'codeGeneratorLLM') {
      normalizedResult = {
        status: 'success',
        output_mode: 'code_block',
        value: `return ${JSON.stringify(payload.instruction)};`,
      };
    } else if (this.defaultBehavior === 'echo') {
      normalizedResult = {
        status: 'success',
        output_mode: payload.expected_output_mode ?? 'plain_value',
        value: `${payload.profile}:${payload.instruction}`,
      };
    } else {
      normalizedResult = {
        status: 'success',
        output_mode: payload.expected_output_mode ?? 'plain_value',
        value: payload.instruction,
      };
    }

    if (normalizedResult.status === 'success') {
      await this.recordInvocation?.(createCacheCandidateRecord({
        payload,
        binding: null,
        normalizedResult,
        source: 'provider',
        lookupKey,
        traceContext: payload.trace_context ?? {},
        capturedAt: this.now(),
      }));
    }
    return normalizedResult;
  }
}

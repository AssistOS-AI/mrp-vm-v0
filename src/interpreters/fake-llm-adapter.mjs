import { ManagedLlmAdapter } from './llm-adapter.mjs';

export class FakeLlmAdapter extends ManagedLlmAdapter {
  constructor(options = {}) {
    super();
    this.scriptedResponses = new Map(Object.entries(options.scriptedResponses ?? {}));
    this.scriptedSequences = new Map(
      Object.entries(options.scriptedSequences ?? {}).map(([profile, responses]) => [profile, [...responses]]),
    );
    this.defaultBehavior = options.defaultBehavior ?? 'echo';
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
    const scripted = this.resolveScripted(payload);
    if (scripted !== null) {
      return this.normalizeResult(payload, scripted);
    }

    if (payload.profile === 'plannerLLM') {
      return {
        status: 'success',
        output_mode: 'sop_proposal',
        value: `@response writerLLM\n${payload.instruction}`,
      };
    }

    if (payload.profile === 'codeGeneratorLLM') {
      return {
        status: 'success',
        output_mode: 'code_block',
        value: `return ${JSON.stringify(payload.instruction)};`,
      };
    }

    if (this.defaultBehavior === 'echo') {
      return {
        status: 'success',
        output_mode: payload.expected_output_mode ?? 'plain_value',
        value: `${payload.profile}:${payload.instruction}`,
      };
    }

    return {
      status: 'success',
      output_mode: payload.expected_output_mode ?? 'plain_value',
      value: payload.instruction,
    };
  }
}

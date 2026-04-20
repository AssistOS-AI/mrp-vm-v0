import { ManagedLlmAdapter } from './llm-adapter.mjs';

export class FakeLlmAdapter extends ManagedLlmAdapter {
  constructor() {
    super();
    this.scriptedResponses = new Map();
  }

  setResponse(key, response) {
    this.scriptedResponses.set(key, response);
  }

  createKey(payload) {
    const mode = payload.trace_context?.mode ?? 'default';
    return `${payload.profile}::${mode}::${payload.instruction}`;
  }

  async invoke(payload) {
    const key = this.createKey(payload);
    if (this.scriptedResponses.has(key)) {
      return this.scriptedResponses.get(key);
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

    return {
      status: 'success',
      output_mode: payload.expected_output_mode ?? 'plain_value',
      value: `${payload.profile}:${payload.instruction}`,
    };
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { ExternalInterpreterRegistry } from '../../src/interpreters/external-interpreter-registry.mjs';
import { FakeLlmAdapter } from '../../src/interpreters/fake-llm-adapter.mjs';

test('external interpreter registry routes wrapper calls through the fake adapter', async () => {
  const adapter = new FakeLlmAdapter();
  adapter.setResponse('plannerLLM::default::plan this', {
    status: 'success',
    output_mode: 'sop_proposal',
    value: '@response writerLLM\nplanned body',
  });

  const registry = new ExternalInterpreterRegistry({
    llmAdapter: adapter,
  });

  registry.register({
    name: 'plannerLLM',
    purpose: 'planning',
    input_contract: ['instruction'],
    output_shapes: ['sop_proposal'],
    cost_class: 'cheap',
    can_insert_declarations: true,
    can_refuse: true,
    uses_llm_adapter: true,
    capability_profile: 'default',
    trace_requirements: ['interpreter_invoked'],
  });

  const effects = await registry.invoke('plannerLLM', {
    body: 'plan this',
    targetFamily: 'response',
    traceContext: {},
    contextPackage: {
      markdown: '',
    },
  });

  assert.equal(effects.declarationInsertions[0].text, '@response writerLLM\nplanned body');
});

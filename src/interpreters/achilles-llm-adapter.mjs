import { pathToFileURL } from 'node:url';
import { ManagedLlmAdapter } from './llm-adapter.mjs';
import { resolveLlmProfile } from '../config/runtime-config.mjs';

function pickAgentClass(moduleNamespace) {
  if (typeof moduleNamespace?.LLMAgent === 'function') {
    return moduleNamespace.LLMAgent;
  }
  if (typeof moduleNamespace?.default?.LLMAgent === 'function') {
    return moduleNamespace.default.LLMAgent;
  }
  if (typeof moduleNamespace?.default === 'function') {
    return moduleNamespace.default;
  }
  return null;
}

function normalizePromptAssets(promptAssets = []) {
  return promptAssets.map((entry) => ({
    ku_id: entry.kuId ?? entry.ku_id,
    title: entry.meta?.title ?? entry.title ?? entry.kuId ?? entry.ku_id,
    summary: entry.meta?.summary ?? entry.summary ?? '',
    content: entry.content ?? entry.value ?? '',
  }));
}

function buildMessages(payload, profileBinding) {
  const promptAssetText = normalizePromptAssets(payload.prompt_assets).map((entry) => {
    return `Asset ${entry.ku_id} (${entry.title})\n${entry.content}`;
  }).join('\n\n');
  const systemSections = [
    `Profile: ${payload.profile}`,
    `Task tag: ${profileBinding.taskTag}`,
    `Model tier: ${profileBinding.tier}`,
    payload.expected_output_mode ? `Expected output mode: ${payload.expected_output_mode}` : '',
    promptAssetText,
  ].filter(Boolean);
  const userSections = [
    payload.context_package ? `Context package:\n${payload.context_package}` : '',
    payload.instruction ? `Instruction:\n${payload.instruction}` : '',
  ].filter(Boolean);

  return [
    {
      role: 'system',
      content: systemSections.join('\n\n'),
    },
    {
      role: 'user',
      content: userSections.join('\n\n'),
    },
  ];
}

function extractValue(result) {
  if (typeof result === 'string') {
    return result;
  }
  return result?.value
    ?? result?.content
    ?? result?.text
    ?? result?.output
    ?? result?.result
    ?? result?.message?.content
    ?? result?.response?.content
    ?? result?.response
    ?? null;
}

function normalizeResult(result, expectedOutputMode) {
  if (typeof result === 'string') {
    return {
      status: 'success',
      output_mode: expectedOutputMode ?? 'plain_value',
      value: result,
    };
  }

  if (result?.status === 'semantic_refusal' || result?.refusal === true) {
    return {
      status: 'semantic_refusal',
      message: result?.message ?? result?.reason ?? 'The model refused the task.',
    };
  }

  if (result?.status === 'provider_failure' || result?.error) {
    return {
      status: 'provider_failure',
      message: result?.message ?? result?.error?.message ?? result?.error ?? 'Provider failure.',
    };
  }

  const value = extractValue(result);
  return {
    status: result?.status ?? 'success',
    output_mode: result?.output_mode ?? expectedOutputMode ?? 'plain_value',
    value,
  };
}

function buildPromptText(request) {
  return (request.messages ?? [])
    .map((message) => `[${String(message.role ?? 'user').toUpperCase()}]\n${message.content ?? ''}`)
    .join('\n\n')
    .trim();
}

function buildExecuteOptions(request) {
  const options = {
    model: request.model,
    tags: request.taskTag ? [request.taskTag] : undefined,
    tier: request.modelTier,
    history: request.messages,
  };
  if (request.expectedOutputMode === 'structured_json') {
    options.responseShape = 'json';
  } else if (request.expectedOutputMode === 'code_block') {
    options.responseShape = 'code';
  }
  return options;
}

async function callAgent(agent, request) {
  const promptText = buildPromptText(request);
  if (typeof agent.executePrompt === 'function') {
    return agent.executePrompt(promptText, buildExecuteOptions(request));
  }
  for (const methodName of ['invoke', 'run', 'call']) {
    if (typeof agent[methodName] === 'function') {
      return agent[methodName](request);
    }
  }
  if (typeof agent.complete === 'function') {
    try {
      return await agent.complete({
        prompt: promptText,
        ...buildExecuteOptions(request),
      });
    } catch (error) {
      if (/prompt string/i.test(String(error?.message ?? ''))) {
        return agent.complete(promptText);
      }
      throw error;
    }
  }
  if (typeof agent.send === 'function') {
    return agent.send(request.messages ?? request);
  }
  throw new Error('LLMAgent does not expose a supported invocation method.');
}

export class AchillesLlmAdapter extends ManagedLlmAdapter {
  constructor(runtimeConfig) {
    super();
    this.runtimeConfig = runtimeConfig;
    this.agentClassPromise = null;
  }

  async loadAgentClass() {
    if (!this.agentClassPromise) {
      this.agentClassPromise = (async () => {
        const resolution = this.runtimeConfig?.dependencies?.achillesAgentLib;
        if (!resolution?.modulePath) {
          throw new Error('AchillesAgentLib is not available. Install it in the project root or node_modules.');
        }
        const moduleNamespace = await import(pathToFileURL(resolution.modulePath).href);
        const AgentClass = pickAgentClass(moduleNamespace);
        if (!AgentClass) {
          throw new Error(`Could not find LLMAgent export in ${resolution.modulePath}.`);
        }
        return AgentClass;
      })();
    }
    return this.agentClassPromise;
  }

  async invoke(payload) {
    const AgentClass = await this.loadAgentClass();
    const profileBinding = resolveLlmProfile(this.runtimeConfig, payload.profile);
    const request = {
      apiBaseUrl: this.runtimeConfig?.llm?.apiBaseUrl ?? null,
      profile: payload.profile,
      model: profileBinding.model,
      modelTier: profileBinding.tier,
      taskTag: profileBinding.taskTag,
      expectedOutputMode: payload.expected_output_mode ?? 'plain_value',
      promptAssets: normalizePromptAssets(payload.prompt_assets),
      contextPackage: payload.context_package ?? '',
      instruction: payload.instruction ?? '',
      inputBudget: payload.input_budget ?? {},
      outputBudget: payload.output_budget ?? {},
      traceContext: payload.trace_context ?? {},
      messages: buildMessages(payload, profileBinding),
    };
    const agent = new AgentClass({
      apiBaseUrl: request.apiBaseUrl,
      model: request.model,
      modelTier: request.modelTier,
      taskTag: request.taskTag,
      profile: request.profile,
    });
    const result = await callAgent(agent, request);
    return normalizeResult(result, request.expectedOutputMode);
  }
}

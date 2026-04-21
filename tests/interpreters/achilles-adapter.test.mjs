import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { AchillesLlmAdapter, createRuntimeConfig, resolveLlmProfile } from '../../src/index.mjs';

async function createFakeAchillesModule(methodName = 'invoke') {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mrp-vm-achilles-'));
  const moduleDir = path.join(rootDir, 'AchillesAgentLib');
  return createFakeAchillesModuleAt(rootDir, moduleDir, methodName);
}

async function createFakeAchillesModuleAt(rootDir, moduleDir, methodName = 'invoke') {
  await mkdir(moduleDir, { recursive: true });
  await writeFile(path.join(moduleDir, 'index.mjs'), [
    'export class LLMAgent {',
    '  constructor(options = {}) {',
    '    this.options = options;',
    '  }',
    methodName === 'complete'
      ? '  async complete(options) {'
      : `  async ${methodName}(request) {`,
    '    return {',
    '      status: "success",',
    methodName === 'complete'
      ? '      output_mode: "plain_value",'
      : '      output_mode: request.expectedOutputMode ?? "plain_value",',
    methodName === 'complete'
      ? '      value: `${this.options.model}::${options.prompt}`'
      : '      value: `${this.options.model}::${request.taskTag}::${request.instruction}`',
    '    };',
    '  }',
    '}',
    '',
  ].join('\n'), 'utf8');
  return {
    rootDir,
    modulePath: path.join(moduleDir, 'index.mjs'),
  };
}

async function createFakeNodeModulesAchillesModule(methodName = 'invoke') {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mrp-vm-achilles-node-modules-'));
  const moduleDir = path.join(rootDir, 'node_modules', 'achillesAgentLib');
  await mkdir(moduleDir, { recursive: true });
  await writeFile(path.join(moduleDir, 'package.json'), JSON.stringify({
    name: 'ploinky-agent-lib',
    type: 'module',
    exports: {
      '.': './index.mjs',
      './package.json': './package.json',
    },
  }, null, 2), 'utf8');
  return createFakeAchillesModuleAt(rootDir, moduleDir, methodName);
}

async function createFakeParentDirectoryAchillesModule(methodName = 'invoke') {
  const parentDir = await mkdtemp(path.join(os.tmpdir(), 'mrp-vm-achilles-parent-'));
  const rootDir = path.join(parentDir, 'workspace');
  await mkdir(rootDir, { recursive: true });
  const moduleDir = path.join(parentDir, 'AchillesAgentLib');
  return createFakeAchillesModuleAt(rootDir, moduleDir, methodName);
}

test('createRuntimeConfig builds Achilles profile routing from manual overrides', async () => {
  const fake = await createFakeAchillesModule();
  const runtimeConfig = createRuntimeConfig({
    baseDir: fake.rootDir,
    manualOverrides: {
      modelTiers: {
        fast: 'mini-model',
        standard: 'std-model',
        premium: 'max-model',
      },
      profileBindings: {
        plannerLLM: {
          tier: 'premium',
          taskTag: 'orchestration',
          model: 'planner-model',
        },
      },
    },
  });

  assert.equal(runtimeConfig.llm.adapter, 'managed');
  assert.equal(runtimeConfig.dependencies.achillesAgentLib.strategy, 'project-root');
  assert.equal(resolveLlmProfile(runtimeConfig, 'plannerLLM').model, 'planner-model');
  assert.equal(resolveLlmProfile(runtimeConfig, 'fastLLM').model, 'mini-model');
});

test('createRuntimeConfig resolves achillesAgentLib from node_modules by folder name', async () => {
  const fake = await createFakeNodeModulesAchillesModule();
  const runtimeConfig = createRuntimeConfig({
    baseDir: fake.rootDir,
  });

  assert.equal(runtimeConfig.llm.adapter, 'managed');
  assert.equal(runtimeConfig.dependencies.achillesAgentLib.strategy, 'node_modules');
  assert.match(runtimeConfig.dependencies.achillesAgentLib.modulePath, /node_modules\/achillesAgentLib\/index\.mjs$/);
});

test('createRuntimeConfig resolves AchillesAgentLib from a parent directory', async () => {
  const fake = await createFakeParentDirectoryAchillesModule();
  const runtimeConfig = createRuntimeConfig({
    baseDir: fake.rootDir,
  });

  assert.equal(runtimeConfig.llm.adapter, 'managed');
  assert.equal(runtimeConfig.dependencies.achillesAgentLib.strategy, 'ancestor-dir');
  assert.match(runtimeConfig.dependencies.achillesAgentLib.modulePath, /AchillesAgentLib\/index\.mjs$/);
});

test('AchillesLlmAdapter invokes LLMAgent through the configured profile binding', async () => {
  const fake = await createFakeAchillesModule();
  const runtimeConfig = createRuntimeConfig({
    baseDir: fake.rootDir,
    manualOverrides: {
      profileBindings: {
        writerLLM: {
          tier: 'standard',
          model: 'writer-model',
          taskTag: 'documentation',
        },
      },
    },
  });
  const adapter = new AchillesLlmAdapter(runtimeConfig);

  const result = await adapter.invoke({
    profile: 'writerLLM',
    prompt_assets: [],
    context_package: 'Context block',
    instruction: 'Write a crisp answer.',
    expected_output_mode: 'plain_value',
    trace_context: { request_id: 'req-1' },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output_mode, 'plain_value');
  assert.equal(result.value, 'writer-model::documentation::Write a crisp answer.');
});

test('AchillesLlmAdapter uses complete({ prompt, ... }) when the agent exposes complete only', async () => {
  const fake = await createFakeAchillesModule('complete');
  const runtimeConfig = createRuntimeConfig({
    baseDir: fake.rootDir,
    manualOverrides: {
      profileBindings: {
        writerLLM: {
          tier: 'standard',
          model: 'writer-model',
          taskTag: 'documentation',
        },
      },
    },
  });
  const adapter = new AchillesLlmAdapter(runtimeConfig);

  const result = await adapter.invoke({
    profile: 'writerLLM',
    prompt_assets: [],
    context_package: 'Context block',
    instruction: 'Write a crisp answer.',
    expected_output_mode: 'plain_value',
    trace_context: { request_id: 'req-2' },
  });

  assert.equal(result.status, 'success');
  assert.match(result.value, /^writer-model::\[SYSTEM\]/);
  assert.match(result.value, /Write a crisp answer\./);
});

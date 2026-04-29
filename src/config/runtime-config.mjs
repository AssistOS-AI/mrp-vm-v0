import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_TASK_TAGS = {
  bootstrap: 'project-bootstrap',
  documentation: 'documentation',
  orchestration: 'orchestration',
  specification: 'specification',
  testing: 'testing',
};

const DEFAULT_MODEL_TIERS = {
  fast: 'fast',
  standard: 'write',
  premium: 'deep',
};

const DEFAULT_PROFILE_BINDINGS = {
  fastLLM: { tier: 'fast', taskTag: DEFAULT_TASK_TAGS.testing },
  deepLLM: { tier: 'premium', taskTag: DEFAULT_TASK_TAGS.specification },
  codeGeneratorLLM: { tier: 'standard', model: 'code', taskTag: DEFAULT_TASK_TAGS.bootstrap },
  writerLLM: { tier: 'standard', taskTag: DEFAULT_TASK_TAGS.documentation },
  plannerLLM: { tier: 'premium', model: 'plan', taskTag: DEFAULT_TASK_TAGS.orchestration },
  logicGeneratorLLM: { tier: 'premium', taskTag: DEFAULT_TASK_TAGS.specification },
  formatterLLM: { tier: 'standard', taskTag: DEFAULT_TASK_TAGS.documentation },
};

function createResolver(baseDir) {
  return createRequire(path.join(baseDir, '__mrp_vm_runtime_config__.mjs'));
}

function resolvePackageEntry(packageJsonPath) {
  const packageDir = path.dirname(packageJsonPath);
  const source = readFileSync(packageJsonPath, 'utf8');
  const pkg = JSON.parse(source);
  const exportsField = pkg.exports;
  if (typeof exportsField === 'string') {
    return path.resolve(packageDir, exportsField);
  }
  if (exportsField && typeof exportsField === 'object') {
    const rootExport = exportsField['.'];
    if (typeof rootExport === 'string') {
      return path.resolve(packageDir, rootExport);
    }
    if (rootExport && typeof rootExport === 'object') {
      if (typeof rootExport.import === 'string') {
        return path.resolve(packageDir, rootExport.import);
      }
      if (typeof rootExport.default === 'string') {
        return path.resolve(packageDir, rootExport.default);
      }
      if (typeof rootExport.require === 'string') {
        return path.resolve(packageDir, rootExport.require);
      }
    }
  }
  if (pkg.module) {
    return path.resolve(packageDir, pkg.module);
  }
  if (pkg.main) {
    return path.resolve(packageDir, pkg.main);
  }
  return path.resolve(packageDir, 'index.js');
}

function normalizeResolutionPath(candidatePath) {
  if (!candidatePath) {
    return null;
  }
  if (candidatePath.endsWith('package.json')) {
    return {
      packagePath: candidatePath,
      modulePath: resolvePackageEntry(candidatePath),
    };
  }
  const statTarget = existsSync(candidatePath) ? candidatePath : null;
  if (!statTarget) {
    return null;
  }
  if (candidatePath.endsWith('.mjs') || candidatePath.endsWith('.js') || candidatePath.endsWith('.cjs')) {
    return {
      packagePath: null,
      modulePath: candidatePath,
    };
  }
  const packageJsonPath = path.join(candidatePath, 'package.json');
  if (existsSync(packageJsonPath)) {
    return {
      packagePath: packageJsonPath,
      modulePath: resolvePackageEntry(packageJsonPath),
    };
  }
  for (const candidate of ['index.mjs', 'index.js', 'index.cjs']) {
    const modulePath = path.join(candidatePath, candidate);
    if (existsSync(modulePath)) {
      return {
        packagePath: null,
        modulePath,
      };
    }
  }
  return {
    packagePath: null,
    modulePath: path.join(candidatePath, 'index.js'),
  };
}

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

function* iterateAncestorDirs(startDir) {
  let currentDir = path.resolve(startDir);
  while (true) {
    yield currentDir;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
}

function buildDirectResolutionCandidates(targetDir) {
  return [
    path.resolve(targetDir, 'AchillesAgentLib', 'package.json'),
    path.resolve(targetDir, 'AchillesAgentLib'),
    path.resolve(targetDir, 'AchillesAgentLib.mjs'),
    path.resolve(targetDir, 'AchillesAgentLib.js'),
    path.resolve(targetDir, 'achilles-agent-lib', 'package.json'),
    path.resolve(targetDir, 'achilles-agent-lib'),
    path.resolve(targetDir, 'achillesAgentLib', 'package.json'),
    path.resolve(targetDir, 'achillesAgentLib'),
  ];
}

export function resolveAchillesAgentLib(options = {}) {
  const manualOverrides = options.manualOverrides ?? {};
  const baseDir = path.resolve(options.baseDir ?? manualOverrides.baseDir ?? process.cwd());

  for (const candidateDir of iterateAncestorDirs(baseDir)) {
    for (const candidate of buildDirectResolutionCandidates(candidateDir)) {
      if (existsSync(candidate)) {
        const normalized = normalizeResolutionPath(candidate);
        if (normalized) {
          return {
            strategy: candidateDir === baseDir ? 'project-root' : 'ancestor-dir',
            path: candidate,
            ...normalized,
          };
        }
      }
    }
  }

  const resolver = createResolver(baseDir);
  const packageCandidates = ['AchillesAgentLib', 'achillesAgentLib', '@achilles/agent-lib', 'achilles-agent-lib'];
  for (const candidate of packageCandidates) {
    try {
      const packagePath = resolver.resolve(`${candidate}/package.json`);
      return {
        strategy: 'node_modules',
        path: packagePath,
        packagePath,
        modulePath: resolvePackageEntry(packagePath),
      };
    } catch {
      // Continue through the fallback list.
    }
  }

  for (const candidate of packageCandidates) {
    try {
      const modulePath = resolver.resolve(candidate);
      const normalized = normalizeResolutionPath(modulePath);
      if (normalized) {
        return {
          strategy: 'node_modules',
          path: modulePath,
          ...normalized,
        };
      }
    } catch {
      // Continue through the fallback list.
    }
  }

  return null;
}

async function importAchillesAgentLib(runtimeConfig) {
  const resolution = runtimeConfig?.dependencies?.achillesAgentLib;
  if (!resolution?.modulePath) {
    return null;
  }
  return import(pathToFileURL(resolution.modulePath).href);
}

function normalizeModelEntry(entry) {
  const id = entry?.id ?? entry?.model ?? entry?.name ?? entry?.key ?? null;
  if (!id) {
    return null;
  }
  const name = entry?.name ?? entry?.label ?? id;
  const tierValue = entry?.tier ?? entry?.modelTier ?? entry?.class ?? entry?.cost_class ?? 'standard';
  const tier = ['fast', 'standard', 'premium'].includes(String(tierValue))
    ? String(tierValue)
    : /fast|mini|lite|small/.test(String(tierValue).toLowerCase())
      ? 'fast'
      : /deep|reason|max|premium|strong/.test(String(tierValue).toLowerCase())
        ? 'premium'
        : 'standard';
  const tags = Array.isArray(entry?.tags)
    ? entry.tags
    : Array.isArray(entry?.labels)
      ? entry.labels
      : Array.isArray(entry?.capabilities)
        ? entry.capabilities
        : [];
  return {
    id: String(id),
    name: String(name),
    tier,
    tags: tags.map((tag) => String(tag)),
    providerKey: entry?.providerKey ?? entry?.provider_key ?? null,
    apiKeyEnv: entry?.apiKeyEnv ?? entry?.api_key_env ?? null,
    baseURL: entry?.baseURL ?? entry?.base_url ?? null,
  };
}

function extractModelList(result) {
  if (!result) {
    return [];
  }
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result.models)) {
    return result.models;
  }
  if (Array.isArray(result.items)) {
    return result.items;
  }
  return [];
}

function normalizeModelList(list) {
  const unique = new Map();
  for (const entry of list.map(normalizeModelEntry).filter(Boolean)) {
    if (!unique.has(entry.id)) {
      unique.set(entry.id, entry);
    }
  }
  return [...unique.values()];
}

async function resolveModelCandidate(runCandidate) {
  try {
    const result = await runCandidate();
    const list = extractModelList(result);
    if (list.length) {
      return normalizeModelList(list);
    }
  } catch {
    // Try next candidate.
  }
  return [];
}

export async function listAchillesModels(runtimeConfig) {
  const moduleNamespace = await importAchillesAgentLib(runtimeConfig);
  if (!moduleNamespace) {
    return [];
  }

  const moduleCandidates = [
    () => moduleNamespace.listModels?.(),
    () => moduleNamespace.listAvailableModels?.(),
    () => moduleNamespace.getModels?.(),
    () => moduleNamespace.default?.listModels?.(),
    () => moduleNamespace.default?.listAvailableModels?.(),
    () => moduleNamespace.default?.getModels?.(),
  ];
  for (const candidate of moduleCandidates) {
    const list = await resolveModelCandidate(candidate);
    if (list.length) {
      return list;
    }
  }

  const AgentClass = pickAgentClass(moduleNamespace);

  if (AgentClass?.listModels) {
    const list = await resolveModelCandidate(() => AgentClass.listModels());
    if (list.length) {
      return list;
    }
  }

  if (AgentClass?.listAvailableModels) {
    const list = await resolveModelCandidate(() => AgentClass.listAvailableModels());
    if (list.length) {
      return list;
    }
  }

  if (AgentClass) {
    try {
      const agent = new AgentClass({});
      const instanceCandidates = [
        () => agent.listModels?.(),
        () => agent.listAvailableModels?.(),
        () => agent.invokerStrategy?.listAvailableModels?.(),
        () => {
          const supported = agent.getSupportedModels?.() ?? agent.invokerStrategy?.getSupportedModels?.();
          return Array.isArray(supported) ? supported.map((name) => ({ id: name, name })) : [];
        },
        () => {
          const description = agent.invokerStrategy?.describe?.();
          return Array.isArray(description?.models) ? description.models : [];
        },
      ];
      for (const candidate of instanceCandidates) {
        const list = await resolveModelCandidate(candidate);
        if (list.length) {
          return list;
        }
      }
    } catch {
      // Ignore and fall through.
    }
  }

  return [];
}

function resolveTierModel(env, manualOverrides, tierName) {
  const envName = `LLM_${tierName.toUpperCase()}_MODEL`;
  return manualOverrides.modelTiers?.[tierName] ?? env[envName] ?? DEFAULT_MODEL_TIERS[tierName];
}

function buildProfileBindings(env, manualOverrides, modelTiers, taskTags) {
  const explicitBindings = manualOverrides.profileBindings ?? {};
  const bindings = {};

  for (const [profileName, defaults] of Object.entries(DEFAULT_PROFILE_BINDINGS)) {
    const override = explicitBindings[profileName] ?? {};
    const tier = override.tier ?? defaults.tier;
    bindings[profileName] = {
      tier,
      model: override.model ?? env[`LLM_${profileName.toUpperCase()}_MODEL`] ?? defaults.model ?? modelTiers[tier],
      taskTag: override.taskTag ?? defaults.taskTag ?? taskTags.orchestration,
    };
  }

  return bindings;
}

function useFakeAdapter(manualOverrides, env) {
  return manualOverrides.forceFakeLlm ?? (env.LLM_FAKE === '1');
}

function resolveLlmFallbacks(env, manualOverrides) {
  return {
    enabled: manualOverrides.llmFallbacks?.enabled ?? (env.LLM_ENABLE_PROVIDER_FALLBACK === '1'),
  };
}

export function createRuntimeConfig(options = {}) {
  const env = options.env ?? process.env;
  const manualOverrides = options.manualOverrides ?? {};
  const baseDir = path.resolve(options.baseDir ?? manualOverrides.baseDir ?? process.cwd());
  const dependencies = {
    achillesAgentLib: resolveAchillesAgentLib({
      baseDir,
      manualOverrides,
    }),
  };
  const taskTags = {
    ...DEFAULT_TASK_TAGS,
    ...(manualOverrides.taskTags ?? {}),
  };
  const modelTiers = {
    fast: resolveTierModel(env, manualOverrides, 'fast'),
    standard: resolveTierModel(env, manualOverrides, 'standard'),
    premium: resolveTierModel(env, manualOverrides, 'premium'),
  };
  const adapter = useFakeAdapter(manualOverrides, env) ? 'fake' : 'managed';
  const llmFallbacks = resolveLlmFallbacks(env, manualOverrides);

  return {
    baseDir,
    dataDir: path.resolve(baseDir, manualOverrides.dataDir ?? env.ACHILLES_DATA_DIR ?? 'data'),
    sourceDir: path.resolve(baseDir, 'src'),
    testsDir: path.resolve(baseDir, 'tests'),
    llm: {
      adapter,
      agentClass: 'LLMAgent',
      apiBaseUrl: manualOverrides.apiBaseUrl ?? env.LLM_API_BASE_URL ?? null,
      defaultModel: manualOverrides.defaultModel ?? env.LLM_DEFAULT_MODEL ?? modelTiers.standard,
      modelTiers,
      taskTags,
      profileBindings: buildProfileBindings(env, manualOverrides, modelTiers, taskTags),
      fallbacks: llmFallbacks,
    },
    dependencies,
    manualOverrides: {
      ...manualOverrides,
    },
  };
}

export function resolveLlmProfile(runtimeConfig, profileName) {
  return runtimeConfig?.llm?.profileBindings?.[profileName] ?? {
    tier: 'standard',
    model: runtimeConfig?.llm?.defaultModel ?? DEFAULT_MODEL_TIERS.standard,
    taskTag: runtimeConfig?.llm?.taskTags?.orchestration ?? DEFAULT_TASK_TAGS.orchestration,
  };
}

export { DEFAULT_MODEL_TIERS, DEFAULT_PROFILE_BINDINGS, DEFAULT_TASK_TAGS };

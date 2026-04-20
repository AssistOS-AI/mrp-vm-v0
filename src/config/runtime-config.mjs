import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

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

export function resolveAchillesAgentLib(options = {}) {
  const env = options.env ?? process.env;
  const manualOverrides = options.manualOverrides ?? {};
  const baseDir = path.resolve(options.baseDir ?? manualOverrides.baseDir ?? process.cwd());
  const manualPath = options.overridePath ?? manualOverrides.achillesAgentLibPath ?? env.ACHILLES_AGENT_LIB_PATH;
  if (manualPath) {
    const resolvedPath = path.resolve(baseDir, manualPath);
    const normalized = normalizeResolutionPath(resolvedPath);
    if (!normalized) {
      throw new Error(`Configured AchillesAgentLib path does not exist: ${resolvedPath}`);
    }
    return {
      strategy: 'manual-override',
      path: resolvedPath,
      ...normalized,
    };
  }

  const parentCandidates = [
    path.resolve(baseDir, '..', 'AchillesAgentLib', 'package.json'),
    path.resolve(baseDir, '..', 'AchillesAgentLib'),
    path.resolve(baseDir, '..', '@achilles', 'agent-lib', 'package.json'),
    path.resolve(baseDir, '..', '@achilles', 'agent-lib'),
  ];
  for (const candidate of parentCandidates) {
    if (existsSync(candidate)) {
      const normalized = normalizeResolutionPath(candidate);
      if (normalized) {
        return {
          strategy: 'parent-directory',
          path: candidate,
          ...normalized,
        };
      }
    }
  }

  const resolver = createResolver(baseDir);
  for (const candidate of ['AchillesAgentLib/package.json', '@achilles/agent-lib/package.json']) {
    try {
      const packagePath = resolver.resolve(candidate);
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

  return null;
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

export function createRuntimeConfig(options = {}) {
  const env = options.env ?? process.env;
  const manualOverrides = options.manualOverrides ?? {};
  const baseDir = path.resolve(options.baseDir ?? manualOverrides.baseDir ?? process.cwd());
  const dependencies = {
    achillesAgentLib: resolveAchillesAgentLib({
      baseDir,
      env,
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
  const provider = manualOverrides.provider
    ?? env.LLM_PROVIDER
    ?? (dependencies.achillesAgentLib ? 'achilles' : 'fake');

  return {
    baseDir,
    dataDir: path.resolve(baseDir, manualOverrides.dataDir ?? env.ACHILLES_DATA_DIR ?? 'data'),
    sourceDir: path.resolve(baseDir, 'src'),
    testsDir: path.resolve(baseDir, 'tests'),
    llm: {
      provider,
      agentClass: 'LLMAgent',
      apiBaseUrl: manualOverrides.apiBaseUrl ?? env.LLM_API_BASE_URL ?? null,
      defaultModel: manualOverrides.defaultModel ?? env.LLM_DEFAULT_MODEL ?? modelTiers.standard,
      modelTiers,
      taskTags,
      profileBindings: buildProfileBindings(env, manualOverrides, modelTiers, taskTags),
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

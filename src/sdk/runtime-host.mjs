import { createDeterministicTools, createLiveTools } from '../utils/deterministic.mjs';
import { MRPVM } from '../runtime/vm.mjs';
import { createRuntimeConfig } from '../config/runtime-config.mjs';

export class RuntimeHost {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.runtimeConfig = options.runtimeConfig ?? createRuntimeConfig({
      baseDir: rootDir,
      env: options.env,
      manualOverrides: options.manualOverrides,
    });
    this.options = {
      ...options,
      runtimeConfig: this.runtimeConfig,
    };
    this.tools = options.deterministic ? createDeterministicTools(options.deterministic) : createLiveTools();
    this.sessions = new Map();
  }

  async createSession(config = {}) {
    const sessionId = config.sessionId ?? this.tools.createId('session');
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const probe = new MRPVM(this.rootDir, this.options);
    const manifest = await probe.sessionManager.loadSession(sessionId);
    const effectiveRole = config.effectiveRole ?? manifest?.effective_role ?? (config.isAdmin ?? manifest?.is_admin ? 'admin' : 'user');
    const policyProfile = config.policyProfile ?? manifest?.policy_profile ?? 'default';
    const isAdmin = effectiveRole === 'admin';
    const sessionOrigin = config.sessionOrigin ?? manifest?.session_origin ?? 'client';
    const authMode = config.authMode ?? manifest?.auth_mode ?? (isAdmin ? 'bootstrap_admin' : 'anonymous');
    const ownerIdentity = config.ownerIdentity ?? manifest?.owner_identity ?? null;
    const authKeyId = config.authKeyId ?? manifest?.auth_key_id ?? null;

    const executor = new MRPVM(this.rootDir, {
      ...this.options,
      sessionId,
      policyProfile,
      isAdmin,
      effectiveRole,
      sessionOrigin,
      authMode,
      ownerIdentity,
      authKeyId,
    });
    await executor.initializeSession({
      sessionId,
      policyProfile,
      isAdmin,
      effectiveRole,
      sessionOrigin,
      authMode,
      ownerIdentity,
      authKeyId,
    });

    const handle = {
      session_id: sessionId,
      policy_profile: policyProfile,
      is_admin: isAdmin,
      effective_role: effectiveRole,
      session_origin: sessionOrigin,
      auth_mode: authMode,
      owner_identity: ownerIdentity,
      auth_key_id: authKeyId,
      executor,
    };
    this.sessions.set(sessionId, handle);
    return handle;
  }

  async getSession(sessionId) {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    return this.createSession({ sessionId });
  }

  async listSessions() {
    const sample = new MRPVM(this.rootDir, this.options);
    return sample.sessionManager.listSessions();
  }

  async inspectSession(handleOrId) {
    const handle = typeof handleOrId === 'string' ? await this.getSession(handleOrId) : handleOrId;
    return handle.executor.inspectSessionPublic();
  }

  async submitRequest(handleOrId, envelope) {
    const handle = typeof handleOrId === 'string' ? await this.getSession(handleOrId) : handleOrId;
    return handle.executor.startRequest({
      ...envelope,
      sessionId: handle.session_id,
      policyProfile: handle.policy_profile,
      isAdmin: handle.is_admin,
      effectiveRole: handle.effective_role,
      sessionOrigin: handle.session_origin,
      authMode: handle.auth_mode,
      ownerIdentity: handle.owner_identity,
      authKeyId: handle.auth_key_id,
    });
  }

  async closeSession(handleOrId) {
    const handle = typeof handleOrId === 'string' ? await this.getSession(handleOrId) : handleOrId;
    const result = await handle.executor.close();
    this.sessions.delete(handle.session_id);
    return result;
  }
}

export function createRuntime(rootDirOrConfig, options = {}) {
  if (typeof rootDirOrConfig === 'string' || rootDirOrConfig instanceof URL) {
    return new RuntimeHost(String(rootDirOrConfig), options);
  }
  const config = rootDirOrConfig ?? {};
  return new RuntimeHost(config.rootDir ?? config.baseDir ?? process.cwd(), config);
}

export async function createSession(runtime, sessionConfig = {}) {
  return runtime.createSession(sessionConfig);
}

export async function submitRequest(session, requestEnvelope) {
  const started = await session.executor.startRequest({
    ...requestEnvelope,
    sessionId: session.session_id,
    policyProfile: session.policy_profile,
    isAdmin: session.is_admin,
    effectiveRole: session.effective_role,
    sessionOrigin: session.session_origin,
    authMode: session.auth_mode,
    ownerIdentity: session.owner_identity,
    authKeyId: session.auth_key_id,
  });
  return started;
}

export async function inspectSession(session) {
  return session.executor.inspectSessionPublic();
}

export async function closeSession(session) {
  return session.executor.close();
}

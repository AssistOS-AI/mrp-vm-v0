import { createDeterministicTools, createLiveTools } from '../utils/deterministic.mjs';
import { MRPVM } from '../runtime/vm.mjs';

export class RuntimeHost {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.options = options;
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
     const policyProfile = config.policyProfile ?? manifest?.policy_profile ?? 'default';
     const isAdmin = config.isAdmin ?? manifest?.is_admin ?? false;

    const executor = new MRPVM(this.rootDir, {
      ...this.options,
      sessionId,
      policyProfile,
      isAdmin,
    });
    await executor.initializeSession({
      sessionId,
      policyProfile,
      isAdmin,
    });

    const handle = {
      session_id: sessionId,
      policy_profile: policyProfile,
      is_admin: isAdmin,
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
    });
  }

  async closeSession(handleOrId) {
    const handle = typeof handleOrId === 'string' ? await this.getSession(handleOrId) : handleOrId;
    const result = await handle.executor.close();
    this.sessions.delete(handle.session_id);
    return result;
  }
}

export function createRuntime(rootDir, options = {}) {
  return new RuntimeHost(rootDir, options);
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
  });
  return started;
}

export async function inspectSession(session) {
  return session.executor.inspectSessionPublic();
}

export async function closeSession(session) {
  return session.executor.close();
}

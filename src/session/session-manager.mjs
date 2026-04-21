import path from 'node:path';
import { appendJsonl, readJsonl } from '../utils/jsonl.mjs';
import { ensureDir, listDirectories, readJson, readText, removePath, writeJson, writeText } from '../storage/file-store.mjs';

export class SessionManager {
  constructor(rootDir, tools) {
    this.rootDir = rootDir;
    this.tools = tools;
  }

  getSessionPath(sessionId) {
    return path.join(this.rootDir, 'data', 'sessions', sessionId);
  }

  getRequestPath(sessionId, requestId) {
    return path.join(this.getSessionPath(sessionId), 'requests', requestId);
  }

  normalizeSessionConfig(sessionConfigOrPolicy = 'default', legacyIsAdmin = false) {
    if (sessionConfigOrPolicy && typeof sessionConfigOrPolicy === 'object' && !Array.isArray(sessionConfigOrPolicy)) {
      const effectiveRole = sessionConfigOrPolicy.effectiveRole ?? (sessionConfigOrPolicy.isAdmin ? 'admin' : 'user');
      return {
        policyProfile: sessionConfigOrPolicy.policyProfile ?? 'default',
        effectiveRole,
        isAdmin: effectiveRole === 'admin',
        sessionOrigin: sessionConfigOrPolicy.sessionOrigin ?? 'client',
        authMode: sessionConfigOrPolicy.authMode ?? (effectiveRole === 'admin' ? 'bootstrap_admin' : 'anonymous'),
        ownerIdentity: sessionConfigOrPolicy.ownerIdentity ?? null,
        authKeyId: sessionConfigOrPolicy.authKeyId ?? null,
      };
    }

    return {
      policyProfile: sessionConfigOrPolicy ?? 'default',
      effectiveRole: legacyIsAdmin ? 'admin' : 'user',
      isAdmin: Boolean(legacyIsAdmin),
      sessionOrigin: 'client',
      authMode: legacyIsAdmin ? 'bootstrap_admin' : 'anonymous',
      ownerIdentity: null,
      authKeyId: null,
    };
  }

  async createSession(sessionId, sessionConfigOrPolicy = 'default', legacyIsAdmin = false) {
    const sessionPath = this.getSessionPath(sessionId);
    const sessionConfig = this.normalizeSessionConfig(sessionConfigOrPolicy, legacyIsAdmin);
    const createdAt = this.tools.now();
    await ensureDir(path.join(sessionPath, 'trace'));
    await ensureDir(path.join(sessionPath, 'kb'));
    await ensureDir(path.join(sessionPath, 'indexes'));
    await ensureDir(path.join(sessionPath, 'history'));
    await ensureDir(path.join(sessionPath, 'analytics'));
    await ensureDir(path.join(sessionPath, 'requests'));

    const manifest = {
      session_id: sessionId,
      policy_profile: sessionConfig.policyProfile,
      is_admin: sessionConfig.isAdmin,
      session_origin: sessionConfig.sessionOrigin,
      auth_mode: sessionConfig.authMode,
      effective_role: sessionConfig.effectiveRole,
      owner_identity: sessionConfig.ownerIdentity,
      auth_key_id: sessionConfig.authKeyId,
      created_at: createdAt,
      updated_at: createdAt,
      last_activity_at: createdAt,
      active_request_id: null,
    };
    await writeJson(path.join(sessionPath, 'manifest.json'), manifest);
    return manifest;
  }

  async loadSession(sessionId) {
    return readJson(path.join(this.getSessionPath(sessionId), 'manifest.json'));
  }

  async updateSession(sessionId, patch) {
    const manifest = {
      ...(await this.loadSession(sessionId)),
      ...patch,
      updated_at: this.tools.now(),
    };
    await writeJson(path.join(this.getSessionPath(sessionId), 'manifest.json'), manifest);
    return manifest;
  }

  async createRequest(sessionId, requestId, envelope) {
    const requestPath = this.getRequestPath(sessionId, requestId);
    await ensureDir(path.join(requestPath, 'epochs'));
    await ensureDir(path.join(requestPath, 'state', 'families'));
    await writeJson(path.join(requestPath, 'envelope.json'), envelope);
    await writeText(path.join(requestPath, 'current-plan.sop'), '');
    await this.updateSession(sessionId, {
      active_request_id: requestId,
      last_activity_at: this.tools.now(),
    });
    return requestPath;
  }

  async appendRequestSummary(sessionId, summary) {
    const historyPath = path.join(this.getSessionPath(sessionId), 'history', 'request-summaries.jsonl');
    await appendJsonl(historyPath, summary);
  }

  async readRequestSummaries(sessionId) {
    const historyPath = path.join(this.getSessionPath(sessionId), 'history', 'request-summaries.jsonl');
    return readJsonl(historyPath);
  }

  async persistPlan(sessionId, requestId, planText, epochNumber = null) {
    const requestPath = this.getRequestPath(sessionId, requestId);
    await writeText(path.join(requestPath, 'current-plan.sop'), `${planText.trim()}\n`);
    if (epochNumber !== null) {
      const epochFile = path.join(requestPath, 'epochs', `epoch-${String(epochNumber).padStart(4, '0')}.sop`);
      await writeText(epochFile, `${planText.trim()}\n`);
    }
  }

  async persistOutcome(sessionId, requestId, outcome) {
    await writeJson(path.join(this.getRequestPath(sessionId, requestId), 'outcome.json'), outcome);
    await this.updateSession(sessionId, {
      active_request_id: null,
      last_activity_at: this.tools.now(),
    });
  }

  async listSessions() {
    const sessionDirs = await listDirectories(path.join(this.rootDir, 'data', 'sessions'));
    const sessions = [];
    for (const sessionDir of sessionDirs) {
      const manifest = await readJson(path.join(sessionDir, 'manifest.json'));
      if (manifest) {
        sessions.push({
          ...manifest,
          status: manifest.active_request_id ? 'active' : 'idle',
        });
      }
    }
    return sessions.sort((left, right) => left.session_id.localeCompare(right.session_id));
  }

  async listRequestIds(sessionId) {
    const requestDirs = await listDirectories(path.join(this.getSessionPath(sessionId), 'requests'));
    return requestDirs.map((dirPath) => path.basename(dirPath)).sort();
  }

  async loadRequestEnvelope(sessionId, requestId) {
    return readJson(path.join(this.getRequestPath(sessionId, requestId), 'envelope.json'));
  }

  async loadRequestOutcome(sessionId, requestId) {
    return readJson(path.join(this.getRequestPath(sessionId, requestId), 'outcome.json'));
  }

  async loadCurrentPlan(sessionId, requestId) {
    return readText(path.join(this.getRequestPath(sessionId, requestId), 'current-plan.sop'), '');
  }

  async deleteSession(sessionId) {
    await removePath(this.getSessionPath(sessionId));
  }
}

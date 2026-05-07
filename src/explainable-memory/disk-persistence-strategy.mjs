import path from 'node:path';
import { ensureDir, readJson, writeJson } from '../storage/file-store.mjs';

function defaultStatus(sessionId = null) {
  return {
    target_scope: sessionId ? 'session' : 'global',
    session_id: sessionId,
    status: 'missing',
    last_started_at: null,
    last_completed_at: null,
    snapshot_version: null,
    error_message: null,
  };
}

export class DiskExplainableMemoryPersistenceStrategy {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  getBaseDir(sessionId = null) {
    return sessionId
      ? path.join(this.rootDir, 'data', 'sessions', sessionId, 'indexes', 'explainable-memory')
      : path.join(this.rootDir, 'data', 'kb', 'indexes', 'explainable-memory');
  }

  getStatePath(sessionId = null) {
    return path.join(this.getBaseDir(sessionId), sessionId ? 'state.json' : 'global-state.json');
  }

  getLexicalIndexPath(sessionId = null) {
    return path.join(this.getBaseDir(sessionId), sessionId ? 'lexical-index.json' : 'global-lexical-index.json');
  }

  getStatusPath(sessionId = null) {
    return path.join(this.getBaseDir(sessionId), 'status.json');
  }

  async loadSnapshot(sessionId = null) {
    const snapshot = await readJson(this.getStatePath(sessionId), null);
    if (!snapshot) {
      return null;
    }
    const lexicalIndexJson = await readJson(this.getLexicalIndexPath(sessionId), null);
    return {
      ...snapshot,
      lexicalIndexJson,
    };
  }

  async saveSnapshot(sessionId = null, snapshot) {
    const { lexicalIndexJson, ...serializable } = snapshot;
    await ensureDir(this.getBaseDir(sessionId));
    await writeJson(this.getStatePath(sessionId), serializable);
    if (lexicalIndexJson) {
      await writeJson(this.getLexicalIndexPath(sessionId), lexicalIndexJson);
    }
    await this.markReady(sessionId, snapshot);
  }

  async loadStatus(sessionId = null) {
    return readJson(this.getStatusPath(sessionId), defaultStatus(sessionId));
  }

  async markStarted(sessionId = null, context = {}) {
    const current = await this.loadStatus(sessionId);
    const next = {
      ...current,
      ...context,
      target_scope: sessionId ? 'session' : 'global',
      session_id: sessionId,
      status: 'running',
      last_started_at: context.last_started_at ?? new Date().toISOString(),
      error_message: null,
    };
    await ensureDir(this.getBaseDir(sessionId));
    await writeJson(this.getStatusPath(sessionId), next);
    return next;
  }

  async markReady(sessionId = null, snapshot) {
    const next = {
      target_scope: sessionId ? 'session' : 'global',
      session_id: sessionId,
      status: 'ready',
      last_started_at: snapshot.startedAt ?? snapshot.builtAt,
      last_completed_at: snapshot.builtAt,
      snapshot_version: snapshot.version,
      error_message: null,
      indexed_ku_count: snapshot.counts?.indexed_ku_count ?? 0,
      approved_aspect_count: snapshot.counts?.approved_aspect_count ?? 0,
      candidate_aspect_count: snapshot.counts?.candidate_aspect_count ?? 0,
      proposed_aspect_count: snapshot.counts?.proposed_aspect_count ?? 0,
    };
    await ensureDir(this.getBaseDir(sessionId));
    await writeJson(this.getStatusPath(sessionId), next);
    return next;
  }

  async markFailed(sessionId = null, error, context = {}) {
    const current = await this.loadStatus(sessionId);
    const next = {
      ...current,
      ...context,
      target_scope: sessionId ? 'session' : 'global',
      session_id: sessionId,
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    };
    await ensureDir(this.getBaseDir(sessionId));
    await writeJson(this.getStatusPath(sessionId), next);
    return next;
  }
}

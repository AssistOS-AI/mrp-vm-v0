import path from 'node:path';
import { appendJsonl, readJsonl } from '../utils/jsonl.mjs';
import { createDigest } from '../utils/ids.mjs';

export class AnalyticStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.values = new Map();
  }

  getCheckpointPath(sessionId) {
    return path.join(this.rootDir, 'data', 'sessions', sessionId, 'analytics', 'checkpoints.jsonl');
  }

  getValue(key) {
    return this.values.get(key);
  }

  listEntries() {
    return [...this.values.entries()].map(([key, value]) => ({ key, value }));
  }

  setValue(key, value) {
    this.values.set(key, value);
  }

  deleteValue(key) {
    this.values.delete(key);
  }

  async checkpoint(sessionId, payload) {
    const snapshot = this.listEntries();
    const checkpoint = {
      ...payload,
      hash: createDigest(JSON.stringify(snapshot)),
      snapshot,
    };
    await appendJsonl(this.getCheckpointPath(sessionId), checkpoint);
    return checkpoint;
  }

  async load(sessionId) {
    const checkpoints = await readJsonl(this.getCheckpointPath(sessionId));
    if (checkpoints.length === 0) {
      this.values.clear();
      return [];
    }

    const latest = checkpoints[checkpoints.length - 1];
    this.values = new Map((latest.snapshot ?? []).map((entry) => [entry.key, entry.value]));
    return checkpoints;
  }
}

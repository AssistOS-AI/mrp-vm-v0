import path from 'node:path';
import { appendJsonl, readJsonl } from '../utils/jsonl.mjs';

export class TraceStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  getTracePath(sessionId) {
    return path.join(this.rootDir, 'data', 'sessions', sessionId, 'trace', 'session.jsonl');
  }

  async append(sessionId, event) {
    await appendJsonl(this.getTracePath(sessionId), event);
  }

  async readAll(sessionId) {
    return readJsonl(this.getTracePath(sessionId));
  }
}

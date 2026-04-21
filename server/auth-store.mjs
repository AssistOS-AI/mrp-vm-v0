import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

function now() {
  return new Date().toISOString();
}

function createTokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function readJson(filePath, fallback) {
  try {
    const source = await readFile(filePath, 'utf8');
    return JSON.parse(source);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export class AuthStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  getStatePath() {
    return path.join(this.rootDir, 'data', 'server', 'auth', 'state.json');
  }

  getKeysPath() {
    return path.join(this.rootDir, 'data', 'server', 'auth', 'api-keys.json');
  }

  async readState() {
    return readJson(this.getStatePath(), {
      bootstrap_admin_session_id: null,
      bootstrap_admin_claimed_at: null,
    });
  }

  async writeState(state) {
    await writeJson(this.getStatePath(), state);
  }

  async listKeys() {
    const keys = await readJson(this.getKeysPath(), []);
    return Array.isArray(keys) ? keys : [];
  }

  async writeKeys(keys) {
    await writeJson(this.getKeysPath(), keys);
  }

  async hasKeys() {
    const keys = await this.listKeys();
    return keys.some((entry) => entry.status !== 'revoked');
  }

  async getBootstrapStatus() {
    const [state, hasKeys] = await Promise.all([
      this.readState(),
      this.hasKeys(),
    ]);
    return {
      has_api_keys: hasKeys,
      bootstrap_admin_claimed: Boolean(state.bootstrap_admin_session_id),
      bootstrap_admin_session_id: state.bootstrap_admin_session_id,
      bootstrap_admin_available: !hasKeys && !state.bootstrap_admin_session_id,
    };
  }

  async claimBootstrapAdmin(sessionId) {
    const status = await this.getBootstrapStatus();
    if (!status.bootstrap_admin_available) {
      return false;
    }
    await this.writeState({
      bootstrap_admin_session_id: sessionId,
      bootstrap_admin_claimed_at: now(),
    });
    return true;
  }

  async createApiKey(input = {}) {
    const id = `key_${crypto.randomBytes(6).toString('hex')}`;
    const secret = crypto.randomBytes(18).toString('hex');
    const token = `${id}.${secret}`;
    const keys = await this.listKeys();
    const record = {
      id,
      label: input.label ?? id,
      role: input.role === 'admin' ? 'admin' : 'user',
      status: 'active',
      token_prefix: token.slice(0, 16),
      token_hash: createTokenHash(token),
      created_at: now(),
      created_by: input.createdBy ?? null,
      last_used_at: null,
    };
    keys.push(record);
    await this.writeKeys(keys);
    return {
      token,
      record: {
        ...record,
      },
    };
  }

  async createBootstrapAdminKey(input = {}) {
    const status = await this.getBootstrapStatus();
    if (status.has_api_keys) {
      throw new Error('bootstrap_complete');
    }
    if (!status.bootstrap_admin_claimed) {
      await this.writeState({
        bootstrap_admin_session_id: input.sessionId ?? 'bootstrap-api-key',
        bootstrap_admin_claimed_at: now(),
      });
    }
    return this.createApiKey({
      label: input.label ?? 'Bootstrap admin',
      role: 'admin',
      createdBy: input.createdBy ?? 'bootstrap',
    });
  }

  async revokeApiKey(keyId) {
    const keys = await this.listKeys();
    const nextKeys = keys.map((entry) => {
      if (entry.id !== keyId) {
        return entry;
      }
      return {
        ...entry,
        status: 'revoked',
        revoked_at: now(),
      };
    });
    await this.writeKeys(nextKeys);
    return nextKeys.find((entry) => entry.id === keyId) ?? null;
  }

  async authenticate(rawToken) {
    if (!rawToken) {
      return null;
    }
    const token = String(rawToken).trim();
    if (!token) {
      return null;
    }
    const tokenHash = createTokenHash(token);
    const keys = await this.listKeys();
    const record = keys.find((entry) => entry.status !== 'revoked' && entry.token_hash === tokenHash) ?? null;
    if (!record) {
      return null;
    }
    record.last_used_at = now();
    await this.writeKeys(keys);
    return {
      id: record.id,
      label: record.label,
      role: record.role,
      token_prefix: record.token_prefix,
      last_used_at: record.last_used_at,
    };
  }
}

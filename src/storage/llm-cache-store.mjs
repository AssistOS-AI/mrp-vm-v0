import path from 'node:path';
import { ensureDir, readJson, writeJson } from './file-store.mjs';

function defaultState() {
  return {
    version: 1,
    entries: [],
  };
}

function sortEntries(entries = []) {
  return [...entries].sort((left, right) => {
    const rightTime = Date.parse(right.updated_at ?? right.created_at ?? 0);
    const leftTime = Date.parse(left.updated_at ?? left.created_at ?? 0);
    if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return String(right.entry_id ?? '').localeCompare(String(left.entry_id ?? ''));
  });
}

function dedupeSourceRequests(items = []) {
  const unique = new Map();
  for (const item of items) {
    const key = `${item.session_id ?? ''}::${item.request_id ?? ''}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }
  return [...unique.values()];
}

export class LlmCacheStore {
  constructor(runtimeConfig = {}, tools = {}) {
    this.runtimeConfig = runtimeConfig;
    this.tools = tools;
    this.enabled = runtimeConfig?.llm?.cache?.enabled !== false;
    const fallbackDir = path.join(runtimeConfig?.dataDir ?? path.join(runtimeConfig?.baseDir ?? process.cwd(), 'data'), 'cache', 'llm');
    this.directory = path.resolve(runtimeConfig?.llm?.cache?.directory ?? fallbackDir);
  }

  now() {
    return typeof this.tools?.now === 'function'
      ? this.tools.now()
      : new Date().toISOString();
  }

  getIndexPath() {
    return path.join(this.directory, 'index.json');
  }

  async loadState() {
    if (!this.enabled) {
      return defaultState();
    }
    const state = await readJson(this.getIndexPath(), defaultState());
    if (!Array.isArray(state?.entries)) {
      return defaultState();
    }
    return {
      version: state.version ?? 1,
      entries: state.entries,
    };
  }

  async saveState(state) {
    if (!this.enabled) {
      return;
    }
    await ensureDir(this.directory);
    await writeJson(this.getIndexPath(), {
      version: 1,
      entries: sortEntries(state.entries ?? []),
    });
  }

  async listEntries() {
    const state = await this.loadState();
    return sortEntries(state.entries);
  }

  async getEntry(entryId) {
    const entries = await this.listEntries();
    return entries.find((entry) => entry.entry_id === entryId) ?? null;
  }

  async resolveByLookupKey(lookupKey) {
    if (!this.enabled) {
      return null;
    }
    const entries = await this.listEntries();
    return entries.find((entry) => entry.lookup_key === lookupKey) ?? null;
  }

  async noteHit(entryId) {
    if (!this.enabled) {
      return null;
    }
    const state = await this.loadState();
    const index = state.entries.findIndex((entry) => entry.entry_id === entryId);
    if (index < 0) {
      return null;
    }
    const updated = {
      ...state.entries[index],
      hit_count: Number(state.entries[index].hit_count ?? 0) + 1,
      last_hit_at: this.now(),
      updated_at: this.now(),
    };
    state.entries[index] = updated;
    await this.saveState(state);
    return updated;
  }

  async upsertFromCandidate(candidate) {
    if (!this.enabled || candidate?.response?.status !== 'success' || !candidate.lookup_key) {
      return null;
    }
    const state = await this.loadState();
    const now = this.now();
    const existing = state.entries.find((entry) => entry.lookup_key === candidate.lookup_key) ?? null;
    const entry = {
      entry_id: existing?.entry_id ?? candidate.lookup_key,
      lookup_key: candidate.lookup_key,
      profile: candidate.profile,
      model_class: candidate.model_class,
      expected_output_mode: candidate.expected_output_mode,
      instruction: candidate.instruction,
      context_package: candidate.context_package,
      prompt_assets: candidate.prompt_assets ?? [],
      response: candidate.response,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_promoted_at: now,
      last_hit_at: existing?.last_hit_at ?? null,
      hit_count: Number(existing?.hit_count ?? 0),
      source_requests: dedupeSourceRequests([
        ...(existing?.source_requests ?? []),
        {
          session_id: candidate.session_id ?? null,
          request_id: candidate.request_id ?? null,
          promoted_at: now,
          origin: candidate.origin ?? null,
          model: candidate.binding?.model ?? null,
          model_tier: candidate.binding?.model_tier ?? null,
          task_tag: candidate.binding?.task_tag ?? null,
        },
      ]),
    };
    state.entries = state.entries.filter((item) => item.lookup_key !== candidate.lookup_key);
    state.entries.push(entry);
    await this.saveState(state);
    return entry;
  }

  async deleteEntry(entryId) {
    if (!this.enabled) {
      return null;
    }
    const state = await this.loadState();
    const deleted = state.entries.find((entry) => entry.entry_id === entryId) ?? null;
    if (!deleted) {
      return null;
    }
    state.entries = state.entries.filter((entry) => entry.entry_id !== entryId);
    await this.saveState(state);
    return deleted;
  }

  async getSummary() {
    const entries = await this.listEntries();
    const lastHitAt = entries
      .map((entry) => entry.last_hit_at)
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
    const promotedRequests = new Set(
      entries.flatMap((entry) => (entry.source_requests ?? []).map((request) => `${request.session_id ?? ''}::${request.request_id ?? ''}`)),
    );
    return {
      enabled: this.enabled,
      total_entry_count: entries.length,
      total_hits: entries.reduce((sum, entry) => sum + Number(entry.hit_count ?? 0), 0),
      profile_count: new Set(entries.map((entry) => entry.profile).filter(Boolean)).size,
      promoted_request_count: promotedRequests.size,
      last_updated_at: entries[0]?.updated_at ?? null,
      last_hit_at: lastHitAt,
    };
  }
}

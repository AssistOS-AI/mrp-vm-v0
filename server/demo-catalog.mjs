import path from 'node:path';
import { readFile } from 'node:fs/promises';

export async function loadDemoTasks(rootDir = process.cwd()) {
  const candidates = [
    path.join(rootDir, 'data', 'demo', 'chat-demos.json'),
    new URL('../data/demo/chat-demos.json', import.meta.url),
  ];
  let raw = null;
  for (const candidate of candidates) {
    try {
      raw = await readFile(candidate, 'utf8');
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  if (raw == null) {
    throw new Error('Demo catalog could not be resolved from runtime root or repository data/demo.');
  }
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload)) {
    throw new Error('Demo catalog must be a JSON array.');
  }
  return [...payload]
    .map((entry) => ({
      order: Number(entry.order ?? 0),
      id: String(entry.id ?? '').trim(),
      title: String(entry.title ?? '').trim(),
      prompt: String(entry.prompt ?? ''),
    }))
    .filter((entry) => entry.id && entry.title && entry.prompt)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.id.localeCompare(right.id);
    });
}

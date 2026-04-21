import path from 'node:path';
import { readFile } from 'node:fs/promises';

export async function loadDemoTasks(rootDir = process.cwd()) {
  const filePath = path.join(rootDir, 'data', 'demo', 'chat-demos.json');
  const payload = JSON.parse(await readFile(filePath, 'utf8'));
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

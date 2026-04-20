import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function appendJsonl(filePath, record) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const line = `${JSON.stringify(record)}\n`;
  let existing = '';

  try {
    existing = await readFile(filePath, 'utf8');
  } catch {
    existing = '';
  }

  await writeFile(filePath, `${existing}${line}`, 'utf8');
}

export async function readJsonl(filePath) {
  let content = '';

  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

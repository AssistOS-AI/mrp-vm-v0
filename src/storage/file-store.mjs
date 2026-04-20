import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, String(value), 'utf8');
}

export async function readText(filePath, fallback = null) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(filePath, fallback = null) {
  const text = await readText(filePath);
  if (text === null) {
    return fallback;
  }
  return JSON.parse(text);
}

export async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function removePath(targetPath) {
  if (await pathExists(targetPath)) {
    await rm(targetPath, { recursive: true, force: true });
  }
}

export async function listDirectories(rootPath) {
  let children = [];
  try {
    children = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  return children
    .filter((child) => child.isDirectory())
    .map((child) => path.join(rootPath, child.name))
    .sort();
}

export async function listFilesRecursive(rootPath, extension = null) {
  const entries = [];

  async function walk(currentPath) {
    let children = [];
    try {
      children = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const child of children) {
      const fullPath = path.join(currentPath, child.name);
      if (child.isDirectory()) {
        await walk(fullPath);
      } else if (!extension || child.name.endsWith(extension)) {
        entries.push(fullPath);
      }
    }
  }

  await walk(rootPath);
  return entries.sort();
}

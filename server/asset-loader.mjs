import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('.', import.meta.url));
const templateRoot = path.join(serverRoot, 'templates');
const publicRoot = path.join(serverRoot, 'public');

const templateCache = new Map();
const assetCache = new Map();

function getMimeType(filePath) {
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  return 'text/plain; charset=utf-8';
}

export async function loadTemplate(name) {
  if (!templateCache.has(name)) {
    const filePath = path.join(templateRoot, name);
    templateCache.set(name, readFile(filePath, 'utf8'));
  }
  return templateCache.get(name);
}

export async function loadPublicAsset(relativePath) {
  const sanitizedPath = relativePath.replace(/^\/+/, '');
  if (sanitizedPath.includes('..')) {
    return null;
  }
  if (!assetCache.has(sanitizedPath)) {
    const filePath = path.join(publicRoot, sanitizedPath);
    assetCache.set(sanitizedPath, readFile(filePath, 'utf8')
      .then((body) => ({
        body,
        contentType: getMimeType(filePath),
      }))
      .catch(() => null));
  }
  return assetCache.get(sanitizedPath);
}

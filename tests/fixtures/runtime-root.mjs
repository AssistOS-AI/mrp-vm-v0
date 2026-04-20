import os from 'node:os';
import path from 'node:path';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function createTempRuntimeRoot() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mrp-vm-v0-'));
  const fixtureRoot = fileURLToPath(new URL('../../', import.meta.url));
  await mkdir(path.join(tempRoot, 'data'), { recursive: true });
  await cp(path.join(fixtureRoot, 'data', 'default'), path.join(tempRoot, 'data', 'default'), {
    recursive: true,
  });
  await mkdir(path.join(tempRoot, 'data', 'kb', 'global'), { recursive: true });
  return tempRoot;
}

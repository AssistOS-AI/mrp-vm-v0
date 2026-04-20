import path from 'node:path';
import { ensureDir, listDirectories, readJson, readText, writeJson, writeText } from '../storage/file-store.mjs';

export class RequestManager {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  getFamilyPath(sessionId, requestId, familyId) {
    return path.join(this.rootDir, 'data', 'sessions', sessionId, 'requests', requestId, 'state', 'families', familyId);
  }

  async persistFamily(sessionId, requestId, family) {
    const familyPath = this.getFamilyPath(sessionId, requestId, family.familyId);
    await ensureDir(familyPath);
    await writeJson(path.join(familyPath, 'family.meta.json'), family.familyMeta);
    for (const variant of family.variants) {
      await writeText(path.join(familyPath, `v${String(variant.version).padStart(4, '0')}.value.txt`), `${variant.rendered}\n`);
      await writeJson(path.join(familyPath, `v${String(variant.version).padStart(4, '0')}.meta.json`), variant.meta);
    }
  }

  async loadFamilyState(sessionId, requestId) {
    const familiesRoot = path.join(this.rootDir, 'data', 'sessions', sessionId, 'requests', requestId, 'state', 'families');
    const familyDirs = await listDirectories(familiesRoot);
    const families = [];

    for (const familyDir of familyDirs) {
      const familyId = path.basename(familyDir);
      const familyMeta = await readJson(path.join(familyDir, 'family.meta.json'), { status: 'unknown' });
      const variants = [];
      const entries = await listDirectories(familyDir);
      void entries;
      let version = 1;

      while (true) {
        const versionName = `v${String(version).padStart(4, '0')}`;
        const value = await readText(path.join(familyDir, `${versionName}.value.txt`), null);
        if (value === null) {
          break;
        }
        const meta = await readJson(path.join(familyDir, `${versionName}.meta.json`), {});
        variants.push({
          id: `${familyId}:v${version}`,
          version,
          rendered: value.trimEnd(),
          meta,
        });
        version += 1;
      }

      families.push({
        familyId,
        familyMeta,
        variants,
      });
    }

    return families;
  }
}

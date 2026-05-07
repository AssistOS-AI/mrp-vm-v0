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
      const version = Number(variant.version ?? String(variant.id ?? '').split(':v')[1] ?? 0);
      const versionName = `v${String(version).padStart(4, '0')}`;
      await writeText(path.join(familyPath, `${versionName}.value.txt`), `${variant.rendered}\n`);
      await writeJson(path.join(familyPath, `${versionName}.meta.json`), variant.meta);
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
        const rendered = value.trimEnd();
        variants.push({
          id: `${familyId}:v${version}`,
          version,
          value: rendered,
          rendered,
          meta,
        });
        version += 1;
      }

      if (variants.length === 0) {
        const legacyValue = await readText(path.join(familyDir, 'vundefined.value.txt'), null);
        if (legacyValue !== null) {
          const legacyMeta = await readJson(path.join(familyDir, 'vundefined.meta.json'), {});
          const rendered = legacyValue.trimEnd();
          variants.push({
            id: `${familyId}:v1`,
            version: 1,
            value: rendered,
            rendered,
            meta: legacyMeta,
          });
        }
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

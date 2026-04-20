import crypto from 'node:crypto';

export function createKuId() {
  return `ku_${crypto.randomBytes(8).toString('hex')}`;
}

export function createDigest(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

export function createVariantId(familyId, version) {
  return `${familyId}:v${version}`;
}

export function parseVariantId(value) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*):v([1-9][0-9]*)$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    familyId: match[1],
    version: Number(match[2]),
  };
}

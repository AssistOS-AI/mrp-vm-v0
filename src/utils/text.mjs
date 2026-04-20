import { createDigest } from './ids.mjs';

export function stableStringify(value) {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = sortKeys(value[key]);
  }
  return output;
}

export function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function tokenize(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function canonicalText(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined) {
    return '';
  }

  return stableStringify(value);
}

export function toSummaryText(value, maxLength = 160) {
  const text = normalizeWhitespace(canonicalText(value));
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

export function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

export function hashText(value) {
  return createDigest(String(value));
}

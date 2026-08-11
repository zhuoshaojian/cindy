'use strict';

function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1;
  return value.slice(0, end);
}

function normalizeManifestBaseUrl(raw, { fieldName, source, appendedPath = '/endpoint.json' }) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`${source} 缺少非空字段 ${fieldName}`);
  }
  const normalized = trimTrailingSlashes(raw.trim());
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${source} 字段 ${fieldName} 不是合法绝对 URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${source} 字段 ${fieldName} 必须是无凭据 HTTPS URL`);
  }
  if (normalized.includes('?') || normalized.includes('#')) {
    throw new Error(`${source} 字段 ${fieldName} 不允许 query/hash：运行时会在 base 后按路径拼接 ${appendedPath}`);
  }
  return normalized;
}

module.exports = { normalizeManifestBaseUrl };

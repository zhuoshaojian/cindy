import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import manifestBaseUrl from './shared/manifest-base-url.cjs';
import { verifyDirDistManifest, writeDirDistManifest } from '../tools/shared/dir-dist-manifest.mjs';
import { extractArchive, flattenExtractedDir } from '../tools/pi/update.mjs';

const { normalizeManifestBaseUrl } = manifestBaseUrl;
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const AGENT_BINARY_MIRROR_ENV = 'XDT_AGENT_BINARY_MIRROR_BASE_URL';
const MIRRORED_KINDS = new Set(['claude', 'codex', 'ripgrep', 'pi']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function supportsAgentBinaryMirror(kind) {
  return MIRRORED_KINDS.has(kind);
}

export function resolveAgentBinaryMirrorBaseUrl(env = process.env) {
  const raw = env[AGENT_BINARY_MIRROR_ENV];
  // Docker's optional build ARG defaults to an empty string. Empty therefore
  // has the same compatibility semantics as an omitted opt-in.
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
  return normalizeManifestBaseUrl(raw, {
    fieldName: AGENT_BINARY_MIRROR_ENV,
    source: 'agent binary mirror',
    appendedPath: '固定镜像资源路径',
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertRelativeAssetPath(relativePath, source) {
  if (typeof relativePath !== 'string' || relativePath.startsWith('/')) {
    throw new Error(`${source} relativePath must be a relative path`);
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${source} relativePath contains an invalid path segment`);
  }
  return segments.join('/');
}

export function loadAgentBinaryMirrorAsset({
  kind,
  platformKey,
  expectedVersion,
  rootDir = ROOT,
}) {
  if (!supportsAgentBinaryMirror(kind)) {
    throw new Error(`agent binary mirror does not support kind: ${kind}`);
  }
  const source = `tools/agent-binary-mirror/${platformKey}.json`;
  const filePath = path.join(rootDir, source);
  let pin;
  try {
    pin = readJson(filePath);
  } catch (error) {
    throw new Error(`agent binary mirror has no trusted pin for ${platformKey}: ${error.message}`);
  }
  if (pin?.schemaVersion !== 1 || pin?.platform !== platformKey) {
    throw new Error(`${source} must use schemaVersion=1 and platform=${platformKey}`);
  }
  const asset = pin.assets?.[kind];
  if (!asset || typeof asset !== 'object') {
    throw new Error(`${source} has no trusted ${kind} asset`);
  }
  if (asset.version !== expectedVersion) {
    throw new Error(
      `${source} ${kind} version ${asset.version ?? '(missing)'} does not match pinned version ${expectedVersion}`,
    );
  }
  const common = {
    format: asset.format,
    version: asset.version,
    relativePath: assertRelativeAssetPath(asset.relativePath, `${source} ${kind}`),
  };
  if (asset.format === 'raw-gzip') {
    const binarySha256 = String(asset.binarySha256 ?? '').toLowerCase();
    if (!SHA256_PATTERN.test(binarySha256)) {
      throw new Error(`${source} ${kind}.binarySha256 must be a lowercase SHA-256 digest`);
    }
    if (!Number.isSafeInteger(asset.binarySize) || asset.binarySize < 1024) {
      throw new Error(`${source} ${kind}.binarySize must be an integer >= 1024`);
    }
    return { ...common, binarySha256, binarySize: asset.binarySize };
  }
  if (asset.format === 'directory-tar-gzip') {
    const archiveSha256 = String(asset.archiveSha256 ?? '').toLowerCase();
    if (!SHA256_PATTERN.test(archiveSha256)) {
      throw new Error(`${source} ${kind}.archiveSha256 must be a lowercase SHA-256 digest`);
    }
    if (!Number.isSafeInteger(asset.archiveSize) || asset.archiveSize < 1024) {
      throw new Error(`${source} ${kind}.archiveSize must be an integer >= 1024`);
    }
    if (typeof asset.binaryName !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(asset.binaryName)) {
      throw new Error(`${source} ${kind}.binaryName is invalid`);
    }
    return {
      ...common,
      archiveSha256,
      archiveSize: asset.archiveSize,
      binaryName: asset.binaryName,
    };
  }
  throw new Error(`${source} ${kind}.format is unsupported`);
}

export function resolveAgentBinaryMirrorAssetUrl(baseUrl, asset) {
  const normalizedBase = normalizeManifestBaseUrl(baseUrl, {
    fieldName: AGENT_BINARY_MIRROR_ENV,
    source: 'agent binary mirror',
    appendedPath: '固定镜像资源路径',
  });
  return `${normalizedBase}/${asset.relativePath}`;
}

export function agentBinaryMirrorTemporaryAssetName(format) {
  return format === 'directory-tar-gzip' ? 'asset.tar.gz' : 'asset.gz';
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function byteLimit(maxBytes, label) {
  let seen = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        callback(new Error(`${label} exceeded pinned size ${maxBytes}`));
        return;
      }
      callback(null, chunk);
    },
  });
}

export async function isInstalledAgentBinaryMirrorAsset({
  kind,
  version,
  platformKey,
  targetPath,
  rootDir = ROOT,
}) {
  const asset = loadAgentBinaryMirrorAsset({
    kind,
    platformKey,
    expectedVersion: version,
    rootDir,
  });
  if (asset.format === 'directory-tar-gzip') {
    const targetDir = path.dirname(targetPath);
    try {
      return verifyDirDistManifest(targetDir)
        && fs.readFileSync(path.join(targetDir, '.mirror-archive-sha256'), 'utf8').trim()
          === asset.archiveSha256;
    } catch {
      return false;
    }
  }
  try {
    if (fs.statSync(targetPath).size !== asset.binarySize) return false;
  } catch {
    return false;
  }
  return await sha256File(targetPath) === asset.binarySha256;
}

export async function installAgentBinaryFromMirror({
  baseUrl,
  kind,
  version,
  platformKey,
  targetPath,
  rootDir = ROOT,
  fetchImpl = fetch,
}) {
  const asset = loadAgentBinaryMirrorAsset({
    kind,
    platformKey,
    expectedVersion: version,
    rootDir,
  });
  const url = resolveAgentBinaryMirrorAssetUrl(baseUrl, asset);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cindy-agent-mirror-${kind}-`));
  const archivePath = path.join(tempRoot, agentBinaryMirrorTemporaryAssetName(asset.format));
  const binaryPath = path.join(tempRoot, 'binary');

  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) {
      throw new Error(`agent binary mirror download failed for ${kind} (${response.status})`);
    }
    if (asset.format === 'directory-tar-gzip') {
      await pipeline(
        Readable.fromWeb(response.body),
        byteLimit(asset.archiveSize, `${kind} mirror archive`),
        fs.createWriteStream(archivePath),
      );
      const actualSize = fs.statSync(archivePath).size;
      if (actualSize !== asset.archiveSize) {
        throw new Error(
          `${kind} mirror archive size mismatch: expected ${asset.archiveSize}, got ${actualSize}`,
        );
      }
      const actualHash = await sha256File(archivePath);
      if (actualHash !== asset.archiveSha256) {
        throw new Error(
          `${kind} mirror archive sha256 mismatch: expected ${asset.archiveSha256}, got ${actualHash}`,
        );
      }

      const extractRoot = path.join(tempRoot, 'extract');
      fs.mkdirSync(extractRoot);
      await extractArchive(archivePath, extractRoot);
      const extractedBinary = flattenExtractedDir(extractRoot, asset.binaryName);
      if (!asset.binaryName.endsWith('.exe')) fs.chmodSync(extractedBinary, 0o755);
      fs.writeFileSync(path.join(extractRoot, '.mirror-archive-sha256'), `${actualHash}\n`);
      writeDirDistManifest(extractRoot);
      if (!verifyDirDistManifest(extractRoot)) {
        throw new Error(`${kind} mirror directory distribution failed manifest verification`);
      }

      const targetDir = path.dirname(targetPath);
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.cpSync(extractRoot, targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, '.version'), `${version}\n`);
      return { url, archiveSha256: actualHash, archiveSize: actualSize };
    }

    await pipeline(
      Readable.fromWeb(response.body),
      createGunzip(),
      byteLimit(asset.binarySize, `${kind} mirror binary`),
      fs.createWriteStream(binaryPath),
    );

    const actualSize = fs.statSync(binaryPath).size;
    if (actualSize !== asset.binarySize) {
      throw new Error(
        `${kind} mirror binary size mismatch: expected ${asset.binarySize}, got ${actualSize}`,
      );
    }
    const actualHash = await sha256File(binaryPath);
    if (actualHash !== asset.binarySha256) {
      throw new Error(
        `${kind} mirror binary sha256 mismatch: expected ${asset.binarySha256}, got ${actualHash}`,
      );
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const stagedPath = `${targetPath}.mirror-tmp`;
    try {
      fs.copyFileSync(binaryPath, stagedPath);
      if (!targetPath.endsWith('.exe')) fs.chmodSync(stagedPath, 0o755);
      fs.renameSync(stagedPath, targetPath);
    } finally {
      fs.rmSync(stagedPath, { force: true });
    }
    fs.writeFileSync(path.join(path.dirname(targetPath), '.version'), `${version}\n`);
    return { url, binarySha256: actualHash, binarySize: actualSize };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

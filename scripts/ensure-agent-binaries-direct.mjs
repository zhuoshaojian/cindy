#!/usr/bin/env node
/**
 * Bootstrap pinned Linux runtime binaries without GitHub's release-metadata API.
 *
 * The normal agent updater intentionally uses the GitHub API so it can obtain
 * release digests. Container builds may run behind a shared/NATed API limit,
 * while the pinned URLs and hashes are already checked into each tools/<kind>/latest.json.
 * This narrow build helper uses those immutable pins directly, then the normal
 * ensure-agent-binaries guard performs its usual final validation.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PLATFORM = 'linux-x64';
const MIN_EXPECTED_BYTES = 1024;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function isUsableBinary(filePath) {
  try {
    return fs.statSync(filePath).size >= MIN_EXPECTED_BYTES;
  } catch {
    return false;
  }
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}): ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function extract(archivePath, destination) {
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destination], {
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`tar exited with ${result.status}`);
  }
}

function findBinary(root, basename) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === basename) return candidate;
    if (entry.isDirectory()) {
      const found = findBinary(candidate, basename);
      if (found) return found;
    }
  }
  return null;
}

async function installPinnedBinary({
  kind,
  version,
  url,
  archiveSha256,
  binaryName,
  targetPath,
}) {
  if (isUsableBinary(targetPath)) {
    fs.writeFileSync(`${path.dirname(targetPath)}/.version`, `${version}\n`);
    console.log(`[direct-agent-bootstrap] ${kind} ${PLATFORM}: already present @ ${version}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cindy-${kind}-`));
  const archivePath = path.join(tempRoot, 'asset.tar.gz');
  const extractRoot = path.join(tempRoot, 'extract');
  fs.mkdirSync(extractRoot);
  try {
    console.log(`[direct-agent-bootstrap] ${kind} ${PLATFORM}: downloading pinned release`);
    await download(url, archivePath);
    const actualHash = sha256(archivePath);
    if (actualHash !== archiveSha256) {
      throw new Error(`${kind} archive sha256 mismatch: expected ${archiveSha256}, got ${actualHash}`);
    }
    extract(archivePath, extractRoot);
    const extracted = findBinary(extractRoot, binaryName);
    if (!extracted) throw new Error(`${kind} archive did not contain ${binaryName}`);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(extracted, targetPath);
    fs.chmodSync(targetPath, 0o755);
    fs.writeFileSync(`${path.dirname(targetPath)}/.version`, `${version}\n`);
    console.log(`[direct-agent-bootstrap] ${kind} ${PLATFORM}: installed @ ${version}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--platform=linux-x64') === false) {
    throw new Error('this helper only supports --platform=linux-x64');
  }

  const codex = readJson('tools/codex/latest.json');
  const codexPin = codex.runtimeAssets[PLATFORM];
  await installPinnedBinary({
    kind: 'codex',
    version: codex.version,
    url: codexPin.url,
    archiveSha256: codexPin.sha256,
    binaryName: 'codex-x86_64-unknown-linux-musl',
    targetPath: path.join(ROOT, 'apps/codex-bin', PLATFORM, 'codex'),
  });

  const ripgrep = readJson('tools/ripgrep/latest.json');
  const ripgrepArchive = `ripgrep-${ripgrep.version}-x86_64-unknown-linux-musl.tar.gz`;
  const ripgrepUrl =
    `https://github.com/BurntSushi/ripgrep/releases/download/${ripgrep.version}/${ripgrepArchive}`;
  const checksumText = await (async () => {
    const response = await fetch(`${ripgrepUrl}.sha256`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`ripgrep checksum download failed (${response.status})`);
    return response.text();
  })();
  const ripgrepHash = checksumText.match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase();
  if (!ripgrepHash) throw new Error('ripgrep checksum file did not contain a SHA-256 digest');
  await installPinnedBinary({
    kind: 'ripgrep',
    version: ripgrep.version,
    url: ripgrepUrl,
    archiveSha256: ripgrepHash,
    binaryName: 'rg',
    targetPath: path.join(ROOT, 'apps/ripgrep-bin', PLATFORM, 'rg'),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[direct-agent-bootstrap] ${error.message ?? String(error)}`);
    process.exit(1);
  });
}

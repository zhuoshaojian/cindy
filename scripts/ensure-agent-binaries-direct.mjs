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

import {
  installAgentBinaryFromMirror,
  isInstalledAgentBinaryMirrorAsset,
  resolveAgentBinaryMirrorBaseUrl,
} from './agent-binary-mirror.mjs';

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

  const mirrorBaseUrl = resolveAgentBinaryMirrorBaseUrl();
  // 这里刻意跟 tools/codex/（单文件 pin），**不是** tools/codex-package/。
  //
  // 上游 v0.1.73 新增了 tools/codex-package/（目录分发，当前 0.153.0）并把构建期的
  // ensure-agent-binaries 迁了过去,但 apps/desktop 的 Linux runtime fallback 仍然要求
  // codex 精确等于 tools/codex 的 pin —— 那是 app-server 协议对齐的硬要求
  // （linux-runtime-fallback.ts:288 用 runtimeVersionMatchesPin,claude 才允许更新版本）。
  // Pod 是 packaged Linux,启动时只会在 PATH / userData 里找那个精确版本;装成 0.153.0
  // 会判失配,然后回落去联网下载 0.145.0 —— 而集群内取不到 GitHub,实例就卡在
  // binaries not-ready。2026-09-07 这样打断过 8 台存量实例,由健康门禁回滚收场。
  const codex = readJson('tools/codex/latest.json');
  const codexPin = codex.runtimeAssets[PLATFORM];
  const codexTarget = path.join(ROOT, 'apps/codex-bin', PLATFORM, 'codex');
  if (mirrorBaseUrl) {
    const mirrorOptions = {
      // 台账里 'codex' 是 codex-package 的目录分发(给构建期 ensure-agent-binaries),
      // 'codex-cli' 才是这个单文件 pin。两者版本不同,不能混用同一个条目。
      kind: 'codex-cli',
      version: codex.version,
      platformKey: PLATFORM,
      targetPath: codexTarget,
    };
    if (await isInstalledAgentBinaryMirrorAsset(mirrorOptions)) {
      console.log(`[direct-agent-bootstrap] codex ${PLATFORM}: mirror-verified @ ${codex.version}`);
    } else {
      await installAgentBinaryFromMirror({ baseUrl: mirrorBaseUrl, ...mirrorOptions });
    }
  } else {
    await installPinnedBinary({
      kind: 'codex',
      version: codex.version,
      url: codexPin.url,
      archiveSha256: codexPin.sha256,
      binaryName: 'codex-x86_64-unknown-linux-musl',
      targetPath: codexTarget,
    });
  }

  const ripgrep = readJson('tools/ripgrep/latest.json');
  const ripgrepTarget = path.join(ROOT, 'apps/ripgrep-bin', PLATFORM, 'rg');
  if (mirrorBaseUrl) {
    const mirrorOptions = {
      kind: 'ripgrep',
      version: ripgrep.version,
      platformKey: PLATFORM,
      targetPath: ripgrepTarget,
    };
    if (await isInstalledAgentBinaryMirrorAsset(mirrorOptions)) {
      console.log(`[direct-agent-bootstrap] ripgrep ${PLATFORM}: mirror-verified @ ${ripgrep.version}`);
    } else {
      await installAgentBinaryFromMirror({ baseUrl: mirrorBaseUrl, ...mirrorOptions });
    }
  } else {
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
      targetPath: ripgrepTarget,
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[direct-agent-bootstrap] ${error.message ?? String(error)}`);
    process.exit(1);
  });
}

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  AGENT_BINARY_MIRROR_ENV,
  agentBinaryMirrorTemporaryAssetName,
  installAgentBinaryFromMirror,
  isInstalledAgentBinaryMirrorAsset,
  loadAgentBinaryMirrorAsset,
  resolveAgentBinaryMirrorAssetUrl,
  resolveAgentBinaryMirrorBaseUrl,
} from '../agent-binary-mirror.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function makeFixture({ kind = 'codex', binary = Buffer.alloc(2048, 7) } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mirror-test-'));
  const platformKey = 'linux-x64';
  const version = '1.2.3';
  const relativePath = `${kind}/${version}/${platformKey}/${kind}.gz`;
  const pinDir = path.join(rootDir, 'tools', 'agent-binary-mirror');
  fs.mkdirSync(pinDir, { recursive: true });
  fs.writeFileSync(path.join(pinDir, `${platformKey}.json`), JSON.stringify({
    schemaVersion: 1,
    platform: platformKey,
    assets: {
      [kind]: {
        format: 'raw-gzip',
        version,
        relativePath,
        binarySha256: sha256(binary),
        binarySize: binary.length,
      },
    },
  }));
  return { rootDir, platformKey, version, relativePath, binary };
}

function makeDirectoryFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mirror-dir-test-'));
  const platformKey = 'linux-x64';
  const version = '1.2.3';
  const payloadRoot = path.join(rootDir, 'payload', 'pi');
  fs.mkdirSync(path.join(payloadRoot, 'theme'), { recursive: true });
  fs.writeFileSync(path.join(payloadRoot, 'pi'), crypto.randomBytes(4096));
  fs.writeFileSync(path.join(payloadRoot, 'theme', 'default.json'), '{"accent":"pi"}');
  const archivePath = path.join(rootDir, 'pi-linux-x64.tar.gz');
  const tar = spawnSync('tar', ['-czf', archivePath, '-C', path.join(rootDir, 'payload'), 'pi']);
  assert.equal(tar.status, 0, tar.stderr?.toString());
  const archive = fs.readFileSync(archivePath);
  const relativePath = `pi/${version}/${platformKey}/pi-linux-x64.tar.gz`;
  const pinDir = path.join(rootDir, 'tools', 'agent-binary-mirror');
  fs.mkdirSync(pinDir, { recursive: true });
  fs.writeFileSync(path.join(pinDir, `${platformKey}.json`), JSON.stringify({
    schemaVersion: 1,
    platform: platformKey,
    assets: {
      pi: {
        format: 'directory-tar-gzip',
        version,
        relativePath,
        archiveSha256: sha256(archive),
        archiveSize: archive.length,
        binaryName: 'pi',
      },
    },
  }));
  return { rootDir, platformKey, version, relativePath, archive };
}

test('directory archive extraction keeps the explicit .tar.gz contract required by GNU tar', () => {
  assert.equal(agentBinaryMirrorTemporaryAssetName('directory-tar-gzip'), 'asset.tar.gz');
  assert.equal(agentBinaryMirrorTemporaryAssetName('raw-gzip'), 'asset.gz');
});

test('mirror opt-in is absent for unset/empty env and validates an HTTPS base', () => {
  assert.equal(resolveAgentBinaryMirrorBaseUrl({}), null);
  assert.equal(resolveAgentBinaryMirrorBaseUrl({ [AGENT_BINARY_MIRROR_ENV]: '  ' }), null);
  assert.equal(
    resolveAgentBinaryMirrorBaseUrl({ [AGENT_BINARY_MIRROR_ENV]: 'https://mirror.example.test/root///' }),
    'https://mirror.example.test/root',
  );
});

test('mirror base rejects HTTP, credentials, query, and hash', () => {
  for (const invalid of [
    'http://mirror.example.test',
    'https://user:password@mirror.example.test',
    'https://mirror.example.test?channel=cn',
    'https://mirror.example.test#assets',
  ]) {
    assert.throws(
      () => resolveAgentBinaryMirrorBaseUrl({ [AGENT_BINARY_MIRROR_ENV]: invalid }),
      new RegExp(AGENT_BINARY_MIRROR_ENV),
    );
  }
});

test('repository pins resolve all linux-x64 mirror paths', async () => {
  const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  // 台账条目必须按**消费者**对齐，不能按 kind 名去猜 tools/<kind>/latest.json。
  // 一个 kind 名对应哪个 pin 源，取决于谁消费它：
  //   codex      → 构建期 ensure-agent-binaries（KINDS 的 pinDir: 'codex-package'）
  //   codex-cli  → 运行期 apps/desktop 的 Linux runtime fallback，它要求精确等于
  //                tools/codex 的 pin（app-server 协议对齐），版本比上面那个旧
  // 2026-09-07 这里按 kind 名猜路径，让台账拿另一个消费者的 pin 自证通过，
  // 构建仍然 fail-closed 失败；改成 codex-package 后又把镜像装成了运行期不接受的
  // 版本，打断了 8 台存量实例。两个方向都栽过，所以逐个消费者钉住。
  const pinSources = {
    claude: async () =>
      (await import(new URL('../../tools/claude/update.mjs', import.meta.url).href))
        .readPinnedVersion(),
    codex: async () =>
      (await import(new URL('../../tools/codex-package/update.mjs', import.meta.url).href))
        .readPinnedVersion(),
    'codex-cli': async () =>
      JSON.parse(fs.readFileSync(path.join(rootDir, 'tools/codex/latest.json'), 'utf8')).version,
    ripgrep: async () =>
      (await import(new URL('../../tools/ripgrep/update.mjs', import.meta.url).href))
        .readPinnedVersion(),
    pi: async () =>
      (await import(new URL('../../tools/pi/update.mjs', import.meta.url).href))
        .readPinnedVersion(),
  };
  const versions = {};
  for (const [kind, read] of Object.entries(pinSources)) versions[kind] = await read();
  // codex 与 codex-cli 是两个不同版本的条目，混用任一个都会在构建或运行期炸。
  assert.notEqual(
    versions.codex,
    versions['codex-cli'],
    'codex(codex-package) 与 codex-cli(tools/codex) 的 pin 一旦相同，说明上游已收敛，'
      + '此时应把镜像与台账收敛回单一 codex 条目，而不是继续维护两份',
  );
  const expectedPaths = {
    claude: `claude-code/${versions.claude}/linux-x64/claude.gz`,
    codex: `codex-package/${versions.codex}/linux-x64/codex-package-linux-x64.tar.gz`,
    'codex-cli': `codex/${versions['codex-cli']}/linux-x64/codex.gz`,
    ripgrep: `ripgrep/${versions.ripgrep}/linux-x64/rg.gz`,
    pi: `pi/${versions.pi}/linux-x64/pi-linux-x64.tar.gz`,
  };
  for (const kind of Object.keys(versions)) {
    const asset = loadAgentBinaryMirrorAsset({
      kind,
      platformKey: 'linux-x64',
      expectedVersion: versions[kind],
      rootDir,
    });
    assert.equal(asset.relativePath, expectedPaths[kind]);
    assert.equal(
      resolveAgentBinaryMirrorAssetUrl('https://mirror.example.test/base', asset),
      `https://mirror.example.test/base/${expectedPaths[kind]}`,
    );
  }
});

test('cloud image installs the codex build that the Linux runtime fallback accepts', () => {
  const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const readRoot = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

  // 运行期判据的唯一真源：apps/desktop 的 Linux runtime fallback 用 tools/codex 的 pin,
  // 且对 codex 走 runtimeVersionMatchesPin（精确相等,不接受更新版本）。
  const fallback = readRoot('apps/desktop/src/main/agent-binaries/linux-runtime-fallback.ts');
  assert.match(fallback, /import codexLatest from '.*tools\/codex\/latest\.json'/);
  assert.match(fallback, /if \(runtimeVersionMatchesPin\(kind, versionOutput\)\) return candidate;/);
  const runtimePin = JSON.parse(readRoot('tools/codex/latest.json')).version;

  // 镜像侧必须按同一个 pin 装,并放到 PATH 上那个目录。
  const direct = readRoot('scripts/ensure-agent-binaries-direct.mjs');
  assert.match(direct, /readJson\('tools\/codex\/latest\.json'\)/);
  assert.match(direct, /'apps\/codex-bin', PLATFORM, 'codex'/);
  assert.match(direct, /kind: 'codex-cli'/);
  assert.equal(
    JSON.parse(readRoot('tools/agent-binary-mirror/linux-x64.json')).assets['codex-cli'].version,
    runtimePin,
  );

  // Dockerfile 的 PATH 与 runtime COPY 都必须指向那份单文件,否则 Pod 找不到它就会
  // 回落去联网下载 —— 集群内取不到 GitHub,实例卡在 binaries not-ready。
  const dockerfile = readRoot('deploy/cloud-instance/Dockerfile');
  assert.match(dockerfile, /PATH=[^\n]*\/workspace\/apps\/codex-bin\/linux-x64/);
  assert.match(
    dockerfile,
    /COPY --from=packager --chown=cindy:cindy \/workspace\/apps\/codex-bin\/linux-x64\/ \/workspace\/apps\/codex-bin\/linux-x64\//,
  );
  assert.match(
    readRoot('deploy/cloud-instance/check-capabilities.mjs'),
    /apps\/codex-bin\/linux-x64\/codex/,
  );
});

test('directory-distribution mirror verifies the pinned archive and installs all Pi assets', async () => {
  const fixture = makeDirectoryFixture();
  const targetPath = path.join(fixture.rootDir, 'dest', 'pi');
  await installAgentBinaryFromMirror({
    baseUrl: 'https://mirror.example.test',
    kind: 'pi',
    version: fixture.version,
    platformKey: fixture.platformKey,
    targetPath,
    rootDir: fixture.rootDir,
    fetchImpl: async () => new Response(fixture.archive, { status: 200 }),
  });
  assert.equal(fs.statSync(targetPath).size, 4096);
  assert.equal(fs.readFileSync(path.join(path.dirname(targetPath), 'theme', 'default.json'), 'utf8'), '{"accent":"pi"}');
  assert.equal(fs.readFileSync(path.join(path.dirname(targetPath), '.version'), 'utf8'), '1.2.3\n');
  assert.equal(await isInstalledAgentBinaryMirrorAsset({
    kind: 'pi',
    version: fixture.version,
    platformKey: fixture.platformKey,
    targetPath,
    rootDir: fixture.rootDir,
  }), true);
});

test('mirror install verifies the repository-pinned binary and writes the version marker', async () => {
  const fixture = makeFixture();
  const targetPath = path.join(fixture.rootDir, 'dest', 'codex');
  const requested = [];
  await installAgentBinaryFromMirror({
    baseUrl: 'https://mirror.example.test/base',
    kind: 'codex',
    version: fixture.version,
    platformKey: fixture.platformKey,
    targetPath,
    rootDir: fixture.rootDir,
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(zlib.gzipSync(fixture.binary), { status: 200 });
    },
  });

  assert.deepEqual(requested, [`https://mirror.example.test/base/${fixture.relativePath}`]);
  assert.deepEqual(fs.readFileSync(targetPath), fixture.binary);
  assert.equal(fs.readFileSync(path.join(path.dirname(targetPath), '.version'), 'utf8'), '1.2.3\n');
  assert.equal(await isInstalledAgentBinaryMirrorAsset({
    kind: 'codex',
    version: fixture.version,
    platformKey: fixture.platformKey,
    targetPath,
    rootDir: fixture.rootDir,
  }), true);
  fs.writeFileSync(targetPath, Buffer.alloc(fixture.binary.length, 8));
  assert.equal(await isInstalledAgentBinaryMirrorAsset({
    kind: 'codex',
    version: fixture.version,
    platformKey: fixture.platformKey,
    targetPath,
    rootDir: fixture.rootDir,
  }), false);
});

test('configured mirror fails closed on a missing asset without leaving a target', async () => {
  const fixture = makeFixture();
  const targetPath = path.join(fixture.rootDir, 'dest', 'codex');
  await assert.rejects(
    () => installAgentBinaryFromMirror({
      baseUrl: 'https://mirror.example.test',
      kind: 'codex',
      version: fixture.version,
      platformKey: fixture.platformKey,
      targetPath,
      rootDir: fixture.rootDir,
      fetchImpl: async () => new Response('missing', { status: 404 }),
    }),
    /mirror download failed.*404/,
  );
  assert.equal(fs.existsSync(targetPath), false);
});

test('configured mirror fails closed on a hash mismatch and never fetches a checksum sidecar', async () => {
  const fixture = makeFixture({ kind: 'ripgrep' });
  const targetPath = path.join(fixture.rootDir, 'dest', 'rg');
  const requested = [];
  await assert.rejects(
    () => installAgentBinaryFromMirror({
      baseUrl: 'https://mirror.example.test',
      kind: 'ripgrep',
      version: fixture.version,
      platformKey: fixture.platformKey,
      targetPath,
      rootDir: fixture.rootDir,
      fetchImpl: async (url) => {
        requested.push(url);
        return new Response(zlib.gzipSync(Buffer.alloc(fixture.binary.length, 9)), { status: 200 });
      },
    }),
    /binary sha256 mismatch/,
  );
  assert.deepEqual(requested, [`https://mirror.example.test/${fixture.relativePath}`]);
  assert.equal(requested.some((url) => url.endsWith('.sha256')), false);
  assert.equal(fs.existsSync(targetPath), false);
});

test('configured mirror rejects decompressed bytes beyond the repository-pinned size', async () => {
  const fixture = makeFixture();
  const targetPath = path.join(fixture.rootDir, 'dest', 'codex');
  await assert.rejects(
    () => installAgentBinaryFromMirror({
      baseUrl: 'https://mirror.example.test',
      kind: 'codex',
      version: fixture.version,
      platformKey: fixture.platformKey,
      targetPath,
      rootDir: fixture.rootDir,
      fetchImpl: async () => new Response(
        zlib.gzipSync(Buffer.alloc(fixture.binary.length + 1, 7)),
        { status: 200 },
      ),
    }),
    /exceeded pinned size/,
  );
  assert.equal(fs.existsSync(targetPath), false);
});

test('configured mirror failures stay fatal under the CLI best-effort mode', () => {
  const script = path.resolve(fileURLToPath(new URL('../ensure-agent-binaries.mjs', import.meta.url)));
  const result = spawnSync(process.execPath, [
    script,
    '--best-effort',
    '--kinds=codex',
    '--platform=missing-mirror-pin',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      [AGENT_BINARY_MIRROR_ENV]: 'https://mirror.example.test',
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no trusted pin for missing-mirror-pin/);
  assert.doesNotMatch(result.stdout, /falling back/);
});

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

test('repository pins resolve all linux-x64 mirror paths', () => {
  const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const versions = {
    claude: JSON.parse(fs.readFileSync(path.join(rootDir, 'tools/claude/latest.json'))).version,
    codex: JSON.parse(fs.readFileSync(path.join(rootDir, 'tools/codex/latest.json'))).version,
    ripgrep: JSON.parse(fs.readFileSync(path.join(rootDir, 'tools/ripgrep/latest.json'))).version,
    pi: JSON.parse(fs.readFileSync(path.join(rootDir, 'tools/pi/latest.json'))).version,
  };
  const expectedPaths = {
    claude: `claude-code/${versions.claude}/linux-x64/claude.gz`,
    codex: `codex/${versions.codex}/linux-x64/codex.gz`,
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

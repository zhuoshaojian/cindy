import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DESKTOP_ENDPOINT_MANIFEST_BASES_SCHEMA_VERSION,
  desktopClientBuildEnv,
  loadDesktopEndpointManifestBases,
  loadEndpointManifestBaseUrl,
  loadPeerEndpointManifestBaseUrl,
  mobileClientBundleEnv,
  mobileClientBuildEnv,
} from '../shared/client-endpoint-build-env.mjs';
import { resolveReleaseCdnBaseUrl } from '../shared/release-env.mjs';

const require = createRequire(import.meta.url);
const { normalizeMobileManifestBaseUrl } = require('../shared/client-endpoint-build-env.cjs');

const tempDirs = [];
const originalReleaseCdn = process.env.XDT_CDN_BASE_URL;
const originalCindyAuthRegion = process.env.CINDY_AUTH_REGION;
const originalViteAuthRegion = process.env.VITE_CINDY_AUTH_REGION;
const originalViteManifestBase = process.env.VITE_ENDPOINT_MANIFEST_BASE_URL;
const originalVitePeerManifestBase = process.env.VITE_ENDPOINT_MANIFEST_PEER_BASE_URL;

afterEach(() => {
  if (originalReleaseCdn === undefined) delete process.env.XDT_CDN_BASE_URL;
  else process.env.XDT_CDN_BASE_URL = originalReleaseCdn;
  if (originalCindyAuthRegion === undefined) delete process.env.CINDY_AUTH_REGION;
  else process.env.CINDY_AUTH_REGION = originalCindyAuthRegion;
  if (originalViteAuthRegion === undefined) delete process.env.VITE_CINDY_AUTH_REGION;
  else process.env.VITE_CINDY_AUTH_REGION = originalViteAuthRegion;
  if (originalViteManifestBase === undefined) {
    delete process.env.VITE_ENDPOINT_MANIFEST_BASE_URL;
  } else {
    process.env.VITE_ENDPOINT_MANIFEST_BASE_URL = originalViteManifestBase;
  }
  if (originalVitePeerManifestBase === undefined) {
    delete process.env.VITE_ENDPOINT_MANIFEST_PEER_BASE_URL;
  } else {
    process.env.VITE_ENDPOINT_MANIFEST_PEER_BASE_URL = originalVitePeerManifestBase;
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('desktop/mobile 构建从 region 清单的 cdnBaseUrl 生成自举环境变量', () => {
  const repoRoot = writeRepoFixtures();
  delete process.env.CINDY_AUTH_REGION;

  assert.deepEqual(desktopClientBuildEnv({ allowEnvOverride: false, repoRoot }), {
    VITE_CINDY_AUTH_REGION: 'global',
    VITE_ENDPOINT_MANIFEST_BASE_URL: 'https://hotfix-global.example.invalid/app',
    VITE_ENDPOINT_MANIFEST_PEER_BASE_URL: 'https://hotfix-cn.example.invalid/app',
  });
  assert.equal(
    Object.hasOwn(desktopClientBuildEnv({ allowEnvOverride: false, repoRoot }), 'VITE_FEISHU_APP_ID'),
    false,
  );
  assert.deepEqual(mobileClientBuildEnv({ authRegion: 'global', repoRoot }), {
    EXPO_PUBLIC_CINDY_AUTH_REGION: 'global',
    EXPO_PUBLIC_ENDPOINT_MANIFEST_BASE_URL: 'https://hotfix-global.example.invalid/app',
  });
  assert.deepEqual(mobileClientBundleEnv({ authRegion: 'global', repoRoot }), {
    EXPO_PUBLIC_CINDY_AUTH_REGION: 'global',
    EXPO_PUBLIC_ENDPOINT_MANIFEST_BASE_URL: 'https://hotfix-global.example.invalid/app',
    EXPO_PUBLIC_ENDPOINT_MANIFEST_PEER_BASE_URL: 'https://hotfix-cn.example.invalid/app',
  });
  assert.equal(
    loadPeerEndpointManifestBaseUrl({ authRegion: 'cn', repoRoot }),
    'https://hotfix-global.example.invalid/app',
  );
});

test('端点清单自举基址缺失、非法协议、凭据或 query/hash 时 fail closed', () => {
  const repoRoot = writeRepoFixtures();
  const cnPath = path.join(repoRoot, 'config', 'endpoint.json');

  fs.writeFileSync(cnPath, JSON.stringify({ schemaVersion: 1 }));
  assert.throws(() => loadEndpointManifestBaseUrl({ authRegion: 'cn', repoRoot }), /cdnBaseUrl/);

  fs.writeFileSync(
    cnPath,
    JSON.stringify({
      schemaVersion: 1,
      cdnBaseUrl: 'http://hotfix.example.invalid/app',
    }),
  );
  assert.throws(() => loadEndpointManifestBaseUrl({ authRegion: 'cn', repoRoot }), /HTTPS/);

  fs.writeFileSync(
    cnPath,
    JSON.stringify({
      schemaVersion: 1,
      cdnBaseUrl: 'https://hotfix.example.invalid/app?tenant=dev',
    }),
  );
  assert.throws(
    () => mobileClientBuildEnv({ authRegion: 'cn', repoRoot }),
    /cdnBaseUrl 不允许 query\/hash.*路径拼接 \/endpoint\.json/,
  );

  fs.writeFileSync(
    cnPath,
    JSON.stringify({
      schemaVersion: 1,
      cdnBaseUrl: 'https://hotfix-cn.example.invalid/app',
    }),
  );
  fs.writeFileSync(
    path.join(repoRoot, 'config', 'endpoint.global.json'),
    JSON.stringify({
      schemaVersion: 1,
      cdnBaseUrl: 'https://hotfix-global.example.invalid/app#manifest',
    }),
  );
  assert.throws(
    () => mobileClientBundleEnv({ authRegion: 'cn', repoRoot }),
    /cdnBaseUrl 不允许 query\/hash.*路径拼接 \/endpoint\.json/,
  );

  assert.throws(
    () => normalizeMobileManifestBaseUrl('https://mobile-current.example.invalid/app?tenant=dev', 'current.json'),
    /cdnBaseUrl 不允许 query\/hash.*路径拼接 \/endpoint\.json/,
  );
  assert.throws(
    () => normalizeMobileManifestBaseUrl('https://mobile-peer.example.invalid/app#manifest', 'peer.json'),
    /cdnBaseUrl 不允许 query\/hash.*路径拼接 \/endpoint\.json/,
  );

  fs.writeFileSync(
    cnPath,
    JSON.stringify({
      schemaVersion: 1,
      cdnBaseUrl: 'https://user:pass@hotfix.example.invalid/app',
    }),
  );
  assert.throws(() => loadEndpointManifestBaseUrl({ authRegion: 'cn', repoRoot }), /HTTPS/);
});

test('Desktop packaged 构建通过显式文件注入 current/peer，且普通 env 不能覆盖', () => {
  const repoRoot = writeRepoFixtures();
  const relativePath = path.join('config', 'desktop-endpoint-manifest-bases.json');
  writeDesktopManifestBases(path.join(repoRoot, relativePath), {
    region: 'cn',
    currentManifestBaseUrl: 'https://manifest-current.example.invalid/cindy///',
    peerManifestBaseUrl: 'https://manifest-peer.example.invalid/cindy/',
  });
  process.env.VITE_CINDY_AUTH_REGION = 'global';
  process.env.VITE_ENDPOINT_MANIFEST_BASE_URL = 'https://env-current.example.invalid';
  process.env.VITE_ENDPOINT_MANIFEST_PEER_BASE_URL = 'https://env-peer.example.invalid';

  assert.deepEqual(
    desktopClientBuildEnv({
      allowEnvOverride: false,
      authRegion: 'dev',
      endpointManifestBasesFile: relativePath,
      repoRoot,
    }),
    {
      VITE_CINDY_AUTH_REGION: 'dev',
      VITE_ENDPOINT_MANIFEST_BASE_URL: 'https://manifest-current.example.invalid/cindy',
      VITE_ENDPOINT_MANIFEST_PEER_BASE_URL: 'https://manifest-peer.example.invalid/cindy',
    },
  );
});

test('Desktop 清单基址文件对 schema、realm、字段和 HTTPS 凭据 fail closed', () => {
  const repoRoot = writeRepoFixtures();
  const filePath = path.join(repoRoot, 'manifest-bases.json');

  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath: path.join(repoRoot, 'missing.json'),
        authRegion: 'cn',
        repoRoot,
      }),
    /缺少 Desktop 端点清单基址配置/,
  );

  fs.writeFileSync(filePath, '{');
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'cn',
        repoRoot,
      }),
    /不是合法 JSON/,
  );

  const valid = {
    region: 'cn',
    currentManifestBaseUrl: 'https://current.example.invalid/cindy',
    peerManifestBaseUrl: 'https://peer.example.invalid/cindy',
  };
  writeDesktopManifestBases(filePath, { ...valid, schemaVersion: 2 });
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'cn',
        repoRoot,
      }),
    /schemaVersion 必须为 1/,
  );

  writeDesktopManifestBases(filePath, { ...valid, region: 'dev' });
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'dev',
        repoRoot,
      }),
    /region 只能是 cn 或 global/,
  );

  writeDesktopManifestBases(filePath, valid);
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'global',
        repoRoot,
      }),
    /region 与构建物理 realm 不一致/,
  );

  writeDesktopManifestBases(filePath, { ...valid, peerManifestBaseUrl: '' });
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'cn',
        repoRoot,
      }),
    /peerManifestBaseUrl/,
  );

  writeDesktopManifestBases(filePath, {
    ...valid,
    currentManifestBaseUrl: 'http://current.example.invalid/cindy',
  });
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'cn',
        repoRoot,
      }),
    /无凭据 HTTPS URL/,
  );

  writeDesktopManifestBases(filePath, {
    ...valid,
    peerManifestBaseUrl: 'https://user:pass@peer.example.invalid/cindy',
  });
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'cn',
        repoRoot,
      }),
    /无凭据 HTTPS URL/,
  );

  writeDesktopManifestBases(filePath, {
    ...valid,
    currentManifestBaseUrl: 'https://current.example.invalid/cindy?channel=dev',
  });
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'cn',
        repoRoot,
      }),
    /currentManifestBaseUrl 不允许 query\/hash.*路径拼接 \/endpoint\.json/,
  );

  writeDesktopManifestBases(filePath, {
    ...valid,
    peerManifestBaseUrl: 'https://peer.example.invalid/cindy#endpoint',
  });
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'cn',
        repoRoot,
      }),
    /peerManifestBaseUrl 不允许 query\/hash.*路径拼接 \/endpoint\.json/,
  );

  writeDesktopManifestBases(filePath, { ...valid, unexpected: true });
  assert.throws(
    () =>
      loadDesktopEndpointManifestBases({
        filePath,
        authRegion: 'cn',
        repoRoot,
      }),
    /未知字段: unexpected/,
  );
});

test('仓内 Desktop 清单基址示例是合法 placeholder 配置', () => {
  const filePath = fileURLToPath(new URL('../../config/desktop-endpoint-manifest-bases.json.example', import.meta.url));
  assert.deepEqual(loadDesktopEndpointManifestBases({ filePath, authRegion: 'dev' }), {
    currentManifestBaseUrl: 'https://manifests-cn.example.invalid/cindy',
    peerManifestBaseUrl: 'https://manifests-global.example.invalid/cindy',
  });
});

test('发布 CDN 只接受显式 XDT_CDN_BASE_URL', () => {
  delete process.env.XDT_CDN_BASE_URL;
  assert.throws(() => resolveReleaseCdnBaseUrl(), /XDT_CDN_BASE_URL/);
  process.env.XDT_CDN_BASE_URL = 'https://release.example.invalid/app///';
  assert.equal(resolveReleaseCdnBaseUrl(), 'https://release.example.invalid/app');
});

function writeRepoFixtures() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'client-endpoint-build-env-'));
  tempDirs.push(repoRoot);
  const configDir = path.join(repoRoot, 'config');
  fs.mkdirSync(configDir);
  fs.writeFileSync(
    path.join(configDir, 'endpoint.json'),
    JSON.stringify({
      schemaVersion: 1,
      cdnBaseUrl: 'https://hotfix-cn.example.invalid/app/',
    }),
  );
  fs.writeFileSync(
    path.join(configDir, 'endpoint.global.json'),
    JSON.stringify({
      schemaVersion: 1,
      cdnBaseUrl: 'https://hotfix-global.example.invalid/app/',
    }),
  );
  return repoRoot;
}

function writeDesktopManifestBases(filePath, value) {
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      schemaVersion: DESKTOP_ENDPOINT_MANIFEST_BASES_SCHEMA_VERSION,
      ...value,
    }),
  );
}

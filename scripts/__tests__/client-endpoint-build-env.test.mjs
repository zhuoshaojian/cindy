import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  mobileClientBundleProcessEnv,
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
  assert.deepEqual(mobileClientBundleEnv({ authRegion: 'dev', repoRoot }), {
    EXPO_PUBLIC_CINDY_AUTH_REGION: 'dev',
    EXPO_PUBLIC_ENDPOINT_MANIFEST_BASE_URL: 'https://hotfix-dev.example.invalid/app',
    EXPO_PUBLIC_ENDPOINT_MANIFEST_PEER_BASE_URL: 'https://hotfix-global.example.invalid/app',
    EXPO_PUBLIC_CINDY_DEV_RELEASE_ENDPOINT_MANIFEST_BASE_URL:
      'https://hotfix-cn.example.invalid/app',
  });
  assert.equal(
    loadPeerEndpointManifestBaseUrl({ authRegion: 'cn', repoRoot }),
    'https://hotfix-global.example.invalid/app',
  );
});

test('Mobile bundling 进程环境只在 CindyDev 保留 Release 清单基址', () => {
  const repoRoot = writeRepoFixtures();
  const staleBaseEnv = {
    KEEP_ME: '1',
    EXPO_PUBLIC_CINDY_DEV_RELEASE_ENDPOINT_MANIFEST_BASE_URL:
      'https://stale-release.example.invalid/app',
  };

  const cn = mobileClientBundleProcessEnv({
    authRegion: 'cn',
    baseEnv: staleBaseEnv,
    repoRoot,
  });
  assert.equal(cn.KEEP_ME, '1');
  assert.equal(
    Object.hasOwn(
      cn,
      'EXPO_PUBLIC_CINDY_DEV_RELEASE_ENDPOINT_MANIFEST_BASE_URL',
    ),
    false,
  );

  const dev = mobileClientBundleProcessEnv({
    authRegion: 'dev',
    baseEnv: staleBaseEnv,
    repoRoot,
  });
  assert.equal(
    dev.EXPO_PUBLIC_CINDY_DEV_RELEASE_ENDPOINT_MANIFEST_BASE_URL,
    'https://hotfix-cn.example.invalid/app',
  );
});

test('Mobile 构建入口不把动态异常或环境变量值写入失败日志', () => {
  for (const relativePath of [
    'apps/mobile/scripts/build-android.mjs',
    'apps/mobile/scripts/build-ios.mjs',
  ]) {
    const source = fs.readFileSync(path.resolve(relativePath), 'utf8');
    const catchBlock = source.slice(source.lastIndexOf('main().catch('));

    assert.match(catchBlock, /main\(\)\.catch\(\(\) => \{/);
    assert.doesNotMatch(catchBlock, /process\.env/);
    assert.doesNotMatch(catchBlock, /err(?:or)?\??\.(?:message|stack)/i);
    assert.doesNotMatch(catchBlock, /scrubSecretsFromText/);
  }
});

test('Android 构建在子进程启动前失败时输出安全且可执行的诊断', () => {
  const fakeSecret = 'fake-keystore-password-that-must-not-leak';
  const result = spawnSync(
    process.execPath,
    [path.resolve('apps/mobile/scripts/build-android.mjs'), '--region', 'invalid'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        XDT_ANDROID_KEYSTORE_PASSWORD_DEV: fakeSecret,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Android 构建失败（参数检查）/);
  assert.match(result.stderr, /--region cn\|global\|dev/);
  assert.doesNotMatch(result.stderr, new RegExp(fakeSecret));
  assert.doesNotMatch(result.stderr, /详细原因请查看上方构建工具输出/);
});

test('iOS 构建在子进程启动前失败时输出安全且可执行的诊断', () => {
  const fakeSecret = 'fake-ios-signing-secret-that-must-not-leak';
  const result = spawnSync(
    process.execPath,
    [path.resolve('apps/mobile/scripts/build-ios.mjs'), '--region', 'invalid'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        XDT_IOS_SIGNING_SECRET_DEV: fakeSecret,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iOS 构建失败（参数检查）/);
  assert.match(result.stderr, /--region cn\|global\|dev/);
  assert.doesNotMatch(result.stderr, new RegExp(fakeSecret));
  assert.doesNotMatch(result.stderr, /详细原因请查看上方构建工具输出/);
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

test('Vite main 优先消费 packaged 构建注入，不会先加载缺失的 dev 清单', async () => {
  process.env.CINDY_AUTH_REGION = 'dev';
  process.env.VITE_CINDY_AUTH_REGION = 'dev';
  process.env.VITE_ENDPOINT_MANIFEST_BASE_URL = 'https://current.example.invalid/cindy';
  process.env.VITE_ENDPOINT_MANIFEST_PEER_BASE_URL = 'https://peer.example.invalid/cindy';

  const { loadConfigFromFile } = await import('vite');
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apps/desktop/vite.main.config.ts'),
  );
  assert.ok(loaded);
  assert.deepEqual(
    {
      region: loaded.config.define['import.meta.env.VITE_CINDY_AUTH_REGION'],
      current: loaded.config.define['import.meta.env.VITE_ENDPOINT_MANIFEST_BASE_URL'],
      peer: loaded.config.define['import.meta.env.VITE_ENDPOINT_MANIFEST_PEER_BASE_URL'],
    },
    {
      region: JSON.stringify('dev'),
      current: JSON.stringify('https://current.example.invalid/cindy'),
      peer: JSON.stringify('https://peer.example.invalid/cindy'),
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
  fs.writeFileSync(
    path.join(configDir, 'endpoint.dev.json'),
    JSON.stringify({ schemaVersion: 1, cdnBaseUrl: 'https://hotfix-dev.example.invalid/app/' }),
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

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildCloudRuntimeMetadata } from '../cloud-runtime-build-metadata.mjs';
import {
  isCloudRuntimeBuildInput,
  isExcludedCloudRuntimeBuildInput,
  sensitiveBuildContextContentRule,
  sensitiveBuildContextPathRule,
  untrackedFiles,
} from '../cloud-runtime-build-context.mjs';
import {
  CLOUD_RUNTIME_ENDPOINT_DISCOVERY_SCRIPT,
  validateCloudRuntimeEndpointConfigs,
  validateCloudRuntimeInspect,
  validateCloudRuntimePaths,
  validatePackagedContentProof,
} from '../cloud-runtime-image-content-check.mjs';
import { createPackagedContentManifest } from '../cloud-runtime-packaged-content-manifest.mjs';

const require = createRequire(import.meta.url);
const { createPackage } = require('@electron/asar');

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('formal Dockerfile is the single runtime-stage source used by local compose', () => {
  const dockerfile = read('deploy/cloud-instance/Dockerfile');
  const compose = read('deploy/cloud-instance/local/compose.yaml');

  assert.match(dockerfile, /^# syntax=docker\/dockerfile:/);
  assert.match(dockerfile, /ARG NODE_IMAGE=node:22-bookworm-slim/);
  assert.match(dockerfile, /ARG PNPM_VERSION=10\.33\.2/);
  assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS base/);
  const baseStage = dockerfile.slice(
    dockerfile.indexOf('FROM ${NODE_IMAGE} AS base'),
    dockerfile.indexOf('FROM base AS source'),
  );
  const sourceStage = dockerfile.slice(
    dockerfile.indexOf('FROM base AS source'),
    dockerfile.indexOf('FROM source AS development'),
  );
  const packagerStage = dockerfile.slice(
    dockerfile.indexOf('FROM source AS packager'),
    dockerfile.indexOf('FROM base AS runtime'),
  );
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('FROM base AS runtime'));
  const architectureAssertion = /test "\$\{TARGETOS\}" = linux && test "\$\{TARGETARCH\}" = amd64/;
  assert.doesNotMatch(baseStage, architectureAssertion);
  assert.match(sourceStage, architectureAssertion);
  assert.match(runtimeStage, architectureAssertion);
  assert.equal(dockerfile.match(new RegExp(architectureAssertion.source, 'g'))?.length, 2);
  assert.match(dockerfile, /FROM source AS packager/);
  assert.match(dockerfile, /ENV NODE_ENV=development/);
  assert.match(dockerfile, /pnpm install --filter desktop\.\.\. --prod=false --frozen-lockfile/);
  assert.match(dockerfile, /ARG XDT_AGENT_BINARY_MIRROR_BASE_URL=""/);
  assert.doesNotMatch(dockerfile, /ENV XDT_AGENT_BINARY_MIRROR_BASE_URL/);
  assert.ok(
    dockerfile.indexOf('ARG XDT_AGENT_BINARY_MIRROR_BASE_URL=""')
      < dockerfile.indexOf('pnpm install --filter desktop... --prod=false --frozen-lockfile'),
  );
  assert.doesNotMatch(dockerfile, /COPY \. \./);
  for (const expectedCopy of [
    'COPY apps/desktop/ ./apps/desktop/',
    'COPY appicon/ ./appicon/',
    'COPY packages/ ./packages/',
    'COPY scripts/ ./scripts/',
    'COPY tools/ ./tools/',
    'COPY docs/legal/notices/ ./docs/legal/notices/',
    'COPY config/endpoint.json config/endpoint.global.json ./config/',
  ]) assert.match(dockerfile, new RegExp(expectedCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // 协议包已内联进本仓 `packages/`(上游 2026-08 删掉 cindy-protocol submodule)。
  // 再出现这条 COPY 会让构建在不存在的路径上直接失败 —— 只有真去构建才看得见,
  // 所以在这里钉住。
  assert.doesNotMatch(dockerfile, /COPY\s+cindy-protocol\//);
  assert.match(dockerfile, /pnpm --filter desktop package --platform=linux --arch=x64/);
  assert.match(dockerfile, /NODE_OPTIONS=--max-old-space-size=8192/);
  assert.match(
    packagerStage,
    /RUN --mount=type=cache,target=\/root\/\.cache\/electron,id=cindy-cloud-electron/,
  );
  const directBootstrap = read('scripts/ensure-agent-binaries-direct.mjs');
  const normalBootstrap = read('scripts/ensure-agent-binaries.mjs');
  assert.match(directBootstrap, /installAgentBinaryFromMirror/);
  assert.match(normalBootstrap, /installAgentBinaryFromMirror/);
  const forgeConfig = read('apps/desktop/forge.config.ts');
  assert.match(
    forgeConfig,
    /fs\.rmSync\(path\.join\(destModules, 'ssh2', 'test'\), \{ recursive: true, force: true \}\)/,
  );
  assert.match(dockerfile, /FROM base AS runtime/);
  assert.equal(dockerfile.match(/ AS runtime\s*$/gm)?.length, 1);
  assert.match(dockerfile, /useradd --create-home --uid 10001/);
  assert.match(dockerfile, /USER cindy\s*$/m);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*cindy-cloud-healthcheck\.mjs/);
  const runtimeInstructions = runtimeStage.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(runtimeInstructions.slice(-2), ['USER cindy', 'CMD []']);
  assert.match(baseStage, /ELECTRON_DISABLE_SANDBOX=1/);
  assert.match(baseStage, /XDT_DEV_SAFE_STORAGE_BASIC=1/);
  // Keywords only, never the prose: consolidating the two Dockerfiles once
  // deleted this justification outright, and both settings reach production.
  assert.match(baseStage, /SUID/);
  assert.match(baseStage, /keyring/);
  assert.match(compose, /dockerfile: deploy\/cloud-instance\/Dockerfile/);
  assert.match(compose, /target: development/);
  assert.equal(fs.existsSync(path.join(ROOT, 'deploy/cloud-instance/local/Dockerfile')), false);
});

test('runtime helper scripts have one canonical copy and entrypoint is POSIX shell', () => {
  for (const name of ['entrypoint.sh', 'healthcheck.mjs', 'check-capabilities.mjs']) {
    assert.equal(fs.existsSync(path.join(ROOT, 'deploy/cloud-instance', name)), true);
    assert.equal(fs.existsSync(path.join(ROOT, 'deploy/cloud-instance/local', name)), false);
  }
  execFileSync('sh', ['-n', path.join(ROOT, 'deploy/cloud-instance/entrypoint.sh')]);

  const smoke = read('scripts/cloud-runtime-image-smoke.mjs');
  assert.match(smoke, /const HEADLESS_STARTUP_MARKER = 'headless startup entered'/);
  assert.match(
    smoke,
    /run\('docker', \[\s*'run', '--detach'[\s\S]*?\n\s*image,\s*\n\s*\]\);/,
  );
  assert.match(smoke, /dockerLogs\.includes\(HEADLESS_STARTUP_MARKER\)/);
  assert.match(smoke, /mainLogs\.includes\(HEADLESS_STARTUP_MARKER\)/);
  assert.match(smoke, /error while loading shared libraries/);
  assert.match(smoke, /cannot open shared object file/);
  assert.match(smoke, /cindy-xvfb\.log/);
  assert.match(smoke, /'stop', '--time', String\(STOP_TIMEOUT_SECONDS\)/);
  assert.match(smoke, /stoppedState\.ExitCode === 137/);
  assert.match(smoke, /printContainerDiagnostics\(containerName, userDataDir, tempRoot\)/);
  assert.match(smoke, /Full readiness requires real Pod credentials and endpoints/);
});

test('docker context excludes host state, credentials and local endpoints', () => {
  const ignore = read('.dockerignore');
  for (const pattern of [
    '**/.env',
    '**/.env.*',
    '**/.npmrc',
    '**/.netrc',
    '**/.aws',
    '**/.docker',
    '**/.kube',
    '**/.config/gh',
    '**/logs',
    '**/userData',
    '**/safe-storage',
    '**/*.enc',
    '**/*.pem',
    '**/*.key',
    '**/*.crt',
    '**/*.p12',
    '**/*.pfx',
    '**/config/endpoint.local.json',
  ]) {
    assert.match(ignore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
});

test('build context whitelist excludes unrelated and credential-sensitive inputs', () => {
  assert.equal(isCloudRuntimeBuildInput('apps/desktop/src/main/index.ts'), true);
  assert.equal(isCloudRuntimeBuildInput('config/endpoint.global.json'), true);
  assert.equal(
    isCloudRuntimeBuildInput('cindy-protocol/packages/device-link-protocol/src/index.ts'),
    false,
  );
  assert.equal(
    isCloudRuntimeBuildInput('apps/mobile/modules/xdt-ios-app-distribution/package.json'),
    true,
  );
  assert.equal(
    isCloudRuntimeBuildInput('apps/mobile/modules/xdt-ios-app-distribution/src/index.ts'),
    false,
  );
  assert.equal(isCloudRuntimeBuildInput('apps/mobile/app.json'), false);
  assert.equal(isCloudRuntimeBuildInput('.github/workflows/ci.yml'), false);
  assert.equal(isExcludedCloudRuntimeBuildInput('apps/desktop/.env.production'), true);
  assert.equal(isExcludedCloudRuntimeBuildInput('packages/example/src/__tests__/fixture.ts'), true);
  assert.equal(
    isExcludedCloudRuntimeBuildInput(
      'packages/browser-control-runtime/src/_generated/vendor/fs-safe/dist/advanced.js',
    ),
    false,
  );
  assert.equal(sensitiveBuildContextPathRule('apps/desktop/.config/gh/hosts.yml'), 'provider-config');
  assert.equal(sensitiveBuildContextPathRule('packages/example/token.ts'), null);
  assert.equal(
    sensitiveBuildContextContentRule([
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'not-a-real-key-fixture',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n')),
    'private-key-content',
  );
  assert.equal(
    sensitiveBuildContextContentRule(
      String.raw`const CREDENTIAL_SCRUB_RE = /-----BEGIN OPENSSH PRIVATE KEY-----|token/g;`,
    ),
    null,
  );
  assert.equal(sensitiveBuildContextContentRule('export const token = "not-a-secret";'), null);
});

test('build context untracked scan does not require the removed cindy-protocol checkout', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-untracked-contract-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tempRoot });
    fs.writeFileSync(path.join(tempRoot, 'untracked.txt'), 'safe');

    assert.equal(fs.existsSync(path.join(tempRoot, 'cindy-protocol')), false);
    assert.deepEqual(untrackedFiles(tempRoot), ['untracked.txt']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('content inspection rejects leaked sources, credentials and local endpoints', () => {
  const baseInspect = {
    Architecture: 'amd64',
    Os: 'linux',
    Config: {
      User: 'cindy',
      Entrypoint: ['/usr/local/bin/cindy-cloud-entrypoint'],
      Cmd: [],
      Healthcheck: { Test: ['CMD', 'node', '/usr/local/bin/cindy-cloud-healthcheck.mjs'] },
      Env: ['NODE_ENV=production'],
    },
  };
  assert.deepEqual(validateCloudRuntimeInspect(baseInspect), []);
  assert.match(
    validateCloudRuntimeInspect({
      ...baseInspect,
      Config: { ...baseInspect.Config, Env: ['API_TOKEN=baked-value', 'API_URL=http://localhost:3335'] },
    }).join('\n'),
    /credential-like environment variable|local\/mock endpoint/,
  );
  assert.deepEqual(validateCloudRuntimePaths(['/opt/cindy/Cindy']), []);
  assert.deepEqual(validateCloudRuntimePaths([
    '/opt/cindy/resources/app.asar.unpacked/node_modules/example/token.js',
    '/opt/cindy/resources/app.asar.unpacked/node_modules/example/credentials.js',
  ]), []);
  assert.match(
    validateCloudRuntimePaths([
      '/workspace/package.json',
      '/opt/cindy/.env.production',
      '/home/cindy/safe-storage/key.enc',
      '/var/lib/cindy/user-data/account.json',
      '/home/cindy/.config/gh/hosts.yml',
    ]).join('\n'),
    /leaked|prohibited|pre-populate/,
  );
  assert.deepEqual(validateCloudRuntimeEndpointConfigs([
    { filePath: '/opt/cindy/resources/endpoint.json', content: '{"api":"https://api.cindy.app"}' },
  ]), []);
  assert.match(validateCloudRuntimeEndpointConfigs([
    { filePath: '/opt/cindy/resources/endpoint.custom.json', content: '{"api":"http://localhost:3000"}' },
  ]).join('\n'), /local\/mock endpoint/);

  const endpointRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-endpoint-scan-'));
  try {
    fs.mkdirSync(path.join(endpointRoot, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(endpointRoot, 'nested', 'endpoint.runtime.json'), '{"api":"https://api.cindy.app"}');
    fs.writeFileSync(path.join(endpointRoot, 'nested', 'unrelated.json'), '{"api":"http://localhost:3000"}');
    const discovered = spawnSync(process.execPath, [
      '-e', CLOUD_RUNTIME_ENDPOINT_DISCOVERY_SCRIPT, endpointRoot,
    ], { encoding: 'utf8' });
    assert.equal(discovered.status, 0, discovered.stderr);
    assert.deepEqual(JSON.parse(discovered.stdout), [{
      filePath: path.join(endpointRoot, 'nested', 'endpoint.runtime.json'),
      content: '{"api":"https://api.cindy.app"}',
    }]);
  } finally {
    fs.rmSync(endpointRoot, { recursive: true, force: true });
  }

  const cleanProof = {
    manifest: {
      schemaVersion: 1,
      rulesVersion: 2,
      result: 'safe',
      archive: {
        path: 'resources/app.asar',
        sha256: `sha256:${'d'.repeat(64)}`,
        entryCount: 10,
        inspectedConfigCount: 2,
        skippedNodeModulesConfigCount: 3,
      },
      findings: [],
    },
    actualSha256: `sha256:${'d'.repeat(64)}`,
  };
  assert.deepEqual(validatePackagedContentProof(cleanProof), []);
  assert.match(validatePackagedContentProof({
    ...cleanProof,
    actualSha256: `sha256:${'e'.repeat(64)}`,
  }).join('\n'), /does not match/);
  const archiveWithoutSkippedCount = { ...cleanProof.manifest.archive };
  delete archiveWithoutSkippedCount.skippedNodeModulesConfigCount;
  assert.match(validatePackagedContentProof({
    ...cleanProof,
    manifest: {
      ...cleanProof.manifest,
      archive: archiveWithoutSkippedCount,
    },
  }).join('\n'), /invalid skipped node_modules config count/);
  assert.match(validatePackagedContentProof({
    ...cleanProof,
    manifest: {
      ...cleanProof.manifest,
      archive: {
        ...cleanProof.manifest.archive,
        skippedNodeModulesConfigCount: -1,
      },
    },
  }).join('\n'), /invalid skipped node_modules config count/);
});

test('packaged app.asar scan emits a SHA-bound proof and rejects local endpoint config', async () => {
  const rootPackage = JSON.parse(read('package.json'));
  assert.equal(rootPackage.devDependencies?.['@electron/asar'], '3.4.1');
  assert.match(
    read('pnpm-lock.yaml'),
    /importers:\n\n  \.:\n[\s\S]*?devDependencies:\n      '@electron\/asar':\n        specifier: 3\.4\.1\n        version: 3\.4\.1/,
  );
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-asar-contract-'));
  try {
    const safeDir = path.join(tempRoot, 'safe');
    const safeAsar = path.join(tempRoot, 'safe.asar');
    const manifestPath = path.join(tempRoot, 'manifest.json');
    fs.mkdirSync(path.join(safeDir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(safeDir, 'node_modules', 'example'), { recursive: true });
    fs.writeFileSync(path.join(safeDir, 'index.js'), 'console.log("safe")');
    fs.writeFileSync(path.join(safeDir, 'config', 'endpoint.json'), '{"api":"https://api.cindy.app"}');
    fs.writeFileSync(
      path.join(safeDir, 'node_modules', 'example', 'defaults.json'),
      '{"api":"http://localhost:3000"}',
    );
    await createPackage(safeDir, safeAsar);
    const manifest = createPackagedContentManifest({ asarPath: safeAsar, outputPath: manifestPath });
    assert.equal(manifest.result, 'safe');
    assert.match(manifest.archive.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(manifest.archive.inspectedConfigCount, 1);
    assert.equal(manifest.archive.skippedNodeModulesConfigCount, 1);
    assert.ok(
      manifest.archive.inspectedConfigCount + manifest.archive.skippedNodeModulesConfigCount
        <= manifest.archive.entryCount,
    );

    const unsafeDir = path.join(tempRoot, 'unsafe');
    const unsafeAsar = path.join(tempRoot, 'unsafe.asar');
    fs.mkdirSync(path.join(unsafeDir, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(unsafeDir, 'config', 'endpoint.runtime.json'),
      '{"api":"http://localhost:3000"}',
    );
    await createPackage(unsafeDir, unsafeAsar);
    assert.throws(
      () => createPackagedContentManifest({ asarPath: unsafeAsar, outputPath: manifestPath }),
      /local-or-mock-endpoint/,
    );

    const unsafePathDir = path.join(tempRoot, 'unsafe-path');
    const unsafePathAsar = path.join(tempRoot, 'unsafe-path.asar');
    fs.mkdirSync(path.join(unsafePathDir, 'node_modules', 'example'), { recursive: true });
    fs.writeFileSync(
      path.join(unsafePathDir, 'node_modules', 'example', '.env.production'),
      'TOKEN=not-a-real-token',
    );
    await createPackage(unsafePathDir, unsafePathAsar);
    assert.throws(
      () => createPackagedContentManifest({ asarPath: unsafePathAsar, outputPath: manifestPath }),
      /environment-file/,
    );

    const unsafeEndpointPathDir = path.join(tempRoot, 'unsafe-endpoint-path');
    const unsafeEndpointPathAsar = path.join(tempRoot, 'unsafe-endpoint-path.asar');
    fs.mkdirSync(
      path.join(unsafeEndpointPathDir, 'node_modules', 'example'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        unsafeEndpointPathDir,
        'node_modules',
        'example',
        'endpoint.local.json',
      ),
      '{"api":"https://example.invalid"}',
    );
    await createPackage(unsafeEndpointPathDir, unsafeEndpointPathAsar);
    assert.throws(
      () => createPackagedContentManifest({
        asarPath: unsafeEndpointPathAsar,
        outputPath: manifestPath,
      }),
      /local-endpoint-file/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('capability and health helpers accept only a valid linux-x64 fixture', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-runtime-contract-'));
  const workspace = path.join(tempRoot, 'workspace');
  const resources = path.join(tempRoot, 'resources');
  const statusFile = path.join(tempRoot, 'status.json');
  try {
    const files = [
      path.join(workspace, 'apps/claude-code-bin/linux-x64/claude'),
      path.join(workspace, 'apps/codex-bin/linux-x64/codex'),
      path.join(resources, 'tools/ripgrep/rg'),
      path.join(resources, 'app.asar.unpacked/native/sqlite-vec/linux-x64/vec0.so'),
    ];
    for (const filePath of files) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.alloc(2048, 1));
      if (!filePath.endsWith('vec0.so')) fs.chmodSync(filePath, 0o755);
    }
    const capability = spawnSync('node', [path.join(ROOT, 'deploy/cloud-instance/check-capabilities.mjs')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CINDY_CLOUD_ARCH: 'x86_64',
        CINDY_WORKSPACE_ROOT: workspace,
        CINDY_CLOUD_PACKAGED_RESOURCES: resources,
      },
    });
    assert.equal(capability.status, 0, capability.stderr);

    fs.writeFileSync(statusFile, JSON.stringify({
      version: 1,
      phase: 'ready',
      heartbeatAtMs: Date.now(),
      readiness: {
        auth: 'ready',
        database: 'ready',
        binaries: 'ready',
        maker: 'ready',
        deviceLink: 'ready',
        modelAccess: 'unknown',
      },
    }));
    const health = spawnSync('node', [path.join(ROOT, 'deploy/cloud-instance/healthcheck.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, CINDY_CLOUD_STATUS_FILE: statusFile },
    });
    assert.equal(health.status, 0, health.stderr);

    const arm = spawnSync('node', [path.join(ROOT, 'deploy/cloud-instance/check-capabilities.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, CINDY_CLOUD_ARCH: 'arm64' },
    });
    assert.equal(arm.status, 78);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('build metadata is deterministic and explicitly non-promotable', () => {
  const input = {
    imageRef: 'cindy-cloud-runtime:sha-0123456789012345678901234567890123456789',
    imageTag: 'sha-0123456789012345678901234567890123456789',
    buildkitDigest: `sha256:${'a'.repeat(64)}`,
    buildkitDigestSource: 'steps.build.outputs.digest',
    loadedImageConfigId: `sha256:${'b'.repeat(64)}`,
    platform: 'linux/amd64',
    sourceRepository: 'example/cindy-fork',
    sourceSha: '0123456789012345678901234567890123456789',
    sourceRef: 'refs/heads/feature',
    createdAt: '2026-08-07T00:00:00Z',
    runId: '123',
    runAttempt: '1',
    imageArchive: 'cloud-runtime-image.tar.gz',
    imageArchiveSha256: `sha256:${'c'.repeat(64)}`,
    sbom: 'cloud-runtime.spdx.json',
  };
  const first = buildCloudRuntimeMetadata(input);
  assert.deepEqual(buildCloudRuntimeMetadata(input), first);
  assert.equal(first.image.tag, input.imageTag);
  assert.equal(first.image.buildkitDigest, input.buildkitDigest);
  assert.equal(first.image.buildkitDigestSource, input.buildkitDigestSource);
  assert.equal(first.image.loadedImageConfigId, input.loadedImageConfigId);
  assert.equal(first.source.repository, input.sourceRepository);
  assert.deepEqual(first.artifacts.imageArchive, {
    path: input.imageArchive,
    sha256: input.imageArchiveSha256,
  });
  assert.equal(first.promotion.enabled, false);
  assert.equal(buildCloudRuntimeMetadata({
    ...input,
    buildkitDigestSource: 'steps.build.outputs.metadata["containerimage.config.digest"]',
  }).image.buildkitDigestSource, 'steps.build.outputs.metadata["containerimage.config.digest"]');
  assert.throws(
    () => buildCloudRuntimeMetadata({ ...input, platform: 'linux/arm64' }),
    /linux\/amd64/,
  );
  assert.throws(
    () => buildCloudRuntimeMetadata({ ...input, loadedImageConfigId: undefined }),
    /loadedImageConfigId/,
  );
  assert.throws(
    () => buildCloudRuntimeMetadata({ ...input, imageArchiveSha256: undefined }),
    /imageArchiveSha256/,
  );
  assert.throws(
    () => buildCloudRuntimeMetadata({ ...input, sourceRepository: undefined }),
    /sourceRepository/,
  );
  assert.throws(
    () => buildCloudRuntimeMetadata({ ...input, imageTag: 'different-tag' }),
    /imageRef must end with/,
  );
  assert.throws(
    () => buildCloudRuntimeMetadata({ ...input, buildkitDigestSource: 'unknown.source' }),
    /unsupported buildkitDigestSource/,
  );
});

test('workflow never grants registry or OIDC permissions and branch builds cannot push', () => {
  const workflow = read('.github/workflows/build-cloud-runtime-image.yml');
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /packages:\s*write|id-token:\s*write|docker\/login-action/);
  assert.match(workflow, /platforms: linux\/amd64/);
  assert.match(workflow, /DOCKER_BUILD_RECORD_RETENTION_DAYS: 7/);
  assert.match(workflow, /push: false/);
  assert.match(workflow, /push:\n    branches: \[main\]/);
  assert.match(workflow, /Reclaim GitHub runner disk/);
  assert.match(workflow, /docker system prune -af/);
  assert.equal(workflow.match(/df -h "\$GITHUB_WORKSPACE"/g)?.length, 2);
  assert.ok(
    workflow.indexOf('Reclaim GitHub runner disk')
      < workflow.indexOf('Require native x64 builder and sufficient disk'),
  );
  assert.match(workflow, /cloud-runtime-image-smoke\.mjs/);
  assert.match(workflow, /cloud-runtime-image-content-check\.mjs/);
  assert.match(workflow, /cloud-runtime-build-context\.mjs/);
  assert.match(workflow, /runner\.temp.*cloud-runtime-build-context/);
  const contextGateIndex = workflow.indexOf('Prepare credential-clean tracked build context');
  const buildActionIndex = workflow.indexOf('uses: docker/build-push-action@');
  const cacheExportIndex = workflow.indexOf('cache-to:');
  assert.ok(contextGateIndex >= 0 && contextGateIndex < buildActionIndex);
  assert.ok(buildActionIndex < cacheExportIndex);
  assert.match(workflow, /severity: CRITICAL/);
  assert.match(workflow, /cloud-runtime\.spdx\.json/);
  assert.match(workflow, /docker image inspect --format '\{\{\.Id\}\}'/);
  assert.match(workflow, /sha256sum artifacts\/cloud-runtime-image\.tar\.gz/);
  assert.match(workflow, /--buildkit-digest=/);
  assert.match(workflow, /\.\["containerimage\.config\.digest"\] \/\/ empty/);
  assert.match(workflow, /2>\/dev\/null \|\| true/);
  assert.match(workflow, /buildkit_digest_source='steps\.build\.outputs\.digest'/);
  assert.match(
    workflow,
    /buildkit_digest_source='steps\.build\.outputs\.metadata\["containerimage\.config\.digest"\]'/,
  );
  assert.match(workflow, /--buildkit-digest-source=/);
  assert.match(workflow, /--source-repository='\$\{\{ github\.repository \}\}'/);
  assert.match(workflow, /--image-tag='\$\{\{ steps\.vars\.outputs\.image_tag \}\}'/);
  assert.match(workflow, /type=raw,value=\$\{\{ steps\.vars\.outputs\.image_tag \}\}/);
  assert.equal(workflow.match(/sha-\$\{GITHUB_SHA\}/g)?.length, 1);
  assert.match(workflow, /--loaded-image-config-id=/);
  assert.match(workflow, /--image-archive-sha256=/);
  assert.match(workflow, /valid digest directly or through containerimage\.config\.digest/);
  assert.doesNotMatch(workflow, /promotable digest|exact digest handoff/i);
  assert.match(workflow, /Promotion and signing are intentionally disabled in Build-1/);
});

// 回归:rebase 把上游新增的 apps/mobile/modules/xdt-ios-action-sheet 带进 lockfile,
// 而 Dockerfile 的 COPY 清单与 build-context 白名单各自硬枚举了当时的 5 个模块,两处都
// 没跟上。pnpm 即使 --filter desktop 也会校验每个 file: 快照的清单,于是构建在依赖安装
// 阶段 ENOENT 挂掉 —— 而且没有任何单测覆盖这条,只有真去构建镜像才看得见。
// 显式 COPY 清单是刻意保留的第二道边界(不改成动态推导),所以用这条测试守住三方一致。
test('mobile module manifests stay in sync across lockfile, Dockerfile and build context', () => {
  const lockfileModules = new Set(
    [...read('pnpm-lock.yaml').matchAll(/apps\/mobile\/modules\/([A-Za-z0-9._-]+)/g)]
      .map((match) => match[1]),
  );
  assert.ok(lockfileModules.size > 0, 'lockfile should reference at least one Mobile module');

  const dockerfileModules = new Set(
    [...read('deploy/cloud-instance/Dockerfile')
      .matchAll(/^COPY apps\/mobile\/modules\/([A-Za-z0-9._-]+)\/package\.json /gm)]
      .map((match) => match[1]),
  );
  assert.deepEqual(
    [...dockerfileModules].sort(),
    [...lockfileModules].sort(),
    'Dockerfile COPY list must name exactly the Mobile modules the lockfile snapshots',
  );

  // 白名单必须放行每个模块的 package.json,且仍然只放行 package.json ——
  // 不能因为补模块而把 Mobile 源码带进云端镜像上下文。
  for (const moduleName of lockfileModules) {
    assert.equal(
      isCloudRuntimeBuildInput(`apps/mobile/modules/${moduleName}/package.json`),
      true,
      `build context must include apps/mobile/modules/${moduleName}/package.json`,
    );
    assert.equal(
      isCloudRuntimeBuildInput(`apps/mobile/modules/${moduleName}/src/index.ts`),
      false,
      `build context must not include apps/mobile/modules/${moduleName} source`,
    );
  }
});

// 浏览器控制运行时只在 findChromeExecutableLinux 的固定路径清单里找可执行文件,
// 装了个不在清单上的浏览器等于没装(而 Pod 里没有 xdg-settings,更高优先级的
// detectDefaultChromiumExecutableLinux 永远返回 null,落不到别处)。这条把
// Dockerfile 装的包与那份清单绑在一起,免得一方改了另一方静默失效。
test('image installs a browser the control runtime can actually discover', () => {
  const dockerfile = read('deploy/cloud-instance/Dockerfile');
  const installed = new Set(
    dockerfile
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(chromium|google-chrome[a-z-]*|microsoft-edge[a-z-]*|brave-browser[a-z-]*)\s*\\?$/.test(line))
      .map((line) => line.replace(/\s*\\$/, '')),
  );
  assert.ok(
    installed.size > 0,
    'Dockerfile must apt-install a browser for the browser-control runtime',
  );

  const detection = read(
    'packages/browser-control-runtime/src/_generated/extension/src/browser/chrome.executables.ts',
  );
  const linuxBlock = detection.slice(
    detection.indexOf('export function findChromeExecutableLinux'),
    detection.indexOf('function findGoogleChromeExecutableLinux'),
  );
  assert.ok(linuxBlock.length > 0, 'findChromeExecutableLinux block not found');
  for (const pkg of installed) {
    assert.ok(
      linuxBlock.includes(`/usr/bin/${pkg}`),
      `installed browser ${pkg} is not on the Linux detection candidate list`,
    );
  }
});

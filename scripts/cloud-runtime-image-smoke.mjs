#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HEADLESS_STARTUP_MARKER = 'headless startup entered';
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const STOP_TIMEOUT_SECONDS = 10;
const RUNTIME_FAILURE_PATTERNS = [
  /error while loading shared libraries/i,
  /cannot open shared object file/i,
  /fatal server error/i,
  /xvfb[^\n]*fatal/i,
];

function result(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options });
}

function run(command, args, options = {}) {
  const execution = result(command, args, options);
  if (execution.error || execution.status !== 0) {
    throw execution.error ?? new Error(
      `${command} ${args.join(' ')} exited ${execution.status}\n${execution.stdout ?? ''}\n${execution.stderr ?? ''}`,
    );
  }
  return execution.stdout;
}

const SLEEP_LOCK = new Int32Array(new SharedArrayBuffer(4));

function sleep(milliseconds) {
  Atomics.wait(SLEEP_LOCK, 0, 0, milliseconds);
}

function readMainLogs(userDataDir) {
  const logsDir = path.join(userDataDir, 'logs');
  try {
    return fs.readdirSync(logsDir)
      .filter((name) => /^main-.*\.log$/u.test(name))
      .sort()
      .map((name) => fs.readFileSync(path.join(logsDir, name), 'utf8'))
      .join('\n');
  } catch {
    return '';
  }
}

function readDockerLogs(containerName) {
  const execution = result('docker', ['logs', containerName]);
  return `${execution.stdout ?? ''}${execution.stderr ?? ''}`;
}

function readXvfbLog(containerName, tempRoot) {
  const live = result('docker', [
    'exec', containerName, 'sh', '-lc',
    'cat /tmp/cindy-xvfb.log 2>/dev/null || true',
  ]);
  if (live.status === 0) return live.stdout ?? '';

  const copiedLog = path.join(tempRoot, 'cindy-xvfb.log');
  if (fs.existsSync(copiedLog)) return fs.readFileSync(copiedLog, 'utf8');
  const copied = result('docker', [
    'cp', `${containerName}:/tmp/cindy-xvfb.log`, copiedLog,
  ]);
  if (copied.status !== 0) return '';
  try {
    return fs.readFileSync(copiedLog, 'utf8');
  } catch {
    return '';
  }
}

function inspectContainerState(containerName) {
  const execution = result('docker', [
    'inspect', '--format', '{{json .State}}', containerName,
  ]);
  if (execution.status !== 0) return null;
  try {
    return JSON.parse(execution.stdout);
  } catch {
    return null;
  }
}

function assertNoRuntimeFailures(logs) {
  for (const pattern of RUNTIME_FAILURE_PATTERNS) {
    if (pattern.test(logs)) {
      throw new Error(`packaged runtime log matched prohibited failure: ${pattern}`);
    }
  }
}

/** The three log surfaces every failure check and diagnostic dump needs. */
function collectRuntimeLogs(containerName, userDataDir, tempRoot) {
  return {
    dockerLogs: readDockerLogs(containerName),
    mainLogs: readMainLogs(userDataDir),
    xvfbLog: readXvfbLog(containerName, tempRoot),
  };
}

function printContainerDiagnostics(containerName, userDataDir, tempRoot) {
  const { dockerLogs, mainLogs, xvfbLog } = collectRuntimeLogs(containerName, userDataDir, tempRoot);
  console.error(`\n[cloud-runtime-smoke] full docker logs (${containerName}):\n${dockerLogs || '<empty>'}`);
  console.error(`\n[cloud-runtime-smoke] full packaged main logs:\n${mainLogs || '<empty>'}`);
  console.error(`\n[cloud-runtime-smoke] full /tmp/cindy-xvfb.log:\n${xvfbLog || '<empty>'}`);
}

const HTTPS_ENDPOINT_FIELDS = [
  'authApiBaseUrl', 'deviceLinkApiBaseUrl', 'oauthBrokerApiBaseUrl', 'ossApiBaseUrl',
  'heartbeatUrl', 'websiteUrl', 'modelAccessApiBaseUrl', 'voiceApiBaseUrl',
  'githubApiBaseUrl', 'skillhubApiBaseUrl', 'pluginApiBaseUrl', 'cdnBaseUrl',
  'mobileUpdateBaseUrl',
];
const WSS_ENDPOINT_FIELDS = ['telegramHookWsUrl', 'xHookWsUrl', 'slackHookWsUrl'];

// Unroutable .invalid hosts: the smoke only needs the manifest to satisfy the
// strict Pod gate, never to reach a real service.
function writeEndpointFixture(filePath) {
  const httpsUrl = 'https://cloud-runtime-smoke.example.invalid';
  const wssUrl = 'wss://cloud-runtime-smoke.example.invalid';
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 1,
    ...Object.fromEntries(HTTPS_ENDPOINT_FIELDS.map((field) => [field, httpsUrl])),
    ...Object.fromEntries(WSS_ENDPOINT_FIELDS.map((field) => [field, wssUrl])),
    authDesktopCallbackUrl: `${httpsUrl}/api/auth/desktop/callback`,
    review: '0.0.0',
  }));
}

/**
 * Proves only that packaged Electron starts, its dynamic libraries and Xvfb
 * initialize, app code is entered, and SIGTERM exits without Docker's SIGKILL
 * fallback. Full readiness requires real Pod credentials and endpoints and is
 * deliberately outside this image-only smoke.
 */
function runPackagedStartupSmoke(image) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-runtime-smoke-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const resourceTokenFile = path.join(tempRoot, 'pod-resource-refresh-token');
  const endpointFile = path.join(tempRoot, 'endpoint.json');
  const containerName = `cindy-cloud-runtime-smoke-${process.pid}-${Date.now()}`;
  let containerCreated = false;

  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o777 });
  fs.chmodSync(userDataDir, 0o777);
  fs.writeFileSync(resourceTokenFile, 'cloud-runtime-smoke-not-a-real-token\n', { mode: 0o444 });
  writeEndpointFixture(endpointFile);
  fs.chmodSync(endpointFile, 0o444);

  try {
    // No arguments follow the image: the inherited empty CMD makes entrypoint.sh
    // select /opt/cindy/Cindy --headless instead of its arbitrary-command branch.
    run('docker', [
      'run', '--detach', '--name', containerName,
      '--env', 'XDT_POD_DEVICE_ID=cloud-device-runtime-smoke',
      // 控制面注入的 membership 是 Pod 身份的必需一半:startPodCloudRuntimeController
      // 按 provisioned session → 当前用户 → 本环境变量三级取值,而 smoke 用的是假 token,
      // 前两级必然为空。少了它启动会以 'Pod cloud runtime identity is incomplete'
      // 硬失败 —— 这条门禁此前一直因此过不去,并非被测镜像有问题。
      '--env', 'XDT_POD_MEMBERSHIP_ID=membership-runtime-smoke',
      '--env', 'XDT_POD_RESOURCE_REFRESH_TOKEN_FILE=/run/secrets/pod-resource-refresh-token',
      '--env', 'XDT_ENDPOINT_MANIFEST_FILE=/run/config/endpoint.json',
      '--env', 'XDT_USER_DATA_DIR=/var/lib/cindy/user-data',
      '--mount', `type=bind,source=${resourceTokenFile},target=/run/secrets/pod-resource-refresh-token,readonly`,
      '--mount', `type=bind,source=${endpointFile},target=/run/config/endpoint.json,readonly`,
      '--mount', `type=bind,source=${userDataDir},target=/var/lib/cindy/user-data`,
      image,
    ]);
    containerCreated = true;

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let markerSource = '';
    while (Date.now() < deadline) {
      const dockerLogs = readDockerLogs(containerName);
      const mainLogs = readMainLogs(userDataDir);
      assertNoRuntimeFailures(`${dockerLogs}\n${mainLogs}`);
      if (dockerLogs.includes(HEADLESS_STARTUP_MARKER)) markerSource = 'docker logs';
      if (mainLogs.includes(HEADLESS_STARTUP_MARKER)) markerSource = 'packaged main log';
      if (markerSource) break;
      const state = inspectContainerState(containerName);
      if (!state?.Running) {
        throw new Error('packaged runtime exited before the headless startup marker');
      }
      sleep(POLL_INTERVAL_MS);
    }
    if (!markerSource) {
      throw new Error(`timed out after ${STARTUP_TIMEOUT_MS}ms waiting for ${HEADLESS_STARTUP_MARKER}`);
    }

    assertNoRuntimeFailures(
      Object.values(collectRuntimeLogs(containerName, userDataDir, tempRoot)).join('\n'),
    );

    run('docker', ['stop', '--time', String(STOP_TIMEOUT_SECONDS), containerName], {
      timeout: (STOP_TIMEOUT_SECONDS + 5) * 1_000,
    });
    const stoppedState = inspectContainerState(containerName);
    if (!stoppedState || stoppedState.Running || stoppedState.OOMKilled || stoppedState.ExitCode === 137) {
      throw new Error(`packaged runtime did not stop gracefully: ${JSON.stringify(stoppedState)}`);
    }
    assertNoRuntimeFailures(
      Object.values(collectRuntimeLogs(containerName, userDataDir, tempRoot)).join('\n'),
    );

    console.log(
      `[cloud-runtime-smoke] packaged Electron entered app code via ${markerSource}; SIGTERM exit=${stoppedState.ExitCode}`,
    );
  } catch (error) {
    if (containerCreated) printContainerDiagnostics(containerName, userDataDir, tempRoot);
    throw error;
  } finally {
    if (containerCreated) result('docker', ['rm', '--force', containerName]);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const imageArg = process.argv.find((arg) => arg.startsWith('--image='));
  const image = imageArg?.slice('--image='.length);
  if (!image) throw new Error('usage: cloud-runtime-image-smoke.mjs --image=<tag>');

  run('docker', [
    'run', '--rm', '--entrypoint', 'node', image,
    '/usr/local/bin/cindy-cloud-check-capabilities.mjs',
  ]);
  run('docker', [
    'run', '--rm', '--entrypoint', 'sh', image, '-lc',
    [
      'set -eu',
      'test "$(id -u)" = 10001',
      'test -x /opt/cindy/Cindy',
      'status=/tmp/cindy-cloud-status.json',
      `node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({version:1,phase:"ready",heartbeatAtMs:Date.now(),readiness:{auth:"ready",database:"ready",binaries:"ready",maker:"ready",deviceLink:"ready",modelAccess:"unknown"}}))' "$status"`,
      'CINDY_CLOUD_STATUS_FILE="$status" node /usr/local/bin/cindy-cloud-healthcheck.mjs',
    ].join('; '),
  ]);
  run('docker', [
    'run', '--rm', image,
    'node', '-e',
    'if(process.getuid?.()!==10001)process.exit(1);console.log("entrypoint-ok")',
  ]);
  runPackagedStartupSmoke(image);
  console.log(
    `[cloud-runtime-smoke] ${image}: capability, health, non-root entrypoint, packaged startup and SIGTERM smoke passed`,
  );
}

try {
  main();
} catch (error) {
  console.error(`[cloud-runtime-smoke] ${error.message ?? String(error)}`);
  process.exit(1);
}

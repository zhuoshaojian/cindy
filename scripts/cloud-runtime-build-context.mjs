#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const EXACT_INPUTS = new Set([
  '.dockerignore',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  // pnpm validates every file: snapshot in the shared lockfile even when the
  // install is filtered to Desktop. Only these package manifests are needed;
  // no Mobile runtime source enters the cloud image context.
  'apps/mobile/modules/xdt-ios-app-distribution/package.json',
  'apps/mobile/modules/xdt-mobile-realtime-audio/package.json',
  'apps/mobile/modules/xdt-screenshot-monitor/package.json',
  'apps/mobile/modules/xdt-tapdb/package.json',
  'apps/mobile/modules/xdt-wechat-login/package.json',
  'config/endpoint.json',
  'config/endpoint.global.json',
]);
const INPUT_PREFIXES = [
  'appicon/',
  'apps/desktop/',
  'dependency-patches/',
  'deploy/cloud-instance/',
  'docs/legal/notices/',
  'packages/',
  'scripts/',
  'tools/',
];
const REQUIRED_INPUTS = [
  '.dockerignore',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/desktop/package.json',
  'config/endpoint.json',
  'config/endpoint.global.json',
  'deploy/cloud-instance/Dockerfile',
  'docs/legal/notices/desktop-linux.txt',
  'scripts/ensure-agent-binaries.mjs',
  'scripts/agent-binary-mirror.mjs',
  'scripts/ensure-deps.mjs',
  'tools/agent-binary-mirror/linux-x64.json',
];

const TEXT_EXTENSIONS = new Set([
  '.cjs', '.conf', '.css', '.html', '.ini', '.js', '.json', '.jsx', '.md', '.mjs',
  '.sh', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

function normalize(relativePath) {
  return relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isCloudRuntimeBuildInput(relativePath) {
  const normalized = normalize(relativePath);
  return EXACT_INPUTS.has(normalized)
    || INPUT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isExcludedCloudRuntimeBuildInput(relativePath) {
  const normalized = normalize(relativePath);
  // This pinned fs-safe dist is vendored runtime source, not generated build
  // output. The Desktop bundle imports it directly during packaging.
  if (normalized.startsWith('packages/browser-control-runtime/src/_generated/vendor/fs-safe/dist/')) {
    return false;
  }
  const segments = normalized.split('/');
  const basename = segments.at(-1) ?? '';
  if (segments.some((segment) => [
    'node_modules', '.git', '.pnpm-store', '.vite', 'out', 'build', 'dist', 'logs',
    'userData', 'safe-storage', '__tests__', '__snapshots__',
  ].includes(segment))) return true;
  if (/^\.env(?:\.|$)/i.test(basename)) return true;
  if (/\.(?:test|spec)\.[^.]+$/i.test(basename)) return true;
  if (/^endpoint\.(?:local|dev)\.json$/i.test(basename)) return true;
  return false;
}

export function sensitiveBuildContextPathRule(relativePath) {
  const normalized = normalize(relativePath);
  const segments = normalized.split('/');
  const basename = segments.at(-1) ?? '';
  const sensitiveSegments = new Map([
    ['.aws', 'provider-config'],
    ['.azure', 'provider-config'],
    ['.docker', 'container-registry-config'],
    ['.kube', 'cluster-config'],
    ['.ssh', 'ssh-config'],
    ['.gnupg', 'gpg-config'],
  ]);
  for (const segment of segments) {
    if (sensitiveSegments.has(segment)) return sensitiveSegments.get(segment);
  }
  if (normalized.includes('/.config/gh/') || normalized.includes('/.config/gcloud/')) {
    return 'provider-config';
  }
  if (/^\.(?:npmrc|netrc|git-credentials|pypirc|yarnrc(?:\..*)?)$/i.test(basename)) {
    return 'credential-config';
  }
  if (/^(?:id_rsa|id_ed25519)(?:\..*)?$/i.test(basename)) return 'private-key-name';
  if (/\.(?:enc|pem|key|crt|p12|pfx|jks|keystore)$/i.test(basename)) {
    return 'credential-extension';
  }
  if (/^(?:account|auth|credential|credentials|secret|secrets|token|tokens)\.(?:json|ya?ml|txt)$/i.test(basename)) {
    return 'credential-file-name';
  }
  return null;
}

export function sensitiveBuildContextContentRule(content) {
  if (/^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?$/m.test(content)) return 'private-key-content';
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(content)) {
    return 'github-token-content';
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(content)) return 'aws-access-key-content';
  if (/^\s*(?:\/\/[^\s=]+:)?_authToken\s*=\s*\S+/im.test(content)) {
    return 'package-registry-token-content';
  }
  return null;
}

function git(args, cwd = REPO_ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'buffer' });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`git ${args.join(' ')} exited ${result.status}`);
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean).map(normalize);
}

function trackedFiles() {
  return git(['ls-files', '--cached', '--recurse-submodules', '-z']);
}

export function untrackedFiles(repoRoot = REPO_ROOT) {
  return git(['ls-files', '--others', '--exclude-standard', '-z'], repoRoot);
}

function validateEndpointManifest(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  const localOrMock = /(?:localhost|127\.0\.0\.1|\[?::1\]?|host\.docker\.internal|\bmock\b)/i;
  const walk = (value) => {
    if (typeof value === 'string') {
      if (localOrMock.test(value)) throw new Error(`${relativePath}: local-or-mock-endpoint`);
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        const url = new URL(value);
        if (url.username || url.password) throw new Error(`${relativePath}: credentialed-url`);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(parsed);
}

function copyTrackedFile(relativePath, outputRoot) {
  const source = path.join(REPO_ROOT, relativePath);
  const destination = path.join(outputRoot, relativePath);
  const stat = fs.lstatSync(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination);
    return;
  }
  if (!stat.isFile()) throw new Error(`${relativePath}: unsupported-input-type`);
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, stat.mode & 0o777);
}

export function prepareCloudRuntimeBuildContext({ outputRoot, copy = true } = {}) {
  const tracked = trackedFiles();
  const untracked = untrackedFiles();
  const selectedTracked = tracked.filter(
    (relativePath) => isCloudRuntimeBuildInput(relativePath)
      && !isExcludedCloudRuntimeBuildInput(relativePath),
  );
  const selectedUntracked = untracked.filter(
    (relativePath) => isCloudRuntimeBuildInput(relativePath)
      && !isExcludedCloudRuntimeBuildInput(relativePath),
  );
  const findings = [];
  for (const relativePath of [...selectedTracked, ...selectedUntracked]) {
    const pathRule = sensitiveBuildContextPathRule(relativePath);
    if (pathRule) {
      findings.push({ relativePath, rule: pathRule });
      continue;
    }
    const absolutePath = path.join(REPO_ROOT, relativePath);
    let stat;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch {
      findings.push({ relativePath, rule: 'missing-input' });
      continue;
    }
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || !TEXT_EXTENSIONS.has(path.extname(relativePath))) {
      continue;
    }
    const contentRule = sensitiveBuildContextContentRule(fs.readFileSync(absolutePath, 'utf8'));
    if (contentRule) findings.push({ relativePath, rule: contentRule });
  }
  if (findings.length > 0) {
    throw new Error(`credential-sensitive build inputs rejected:\n${findings.map(
      ({ relativePath, rule }) => `- ${relativePath} (${rule})`,
    ).join('\n')}`);
  }
  for (const required of REQUIRED_INPUTS) {
    if (!selectedTracked.includes(required)) throw new Error(`required tracked build input missing: ${required}`);
  }
  validateEndpointManifest('config/endpoint.json');
  validateEndpointManifest('config/endpoint.global.json');

  if (copy) {
    if (!outputRoot) throw new Error('outputRoot is required when copy=true');
    if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length > 0) {
      throw new Error(`refusing to overwrite non-empty build context: ${outputRoot}`);
    }
    fs.mkdirSync(outputRoot, { recursive: true });
    for (const relativePath of selectedTracked) copyTrackedFile(relativePath, outputRoot);
  }
  return {
    trackedInputCount: selectedTracked.length,
    excludedUntrackedCount: selectedUntracked.length,
  };
}

function parseOutput(argv) {
  const value = argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
  if (!value) throw new Error('usage: cloud-runtime-build-context.mjs --output=<empty-directory>');
  return path.resolve(value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputRoot = parseOutput(process.argv.slice(2));
    const result = prepareCloudRuntimeBuildContext({ outputRoot });
    console.log(
      `[cloud-runtime-context] prepared ${result.trackedInputCount} tracked files; ${result.excludedUntrackedCount} untracked files excluded by construction`,
    );
  } catch (error) {
    console.error(`[cloud-runtime-context] ${error.message ?? String(error)}`);
    process.exit(1);
  }
}

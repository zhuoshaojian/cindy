#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROHIBITED_PATHS = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)endpoint\.local\.json$/i,
  /(^|\/)safe-storage(?:\/|$)/i,
  /(^|\/)userData(?:\/|$)/,
  /\.(?:enc|pem|key|crt)$/i,
  /(^|\/)(?:\.aws|\.azure|\.config\/gh|\.docker|\.kube|\.npmrc|\.netrc)(?:\/|$)/i,
  /(^|\/)(?:account|auth|credential|credentials|secret|secrets|token|tokens)\.json$/i,
];

export const CLOUD_RUNTIME_ENDPOINT_DISCOVERY_SCRIPT = [
  'const fs=require("fs"),path=require("path");',
  'const roots=process.argv.slice(1),out=[];',
  'function walk(dir){let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}',
  'for(const entry of entries){const filePath=path.join(dir,entry.name);',
  'if(entry.isDirectory())walk(filePath);',
  'else if(entry.isFile()&&/endpoint[^/]*\\.json$/i.test(entry.name))',
  'out.push({filePath,content:fs.readFileSync(filePath,"utf8")});}}',
  'for(const root of roots)walk(root);process.stdout.write(JSON.stringify(out));',
].join('');

export function validateCloudRuntimeInspect(inspect) {
  const errors = [];
  if (inspect.Architecture !== 'amd64' || inspect.Os !== 'linux') {
    errors.push(`expected linux/amd64, got ${inspect.Os}/${inspect.Architecture}`);
  }
  if (inspect.Config?.User !== 'cindy') {
    errors.push(`expected final USER cindy, got ${inspect.Config?.User || '<empty>'}`);
  }
  const entrypoint = inspect.Config?.Entrypoint ?? [];
  if (entrypoint.join(' ') !== '/usr/local/bin/cindy-cloud-entrypoint') {
    errors.push(`unexpected entrypoint: ${entrypoint.join(' ') || '<empty>'}`);
  }
  if ((inspect.Config?.Cmd ?? []).length !== 0) {
    errors.push(
      `expected an empty CMD so the entrypoint selects packaged headless mode, got: ${inspect.Config.Cmd.join(' ')}`,
    );
  }
  const healthcheck = inspect.Config?.Healthcheck?.Test ?? [];
  if (!healthcheck.join(' ').includes('/usr/local/bin/cindy-cloud-healthcheck.mjs')) {
    errors.push('image healthcheck does not invoke cindy-cloud-healthcheck.mjs');
  }
  for (const env of inspect.Config?.Env ?? []) {
    const [name, ...parts] = env.split('=');
    const value = parts.join('=');
    if (/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) && value) {
      errors.push(`credential-like environment variable is baked into the image: ${name}`);
    }
    if (/(?:localhost|host\.docker\.internal|\bmock\b)/i.test(value)) {
      errors.push(`local/mock endpoint value is baked into image environment: ${name}`);
    }
  }
  return errors;
}

export function validateCloudRuntimePaths(paths) {
  const errors = [];
  for (const filePath of paths) {
    if (PROHIBITED_PATHS.some((pattern) => pattern.test(filePath))) {
      errors.push(`prohibited path in runtime image: ${filePath}`);
    }
  }
  const prohibitedExact = [
    '/workspace/package.json',
    '/workspace/pnpm-lock.yaml',
    '/workspace/node_modules',
    '/root/.local/share/pnpm',
    '/root/.cache/electron',
  ];
  for (const candidate of prohibitedExact) {
    if (paths.some((filePath) => filePath === candidate || filePath.startsWith(`${candidate}/`))) {
      errors.push(`build/source artifact leaked into runtime image: ${candidate}`);
    }
  }
  for (const persistentRoot of [
    '/var/lib/cindy/user-data/',
    '/var/lib/cindy/workspaces/',
    '/var/lib/cindy/status/',
  ]) {
    if (paths.some((filePath) => filePath.startsWith(persistentRoot))) {
      errors.push(`runtime image must not pre-populate persistent state: ${persistentRoot}`);
    }
  }
  if (paths.includes('/home/cindy/.cindy-home-initialized')) {
    errors.push('runtime image must not bake the mounted-home initialization marker');
  }
  return errors;
}

export function validateCloudRuntimeEndpointConfigs(files) {
  const errors = [];
  const localOrMock = /(?:localhost|127\.0\.0\.1|\[?::1\]?|host\.docker\.internal|\bmock\b)/i;
  for (const { filePath, content } of files) {
    if (localOrMock.test(content)) {
      errors.push(`local/mock endpoint material in runtime image: ${filePath}`);
    }
  }
  return errors;
}

export function validatePackagedContentProof(proof) {
  const errors = [];
  const manifest = proof?.manifest;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.rulesVersion !== 2) {
    errors.push('packaged content manifest schema is missing or unsupported');
    return errors;
  }
  if (manifest.result !== 'safe' || !Array.isArray(manifest.findings) || manifest.findings.length !== 0) {
    errors.push('packaged content manifest does not record a clean scan');
  }
  if (!manifest.archive || manifest.archive.path !== 'resources/app.asar') {
    errors.push('packaged content manifest has an unexpected archive path');
  }
  if (!Number.isInteger(manifest.archive?.entryCount) || manifest.archive.entryCount <= 0) {
    errors.push('packaged content manifest has no archive entries');
  }
  if (!Number.isInteger(manifest.archive?.inspectedConfigCount) || manifest.archive.inspectedConfigCount < 0) {
    errors.push('packaged content manifest has an invalid config count');
  }
  if (!Number.isInteger(manifest.archive?.skippedNodeModulesConfigCount)
    || manifest.archive.skippedNodeModulesConfigCount < 0) {
    errors.push('packaged content manifest has an invalid skipped node_modules config count');
  }
  if (Number.isInteger(manifest.archive?.entryCount)
    && Number.isInteger(manifest.archive?.inspectedConfigCount)
    && Number.isInteger(manifest.archive?.skippedNodeModulesConfigCount)
    && manifest.archive.inspectedConfigCount + manifest.archive.skippedNodeModulesConfigCount
      > manifest.archive.entryCount) {
    errors.push('packaged content manifest config counts exceed its archive entry count');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(proof.actualSha256 ?? '')) {
    errors.push('final app.asar SHA-256 is missing or invalid');
  } else if (manifest.archive?.sha256 !== proof.actualSha256) {
    errors.push('final app.asar does not match its build-stage content scan');
  }
  return errors;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

function main() {
  const imageArg = process.argv.find((arg) => arg.startsWith('--image='));
  const image = imageArg?.slice('--image='.length);
  if (!image) throw new Error('usage: cloud-runtime-image-content-check.mjs --image=<tag>');

  const inspect = JSON.parse(run('docker', ['image', 'inspect', image]))[0];
  const roots = ['/opt/cindy', '/workspace', '/home/cindy', '/var/lib/cindy', '/usr/local/bin'];
  const output = run('docker', [
    'run', '--rm', '--user', '0', '--entrypoint', 'find', image,
    ...roots, '-mindepth', '1', '-print',
  ]);
  const paths = output.split(/\r?\n/).filter(Boolean);
  const endpointFiles = JSON.parse(run('docker', [
    'run', '--rm', '--entrypoint', 'node', image, '-e',
    CLOUD_RUNTIME_ENDPOINT_DISCOVERY_SCRIPT,
    ...roots,
  ]));
  const packagedContentProof = JSON.parse(run('docker', [
    'run', '--rm', '--entrypoint', 'node', image, '-e',
    [
      'const crypto=require("crypto"),fs=require("fs");',
      'const manifestPath="/opt/cindy/resources/cloud-runtime-packaged-content-manifest.json";',
      'const asarPath="/opt/cindy/resources/app.asar";',
      'const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));',
      'const actualSha256="sha256:"+crypto.createHash("sha256").update(fs.readFileSync(asarPath)).digest("hex");',
      'process.stdout.write(JSON.stringify({manifest,actualSha256}));',
    ].join(''),
  ]));
  const errors = [
    ...validateCloudRuntimeInspect(inspect),
    ...validateCloudRuntimePaths(paths),
    ...validateCloudRuntimeEndpointConfigs(endpointFiles),
    ...validatePackagedContentProof(packagedContentProof),
  ];
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log(`[cloud-runtime-content] ${image}: ${paths.length} paths checked, no prohibited build/user/credential material`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[cloud-runtime-content] ${error.message ?? String(error)}`);
    process.exit(1);
  }
}

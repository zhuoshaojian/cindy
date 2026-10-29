#!/usr/bin/env node
// Sign an already isolated Cloud Dev staging bundle with one persistent local
// certificate. Never change the user's safeStorage identity or credential ACL.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (
    !['--app', '--keychain', '--identity'].includes(key) ||
    !process.argv[i + 1] ||
    flags.has(key)
  )
    throw new Error(
      'Usage: sign-cloud-dev-local.mjs --app <staging.app> --keychain <keychain> --identity <certificate SHA-1>',
    );
  flags.set(key, process.argv[i + 1]);
}
const app = flags.get('--app');
const keychain = flags.get('--keychain');
const identity = flags.get('--identity');
if (!app || !keychain || !/^[a-f0-9]{40}$/i.test(identity ?? ''))
  throw new Error(
    'A staging app, existing keychain and fixed certificate SHA-1 are required; no ad-hoc fallback',
  );
const root = fs.realpathSync(app);
if (
  root.startsWith('/Applications/') ||
  root.startsWith(path.join(process.env.HOME, 'Applications') + path.sep)
)
  throw new Error('Sign a staging copy, never an installed application');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${path.basename(command)} failed: ${result.stderr || result.stdout}`);
  return `${result.stdout}\n${result.stderr}`;
}
const plist = path.join(root, 'Contents/Info.plist');
const bundleId = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]).trim();
const distribution = JSON.parse(
  fs.readFileSync(path.join(root, 'Contents/Resources/cloud-pilot-distribution.json'), 'utf8'),
);
if (bundleId !== 'com.xd.cindycn.clouddev' || distribution.profile !== 'CindyCloudDev-cn')
  throw new Error('Only the isolated Cloud Dev CN distribution can use this signer');

const signArgs = [
  '--force',
  '--timestamp=none',
  '--keychain',
  keychain,
  '--sign',
  identity,
  '--preserve-metadata=identifier,entitlements,flags',
];
const magic = new Set([
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca',
]);
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? [...walk(target), target] : [target];
  });
}
let binaries = 0;
for (const relative of ['Resources/app.asar.unpacked', 'Resources/tools', 'Frameworks']) {
  const entries = walk(path.join(root, 'Contents', relative));
  for (const entry of entries) {
    if (!fs.statSync(entry).isFile()) continue;
    const fd = fs.openSync(entry, 'r');
    const header = Buffer.alloc(4);
    try {
      fs.readSync(fd, header, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (magic.has(header.toString('hex'))) {
      run('/usr/bin/codesign', [...signArgs, entry]);
      binaries++;
    }
  }
  // walk is post-order: nested bundles must be sealed before their parents.
  for (const entry of entries)
    if (fs.statSync(entry).isDirectory() && /\.(app|framework)$/.test(entry))
      run('/usr/bin/codesign', [...signArgs, entry]);
}
run('/usr/bin/codesign', [...signArgs, root]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', root]);
const requirement = run('/usr/bin/codesign', ['-dr', '-', root])
  .split('\n')
  .find((line) => line.includes('designated =>'));
if (
  !requirement?.includes(`identifier "${bundleId}"`) ||
  !requirement.toLowerCase().includes(identity.toLowerCase()) ||
  requirement.includes('cdhash')
)
  throw new Error('The bundle requirement must bind its identifier to the persistent certificate');
console.log(JSON.stringify({ bundleId, binaries, requirement, notarized: false }));

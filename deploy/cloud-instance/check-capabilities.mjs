#!/usr/bin/env node
import fs from 'node:fs';

const machine = process.env.CINDY_CLOUD_ARCH ?? process.arch;
const arch = machine === 'x86_64' || machine === 'amd64' ? 'x64'
  : machine === 'aarch64' || machine === 'arm64' ? 'arm64'
  : machine;

if (process.platform !== 'linux' && !process.env.CINDY_CLOUD_ARCH) {
  console.error(`[cloud-capability] unsupported host platform: ${process.platform}`);
  process.exit(78);
}
if (arch === 'arm64') {
  console.error(
    '[cloud-capability] linux-arm64 is blocked: pinned agent binaries and sqlite-vec are unavailable; QEMU fallback is forbidden',
  );
  process.exit(78);
}
if (arch !== 'x64') {
  console.error(`[cloud-capability] unsupported Linux architecture: ${arch}`);
  process.exit(78);
}

const root = process.env.CINDY_WORKSPACE_ROOT ?? '/workspace';
const packagedResources = process.env.CINDY_CLOUD_PACKAGED_RESOURCES ?? '/opt/cindy/resources';
const firstExisting = (candidates) => candidates.find((candidate) => fs.existsSync(candidate))
  ?? candidates[0];
const assets = [
  firstExisting([`${root}/apps/claude-code-bin/linux-x64/claude`]),
  firstExisting([`${root}/apps/codex-bin/linux-x64/codex`]),
  firstExisting([
    `${packagedResources}/tools/ripgrep/rg`,
    `${root}/apps/ripgrep-bin/linux-x64/rg`,
  ]),
  firstExisting([
    `${packagedResources}/app.asar.unpacked/native/sqlite-vec/linux-x64/vec0.so`,
    `${root}/apps/desktop/native/sqlite-vec/linux-x64/vec0.so`,
  ]),
];
const missing = assets.filter((filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return !stat.isFile() || stat.size < 1024 || (filePath.endsWith('/vec0.so')
      ? false
      : (stat.mode & 0o111) === 0);
  } catch {
    return true;
  }
});
if (missing.length > 0) {
  console.error(`[cloud-capability] missing or invalid native assets: ${missing.join(', ')}`);
  process.exit(78);
}
console.log(
  `[cloud-capability] linux-x64 native assets present; no emulation enabled; sources=${assets.join(',')}`,
);

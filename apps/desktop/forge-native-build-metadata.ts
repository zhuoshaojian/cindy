import fs from 'node:fs';
import path from 'node:path';

/**
 * node-gyp rebuilds leave host-specific Makefiles in the copied runtime
 * packages. They are not runtime inputs, but they embed the builder's home,
 * checkout, npm config, and Electron headers as absolute paths. Keep the
 * rebuilt native binaries and helpers; remove only the generated text
 * metadata before asar packaging.
 */
export const NATIVE_BUILD_METADATA_RELATIVE_PATHS = Object.freeze([
  path.join('better-sqlite3', 'build', 'Makefile'),
  path.join('better-sqlite3', 'build', 'better_sqlite3.target.mk'),
  path.join('better-sqlite3', 'build', 'config.gypi'),
  path.join('better-sqlite3', 'build', 'deps', 'sqlite3.target.mk'),
  path.join('better-sqlite3', 'build', 'test_extension.target.mk'),
  path.join('node-pty', 'build', 'Makefile'),
  path.join('node-pty', 'build', 'config.gypi'),
  path.join('node-pty', 'build', 'pty.target.mk'),
  path.join('node-pty', 'build', 'spawn-helper.target.mk'),
  path.join('node-pty', 'node-addon-api', 'node_addon_api.target.mk'),
  path.join('node-pty', 'node-addon-api', 'node_addon_api_except.target.mk'),
  path.join('node-pty', 'node-addon-api', 'node_addon_api_maybe.target.mk'),
]);

export function pruneNativeBuildMetadata(buildPath: string): string[] {
  const modulesDir = path.join(buildPath, 'node_modules');
  const removed: string[] = [];
  for (const relativePath of NATIVE_BUILD_METADATA_RELATIVE_PATHS) {
    const target = path.join(modulesDir, relativePath);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { force: true });
    removed.push(relativePath);
  }
  return removed;
}

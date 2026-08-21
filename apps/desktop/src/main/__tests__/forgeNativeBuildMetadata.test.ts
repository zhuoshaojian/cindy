import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  NATIVE_BUILD_METADATA_DIRECTORY_RELATIVE_PATHS,
  NATIVE_BUILD_METADATA_RELATIVE_PATHS,
  pruneNativeBuildMetadata,
} from '../../../forge-native-build-metadata';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('pruneNativeBuildMetadata', () => {
  it('removes builder-path metadata without deleting native runtime files', () => {
    const buildPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-native-metadata-'));
    tempDirs.push(buildPath);
    const modulesDir = path.join(buildPath, 'node_modules');

    for (const relativePath of NATIVE_BUILD_METADATA_RELATIVE_PATHS) {
      const target = path.join(modulesDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '/Users/builder/private/checkout\n');
    }
    for (const relativePath of NATIVE_BUILD_METADATA_DIRECTORY_RELATIVE_PATHS) {
      const target = path.join(relativePath, 'obj.target', 'native.o.d');
      fs.mkdirSync(path.dirname(path.join(modulesDir, target)), { recursive: true });
      fs.writeFileSync(path.join(modulesDir, target), '/Users/builder/private/checkout\n');
    }

    const runtimeFiles = [
      path.join('better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
      path.join('node-pty', 'build', 'Release', 'pty.node'),
      path.join('node-pty', 'build', 'Release', 'spawn-helper'),
    ];
    for (const relativePath of runtimeFiles) {
      const target = path.join(modulesDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'runtime');
    }

    expect(pruneNativeBuildMetadata(buildPath)).toEqual([
      ...NATIVE_BUILD_METADATA_RELATIVE_PATHS,
      ...NATIVE_BUILD_METADATA_DIRECTORY_RELATIVE_PATHS,
    ]);
    for (const relativePath of NATIVE_BUILD_METADATA_RELATIVE_PATHS) {
      expect(fs.existsSync(path.join(modulesDir, relativePath))).toBe(false);
    }
    for (const relativePath of NATIVE_BUILD_METADATA_DIRECTORY_RELATIVE_PATHS) {
      expect(fs.existsSync(path.join(modulesDir, relativePath))).toBe(false);
    }
    for (const relativePath of runtimeFiles) {
      expect(fs.readFileSync(path.join(modulesDir, relativePath), 'utf8')).toBe('runtime');
    }
  });
});

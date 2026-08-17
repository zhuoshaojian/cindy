import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stagePackagedDevKeychainIdentity } from '../../../forge-packaged-keychain-identity';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function stagePackage(productName = 'Cindy'): string {
  const buildPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-packaged-keychain-'));
  tempDirs.push(buildPath);
  fs.writeFileSync(
    path.join(buildPath, 'package.json'),
    `${JSON.stringify({ name: 'desktop', productName, version: '0.0.0' }, null, 2)}\n`,
  );
  return buildPath;
}

describe('stagePackagedDevKeychainIdentity', () => {
  it('sets the staged macOS dev productName before asar packaging', () => {
    const buildPath = stagePackage();

    expect(stagePackagedDevKeychainIdentity({ buildPath, platform: 'darwin', region: 'dev' })).toBe(
      path.join(buildPath, 'package.json'),
    );
    expect(JSON.parse(fs.readFileSync(path.join(buildPath, 'package.json'), 'utf8'))).toEqual({
      name: 'desktop',
      productName: 'CindyDev',
      version: '0.0.0',
    });
  });

  it.each([
    { platform: 'darwin', region: 'cn' as const },
    { platform: 'darwin', region: 'global' as const },
    { platform: 'win32', region: 'dev' as const },
  ])('leaves non-dev-mac packages unchanged: $platform/$region', ({ platform, region }) => {
    const buildPath = stagePackage();
    const packageJsonPath = path.join(buildPath, 'package.json');
    const before = fs.readFileSync(packageJsonPath, 'utf8');

    expect(stagePackagedDevKeychainIdentity({ buildPath, platform, region })).toBeNull();
    expect(fs.readFileSync(packageJsonPath, 'utf8')).toBe(before);
  });
});

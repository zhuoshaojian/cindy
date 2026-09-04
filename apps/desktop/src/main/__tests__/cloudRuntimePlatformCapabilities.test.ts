import { describe, expect, it } from 'vitest';
import {
  evaluateCloudPlatformCapability,
  type CloudRuntimeAssetPaths,
} from '../cloud-runtime/platform-capabilities.js';

const assets: CloudRuntimeAssetPaths = {
  claude: '/runtime/claude',
  codex: '/runtime/codex',
  ripgrep: '/runtime/rg',
  sqliteVec: '/runtime/vec0.so',
};

describe('cloud runtime platform capability', () => {
  it('accepts native linux-x64 only when every required asset is valid', () => {
    expect(
      evaluateCloudPlatformCapability('x64', assets, {
        exists: () => true,
        isExecutable: () => true,
      }),
    ).toEqual({
      platform: 'linux',
      arch: 'x64',
      supported: true,
      missingAssets: [],
      blockers: [],
    });
  });

  it('fails closed for missing x64 assets and all arm64 builds without QEMU fallback', () => {
    expect(
      evaluateCloudPlatformCapability('x64', assets, {
        exists: (filePath) => !filePath.endsWith('/codex'),
        isExecutable: () => true,
      }),
    ).toMatchObject({
      supported: false,
      missingAssets: ['codex'],
    });
    expect(
      evaluateCloudPlatformCapability('arm64', assets, {
        exists: () => true,
        isExecutable: () => true,
      }),
    ).toMatchObject({
      supported: false,
      blockers: ['linux-arm64 agent binary pins and sqlite-vec native asset are not yet available'],
    });
  });
});

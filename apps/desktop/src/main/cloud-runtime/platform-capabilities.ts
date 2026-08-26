export type CloudLinuxArch = 'x64' | 'arm64';

export interface CloudRuntimeAssetPaths {
  claude: string;
  codex: string;
  ripgrep: string;
  sqliteVec: string;
}

export interface CloudPlatformCapability {
  platform: 'linux';
  arch: CloudLinuxArch;
  supported: boolean;
  missingAssets: Array<keyof CloudRuntimeAssetPaths>;
  blockers: string[];
}

export interface CloudPlatformCapabilityDeps {
  exists(filePath: string): boolean;
  isExecutable(filePath: string): boolean;
}

/**
 * Current container capability gate. x64 may proceed only with all managed
 * assets present; arm64 is explicitly blocked until pinned downloads and
 * sqlite-vec are supplied natively. QEMU/emulation is never accepted.
 */
export function evaluateCloudPlatformCapability(
  arch: CloudLinuxArch,
  assets: CloudRuntimeAssetPaths,
  deps: CloudPlatformCapabilityDeps,
): CloudPlatformCapability {
  const missingAssets = (Object.entries(assets) as Array<[keyof CloudRuntimeAssetPaths, string]>)
    .filter(([kind, filePath]) => {
      if (!deps.exists(filePath)) return true;
      return kind !== 'sqliteVec' && !deps.isExecutable(filePath);
    })
    .map(([kind]) => kind);
  const blockers: string[] = [];
  if (arch === 'arm64') {
    blockers.push(
      'linux-arm64 agent binary pins and sqlite-vec native asset are not yet available',
    );
  }
  if (missingAssets.length > 0) {
    blockers.push(`missing or invalid runtime assets: ${missingAssets.join(', ')}`);
  }
  return {
    platform: 'linux',
    arch,
    supported: arch === 'x64' && blockers.length === 0,
    missingAssets,
    blockers,
  };
}

import fs from 'node:fs';
import path from 'node:path';

import { BRAND_IDENTITY, type CindyRegion } from '@cindy/maker-shared/brand-identity';

type StagedPackageJson = Record<string, unknown> & {
  productName?: unknown;
};

/**
 * Pin the macOS safeStorage identity before Electron starts.
 *
 * Electron may consult safeStorage before the main entry can call app.setName(),
 * so packaged dev must carry CindyDev as app.asar/package.json productName. The
 * postPackage Info.plist hook still restores the user-facing display name to
 * Cindy; this staging-only rewrite changes the runtime identity, not the label.
 */
export function stagePackagedDevKeychainIdentity(input: {
  buildPath: string;
  platform: string;
  region: CindyRegion;
}): string | null {
  if (input.platform !== 'darwin' || input.region !== 'dev') return null;

  const packageJsonPath = path.join(input.buildPath, 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as StagedPackageJson;
  parsed.productName = BRAND_IDENTITY.executableNameByRegion.dev;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return packageJsonPath;
}

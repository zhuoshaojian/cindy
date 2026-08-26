/**
 * packagedDevKeychainName — packaged dev 构建的 macOS safeStorage 身份。
 *
 * Electron 用 `app.name` 派生钥匙串 service（`<app.name> Safe Storage`）。dev 包
 * 虽然已有独立的 bundle id、可执行名与默认 userData 目录，但 app.asar 内的
 * productName 仍是面向用户展示的 `Cindy`；若不在 main 最早期改名，它会申请正式版
 * 的 `Cindy Safe Storage`。这里只给 packaged dev 选择 `CindyDev`，cn/global 与
 * 未打包开发实例继续走各自既有语义。
 */

import { BRAND_IDENTITY, type CindyRegion } from '@cindy/maker-shared/brand-identity';

export function resolvePackagedDevKeychainAppName(input: {
  isPackaged: boolean;
  region: CindyRegion;
  platform: NodeJS.Platform;
}): string | null {
  if (!input.isPackaged || input.region !== 'dev' || input.platform !== 'darwin') return null;
  return BRAND_IDENTITY.executableNameByRegion.dev;
}

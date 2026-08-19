import type { CindyRegion } from '@cindy/maker-shared/brand-identity';

export interface AccessibilitySupportApp {
  readonly isPackaged: boolean;
  setAccessibilitySupportEnabled(enabled: boolean): void;
}

export interface AccessibilitySupportInput {
  app: AccessibilitySupportApp;
  platform: NodeJS.Platform;
  region: CindyRegion;
}

/**
 * Force Chromium's renderer accessibility tree only for internal Desktop builds.
 *
 * Exposing the tree lets every process that already holds the OS Accessibility permission read
 * renderer text, including conversation content, and keeping the tree alive has a performance
 * cost. Packaged `cn` / `global` therefore deliberately leave Electron's default untouched;
 * enabling this for a public build requires an explicit product-owner and security/privacy review.
 *
 * Do not "balance" this with `setAccessibilitySupportEnabled(false)` in production. Electron
 * automatically enables accessibility when VoiceOver / JAWS or another assistive technology is
 * present, and system assistive utilities take priority over the manual setting. Not calling the
 * API preserves that accessibility path while internal builds opt into an always-available AX tree.
 */
export function enableInternalBuildAccessibilitySupport(input: AccessibilitySupportInput): boolean {
  // Electron 41 documents this API for macOS and Windows only.
  if (input.platform !== 'darwin' && input.platform !== 'win32') return false;
  if (input.app.isPackaged && input.region !== 'dev') return false;

  input.app.setAccessibilitySupportEnabled(true);
  return true;
}

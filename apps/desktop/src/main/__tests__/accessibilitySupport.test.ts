import { describe, expect, it, vi } from 'vitest';

import { enableInternalBuildAccessibilitySupport } from '../accessibilitySupport.js';

function app(isPackaged: boolean) {
  return {
    isPackaged,
    setAccessibilitySupportEnabled: vi.fn(),
  };
}

describe('enableInternalBuildAccessibilitySupport', () => {
  it.each([
    { label: 'packaged dev on macOS', isPackaged: true, region: 'dev', platform: 'darwin' },
    { label: 'packaged dev on Windows', isPackaged: true, region: 'dev', platform: 'win32' },
    {
      label: 'local unpackaged development',
      isPackaged: false,
      region: 'global',
      platform: 'darwin',
    },
  ] as const)('enables the AX tree for $label', ({ isPackaged, region, platform }) => {
    const electronApp = app(isPackaged);

    expect(enableInternalBuildAccessibilitySupport({ app: electronApp, region, platform })).toBe(
      true,
    );
    expect(electronApp.setAccessibilitySupportEnabled).toHaveBeenCalledOnce();
    expect(electronApp.setAccessibilitySupportEnabled).toHaveBeenCalledWith(true);
  });

  it.each([
    { label: 'packaged Global', region: 'global' },
    { label: 'packaged Mainland China', region: 'cn' },
  ] as const)('does not override Electron accessibility for $label', ({ region }) => {
    const electronApp = app(true);

    expect(
      enableInternalBuildAccessibilitySupport({
        app: electronApp,
        region,
        platform: 'darwin',
      }),
    ).toBe(false);
    expect(electronApp.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });

  it('does not call the macOS/Windows-only API on Linux', () => {
    const electronApp = app(true);

    expect(
      enableInternalBuildAccessibilitySupport({
        app: electronApp,
        region: 'dev',
        platform: 'linux',
      }),
    ).toBe(false);
    expect(electronApp.setAccessibilitySupportEnabled).not.toHaveBeenCalled();
  });
});

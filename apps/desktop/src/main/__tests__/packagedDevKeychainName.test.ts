import { describe, expect, it } from 'vitest';
import { resolvePackagedDevKeychainAppName } from '../packagedDevKeychainName';

describe('resolvePackagedDevKeychainAppName', () => {
  it('isolates packaged dev safeStorage from the formal Cindy keychain item', () => {
    expect(
      resolvePackagedDevKeychainAppName({
        isPackaged: true,
        region: 'dev',
        platform: 'darwin',
      }),
    ).toBe('CindyDev');
  });

  it('does not change release, unpackaged, or non-macOS identities', () => {
    expect(
      resolvePackagedDevKeychainAppName({
        isPackaged: true,
        region: 'cn',
        platform: 'darwin',
      }),
    ).toBeNull();
    expect(
      resolvePackagedDevKeychainAppName({
        isPackaged: true,
        region: 'global',
        platform: 'darwin',
      }),
    ).toBeNull();
    expect(
      resolvePackagedDevKeychainAppName({
        isPackaged: false,
        region: 'dev',
        platform: 'darwin',
      }),
    ).toBeNull();
    expect(
      resolvePackagedDevKeychainAppName({
        isPackaged: true,
        region: 'dev',
        platform: 'win32',
      }),
    ).toBeNull();
  });
});

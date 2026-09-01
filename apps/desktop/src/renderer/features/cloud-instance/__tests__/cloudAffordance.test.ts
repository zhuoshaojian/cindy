import { describe, expect, it } from 'vitest';

import { resolveCloudAffordance } from '../cloudAffordance';

describe('resolveCloudAffordance', () => {
  it('returns login when there is no cloud instance', () => {
    expect(resolveCloudAffordance({ hasInstance: false, online: false })).toBe('login');
  });

  it('returns login when the instance requires browser login', () => {
    expect(resolveCloudAffordance({
      hasInstance: true,
      online: false,
      status: { loginRequired: true },
    })).toBe('login');
  });

  it('returns open when the instance is online', () => {
    expect(resolveCloudAffordance({ hasInstance: true, online: true })).toBe('open');
  });

  it('returns wake when an existing instance is offline', () => {
    expect(resolveCloudAffordance({ hasInstance: true, online: false })).toBe('wake');
  });
});

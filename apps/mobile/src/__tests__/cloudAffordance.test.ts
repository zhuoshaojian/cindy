import { describe, expect, it } from 'vitest';

import { parseCloudOnlineRouteParam, resolveCloudAffordance } from '@/cloud-instance/cloudAffordance';

describe('resolveCloudAffordance', () => {
  it('returns login for zero instances', () => {
    expect(resolveCloudAffordance({ hasInstance: false, online: false })).toBe('login');
  });

  it('returns login when login is required', () => {
    expect(
      resolveCloudAffordance({
        hasInstance: true,
        online: false,
        loginRequired: true,
      }),
    ).toBe('login');
  });

  it('returns open for online instances', () => {
    expect(resolveCloudAffordance({ hasInstance: true, online: true })).toBe('open');
  });

  it('returns wake for offline instances', () => {
    expect(resolveCloudAffordance({ hasInstance: true, online: false })).toBe('wake');
  });

  it('uses the route presence snapshot as the initial online input', () => {
    expect(parseCloudOnlineRouteParam('1')).toBe(true);
    expect(parseCloudOnlineRouteParam('0')).toBe(false);
    expect(resolveCloudAffordance({ hasInstance: true, online: parseCloudOnlineRouteParam('1') })).toBe('open');
    expect(resolveCloudAffordance({ hasInstance: true, online: parseCloudOnlineRouteParam('0') })).toBe('wake');
  });
});

import { describe, expect, it } from 'vitest';

import { buildRemoteProjectPickerOptions } from '../useProjectPickerOptions';
import type { Session } from '@/lib/ccAgent.types';

function session(
  id: string,
  workingDir: string | null,
  updatedAt: string,
  overrides: Partial<Session> = {},
): Session {
  return {
    id,
    title: id,
    status: 'active',
    workspaceKind: 'project',
    workingDir,
    updatedAt,
    createdAt: updatedAt,
    deviceLinkDeviceId: 'cloud-device',
    ...overrides,
  } as Session;
}

describe('buildRemoteProjectPickerOptions', () => {
  it('按设备过滤、目录去重并按最近活动倒序', () => {
    const result = buildRemoteProjectPickerOptions([
      session('old-a', '/srv/a', '2026-07-25T00:00:00.000Z'),
      session('new-a', '/srv/a', '2026-07-27T00:00:00.000Z'),
      session('b', '/srv/b', '2026-07-26T00:00:00.000Z'),
      session('other-device', '/srv/other', '2026-07-28T00:00:00.000Z', {
        deviceLinkDeviceId: 'other',
      }),
      session('dialogue', null, '2026-07-29T00:00:00.000Z', {
        workspaceKind: 'dialogue',
      }),
      session('deleted', '/srv/deleted', '2026-07-30T00:00:00.000Z', {
        status: 'deleted',
      }),
    ], 'cloud-device');

    expect(result.map((option) => option.path)).toEqual(['/srv/a', '/srv/b']);
    expect(result[0]).toMatchObject({ name: 'a', description: '/srv/a' });
  });
});

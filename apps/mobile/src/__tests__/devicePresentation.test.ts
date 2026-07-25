import { describe, expect, it } from 'vitest';

import { resolveMobileDeviceDisplayName, sortCloudDevicesLast } from '@/device-link/devicePresentation';
import { formatCloudDeviceName } from '@cindy/maker-shared/device-list';

const cloud = {
  busy: false,
  deviceId: 'pod-1',
  deviceInfo: { kind: 'cloud' as const },
  isSelf: false,
  lastSeenAt: null,
  name: 'Cloud',
  online: true,
  platform: 'linux',
  remoteControlEnabled: true,
  selfName: 'Cloud',
};

describe('mobile cloud device presentation', () => {
  it.each([
    ['zh-CN', '云端'],
    ['en-US', 'Cloud'],
    ['ja-JP', 'クラウド'],
    ['ko-KR', '클라우드'],
  ])('localizes the cloud self-name for %s viewers', (languageCode, expected) => {
    expect(resolveMobileDeviceDisplayName(cloud, languageCode)).toBe(expected);
  });

  it('keeps a manually renamed cloud device unchanged', () => {
    expect(resolveMobileDeviceDisplayName({ ...cloud, name: '工作 Pod' }, 'zh-CN')).toBe('工作 Pod');
  });

  it.each([
    ['zh-CN', '云端'],
    ['en-US', 'Cloud'],
    ['ja-JP', 'クラウド'],
    ['ko-KR', '클라우드'],
  ])('ignores a cloud ordinal when localizing for %s viewers', (languageCode, expected) => {
    const name = formatCloudDeviceName(3);
    expect(resolveMobileDeviceDisplayName({ ...cloud, name, selfName: name }, languageCode)).toBe(expected);
  });

  it('keeps ordinary devices unchanged', () => {
    expect(resolveMobileDeviceDisplayName({ ...cloud, deviceInfo: null, name: '办公室 Mac' })).toBe('办公室 Mac');
  });

  it('places cloud devices after ordinary devices without reordering either group', () => {
    const devices = [
      { deviceId: 'desktop-2' },
      { deviceId: 'pod-1', kind: 'cloud' as const },
      { deviceId: 'desktop-1' },
      { deviceId: 'pod-2', kind: 'cloud' as const },
    ];
    expect(sortCloudDevicesLast(devices).map((device) => device.deviceId)).toEqual([
      'desktop-2',
      'desktop-1',
      'pod-1',
      'pod-2',
    ]);
  });
});

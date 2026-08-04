import { describe, expect, it } from 'vitest';

import {
  buildDraftPillDevices,
  getSingleSelectedCloudInstance,
} from '../cloudDraftTarget';
import type { CloudInstanceView } from '../useCloudInstances';
import { MACHINE_ALL, MACHINE_LOCAL } from '@/features/device-link/selectedMachineStore';

function instance(
  instanceId: string,
  deviceId: string,
  status: Partial<CloudInstanceView['status']> = {},
): CloudInstanceView {
  return {
    instanceId,
    deviceId,
    nameSequence: 1,
    customLabel: null,
    status: status as CloudInstanceView['status'],
  } as CloudInstanceView;
}

describe('cloudDraftTarget', () => {
  const cloudA = instance('instance-a', 'device-a');
  const cloudB = instance('instance-b', 'device-b');

  it('机器过滤只在单选云端设备时提供隐式目标', () => {
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], ['device-b'])).toBe(cloudB);
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], MACHINE_ALL)).toBeNull();
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], [MACHINE_LOCAL])).toBeNull();
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], ['device-a', 'device-b'])).toBeNull();
  });
});

describe('buildDraftPillDevices(设备 pill 云端行以控制面为唯一数据源)', () => {
  const cloudName = () => '云端';
  const plain = { deviceId: 'mac', name: 'Mac', platform: 'darwin', online: true };

  it('relay 的 cloud 项被排除,云端行来自控制面实例并翻译命名', () => {
    const ghost = {
      deviceId: 'device-ghost',
      name: '__cindy_cloud_device_name__:5',
      platform: null,
      online: false,
      kind: 'cloud' as const,
    };
    const live = instance('instance-a', 'device-a');
    const out = buildDraftPillDevices([plain, ghost], [live], new Set(['device-a']), cloudName);
    expect(out).toEqual([
      plain,
      {
        deviceId: 'device-a',
        name: '云端',
        platform: null,
        online: true,
        kind: 'cloud',
        cloudInstanceId: 'instance-a',
        updateAvailable: false,
      },
    ]);
  });

  it('relay 漏报 kind 时按控制面 deviceId 兜底去重,不出双行', () => {
    const relayNoKind = {
      deviceId: 'device-a',
      name: '__cindy_cloud_device_name__:3',
      platform: null,
      online: true,
    };
    const out = buildDraftPillDevices([relayNoKind], [instance('instance-a', 'device-a')], new Set(), cloudName);
    expect(out).toEqual([
      {
        deviceId: 'device-a',
        name: '云端',
        platform: null,
        online: false,
        kind: 'cloud',
        cloudInstanceId: 'instance-a',
        updateAvailable: false,
      },
    ]);
  });

  it('离线实例保留并携带唤醒所需 instanceId,0 实例时只剩普通设备', () => {
    const out = buildDraftPillDevices([plain], [instance('instance-a', 'device-a')], new Set(), cloudName);
    expect(out[1]).toMatchObject({
      deviceId: 'device-a',
      online: false,
      cloudInstanceId: 'instance-a',
    });
    expect(buildDraftPillDevices([plain], [], new Set(), cloudName)).toEqual([plain]);
  });

  it('只把非验证中的正式版更新投影到设备 pill', () => {
    const available = instance('instance-a', 'device-a', { updateAvailable: true });
    const verifying = instance('instance-b', 'device-b', {
      updateAvailable: true,
      upgrade: { state: 'verifying' } as CloudInstanceView['status']['upgrade'],
    });

    const out = buildDraftPillDevices([], [available, verifying], new Set(), cloudName);

    expect(out.map((device) => device.kind === 'cloud' && device.updateAvailable)).toEqual([
      true,
      false,
    ]);
  });
});

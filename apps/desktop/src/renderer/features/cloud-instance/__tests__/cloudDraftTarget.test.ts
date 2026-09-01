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
  const cloudA = instance('instance-a', 'cloud-device-a');
  const cloudB = instance('instance-b', 'cloud-device-b');

  it('机器过滤只在单选云端设备时提供隐式目标', () => {
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], ['cloud-device-b'])).toBe(cloudB);
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], MACHINE_ALL)).toBeNull();
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], [MACHINE_LOCAL])).toBeNull();
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], ['cloud-device-a', 'cloud-device-b'])).toBeNull();
  });
});

describe('buildDraftPillDevices(设备 pill 云端行以控制面为唯一数据源)', () => {
  const cloudName = () => '云端';
  const plain = { deviceId: 'mac', name: 'Mac', platform: 'darwin', online: true };

  it('relay 的 cloud 项被排除,云端行来自控制面实例并翻译命名', () => {
    const ghost = {
      deviceId: 'cloud-device-ghost',
      name: '__cindy_cloud_device_name__:5',
      platform: null,
      online: false,
    };
    const live = instance('instance-a', 'cloud-device-a');
    const out = buildDraftPillDevices([plain, ghost], [live], new Set(['cloud-device-a']), cloudName);
    expect(out).toEqual([
      plain,
      {
        deviceId: 'cloud-device-a',
        name: '云端',
        platform: null,
        online: true,
        cloudInstanceId: 'instance-a',
        updateAvailable: false,
        modelAccessStale: false,
      },
    ]);
  });

  it('控制面 deviceId 命中的 relay 行不出双行', () => {
    const relayNoKind = {
      deviceId: 'legacy-cloud-device-a',
      name: '__cindy_cloud_device_name__:3',
      platform: null,
      online: true,
    };
    const out = buildDraftPillDevices(
      [relayNoKind],
      [instance('instance-a', 'legacy-cloud-device-a')],
      new Set(),
      cloudName,
    );
    expect(out).toEqual([
      {
        deviceId: 'legacy-cloud-device-a',
        name: '云端',
        platform: null,
        online: false,
        cloudInstanceId: 'instance-a',
        updateAvailable: false,
        modelAccessStale: false,
      },
    ]);
  });

  it('离线实例保留并携带唤醒所需 instanceId,0 实例时只剩普通设备', () => {
    const out = buildDraftPillDevices([plain], [instance('instance-a', 'cloud-device-a')], new Set(), cloudName);
    expect(out[1]).toMatchObject({
      deviceId: 'cloud-device-a',
      online: false,
      cloudInstanceId: 'instance-a',
    });
    expect(buildDraftPillDevices([plain], [], new Set(), cloudName)).toEqual([plain]);
  });

  /**
   * 「能连上」与「能跑模型」是两件事:modelAccess 不参与就绪判定,实例确实是 ready,
   * 所以创建入口必须自己带上这个提示,否则用户要到 agent 跑不动时才发现。
   * `unknown` 是「还不知道」(刚启动/尚未探测),不能拿来打扰用户。
   */
  it.each([
    ['not-ready', true],
    ['unknown', false],
    ['ready', false],
    [undefined, false],
  ] as const)('把 readiness.modelAccess=%s 投影成 modelAccessStale=%s', (modelAccess, expected) => {
    const readiness = { ready: true, reason: 'ready', blockers: [], modelAccess };
    const out = buildDraftPillDevices(
      [],
      [instance('instance-a', 'cloud-device-a', { readiness } as Partial<CloudInstanceView['status']>)],
      new Set(['cloud-device-a']),
      cloudName,
    );

    expect(out[0].modelAccessStale).toBe(expected);
  });

  it('只把非验证中的正式版更新投影到设备 pill', () => {
    const available = instance('instance-a', 'cloud-device-a', { updateAvailable: true });
    const verifying = instance('instance-b', 'cloud-device-b', {
      updateAvailable: true,
      upgrade: { state: 'verifying' } as CloudInstanceView['status']['upgrade'],
    });

    const out = buildDraftPillDevices([], [available, verifying], new Set(), cloudName);

    expect(out.map((device) => device.updateAvailable)).toEqual([true, false]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  deriveCloudDraftToggleState,
  getSingleSelectedCloudInstance,
  resolveCloudDraftInstance,
} from '../cloudDraftTarget';
import type { CloudInstanceView } from '../useCloudInstances';
import { MACHINE_ALL, MACHINE_LOCAL } from '@/features/device-link/selectedMachineStore';

function instance(instanceId: string, deviceId: string): CloudInstanceView {
  return {
    instanceId,
    deviceId,
    nameSequence: 1,
    customLabel: null,
    status: {} as CloudInstanceView['status'],
  } as CloudInstanceView;
}

describe('cloudDraftTarget', () => {
  const cloudA = instance('instance-a', 'device-a');
  const cloudB = instance('instance-b', 'device-b');

  it('只有控制面 ready 时显示；0 实例仍是可首次唤醒的 offline 态', () => {
    expect(
      deriveCloudDraftToggleState({
        loadState: 'unsupported',
        instance: null,
        draftDeviceId: null,
        onlineDeviceIds: new Set(),
        pending: null,
      }),
    ).toBe('hidden');
    expect(
      deriveCloudDraftToggleState({
        loadState: 'ready',
        instance: null,
        draftDeviceId: null,
        onlineDeviceIds: new Set(),
        pending: null,
      }),
    ).toBe('offline');
  });

  it('在线但草稿仍指向本机时为 local；点亮目标后为 online', () => {
    const base = {
      loadState: 'ready' as const,
      instance: cloudA,
      onlineDeviceIds: new Set(['device-a']),
      pending: null,
    };
    expect(deriveCloudDraftToggleState({ ...base, draftDeviceId: null })).toBe('local');
    expect(deriveCloudDraftToggleState({ ...base, draftDeviceId: 'device-a' })).toBe('online');
  });

  it('离线实例与唤醒 pending 分别映射 offline / waking', () => {
    expect(
      deriveCloudDraftToggleState({
        loadState: 'ready',
        instance: cloudA,
        draftDeviceId: null,
        onlineDeviceIds: new Set(),
        pending: null,
      }),
    ).toBe('offline');
    // 可用性与选中正交：即使草稿记着这台设备，presence 离线仍必须画 CloudOff，
    // 不能用“已选中”的高亮掩盖不可用状态。
    expect(
      deriveCloudDraftToggleState({
        loadState: 'ready',
        instance: cloudA,
        draftDeviceId: 'device-a',
        onlineDeviceIds: new Set(),
        pending: null,
      }),
    ).toBe('offline');
    expect(
      deriveCloudDraftToggleState({
        loadState: 'ready',
        instance: cloudA,
        draftDeviceId: null,
        onlineDeviceIds: new Set(),
        pending: { target: 'instance-a', action: 'wake' },
      }),
    ).toBe('waking');
  });

  it('wake 受理后到 presence 上线之间必须维持 waking，不回落 offline', () => {
    // wake IPC 返回后 pending 已清，但 Pod 启动要几十秒——这段空窗靠 wakingDeviceId
    // 维持 spinner/禁点，否则按钮会短暂回到 CloudOff 可点，诱导用户重复唤醒。
    expect(
      deriveCloudDraftToggleState({
        loadState: 'ready',
        instance: cloudA,
        draftDeviceId: null,
        onlineDeviceIds: new Set(),
        pending: null,
        wakingDeviceId: 'device-a',
      }),
    ).toBe('waking');
    // presence 上线后 waking 结束，回到正常在线判定。
    expect(
      deriveCloudDraftToggleState({
        loadState: 'ready',
        instance: cloudA,
        draftDeviceId: 'device-a',
        onlineDeviceIds: new Set(['device-a']),
        pending: null,
        wakingDeviceId: 'device-a',
      }),
    ).toBe('online');
  });

  it('机器过滤只在单选云端设备时提供隐式目标，草稿显式目标优先', () => {
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], ['device-b'])).toBe(cloudB);
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], MACHINE_ALL)).toBeNull();
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], [MACHINE_LOCAL])).toBeNull();
    expect(getSingleSelectedCloudInstance([cloudA, cloudB], ['device-a', 'device-b'])).toBeNull();
    expect(resolveCloudDraftInstance([cloudA, cloudB], 'device-a', ['device-b'])).toBe(cloudA);
  });
});

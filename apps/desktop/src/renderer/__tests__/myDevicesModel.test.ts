import { describe, expect, it } from 'vitest';

import {
  canBeControlledPlatform,
  controlToggleState,
  inboundToggleState,
  resolveHiddenRelayCloudDeviceDuringRebuild,
  resolveActiveConnectionIssue,
} from '@/components/settings/myDevicesModel';

describe('canBeControlledPlatform（手机不展示「我控制它」）', () => {
  it('桌面平台可被控制', () => {
    expect(canBeControlledPlatform('darwin')).toBe(true);
    expect(canBeControlledPlatform('win32')).toBe(true);
    expect(canBeControlledPlatform('linux')).toBe(true);
  });

  it('手机 / 平板不可被控制', () => {
    expect(canBeControlledPlatform('ios')).toBe(false);
    expect(canBeControlledPlatform('android')).toBe(false);
  });

  it('平台未知 / null(旧记录)按可被控处理(与切换栏 isMobilePlatform 同口径,避免「能连不能管」)', () => {
    expect(canBeControlledPlatform('unknown')).toBe(true);
    expect(canBeControlledPlatform(null)).toBe(true);
  });
});

describe('controlToggleState（我控制它,恒可编辑;对方已拒绝本机时整行不渲染、不走此函数）', () => {
  it('对方开了被控 → 可编辑,无原因', () => {
    expect(controlToggleState({ remoteControlEnabled: true, controlEnabled: true })).toEqual({
      checked: true,
      reason: null,
    });
  });

  it('对方未开启被控 → 仍可编辑(本地偏好独立于对方状态),reason=peer-off 作说明文字', () => {
    expect(controlToggleState({ remoteControlEnabled: false, controlEnabled: true })).toEqual({
      checked: true,
      reason: 'peer-off',
    });
  });

  it('对方未开启被控 + 本机已 opt-out → checked 反映 controlEnabled,reason=peer-off', () => {
    expect(controlToggleState({ remoteControlEnabled: false, controlEnabled: false })).toEqual({
      checked: false,
      reason: 'peer-off',
    });
  });
});

describe('inboundToggleState（允许它控制本机）', () => {
  it('总开关开 + 未拉黑 → 勾选、可切换', () => {
    expect(inboundToggleState(true, false)).toEqual({ checked: true, disabled: false });
  });

  it('总开关开 + 已拉黑 → 不勾选、可切换(可恢复)', () => {
    expect(inboundToggleState(true, true)).toEqual({ checked: false, disabled: false });
  });

  it('总开关关 → 置灰(黑名单值照旧反映)', () => {
    expect(inboundToggleState(false, false)).toEqual({ checked: true, disabled: true });
    expect(inboundToggleState(false, true)).toEqual({ checked: false, disabled: true });
  });
});

describe('resolveActiveConnectionIssue（本机卡片的原因行）', () => {
  it('普通 issue 在 online 后隐藏,unstable 即使 online 仍显示', () => {
    const authFailed = { kind: 'auth-failed' as const };
    const unstable = { kind: 'unstable' as const };
    expect(resolveActiveConnectionIssue('connecting', authFailed)).toBe(authFailed);
    expect(resolveActiveConnectionIssue('online', authFailed)).toBeNull();
    expect(resolveActiveConnectionIssue('online', unstable)).toBe(unstable);
  });
});

describe('resolveHiddenRelayCloudDeviceDuringRebuild（重建期间单卡）', () => {
  const oldInstance = { instanceId: 'instance-old', deviceId: 'device-old' };
  const replacement = { instanceId: 'instance-new', deviceId: 'device-new' };
  const rebuilding = { target: 'instance-old', action: 'rebuild' };

  it('隐藏按 oldInstanceId join 到的旧卡，并保留 replacement 卡', () => {
    expect(
      resolveHiddenRelayCloudDeviceDuringRebuild(
        ['device-old', 'device-new'],
        [oldInstance, replacement],
        rebuilding,
      ),
    ).toBe('device-old');
  });

  it('旧实例已离开控制面但旧 Pod 仍在 relay 时，出现 replacement 即隐藏 orphan 旧卡', () => {
    expect(
      resolveHiddenRelayCloudDeviceDuringRebuild(['device-old'], [replacement], rebuilding),
    ).toBe('device-old');
  });

  it('多实例下有多个 orphan 时不猜，不隐藏无关云端设备', () => {
    expect(
      resolveHiddenRelayCloudDeviceDuringRebuild(
        ['device-old', 'device-unrelated'],
        [replacement],
        rebuilding,
      ),
    ).toBeNull();
  });

  it('失败、300s 超时或 abort 清掉 pending 后立即恢复旧卡', () => {
    expect(
      resolveHiddenRelayCloudDeviceDuringRebuild(['device-old'], [replacement], null),
    ).toBeNull();
  });
});

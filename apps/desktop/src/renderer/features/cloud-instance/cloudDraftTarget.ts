/** New Maker 设备 pill 的云端数据投影。 */
import type { CloudInstanceView } from './useCloudInstances';
import { isCloudInstanceDeviceId } from '@cindy/maker-shared/device-list';
import { MACHINE_ALL, type MachineSelection } from '@/features/device-link/selectedMachineStore';
import type { SelectableDevice } from '@/hooks/useControllableDevices';

export type PlainPillDevice = SelectableDevice & {
  cloudInstanceId?: undefined;
  updateAvailable?: undefined;
  modelAccessStale?: undefined;
};

export type CloudPillDevice = SelectableDevice & {
  cloudInstanceId: string;
  updateAvailable: boolean;
  modelAccessStale: boolean;
};

/** 云端行以行为必需的 instanceId 判别，不再缓存另一份合成 tag。 */
export type DraftPillDevice = PlainPillDevice | CloudPillDevice;

export function isCloudPillDevice(device: DraftPillDevice): device is CloudPillDevice {
  return device.cloudInstanceId !== undefined;
}

/** 用户可见的正式版更新提示：升级验证期间不重复提示。 */
export function cloudInstanceHasAvailableUpdate(instance: CloudInstanceView): boolean {
  return instance.status.updateAvailable === true && instance.status.upgrade?.state !== 'verifying';
}

/**
 * 云端模型凭据不可用。放到创建入口是因为「能连上」与「能跑模型」是两件事:
 * modelAccess 不参与就绪判定(实例仍 ready),但用户如果在这里被邀请建任务,
 * 要到 agent 跑不动时才发现没有模型可用。`unknown` 不提示——那是「还不知道」。
 */
export function cloudInstanceModelAccessStale(instance: CloudInstanceView): boolean {
  return instance.status.readiness?.modelAccess === 'not-ready';
}

/**
 * 创建页设备 pill 的设备列表:云端行以**控制面实例列表**为唯一数据源;relay 列表
 * 中的 cloud 项(含已删实例残留的幽灵档案)全部排除,防止幽灵行或同一实例双行。
 * 与手机端设备菜单同口径，按保留 deviceId 前缀排除 relay cloud 项；实例 deviceId 集
 * 仍用于控制面列表 join，避免同一实例双行。
 *
 * 每个实例恰好一行:online 由 relay presence 决定；offline 云端行仍可点击，
 * DeviceSwitcherPill 用 cloudInstanceId 发起唤醒。普通离线设备仍保持禁用。
 */
export function buildDraftPillDevices(
  selectable: readonly SelectableDevice[],
  instances: readonly CloudInstanceView[],
  onlineDeviceIds: ReadonlySet<string>,
  cloudNameOf: (instance: CloudInstanceView) => string,
): DraftPillDevice[] {
  const instanceDeviceIds = new Set(instances.map((instance) => instance.deviceId));
  const rows: DraftPillDevice[] = selectable.filter(
    (device) =>
      !isCloudInstanceDeviceId(device.deviceId) && !instanceDeviceIds.has(device.deviceId),
  );
  for (const instance of instances) {
    rows.push({
      deviceId: instance.deviceId,
      name: cloudNameOf(instance),
      platform: null,
      online: onlineDeviceIds.has(instance.deviceId),
      cloudInstanceId: instance.instanceId,
      updateAvailable: cloudInstanceHasAvailableUpdate(instance),
      modelAccessStale: cloudInstanceModelAccessStale(instance),
    });
  }
  return rows;
}

/** 机器过滤恰好单选一台云端设备时，返回对应实例；多选 / 本机 / 所有均不隐式选云端。 */
export function getSingleSelectedCloudInstance(
  instances: readonly CloudInstanceView[],
  selection: MachineSelection,
): CloudInstanceView | null {
  if (selection === MACHINE_ALL || selection.length !== 1) return null;
  return instances.find((instance) => instance.deviceId === selection[0]) ?? null;
}

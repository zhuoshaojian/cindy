/** New Maker 设备 pill 的云端数据投影。 */
import type { CloudInstanceView } from './useCloudInstances';
import { MACHINE_ALL, type MachineSelection } from '@/features/device-link/selectedMachineStore';
import type { SelectableDevice } from '@/hooks/useControllableDevices';

/**
 * 设备 pill 的行模型:判别联合让「是云端」⟺「必带 instanceId」在类型上成立,
 * 消费端 `kind === 'cloud'` 收窄后即可直接取 cloudInstanceId 发起精确唤醒,
 * 不必再运行时判空(那正是误把普通离线行接上唤醒回调的温床)。
 */
export type DraftPillDevice =
  | (SelectableDevice & { kind?: undefined; cloudInstanceId?: undefined })
  | (SelectableDevice & { kind: 'cloud'; cloudInstanceId: string });

/**
 * 创建页设备 pill 的设备列表:云端行以**控制面实例列表**为唯一数据源;relay 列表
 * 中的 cloud 项(含已删实例残留的幽灵档案)全部排除,防止幽灵行或同一实例双行。
 * 与手机端设备菜单同口径的双集合排除,各防一种不一致窗口:kind 标记按 relay 的
 * `kind==='cloud'` 排(控制面列表未返回/延迟时兜底),实例 deviceId 集按控制面排
 * (relay 侧 kind 标记缺失或尚未上报时兜底)。
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
    (device): device is SelectableDevice & { kind?: undefined } =>
      device.kind !== 'cloud' && !instanceDeviceIds.has(device.deviceId),
  );
  for (const instance of instances) {
    rows.push({
      deviceId: instance.deviceId,
      name: cloudNameOf(instance),
      platform: null,
      online: onlineDeviceIds.has(instance.deviceId),
      kind: 'cloud',
      cloudInstanceId: instance.instanceId,
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

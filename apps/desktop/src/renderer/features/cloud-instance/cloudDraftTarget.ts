/**
 * New Maker 云端目标按钮的纯状态机。
 *
 * 控制面实例列表负责稳定身份，relay presence 只负责 online 判定；这里不发请求，
 * 只把草稿目标、机器过滤和云端 pending 收敛为 renderer 可直接消费的四态。
 */
import type {
  CloudInstancePendingState,
  CloudInstancesLoadState,
  CloudInstanceView,
} from './useCloudInstances';
import { MACHINE_ALL, type MachineSelection } from '@/features/device-link/selectedMachineStore';

export type CloudDraftToggleState = 'hidden' | 'local' | 'online' | 'offline' | 'waking';

/** 机器过滤恰好单选一台云端设备时，返回对应实例；多选 / 本机 / 所有均不隐式选云端。 */
export function getSingleSelectedCloudInstance(
  instances: readonly CloudInstanceView[],
  selection: MachineSelection,
): CloudInstanceView | null {
  if (selection === MACHINE_ALL || selection.length !== 1) return null;
  return instances.find((instance) => instance.deviceId === selection[0]) ?? null;
}

/**
 * 按“草稿当前目标 → 机器过滤单选 → 控制面首实例”的优先级选按钮所代表的实例。
 * 单实例阶段通常只有最后一条路径；前两条确保草稿与全局过滤不会被列表顺序覆盖。
 */
export function resolveCloudDraftInstance(
  instances: readonly CloudInstanceView[],
  draftDeviceId: string | null | undefined,
  selection: MachineSelection,
): CloudInstanceView | null {
  if (draftDeviceId) {
    const current = instances.find((instance) => instance.deviceId === draftDeviceId);
    if (current) return current;
  }
  return getSingleSelectedCloudInstance(instances, selection) ?? instances[0] ?? null;
}

export function deriveCloudDraftToggleState(input: {
  loadState: CloudInstancesLoadState;
  instance: CloudInstanceView | null;
  draftDeviceId: string | null | undefined;
  onlineDeviceIds: ReadonlySet<string>;
  pending: CloudInstancePendingState;
  /** wake 请求已受理但 presence 尚未上线的目标设备;IPC 返回后到 online 之间靠它维持 waking。 */
  wakingDeviceId?: string | null;
}): CloudDraftToggleState {
  if (input.loadState !== 'ready') return 'hidden';

  const waking =
    (input.pending?.action === 'wake' &&
      (input.pending.target === 'new' ||
        (input.instance != null && input.pending.target === input.instance.instanceId))) ||
    (input.wakingDeviceId != null && !input.onlineDeviceIds.has(input.wakingDeviceId));
  if (waking) return 'waking';

  // 0 实例仍保留首次唤醒入口；视觉与休眠实例同为“点击唤醒”。
  if (!input.instance) return 'offline';
  if (!input.onlineDeviceIds.has(input.instance.deviceId)) return 'offline';
  return input.draftDeviceId === input.instance.deviceId ? 'online' : 'local';
}

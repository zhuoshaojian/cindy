/**
 * useCloudInstances —— 账号级云端实例的 renderer 状态收口。
 * ---------------------------------------------------------------------------
 * 数据 / 网络 / token 全在 main;这里只调 `electronAPI.cloudInstances`,并 join
 * device-link 全量设备列表判断「就绪」——实例的 stable `deviceId` 在 relay `online`
 * 即代表 Pod 已连上、可对话(控制面 status 仅作诊断,不作可对话终态)。
 * 云端实例的全部变更动作(唤醒 / 休眠 / 删除)与 in-flight 状态由模块级单例持有,
 * 三个挂载点(机器切换菜单 / 创建页 / 设置页)共享同一快照与动作锁,消费端只做
 * UI:按钮、确认框、toast。
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { extractIpcError } from '@/utils/ipcError';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import { remoteProjectsStore } from '@/features/device-link/remoteProjectsStore';
import { revokedDevicesStore } from '@/features/device-link/revokedDevicesStore';
import { removeRemoteSessionActivityForDevice } from '@/features/device-link/remoteSessionActivityStore';
import { setCloudCapability } from '@/features/device-link/cloudCapability';

/** 控制面列出的一个实例(展示模型)。由 electronAPI 返回类型推导,避免跨层类型 import。 */
export type CloudInstanceView = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['list']>
>['instances'][number];
export type CloudInstanceWakeResult = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['wake']>
>;

/** 端点未配置 → unsupported(隐藏入口);首次加载 → loading;正常 → ready;其它 → error。 */
export type CloudInstancesLoadState = 'loading' | 'ready' | 'unsupported' | 'error';

export type CloudInstanceAction = 'wake' | 'stop' | 'delete';

/** in-flight 动作:target 为 instanceId,首次唤醒(自动建)为 'new';空闲为 null。 */
export type CloudInstancePendingState = {
  target: string | 'new';
  action: CloudInstanceAction;
} | null;

/** Endpoint absence and server-side capability disablement both hide cloud UI. */
export function isCloudInstancesUnsupportedError(error: unknown): boolean {
  const ipcError = extractIpcError(error);
  return ipcError?.code === 'UNSUPPORTED_CAPABILITY' || ipcError?.code === 'CLOUD_INSTANCE_DISABLED';
}

export interface UseCloudInstances {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePendingState;
  /** relay 上 online(可对话)的 deviceId 集合。 */
  onlineDeviceIds: Set<string>;
  wake: (instanceId?: string) => Promise<CloudInstanceWakeResult | undefined>;
  stopInstance: (instanceId: string) => Promise<void>;
  deleteInstance: (instanceId: string) => Promise<void>;
}

interface CloudInstancesSnapshot {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePendingState;
}

const initialSnapshot: CloudInstancesSnapshot = {
  instances: [],
  loadState: 'loading',
  pending: null,
};
let snapshot = initialSnapshot;
let started = false;
const subscribers = new Set<() => void>();

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function instancesEqual(left: readonly CloudInstanceView[], right: readonly CloudInstanceView[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((instance, index) => {
    const other = right[index];
    return instance.instanceId === other.instanceId
      && instance.deviceId === other.deviceId
      && instance.nameSequence === other.nameSequence
      && instance.customLabel === other.customLabel
      && instance.status.instanceId === other.status.instanceId
      && instance.status.deviceId === other.status.deviceId
      && instance.status.ownership.passportId === other.status.ownership.passportId
      && instance.status.ownership.membershipId === other.status.ownership.membershipId
      && instance.status.ownership.membershipKind === other.status.ownership.membershipKind
      && instance.status.ownership.orgSlug === other.status.ownership.orgSlug
      && instance.status.desiredState === other.status.desiredState
      && instance.status.nextWakeAtMs === other.status.nextWakeAtMs
      && instance.status.runtimeState === other.status.runtimeState
      && instance.status.resourceTier === other.status.resourceTier
      && instance.status.readiness.ready === other.status.readiness.ready
      && instance.status.readiness.reason === other.status.readiness.reason
      && arraysEqual(instance.status.readiness.blockers, other.status.readiness.blockers)
      && instance.status.updatedAtMs === other.status.updatedAtMs;
  });
}

function pendingEqual(
  left: CloudInstancePendingState,
  right: CloudInstancePendingState,
): boolean {
  return left === right
    || (left !== null
      && right !== null
      && left.target === right.target
      && left.action === right.action);
}

function updateSnapshot(next: Partial<CloudInstancesSnapshot>): void {
  const nextSnapshot = { ...snapshot, ...next };
  if (
    instancesEqual(snapshot.instances, nextSnapshot.instances)
    && snapshot.loadState === nextSnapshot.loadState
    && pendingEqual(snapshot.pending, nextSnapshot.pending)
  ) {
    return;
  }
  snapshot = nextSnapshot;
  subscribers.forEach((subscriber) => subscriber());
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getSnapshot(): CloudInstancesSnapshot {
  return snapshot;
}

async function refresh(): Promise<Partial<CloudInstancesSnapshot>> {
  try {
    const { instances } = await window.electronAPI.cloudInstances.list();
    return { instances, loadState: 'ready' };
  } catch (error) {
    if (isCloudInstancesUnsupportedError(error)) {
      return { instances: [], loadState: 'unsupported' };
    }
    return { loadState: 'error' };
  }
}

function ensureStarted(): void {
  if (started) return;
  started = true;
  void refresh().then((patch) => updateSnapshot(patch));
}

// 统一动作骨架:防重(pending 期间拒绝新动作)→ 执行 → 成功后刷新列表 → 清 pending。
// 模块级快照同步写入 pending,保证同一 render tick 以及不同 hook 挂载点发起的第二个动作
// 都立即被挡。失败向调用方抛出,由调用方决定用户反馈(菜单 / 设置页文案不同)。
async function runAction<T>(
  target: string | 'new',
  action: CloudInstanceAction,
  op: () => Promise<T>,
): Promise<T | undefined> {
  if (snapshot.pending) return undefined;
  updateSnapshot({ pending: { target, action } });
  let listPatch: Partial<CloudInstancesSnapshot> = {};
  try {
    const value = await op();
    listPatch = await refresh();
    return value;
  } finally {
    updateSnapshot({ ...listPatch, pending: null });
  }
}

async function wake(instanceId?: string): Promise<CloudInstanceWakeResult | undefined> {
  return runAction(instanceId ?? 'new', 'wake', () =>
    window.electronAPI.cloudInstances.wake(instanceId ? { instanceId } : {}),
  );
}

async function stopInstance(instanceId: string): Promise<void> {
  await runAction(instanceId, 'stop', () =>
    window.electronAPI.cloudInstances.stop({ instanceId }),
  );
}

async function deleteInstance(instanceId: string): Promise<void> {
  await runAction(instanceId, 'delete', async () => {
    const target = snapshot.instances.find((instance) => instance.instanceId === instanceId);
    await window.electronAPI.cloudInstances.delete({ instanceId });
    // 控制面清了服务端(容器/store/auth/relay 档案),main 清了设备名缓存;
    // 这里补齐本 renderer 的最后一层:同步分片 / 会话活动 / 被拒标记 ——
    // 否则已删云端会以分片缓存旧名(裸 'Cloud')的断线幽灵行再现于机器菜单。
    // 仅发起端收敛;其它在线客户端的收敛仍依赖后续的 device-removed 推送(已记录)。
    if (target) {
      remoteProjectsStore.removeDevice(target.deviceId);
      removeRemoteSessionActivityForDevice(target.deviceId);
      revokedDevicesStore.clearRevoked(target.deviceId);
    }
  });
}

function resetCloudInstancesStore(): void {
  snapshot = initialSnapshot;
  started = false;
  subscribers.clear();
}

/** 仅供单元测试隔离模块级单例;生产代码不得调用。 */
export function __resetCloudInstancesStoreForTest(): void {
  resetCloudInstancesStore();
}

export function useCloudInstances(enabled = true): UseCloudInstances {
  const { instances, loadState, pending } = useSyncExternalStore(subscribe, getSnapshot);
  const deviceList = useDeviceLinkDeviceList();

  useEffect(() => {
    if (enabled) ensureStarted();
  }, [enabled]);

  const onlineDeviceIds = useMemo(
    () => new Set((deviceList ?? []).filter((device) => device.online).map((device) => device.deviceId)),
    [deviceList],
  );
  useEffect(() => {
    if (loadState === 'unsupported') {
      setCloudCapability(
        true,
        new Set(
          (deviceList ?? [])
            .filter((device) => device.deviceInfo?.kind === 'cloud')
            .map((device) => device.deviceId),
        ),
      );
    } else if (loadState === 'ready') {
      setCloudCapability(false);
    }
  }, [deviceList, loadState]);

  return useMemo(
    () => ({
      instances,
      loadState,
      pending,
      onlineDeviceIds,
      wake,
      stopInstance,
      deleteInstance,
    }),
    [instances, loadState, onlineDeviceIds, pending],
  );
}

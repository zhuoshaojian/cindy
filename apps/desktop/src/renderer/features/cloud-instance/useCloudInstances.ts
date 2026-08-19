/**
 * useCloudInstances —— 账号级云端实例的 renderer 状态收口。
 * ---------------------------------------------------------------------------
 * 数据 / 网络 / token 全在 main;这里只调 `electronAPI.cloudInstances`,并 join
 * device-link 全量设备列表判断「就绪」——实例的 stable `deviceId` 在 relay `online`
 * 即代表 Pod 已连上、可对话(控制面 status 仅作诊断,不作可对话终态)。
 * 云端实例的全部变更动作(唤醒 / 休眠 / 更新 / 删除)与 in-flight 状态由模块级单例持有,
 * 三个挂载点(机器切换菜单 / 创建页 / 设置页)共享同一快照与动作锁,消费端只做
 * UI:按钮、确认框、toast。
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  waitForCloudInstanceTerminalState,
  type CloudInstanceTerminalWatch,
} from '@cindy/maker-shared/cloud-instance';
import { extractIpcError } from '@/utils/ipcError';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import { remoteProjectsStore } from '@/features/device-link/remoteProjectsStore';
import { revokedDevicesStore } from '@/features/device-link/revokedDevicesStore';
import { removeRemoteSessionActivityForDevice } from '@/features/device-link/remoteSessionActivityStore';
import { setCloudCapability } from '@/features/device-link/cloudCapability';

export { CloudInstanceActionTimeoutError } from '@cindy/maker-shared/cloud-instance';

/** 控制面列出的一个实例(展示模型)。由 electronAPI 返回类型推导,避免跨层类型 import。 */
export type CloudInstanceView = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['list']>
>['instances'][number];
export type CloudInstanceWakeResult = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['wake']>
>;

/** 端点未配置 → unsupported(隐藏入口);首次加载 → loading;正常 → ready;其它 → error。 */
export type CloudInstancesLoadState = 'loading' | 'ready' | 'unsupported' | 'error';

export type CloudInstanceAction =
  | 'wake'
  | 'stop'
  | 'upgrade'
  | 'rebuild'
  | 'autoUpdate'
  | 'delete';

/** Delete completed, but the replacement instance could not be created. */
export class CloudInstanceRebuildCreateError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super('cloud instance was deleted but its replacement could not be created');
    this.name = 'CloudInstanceRebuildCreateError';
    this.originalError = originalError;
  }
}

/** in-flight 动作:target 为 instanceId,首次唤醒(自动建)为 'new';空闲为 null。 */
export type CloudInstancePendingState = {
  target: string | 'new';
  action: CloudInstanceAction;
} | null;

/**
 * A successful rebuild has retired the old control-plane row, but relay may
 * still expose the old device until its next authoritative directory refresh.
 */
export interface CloudInstanceRebuildRetirement {
  oldInstanceId: string;
  oldDeviceId: string;
}

/** Endpoint absence and server-side capability disablement both hide cloud UI. */
export function isCloudInstancesUnsupportedError(error: unknown): boolean {
  const ipcError = extractIpcError(error);
  return ipcError?.code === 'UNSUPPORTED_CAPABILITY' || ipcError?.code === 'CLOUD_INSTANCE_DISABLED';
}

export interface UseCloudInstances {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePendingState;
  rebuildRetirement: CloudInstanceRebuildRetirement | null;
  clearRebuildRetirement: (oldInstanceId: string) => void;
  /** relay 上 online(可对话)的 deviceId 集合。 */
  onlineDeviceIds: Set<string>;
  /** Best-effort refresh for menus/panels becoming visible. */
  refresh: () => Promise<void>;
  wake: (instanceId?: string) => Promise<CloudInstanceWakeResult | undefined>;
  stopInstance: (instanceId: string) => Promise<void>;
  upgradeInstance: (instanceId: string) => Promise<void>;
  rebuildInstance: (instanceId: string) => Promise<CloudInstanceWakeResult | undefined>;
  setAutoUpdate: (instanceId: string, enabled: boolean) => Promise<boolean>;
  deleteInstance: (instanceId: string) => Promise<void>;
}

interface CloudInstancesSnapshot {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePendingState;
  rebuildRetirement: CloudInstanceRebuildRetirement | null;
}

const initialSnapshot: CloudInstancesSnapshot = {
  instances: [],
  loadState: 'loading',
  pending: null,
  rebuildRetirement: null,
};
let snapshot = initialSnapshot;
let started = false;
const subscribers = new Set<() => void>();
let refreshInFlight: Promise<Partial<CloudInstancesSnapshot>> | null = null;
let pollingConsumers = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityListenersAttached = false;
let onlineDeviceIdsSnapshot: ReadonlySet<string> = new Set();
let terminalWatchAbortController: AbortController | null = null;

export const CLOUD_INSTANCES_REFRESH_INTERVAL_MS = 90_000;
export const CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS = 5_000;

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
      && (instance.status.upgrade?.state ?? 'idle') === (other.status.upgrade?.state ?? 'idle')
      && (instance.status.upgrade?.targetImage ?? null) === (other.status.upgrade?.targetImage ?? null)
      && (instance.status.upgrade?.previousImage ?? null) === (other.status.upgrade?.previousImage ?? null)
      && (instance.status.upgrade?.deadlineAtMs ?? null) === (other.status.upgrade?.deadlineAtMs ?? null)
      && (instance.status.lastFailedUpgradeImage ?? null) === (other.status.lastFailedUpgradeImage ?? null)
      && (instance.status.updateAvailable ?? false) === (other.status.updateAvailable ?? false)
      && (instance.status.latestReleaseTag ?? null) === (other.status.latestReleaseTag ?? null)
      && instance.status.autoUpdate === other.status.autoUpdate
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

function rebuildRetirementEqual(
  left: CloudInstanceRebuildRetirement | null,
  right: CloudInstanceRebuildRetirement | null,
): boolean {
  return left === right
    || (left !== null
      && right !== null
      && left.oldInstanceId === right.oldInstanceId
      && left.oldDeviceId === right.oldDeviceId);
}

function retargetPending(
  action: CloudInstanceAction,
  expectedTarget: string | 'new',
  nextTarget: string,
): void {
  if (snapshot.pending?.action !== action || snapshot.pending.target !== expectedTarget) return;
  updateSnapshot({ pending: { action, target: nextTarget } });
}

function updateSnapshot(next: Partial<CloudInstancesSnapshot>): void {
  const wasVerifying = hasVerifyingUpgrade(snapshot.instances);
  const nextSnapshot = { ...snapshot, ...next };
  if (
    instancesEqual(snapshot.instances, nextSnapshot.instances)
    && snapshot.loadState === nextSnapshot.loadState
    && pendingEqual(snapshot.pending, nextSnapshot.pending)
    && rebuildRetirementEqual(snapshot.rebuildRetirement, nextSnapshot.rebuildRetirement)
  ) {
    return;
  }
  snapshot = nextSnapshot;
  subscribers.forEach((subscriber) => subscriber());
  if (wasVerifying !== hasVerifyingUpgrade(nextSnapshot.instances)) schedulePoll();
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getSnapshot(): CloudInstancesSnapshot {
  return snapshot;
}

function hasVerifyingUpgrade(instances: readonly CloudInstanceView[]): boolean {
  return instances.some((instance) => instance.status.upgrade?.state === 'verifying');
}

function rendererIsVisible(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function fetchRefreshPatch(): Promise<Partial<CloudInstancesSnapshot>> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const { instances } = await window.electronAPI.cloudInstances.list();
      return { instances, loadState: 'ready' };
    } catch (error) {
      if (isCloudInstancesUnsupportedError(error)) {
        return { instances: [], loadState: 'unsupported' };
      }
      return { loadState: 'error' };
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function refresh(silentFailure = false): Promise<Partial<CloudInstancesSnapshot>> {
  const patch = await fetchRefreshPatch();
  return silentFailure && patch.loadState === 'error' ? {} : patch;
}

async function refreshAfterMutation(): Promise<Partial<CloudInstancesSnapshot>> {
  // A visibility/menu refresh may have started before the mutation acquired
  // the pending lock. Never let that pre-mutation response satisfy the final
  // action refresh, or the UI can remain stale until the next poll.
  if (refreshInFlight) await refreshInFlight;
  return refresh();
}

async function refreshSnapshot(): Promise<void> {
  if (snapshot.pending) return;
  updateSnapshot(await refresh(true));
}

async function refreshSnapshotDuringAction(): Promise<void> {
  updateSnapshot(await refresh(true));
}

function clearPollTimer(): void {
  if (pollTimer === null) return;
  clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll(): void {
  clearPollTimer();
  if (pollingConsumers === 0) return;
  const delay = rendererIsVisible() && hasVerifyingUpgrade(snapshot.instances)
    ? CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS
    : CLOUD_INSTANCES_REFRESH_INTERVAL_MS;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void (async () => {
      if (rendererIsVisible() && !snapshot.pending) await refreshSnapshot();
      schedulePoll();
    })();
  }, delay);
}

function handleRendererVisibilityChange(): void {
  if (rendererIsVisible()) void refreshSnapshot();
  schedulePoll();
}

function attachVisibilityListeners(): void {
  if (visibilityListenersAttached) return;
  visibilityListenersAttached = true;
  document.addEventListener('visibilitychange', handleRendererVisibilityChange);
  window.addEventListener('focus', handleRendererVisibilityChange);
}

function detachVisibilityListeners(): void {
  if (!visibilityListenersAttached) return;
  visibilityListenersAttached = false;
  document.removeEventListener('visibilitychange', handleRendererVisibilityChange);
  window.removeEventListener('focus', handleRendererVisibilityChange);
}

function retainPolling(): () => void {
  pollingConsumers += 1;
  if (pollingConsumers === 1) {
    attachVisibilityListeners();
    schedulePoll();
  }
  return () => {
    pollingConsumers = Math.max(0, pollingConsumers - 1);
    if (pollingConsumers > 0) return;
    clearPollTimer();
    detachVisibilityListeners();
  };
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
  terminalWatch?: (value: T) => CloudInstanceTerminalWatch,
  onTerminalSuccess?: (value: T) => Promise<void>,
): Promise<T | undefined> {
  if (snapshot.pending) return undefined;
  updateSnapshot({ pending: { target, action } });
  let listPatch: Partial<CloudInstancesSnapshot> = {};
  try {
    const value = await op();
    listPatch = await refreshAfterMutation();
    updateSnapshot(listPatch);
    if (terminalWatch) {
      const controller = new AbortController();
      terminalWatchAbortController = controller;
      try {
        await waitForCloudInstanceTerminalState({
          watch: terminalWatch(value),
          getState: () => ({
            instances: snapshot.instances,
            onlineDeviceIds: onlineDeviceIdsSnapshot,
          }),
          refresh: refreshSnapshotDuringAction,
          signal: controller.signal,
        });
        await onTerminalSuccess?.(value);
      } finally {
        if (terminalWatchAbortController === controller) terminalWatchAbortController = null;
      }
    }
    return value;
  } finally {
    updateSnapshot({ pending: null });
  }
}

async function wake(instanceId?: string): Promise<CloudInstanceWakeResult | undefined> {
  return runAction(
    instanceId ?? 'new',
    'wake',
    async () => {
      const result = await window.electronAPI.cloudInstances.wake(instanceId ? { instanceId } : {});
      if (!instanceId) retargetPending('wake', 'new', result.instanceId);
      return result;
    },
    (result) => ({
      action: 'wake',
      instanceId: result.instanceId,
      deviceId: result.deviceId,
    }),
  );
}

async function stopInstance(instanceId: string): Promise<void> {
  const target = snapshot.instances.find((instance) => instance.instanceId === instanceId);
  if (!target) throw new Error(`cloud instance not found: ${instanceId}`);
  await runAction(
    instanceId,
    'stop',
    () => window.electronAPI.cloudInstances.stop({ instanceId }),
    () => ({ action: 'stop', instanceId, deviceId: target.deviceId }),
  );
}

async function upgradeInstance(instanceId: string): Promise<void> {
  await runAction(instanceId, 'upgrade', async () => {
    try {
      await window.electronAPI.cloudInstances.upgrade({ instanceId });
    } catch (error) {
      // Another client may win the race after this UI rendered the update
      // action. Treat that conflict as accepted and refresh into verifying.
      if (extractIpcError(error)?.code === 'CLOUD_INSTANCE_UPGRADE_IN_PROGRESS') return;
      throw error;
    }
  });
}

function withAutoUpdate(
  instances: readonly CloudInstanceView[],
  instanceId: string,
  enabled: boolean,
): CloudInstanceView[] {
  return instances.map((instance) => instance.instanceId === instanceId
    ? { ...instance, status: { ...instance.status, autoUpdate: enabled } }
    : instance);
}

async function setAutoUpdate(instanceId: string, enabled: boolean): Promise<boolean> {
  const result = await runAction(instanceId, 'autoUpdate', async () => {
    const previousInstances = snapshot.instances;
    updateSnapshot({ instances: withAutoUpdate(previousInstances, instanceId, enabled) });
    try {
      await window.electronAPI.cloudInstances.patch({ instanceId, autoUpdate: enabled });
      return true;
    } catch (error) {
      updateSnapshot({ instances: previousInstances });
      throw error;
    }
  });
  return result === true;
}

function clearDeletedInstanceRendererState(target: CloudInstanceView | undefined): void {
  if (!target) return;
  remoteProjectsStore.removeDevice(target.deviceId);
  removeRemoteSessionActivityForDevice(target.deviceId);
  revokedDevicesStore.clearRevoked(target.deviceId);
}

async function deleteInstance(instanceId: string): Promise<void> {
  await runAction(instanceId, 'delete', async () => {
    const target = snapshot.instances.find((instance) => instance.instanceId === instanceId);
    await window.electronAPI.cloudInstances.delete({ instanceId });
    // 控制面清了服务端(容器/store/auth/relay 档案),main 清了设备名缓存;
    // 这里补齐本 renderer 的最后一层:同步分片 / 会话活动 / 被拒标记 ——
    // 否则已删云端会以分片缓存旧名(裸 'Cloud')的断线幽灵行再现于机器菜单。
    // 仅发起端收敛;其它在线客户端的收敛仍依赖后续的 device-removed 推送(已记录)。
    clearDeletedInstanceRendererState(target);
  });
}

/**
 * Self-hosted control planes may not advertise a release, so the upgrade IPC
 * has no target. Rebuild keeps the resource tier but intentionally goes through
 * the existing delete (H7) and first-wake creation paths to pick up the current
 * runtime policy.
 */
async function rebuildInstance(instanceId: string): Promise<CloudInstanceWakeResult | undefined> {
  const target = snapshot.instances.find((instance) => instance.instanceId === instanceId);
  if (!target) throw new Error(`cloud instance not found: ${instanceId}`);
  return runAction(
    instanceId,
    'rebuild',
    async () => {
      await window.electronAPI.cloudInstances.delete({ instanceId });
      clearDeletedInstanceRendererState(target);

      try {
        const result = await window.electronAPI.cloudInstances.wake({
          resourceTier: target.status.resourceTier,
        });
        return result;
      } catch (error) {
        // The destructive half already committed. Never leave the deleted card
        // in renderer state even if the follow-up list request also fails.
        const withoutDeleted = snapshot.instances.filter(
          (instance) => instance.instanceId !== instanceId,
        );
        const patch = await refreshAfterMutation();
        updateSnapshot({ instances: withoutDeleted, ...patch });
        throw new CloudInstanceRebuildCreateError(error);
      }
    },
    (result) => ({
      action: 'rebuild',
      oldInstanceId: instanceId,
      newInstanceId: result.instanceId,
      newDeviceId: result.deviceId,
    }),
    async () => {
      const retirement: CloudInstanceRebuildRetirement = {
        oldInstanceId: instanceId,
        oldDeviceId: target.deviceId,
      };
      // Publish the successful handoff before pending is cleared. Consumers
      // therefore never render a frame with neither the rebuild watch nor the
      // retired-device filter active.
      updateSnapshot({ rebuildRetirement: retirement });

      // Confirm once more after the terminal edge. If the authoritative list
      // still contains the old instance, restore it immediately rather than
      // hiding a real server-side resource. A failed refresh is equally
      // non-authoritative and also restores the row.
      const patch = await refreshAfterMutation();
      const oldInstanceConfirmedAbsent =
        patch.loadState === 'ready' &&
        patch.instances !== undefined &&
        !patch.instances.some((instance) => instance.instanceId === instanceId);
      updateSnapshot({
        ...patch,
        rebuildRetirement: oldInstanceConfirmedAbsent ? retirement : null,
      });
    },
  );
}

function clearRebuildRetirement(oldInstanceId: string): void {
  if (snapshot.rebuildRetirement?.oldInstanceId !== oldInstanceId) return;
  updateSnapshot({ rebuildRetirement: null });
}

function resetCloudInstancesStore(): void {
  terminalWatchAbortController?.abort();
  terminalWatchAbortController = null;
  clearPollTimer();
  detachVisibilityListeners();
  snapshot = initialSnapshot;
  started = false;
  refreshInFlight = null;
  pollingConsumers = 0;
  onlineDeviceIdsSnapshot = new Set();
  subscribers.clear();
}

/** 仅供单元测试隔离模块级单例;生产代码不得调用。 */
export function __resetCloudInstancesStoreForTest(): void {
  resetCloudInstancesStore();
}

export function useCloudInstances(enabled = true): UseCloudInstances {
  const { instances, loadState, pending, rebuildRetirement } = useSyncExternalStore(
    subscribe,
    getSnapshot,
  );
  const deviceList = useDeviceLinkDeviceList();

  useEffect(() => {
    if (!enabled) return undefined;
    ensureStarted();
    return retainPolling();
  }, [enabled]);

  const onlineDeviceIds = useMemo(
    () => new Set((deviceList ?? []).filter((device) => device.online).map((device) => device.deviceId)),
    [deviceList],
  );
  useEffect(() => {
    onlineDeviceIdsSnapshot = onlineDeviceIds;
  }, [onlineDeviceIds]);
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
      rebuildRetirement,
      clearRebuildRetirement,
      onlineDeviceIds,
      refresh: refreshSnapshot,
      wake,
      stopInstance,
      upgradeInstance,
      rebuildInstance,
      setAutoUpdate,
      deleteInstance,
    }),
    [instances, loadState, onlineDeviceIds, pending, rebuildRetirement],
  );
}

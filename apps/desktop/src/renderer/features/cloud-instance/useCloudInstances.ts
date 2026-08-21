/**
 * useCloudInstances —— 账号级云端实例的 renderer 状态收口。
 * ---------------------------------------------------------------------------
 * 数据 / 网络 / token 全在 main;这里只调 `electronAPI.cloudInstances`,并 join
 * device-link 全量设备列表判断「就绪」——实例的 stable `deviceId` 在 relay `online`
 * 即代表 Pod 已连上、可对话(控制面 status 仅作诊断,不作可对话终态)。
 * 云端实例的全部变更动作(唤醒 / 休眠 / 更新 / 重建 / 删除)与 in-flight 状态由模块级单例持有,
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
import { getDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import {
  __resetCloudInstanceRendererAuthorityForTest,
  markCloudInstanceRendererAuthorityUnknown,
  publishCloudInstanceRendererAuthority,
} from './cloudInstanceRendererAuthority';

export { CloudInstanceActionTimeoutError } from '@cindy/maker-shared/cloud-instance';

/** 控制面列出的一个实例(展示模型)。由 electronAPI 返回类型推导,避免跨层类型 import。 */
export type CloudInstanceView = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['list']>
>['instances'][number];
export type CloudInstanceWakeResult = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['wake']>
>;
export type CloudInstanceRebuildView = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['list']>
>['rebuildOperations'][number];
export type CloudInstanceRebuildResult = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['rebuild']>
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

/** in-flight 动作:target 为 instanceId,首次唤醒(自动建)为 'new';空闲为 null。 */
export type CloudInstancePendingState = {
  target: string | 'new';
  action: CloudInstanceAction;
  /** A failed refresh preserves rebuild busy state but marks its phase as stale. */
  syncState?: 'synced' | 'unknown';
} | null;

export interface CloudInstanceRebuildAttention {
  kind: 'manual-wake-required';
  oldInstanceId: string;
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
  rebuildAttention?: CloudInstanceRebuildAttention | null;
  /** relay 上 online(可对话)的 deviceId 集合。 */
  onlineDeviceIds: Set<string>;
  /** Best-effort refresh for menus/panels becoming visible. */
  refresh: () => Promise<void>;
  wake: (instanceId?: string) => Promise<CloudInstanceWakeResult | undefined>;
  stopInstance: (instanceId: string) => Promise<void>;
  upgradeInstance: (instanceId: string) => Promise<void>;
  rebuildInstance: (instanceId: string) => Promise<CloudInstanceRebuildResult | undefined>;
  setAutoUpdate: (instanceId: string, enabled: boolean) => Promise<boolean>;
  deleteInstance: (instanceId: string) => Promise<void>;
}

interface CloudInstancesSnapshot {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePendingState;
  localPending: CloudInstancePendingState;
  rebuildOperations: CloudInstanceRebuildView[];
  rebuildSyncState: 'synced' | 'unknown';
  rebuildAttention: CloudInstanceRebuildAttention | null;
}

const initialSnapshot: CloudInstancesSnapshot = {
  instances: [],
  loadState: 'loading',
  pending: null,
  localPending: null,
  rebuildOperations: [],
  rebuildSyncState: 'synced',
  rebuildAttention: null,
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
const rebuildContinuationAttemptedAt = new Map<string, number>();

export const CLOUD_INSTANCES_REFRESH_INTERVAL_MS = 90_000;
export const CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS = 5_000;
export const CLOUD_REBUILD_CONTINUATION_RETRY_MS = 35_000;

const ACTIVE_REBUILD_PHASES = new Set<CloudInstanceRebuildView['phase']>([
  'accepted',
  'retiring',
  'retirement-timeout',
  'retired-awaiting-create',
  'creating',
  'starting',
]);

function latestOperation(
  operations: readonly CloudInstanceRebuildView[],
  predicate: (operation: CloudInstanceRebuildView) => boolean,
): CloudInstanceRebuildView | null {
  return operations
    .filter(predicate)
    .reduce<CloudInstanceRebuildView | null>(
      (latest, operation) => !latest || operation.updatedAt > latest.updatedAt ? operation : latest,
      null,
    );
}

function activeRebuildOperation(
  operations: readonly CloudInstanceRebuildView[],
): CloudInstanceRebuildView | null {
  return latestOperation(operations, (operation) => ACTIVE_REBUILD_PHASES.has(operation.phase));
}

function rebuildAttentionFor(
  operations: readonly CloudInstanceRebuildView[],
  instances: readonly CloudInstanceView[],
): CloudInstanceRebuildAttention | null {
  if (instances.length > 0) return null;
  const latest = latestOperation(operations, () => true);
  return latest?.phase === 'manual-wake-required'
    || latest?.phase === 'create-failed-after-delete'
    ? { kind: 'manual-wake-required', oldInstanceId: latest.oldInstanceId }
    : null;
}

function rebuildRetryOfOperationId(
  operations: readonly CloudInstanceRebuildView[],
  oldInstanceId: string,
): string | undefined {
  return latestOperation(
    operations,
    (operation) => operation.oldInstanceId === oldInstanceId
      && operation.phase === 'delete-rejected',
  )?.operationId;
}

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
      && left.action === right.action
      && left.syncState === right.syncState);
}

function retargetPending(
  action: CloudInstanceAction,
  expectedTarget: string | 'new',
  nextTarget: string,
): void {
  if (snapshot.localPending?.action !== action || snapshot.localPending.target !== expectedTarget) return;
  updateSnapshot({ localPending: { action, target: nextTarget } });
}

function updateSnapshot(next: Partial<CloudInstancesSnapshot>): void {
  const wasVerifying = hasVerifyingUpgrade(snapshot.instances);
  const wasRebuilding = snapshot.pending?.action === 'rebuild';
  const merged = { ...snapshot, ...next };
  const activeRebuild = activeRebuildOperation(merged.rebuildOperations);
  const serverPending: CloudInstancePendingState = activeRebuild
    ? {
        action: 'rebuild',
        target: activeRebuild.oldInstanceId,
        syncState: merged.rebuildSyncState,
      }
    : null;
  const nextSnapshot: CloudInstancesSnapshot = {
    ...merged,
    pending: merged.localPending ?? serverPending,
    rebuildAttention: rebuildAttentionFor(merged.rebuildOperations, merged.instances),
  };
  if (
    instancesEqual(snapshot.instances, nextSnapshot.instances)
      && snapshot.loadState === nextSnapshot.loadState
      && pendingEqual(snapshot.pending, nextSnapshot.pending)
      && pendingEqual(snapshot.localPending, nextSnapshot.localPending)
      && JSON.stringify(snapshot.rebuildOperations) === JSON.stringify(nextSnapshot.rebuildOperations)
      && snapshot.rebuildSyncState === nextSnapshot.rebuildSyncState
      && JSON.stringify(snapshot.rebuildAttention) === JSON.stringify(nextSnapshot.rebuildAttention)
  ) {
    return;
  }
  snapshot = nextSnapshot;
  subscribers.forEach((subscriber) => subscriber());
  if (
    wasVerifying !== hasVerifyingUpgrade(nextSnapshot.instances)
    || wasRebuilding !== (nextSnapshot.pending?.action === 'rebuild')
  ) schedulePoll();
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
  const ownerAtStart = getDataOwnerGeneration();
  refreshInFlight = (async () => {
    try {
      const { instances, rebuildOperations = [] } = await window.electronAPI.cloudInstances.list();
      const deviceIds = instances.map((instance) => instance.deviceId.trim());
      // GET /instances is a complete, unpaginated membership list. Only a
      // structurally complete success may become renderer authority; malformed
      // rows degrade to unknown rather than retiring a live cloud peer.
      if (deviceIds.every((deviceId) => deviceId.length > 0)) {
        publishCloudInstanceRendererAuthority(ownerAtStart, deviceIds);
      } else {
        markCloudInstanceRendererAuthorityUnknown(ownerAtStart);
      }
      return { instances, rebuildOperations, rebuildSyncState: 'synced', loadState: 'ready' };
    } catch (error) {
      markCloudInstanceRendererAuthorityUnknown(ownerAtStart);
      if (isCloudInstancesUnsupportedError(error)) {
        return {
          instances: [],
          rebuildOperations: [],
          rebuildSyncState: 'synced',
          loadState: 'unsupported',
        };
      }
      return { loadState: 'error', rebuildSyncState: 'unknown' };
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function refresh(silentFailure = false): Promise<Partial<CloudInstancesSnapshot>> {
  const patch = await fetchRefreshPatch();
  return silentFailure && patch.loadState === 'error'
    ? { rebuildSyncState: 'unknown' }
    : patch;
}

function replaceRebuildOperation(operation: CloudInstanceRebuildView): void {
  const existing = snapshot.rebuildOperations.filter(
    (candidate) => candidate.operationId !== operation.operationId,
  );
  updateSnapshot({
    rebuildOperations: [...existing, operation],
    rebuildSyncState: 'synced',
  });
}

function maybeContinueRebuild(): void {
  const operation = activeRebuildOperation(snapshot.rebuildOperations);
  if (!operation || (operation.phase !== 'retired-awaiting-create' && operation.phase !== 'creating')) {
    return;
  }
  const attemptedAt = rebuildContinuationAttemptedAt.get(operation.operationId);
  if (attemptedAt !== undefined && Date.now() - attemptedAt < CLOUD_REBUILD_CONTINUATION_RETRY_MS) {
    return;
  }
  rebuildContinuationAttemptedAt.set(operation.operationId, Date.now());
  void window.electronAPI.cloudInstances.continueRebuild({
    operationId: operation.operationId,
    oldInstanceId: operation.oldInstanceId,
    retryOfOperationId: rebuildRetryOfOperationId(
      snapshot.rebuildOperations,
      operation.oldInstanceId,
    ),
  }).then(({ rebuildOperation }) => {
    replaceRebuildOperation(rebuildOperation);
    schedulePoll();
  }).catch(() => {
    rebuildContinuationAttemptedAt.delete(operation.operationId);
    updateSnapshot({ rebuildSyncState: 'unknown' });
    schedulePoll();
  });
}

function applyRefreshPatch(patch: Partial<CloudInstancesSnapshot>): void {
  const clearsUnconfirmedLocalRebuild = patch.rebuildOperations !== undefined
    && snapshot.localPending?.action === 'rebuild'
    && snapshot.localPending.syncState === 'unknown';
  updateSnapshot(clearsUnconfirmedLocalRebuild
    ? { ...patch, localPending: null }
    : patch);
  if (patch.rebuildOperations) maybeContinueRebuild();
}

async function refreshAfterMutation(): Promise<Partial<CloudInstancesSnapshot>> {
  // A visibility/menu refresh may have started before the mutation acquired
  // the pending lock. Never let that pre-mutation response satisfy the final
  // action refresh, or the UI can remain stale until the next poll.
  if (refreshInFlight) await refreshInFlight;
  return refresh();
}

async function refreshSnapshot(): Promise<void> {
  if (snapshot.localPending && snapshot.localPending.action !== 'rebuild') return;
  applyRefreshPatch(await refresh(true));
}

async function refreshSnapshotDuringAction(): Promise<void> {
  applyRefreshPatch(await refresh(true));
}

function clearPollTimer(): void {
  if (pollTimer === null) return;
  clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll(): void {
  clearPollTimer();
  if (pollingConsumers === 0) return;
  const delay = rendererIsVisible()
    && (hasVerifyingUpgrade(snapshot.instances) || snapshot.pending?.action === 'rebuild')
    ? CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS
    : CLOUD_INSTANCES_REFRESH_INTERVAL_MS;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void (async () => {
      if (rendererIsVisible() && (!snapshot.localPending || snapshot.localPending.action === 'rebuild')) {
        await refreshSnapshot();
      }
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
  void refresh().then(applyRefreshPatch);
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
  updateSnapshot({ localPending: { target, action } });
  let listPatch: Partial<CloudInstancesSnapshot> = {};
  try {
    const value = await op();
    listPatch = await refreshAfterMutation();
    applyRefreshPatch(listPatch);
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
    // An operation may replace its optimistic pending state with a different,
    // authoritative lifecycle (for example a wake rejected by the rebuild
    // gate). Only clear the action this runner originally owned.
    if (snapshot.localPending?.action === action) {
      updateSnapshot({ localPending: null });
    }
  }
}

async function wake(instanceId?: string): Promise<CloudInstanceWakeResult | undefined> {
  return runAction(
    instanceId ?? 'new',
    'wake',
    async () => {
      try {
        const result = await window.electronAPI.cloudInstances.wake(instanceId ? { instanceId } : {});
        if (!instanceId) retargetPending('wake', 'new', result.instanceId);
        return result;
      } catch (error) {
        if (extractIpcError(error)?.code === 'CLOUD_INSTANCE_REBUILD_IN_PROGRESS') {
          // The 409 itself is authoritative evidence that another client owns
          // an active rebuild. Keep every wake entry guarded even when the
          // recovery list is temporarily unavailable, then hydrate the exact
          // old-instance target as soon as GET /instances succeeds.
          updateSnapshot({
            localPending: {
              target: instanceId ?? 'new',
              action: 'rebuild',
              syncState: 'unknown',
            },
            rebuildSyncState: 'unknown',
          });
          applyRefreshPatch(await refresh(true));
        }
        throw error;
      }
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
 * Start the durable server-owned rebuild operation. The control plane retains
 * the original resource tier, proves old-runtime retirement, and exposes the
 * operation through GET /instances so another mount or App restart can resume
 * the client-owned creation continuation.
 */
async function rebuildInstance(instanceId: string): Promise<CloudInstanceRebuildResult | undefined> {
  const target = snapshot.instances.find((instance) => instance.instanceId === instanceId);
  if (!target) throw new Error(`cloud instance not found: ${instanceId}`);
  if (snapshot.pending) return undefined;
  updateSnapshot({ localPending: { target: instanceId, action: 'rebuild' } });
  let returnedDeleteRejected = false;
  try {
    const result = await window.electronAPI.cloudInstances.rebuild({
      instanceId,
      retryOfOperationId: rebuildRetryOfOperationId(snapshot.rebuildOperations, instanceId),
    });
    replaceRebuildOperation(result.rebuildOperation);
    if (result.rebuildOperation.phase === 'delete-rejected') {
      returnedDeleteRejected = true;
      throw new Error('cloud instance rebuild delete was rejected');
    }
    clearDeletedInstanceRendererState(target);
    const patch = await refreshAfterMutation();
    applyRefreshPatch(patch);
    return result;
  } catch (error) {
    if (returnedDeleteRejected) throw error;
    updateSnapshot({
      localPending: { target: instanceId, action: 'rebuild', syncState: 'unknown' },
      rebuildSyncState: 'unknown',
    });
    const patch = await refreshAfterMutation();
    const recovered = patch.rebuildOperations
      ? activeRebuildOperation(patch.rebuildOperations)
      : null;
    applyRefreshPatch(patch);
    if (recovered?.oldInstanceId === instanceId) {
      clearDeletedInstanceRendererState(target);
      return { rebuildOperation: recovered };
    }
    throw error;
  } finally {
    if (
      snapshot.localPending?.action === 'rebuild'
      && snapshot.localPending.target === instanceId
      && snapshot.localPending.syncState !== 'unknown'
    ) {
      updateSnapshot({ localPending: null });
    }
  }
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
  rebuildContinuationAttemptedAt.clear();
  subscribers.clear();
  __resetCloudInstanceRendererAuthorityForTest();
}

/** 仅供单元测试隔离模块级单例;生产代码不得调用。 */
export function __resetCloudInstancesStoreForTest(): void {
  resetCloudInstancesStore();
}

export function useCloudInstances(enabled = true): UseCloudInstances {
  const { instances, loadState, pending, rebuildAttention } = useSyncExternalStore(
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
      rebuildAttention,
      onlineDeviceIds,
      refresh: refreshSnapshot,
      wake,
      stopInstance,
      upgradeInstance,
      rebuildInstance,
      setAutoUpdate,
      deleteInstance,
    }),
    [instances, loadState, onlineDeviceIds, pending, rebuildAttention],
  );
}

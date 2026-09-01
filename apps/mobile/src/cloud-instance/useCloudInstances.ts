import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import {
  CloudInstanceActionTimeoutError,
  waitForCloudInstanceTerminalState,
  type CloudInstanceTerminalWatch,
} from '@cindy/maker-shared/cloud-instance';

import {
  deleteCloudInstance,
  listCloudInstances,
  patchCloudInstance,
  stopCloudInstance,
  upgradeCloudInstance,
  wakeCloudInstance,
  type CloudInstanceApiFetch,
  type CloudInstanceDeleteResult,
  type CloudInstanceStopResult,
  type CloudInstanceUpgradeResult,
  type CloudInstanceView,
  type CloudInstanceRebuildView,
  type CloudInstanceWakeResult,
} from '@/api/cloudInstance';
import {
  runCloudInstanceAction,
  runCloudInstanceWake,
  shouldApplyCloudInstanceRebuildSnapshot,
  type CloudInstanceAction,
  type CloudInstancePending,
} from '@/cloud-instance/cloudInstanceWake';
import { i18n } from '@/i18n';
import {
  createCloudInstanceRefreshLoop,
  type CloudInstanceRefreshLoop,
} from '@/cloud-instance/cloudInstanceRefreshLoop';
import {
  getMobileAuthOwner,
  isMobileAuthOwnerCurrent,
  type MobileAuthOwnerGeneration,
} from '@/auth/authOwnerGeneration';

export type CloudInstancesLoadState = 'loading' | 'ready' | 'unsupported' | 'error';
export type { CloudInstancePending } from '@/cloud-instance/cloudInstanceWake';

export const CLOUD_INSTANCE_ACTION_ERROR_KEYS = {
  wake: 'deviceLink.cloudInstance.wakeFailed',
  stop: 'deviceLink.cloudInstance.stopFailed',
  upgrade: 'deviceLink.cloudInstance.updateFailed',
  autoUpdate: 'deviceLink.cloudInstance.autoUpdateFailed',
  delete: 'deviceLink.cloudInstance.deleteFailed',
  rebuild: 'deviceLink.cloudInstance.rebuildFailed',
} as const satisfies Record<CloudInstanceAction, string>;

const ACTIVE_REBUILD_PHASES = new Set<CloudInstanceRebuildView['phase']>([
  'accepted',
  'retiring',
  'retirement-timeout',
  'retired-awaiting-create',
  'creating',
  'starting',
]);

function latestActiveRebuild(
  operations: readonly CloudInstanceRebuildView[],
): CloudInstanceRebuildView | null {
  return operations
    .filter((operation) => ACTIVE_REBUILD_PHASES.has(operation.phase))
    .reduce<CloudInstanceRebuildView | null>(
      (latest, operation) => !latest || operation.updatedAt > latest.updatedAt ? operation : latest,
      null,
    );
}

// Mobile 的 Home 与设备详情会同时挂在导航栈中；动作锁必须跨 hook 挂载共享，
// 否则从一个页面发起长动作后切到另一个页面仍可重复提交。
const sharedPendingRef: { current: CloudInstancePending } = { current: null };
const sharedPendingSubscribers = new Set<(value: CloudInstancePending) => void>();
let sharedTerminalWatchAbortController: AbortController | null = null;
let sharedRebuildRefreshSequence = 0;
let sharedRebuildAppliedSequence = 0;
let sharedPendingOwner: MobileAuthOwnerGeneration = getMobileAuthOwner();

function sameOwner(
  left: MobileAuthOwnerGeneration,
  right: MobileAuthOwnerGeneration,
): boolean {
  return left.accountId === right.accountId && left.generation === right.generation;
}

function adoptCurrentPendingOwner(): { owner: MobileAuthOwnerGeneration; changed: boolean } {
  const owner = getMobileAuthOwner();
  if (sameOwner(owner, sharedPendingOwner)) return { owner, changed: false };
  sharedPendingOwner = owner;
  sharedPendingRef.current = null;
  sharedTerminalWatchAbortController?.abort();
  sharedTerminalWatchAbortController = null;
  return { owner, changed: true };
}

function publishSharedPending(value: CloudInstancePending): void {
  sharedPendingRef.current = value;
  sharedPendingSubscribers.forEach((subscriber) => subscriber(value));
}

export interface UseCloudInstances {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePending;
  updateOnlineDeviceIds(deviceIds: ReadonlySet<string>): void;
  refresh(): Promise<void>;
  wake(instanceId?: string): Promise<CloudInstanceWakeResult | null>;
  stopInstance(instanceId: string): Promise<CloudInstanceStopResult | null>;
  upgradeInstance(instanceId: string): Promise<CloudInstanceUpgradeResult | null>;
  setAutoUpdate(instanceId: string, enabled: boolean): Promise<true | null>;
  deleteInstance(instanceId: string): Promise<CloudInstanceDeleteResult | null>;
}

/** Account-level cloud instances for the mobile device menu. */
export function useCloudInstances(
  apiFetch: CloudInstanceApiFetch,
  enabled = true,
): UseCloudInstances {
  const pendingOwner = adoptCurrentPendingOwner();
  const [instances, setInstances] = useState<CloudInstanceView[]>([]);
  const [loadState, setLoadState] = useState<CloudInstancesLoadState>('loading');
  const [pending, setPending] = useState<CloudInstancePending>(sharedPendingRef.current);
  const instancesRef = useRef<CloudInstanceView[]>([]);
  const onlineDeviceIdsRef = useRef<ReadonlySet<string>>(new Set());
  const refreshInFlightRef = useRef<ReturnType<typeof listCloudInstances> | null>(null);
  const appVisibleRef = useRef(AppState.currentState === 'active');
  const verifyingRef = useRef(false);
  const refreshRef = useRef<(silentFailure: boolean, allowPending?: boolean) => Promise<void>>(
    async () => undefined,
  );
  const refreshLoopRef = useRef<CloudInstanceRefreshLoop | null>(null);

  useEffect(() => {
    if (pendingOwner.changed) {
      sharedPendingSubscribers.forEach((subscriber) => subscriber(null));
    }
    setPending(sharedPendingRef.current);
  }, [pendingOwner.changed, pendingOwner.owner.accountId, pendingOwner.owner.generation]);

  useEffect(() => {
    const subscriber = (value: CloudInstancePending) => setPending(value);
    sharedPendingSubscribers.add(subscriber);
    setPending(sharedPendingRef.current);
    return () => {
      sharedPendingSubscribers.delete(subscriber);
      if (sharedPendingSubscribers.size === 0) {
        sharedTerminalWatchAbortController?.abort();
        sharedTerminalWatchAbortController = null;
      }
    };
  }, []);

  const requestRefresh = useCallback(async (silentFailure: boolean, allowPending = false) => {
    if (!enabled) return;
    if (
      !allowPending
      && sharedPendingRef.current !== null
      && sharedPendingRef.current.action !== 'rebuild'
    ) return;
    const ownerAtStart = getMobileAuthOwner();
    const rebuildRefreshSequence = ++sharedRebuildRefreshSequence;
    const request = refreshInFlightRef.current ?? listCloudInstances({ apiFetch });
    refreshInFlightRef.current = request;
    const result = await request.finally(() => {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
    });
    if (!isMobileAuthOwnerCurrent(ownerAtStart)) return;
    if (result.kind === 'ok') {
      instancesRef.current = result.value.instances;
      setInstances((current) => (
        cloudInstancesEqual(current, result.value.instances) ? current : result.value.instances
      ));
      if (shouldApplyCloudInstanceRebuildSnapshot(
        rebuildRefreshSequence,
        sharedRebuildAppliedSequence,
      )) {
        sharedRebuildAppliedSequence = rebuildRefreshSequence;
        const activeRebuild = latestActiveRebuild(result.value.rebuildOperations);
        if (activeRebuild) {
          publishSharedPending({ action: 'rebuild', target: activeRebuild.oldInstanceId });
        } else if (sharedPendingRef.current?.action === 'rebuild') {
          publishSharedPending(null);
        }
      }
      setLoadState('ready');
      return;
    }
    if (result.kind === 'unsupported') {
      instancesRef.current = [];
      setInstances((current) => (current.length === 0 ? current : []));
      setLoadState('unsupported');
      return;
    }
    // Mobile 没有统一 logger；只记录可诊断的分类元数据，不记录响应体、错误 message、
    // endpoint 或任何认证信息。静默后台刷新同样留痕，避免长期 error 无 UI 也无日志。
    console.warn('[cloud-instance] list failed', {
      code: result.error.code,
      silent: silentFailure,
      status: result.error.status,
    });
    if (!silentFailure) setLoadState('error');
  }, [apiFetch, enabled]);

  refreshRef.current = requestRefresh;
  if (!refreshLoopRef.current) {
    refreshLoopRef.current = createCloudInstanceRefreshLoop({
      isVisible: () => appVisibleRef.current,
      isVerifying: () => verifyingRef.current,
      refresh: () => refreshRef.current(true),
    });
  }

  const refresh = useCallback(() => requestRefresh(true), [requestRefresh]);
  const updateOnlineDeviceIds = useCallback((deviceIds: ReadonlySet<string>) => {
    onlineDeviceIdsRef.current = deviceIds;
  }, []);
  const refreshAfterAction = useCallback(
    async () => {
      // Do not reuse a menu/AppState refresh that began before the mutation.
      // The post-action read must observe the newly accepted server state.
      if (refreshInFlightRef.current) await refreshInFlightRef.current;
      await requestRefresh(false, true);
    },
    [requestRefresh],
  );

  useEffect(() => {
    if (!enabled) return;
    void requestRefresh(false, true);
  }, [enabled, requestRefresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const loop = refreshLoopRef.current;
    if (!loop) return undefined;
    loop.start();
    const subscription = AppState.addEventListener('change', (state) => {
      appVisibleRef.current = state === 'active';
      loop.visibilityChanged();
    });
    return () => {
      subscription.remove();
      loop.stop();
    };
  }, [enabled]);

  const verifying = instances.some((instance) => instance.status.upgrade.state === 'verifying')
    || pending?.action === 'rebuild';
  useEffect(() => {
    verifyingRef.current = verifying;
    refreshLoopRef.current?.instancesChanged();
  }, [verifying]);

  const waitForTerminal = useCallback(async (watch: CloudInstanceTerminalWatch) => {
    const controller = new AbortController();
    sharedTerminalWatchAbortController?.abort();
    sharedTerminalWatchAbortController = controller;
    try {
      await waitForCloudInstanceTerminalState({
        watch,
        getState: () => ({
          instances: instancesRef.current,
          onlineDeviceIds: onlineDeviceIdsRef.current,
        }),
        refresh: refreshAfterAction,
        signal: controller.signal,
      });
    } finally {
      if (sharedTerminalWatchAbortController === controller) {
        sharedTerminalWatchAbortController = null;
      }
    }
  }, [refreshAfterAction]);

  const onTerminalError = useCallback((error: unknown) => {
    if (error instanceof CloudInstanceActionTimeoutError) {
      Alert.alert(i18n.t('deviceLink.cloudInstance.actionTimedOut'));
    }
  }, []);

  const wake = useCallback(
    async (instanceId?: string) => {
      return runCloudInstanceWake(instanceId, {
        pendingRef: sharedPendingRef,
        setPending: publishSharedPending,
        requestWake: (target) => wakeCloudInstance(target, { apiFetch }),
        refresh: refreshAfterAction,
        onError: (error) => {
          if (error.code === 'REBUILD_IN_PROGRESS') {
            // The gate response is authoritative even if the follow-up list is
            // offline: preserve a rebuild guard instead of flashing idle and
            // allowing repeated wake attempts.
            publishSharedPending({ action: 'rebuild', target: instanceId ?? 'new' });
            Alert.alert(i18n.t('deviceLink.cloudInstance.rebuildStillCleaning'));
            return true;
          }
          if (error.code === 'CLOUD_INSTANCE_LOGIN_REQUIRED') {
            Alert.alert(i18n.t('deviceLink.cloudInstance.loginRequired'));
          } else if (error.code === 'ALREADY_EXISTS') {
            Alert.alert(i18n.t('deviceLink.cloudInstance.alreadyExists'));
          } else if (error.code === 'NOT_FOUND') {
            Alert.alert(i18n.t('deviceLink.cloudInstance.notFound'));
          } else {
            Alert.alert(i18n.t('deviceLink.cloudInstance.wakeFailed'));
          }
          return false;
        },
        onAccepted: (result) => {
          if (sharedPendingRef.current?.action !== 'wake' || sharedPendingRef.current.target !== 'new') return;
          const accepted = { action: 'wake' as const, target: result.instanceId };
          publishSharedPending(accepted);
        },
        waitForTerminal: (result) => waitForTerminal({
          action: 'wake',
          instanceId: result.instanceId,
          deviceId: result.deviceId,
        }),
        onTerminalError,
      });
    },
    [apiFetch, onTerminalError, refreshAfterAction, waitForTerminal],
  );

  const onActionError = useCallback((action: CloudInstanceAction, error?: { code?: string }) => {
    if (error?.code === 'CLOUD_INSTANCE_LOGIN_REQUIRED') {
      Alert.alert(i18n.t('deviceLink.cloudInstance.loginRequired'));
    } else if (error?.code === 'ALREADY_EXISTS') {
      Alert.alert(i18n.t('deviceLink.cloudInstance.alreadyExists'));
    } else if (error?.code === 'NOT_FOUND') {
      Alert.alert(i18n.t('deviceLink.cloudInstance.notFound'));
    } else {
      Alert.alert(i18n.t(CLOUD_INSTANCE_ACTION_ERROR_KEYS[action]));
    }
  }, []);

  const stopInstance = useCallback(
    (instanceId: string) => {
      const target = instancesRef.current.find((instance) => instance.instanceId === instanceId);
      if (!target) {
        onActionError('stop');
        return Promise.resolve(null);
      }
      return runCloudInstanceAction(instanceId, 'stop', {
        pendingRef: sharedPendingRef,
        setPending: publishSharedPending,
        request: () => stopCloudInstance(instanceId, { apiFetch }),
        refresh: refreshAfterAction,
        onError: onActionError,
        waitForTerminal: () => waitForTerminal({
          action: 'stop',
          instanceId,
          deviceId: target.deviceId,
        }),
        onTerminalError,
      });
    },
    [apiFetch, onActionError, onTerminalError, refreshAfterAction, waitForTerminal],
  );

  const deleteInstance = useCallback(
    (instanceId: string) =>
      runCloudInstanceAction(instanceId, 'delete', {
        pendingRef: sharedPendingRef,
        setPending: publishSharedPending,
        request: () => deleteCloudInstance(instanceId, { apiFetch }),
        refresh: refreshAfterAction,
        onError: onActionError,
      }),
    [apiFetch, onActionError, refreshAfterAction],
  );

  const upgradeInstance = useCallback(
    (instanceId: string) =>
      runCloudInstanceAction(instanceId, 'upgrade', {
        pendingRef: sharedPendingRef,
        setPending: publishSharedPending,
        request: () => upgradeCloudInstance(instanceId, { apiFetch }),
        refresh: refreshAfterAction,
        onError: (action, error) => {
          if (
            error.code === 'UPGRADE_IN_PROGRESS'
            || error.code === 'CLOUD_INSTANCE_UPGRADE_IN_PROGRESS'
          ) {
            return true;
          }
          if (error.code === 'NO_RELEASE_AVAILABLE') {
            Alert.alert(i18n.t('deviceLink.cloudInstance.noReleaseAvailable'));
            return false;
          }
          onActionError(action, error);
          return false;
        },
      }),
    [apiFetch, onActionError, refreshAfterAction],
  );

  const setAutoUpdate = useCallback(
    (instanceId: string, enabled: boolean) => {
      const previous = instances.find((instance) => instance.instanceId === instanceId)?.status.autoUpdate;
      if (typeof previous !== 'boolean') return Promise.resolve(null);
      const patchInstances = (value: boolean) => setInstances((current) => current.map((instance) =>
        instance.instanceId === instanceId
          ? { ...instance, status: { ...instance.status, autoUpdate: value } }
          : instance));
      return runCloudInstanceAction(instanceId, 'autoUpdate', {
        pendingRef: sharedPendingRef,
        setPending: publishSharedPending,
        request: () => patchCloudInstance(instanceId, { autoUpdate: enabled }, { apiFetch }),
        refresh: refreshAfterAction,
        onError: onActionError,
        onOptimisticStart: () => patchInstances(enabled),
        onOptimisticRollback: () => patchInstances(previous),
      });
    },
    [apiFetch, instances, onActionError, refreshAfterAction],
  );

  // 稳定对象身份:消费端整体透传给 DeviceMenuModal,memo 化后不随无关渲染变化。
  return useMemo(
    () => ({
      instances,
      loadState,
      pending,
      updateOnlineDeviceIds,
      refresh,
      wake,
      stopInstance,
      upgradeInstance,
      setAutoUpdate,
      deleteInstance,
    }),
    [deleteInstance, instances, loadState, pending, refresh, setAutoUpdate, stopInstance, updateOnlineDeviceIds, upgradeInstance, wake],
  );
}

function cloudInstancesEqual(
  left: readonly CloudInstanceView[],
  right: readonly CloudInstanceView[],
): boolean {
  return left.length === right.length
    && left.every((instance, index) => JSON.stringify(instance) === JSON.stringify(right[index]));
}

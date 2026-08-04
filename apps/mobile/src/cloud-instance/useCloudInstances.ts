import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import {
  deleteCloudInstance,
  listCloudInstances,
  stopCloudInstance,
  upgradeCloudInstance,
  wakeCloudInstance,
  type CloudInstanceApiFetch,
  type CloudInstanceDeleteResult,
  type CloudInstanceStopResult,
  type CloudInstanceUpgradeResult,
  type CloudInstanceView,
  type CloudInstanceWakeResult,
} from '@/api/cloudInstance';
import {
  runCloudInstanceAction,
  runCloudInstanceWake,
  type CloudInstanceAction,
  type CloudInstancePending,
} from '@/cloud-instance/cloudInstanceWake';
import { i18n } from '@/i18n';
import {
  createCloudInstanceRefreshLoop,
  type CloudInstanceRefreshLoop,
} from '@/cloud-instance/cloudInstanceRefreshLoop';

export type CloudInstancesLoadState = 'loading' | 'ready' | 'unsupported' | 'error';
export type { CloudInstancePending } from '@/cloud-instance/cloudInstanceWake';

export const CLOUD_INSTANCE_ACTION_ERROR_KEYS = {
  wake: 'deviceLink.cloudInstance.wakeFailed',
  stop: 'deviceLink.cloudInstance.stopFailed',
  upgrade: 'deviceLink.cloudInstance.updateFailed',
  delete: 'deviceLink.cloudInstance.deleteFailed',
} as const satisfies Record<CloudInstanceAction, string>;

export interface UseCloudInstances {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePending;
  refresh(): Promise<void>;
  wake(instanceId?: string): Promise<CloudInstanceWakeResult | null>;
  stopInstance(instanceId: string): Promise<CloudInstanceStopResult | null>;
  upgradeInstance(instanceId: string): Promise<CloudInstanceUpgradeResult | null>;
  deleteInstance(instanceId: string): Promise<CloudInstanceDeleteResult | null>;
}

/** Account-level cloud instances for the mobile device menu. */
export function useCloudInstances(apiFetch: CloudInstanceApiFetch): UseCloudInstances {
  const [instances, setInstances] = useState<CloudInstanceView[]>([]);
  const [loadState, setLoadState] = useState<CloudInstancesLoadState>('loading');
  const [pending, setPending] = useState<CloudInstancePending>(null);
  const pendingRef = useRef<CloudInstancePending>(null);
  const refreshInFlightRef = useRef<ReturnType<typeof listCloudInstances> | null>(null);
  const appVisibleRef = useRef(AppState.currentState === 'active');
  const verifyingRef = useRef(false);
  const refreshRef = useRef<(silentFailure: boolean, allowPending?: boolean) => Promise<void>>(
    async () => undefined,
  );
  const refreshLoopRef = useRef<CloudInstanceRefreshLoop | null>(null);

  const requestRefresh = useCallback(async (silentFailure: boolean, allowPending = false) => {
    if (!allowPending && pendingRef.current !== null) return;
    const request = refreshInFlightRef.current ?? listCloudInstances({ apiFetch });
    refreshInFlightRef.current = request;
    const result = await request.finally(() => {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
    });
    if (result.kind === 'ok') {
      setInstances((current) => (
        cloudInstancesEqual(current, result.value.instances) ? current : result.value.instances
      ));
      setLoadState('ready');
      return;
    }
    if (result.kind === 'unsupported') {
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
  }, [apiFetch]);

  refreshRef.current = requestRefresh;
  if (!refreshLoopRef.current) {
    refreshLoopRef.current = createCloudInstanceRefreshLoop({
      isVisible: () => appVisibleRef.current,
      isVerifying: () => verifyingRef.current,
      refresh: () => refreshRef.current(true),
    });
  }

  const refresh = useCallback(() => requestRefresh(true), [requestRefresh]);
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
    void requestRefresh(false, true);
  }, [requestRefresh]);

  useEffect(() => {
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
  }, []);

  const verifying = instances.some((instance) => instance.status.upgrade.state === 'verifying');
  useEffect(() => {
    verifyingRef.current = verifying;
    refreshLoopRef.current?.instancesChanged();
  }, [verifying]);

  const wake = useCallback(
    async (instanceId?: string) => {
      return runCloudInstanceWake(instanceId, {
        pendingRef,
        setPending,
        requestWake: (target) => wakeCloudInstance(target, { apiFetch }),
        refresh: refreshAfterAction,
        onError: () => Alert.alert(i18n.t('deviceLink.cloudInstance.wakeFailed')),
      });
    },
    [apiFetch, refreshAfterAction],
  );

  const onActionError = useCallback((action: CloudInstanceAction) => {
    Alert.alert(i18n.t(CLOUD_INSTANCE_ACTION_ERROR_KEYS[action]));
  }, []);

  const stopInstance = useCallback(
    (instanceId: string) =>
      runCloudInstanceAction(instanceId, 'stop', {
        pendingRef,
        setPending,
        request: () => stopCloudInstance(instanceId, { apiFetch }),
        refresh: refreshAfterAction,
        onError: onActionError,
      }),
    [apiFetch, onActionError, refreshAfterAction],
  );

  const deleteInstance = useCallback(
    (instanceId: string) =>
      runCloudInstanceAction(instanceId, 'delete', {
        pendingRef,
        setPending,
        request: () => deleteCloudInstance(instanceId, { apiFetch }),
        refresh: refreshAfterAction,
        onError: onActionError,
      }),
    [apiFetch, onActionError, refreshAfterAction],
  );

  const upgradeInstance = useCallback(
    (instanceId: string) =>
      runCloudInstanceAction(instanceId, 'upgrade', {
        pendingRef,
        setPending,
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
          onActionError(action);
          return false;
        },
      }),
    [apiFetch, onActionError, refreshAfterAction],
  );

  // 稳定对象身份:消费端整体透传给 DeviceMenuModal,memo 化后不随无关渲染变化。
  return useMemo(
    () => ({ instances, loadState, pending, refresh, wake, stopInstance, upgradeInstance, deleteInstance }),
    [deleteInstance, instances, loadState, pending, refresh, stopInstance, upgradeInstance, wake],
  );
}

function cloudInstancesEqual(
  left: readonly CloudInstanceView[],
  right: readonly CloudInstanceView[],
): boolean {
  return left.length === right.length
    && left.every((instance, index) => JSON.stringify(instance) === JSON.stringify(right[index]));
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import {
  deleteCloudInstance,
  listCloudInstances,
  stopCloudInstance,
  wakeCloudInstance,
  type CloudInstanceApiFetch,
  type CloudInstanceDeleteResult,
  type CloudInstanceStopResult,
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

export type CloudInstancesLoadState = 'loading' | 'ready' | 'unsupported' | 'error';
export type { CloudInstancePending } from '@/cloud-instance/cloudInstanceWake';

export const CLOUD_INSTANCE_ACTION_ERROR_KEYS = {
  wake: 'deviceLink.cloudInstance.wakeFailed',
  stop: 'deviceLink.cloudInstance.stopFailed',
  delete: 'deviceLink.cloudInstance.deleteFailed',
} as const satisfies Record<CloudInstanceAction, string>;

export interface UseCloudInstances {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePending;
  wake(instanceId?: string): Promise<CloudInstanceWakeResult | null>;
  stopInstance(instanceId: string): Promise<CloudInstanceStopResult | null>;
  deleteInstance(instanceId: string): Promise<CloudInstanceDeleteResult | null>;
}

/** Account-level cloud instances for the mobile device menu. */
export function useCloudInstances(apiFetch: CloudInstanceApiFetch): UseCloudInstances {
  const [instances, setInstances] = useState<CloudInstanceView[]>([]);
  const [loadState, setLoadState] = useState<CloudInstancesLoadState>('loading');
  const [pending, setPending] = useState<CloudInstancePending>(null);
  const pendingRef = useRef<CloudInstancePending>(null);

  const refresh = useCallback(async () => {
    const result = await listCloudInstances({ apiFetch });
    if (result.kind === 'ok') {
      setInstances(result.value.instances);
      setLoadState('ready');
      return;
    }
    if (result.kind === 'unsupported') {
      setInstances([]);
      setLoadState('unsupported');
      return;
    }
    setLoadState('error');
  }, [apiFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const wake = useCallback(
    async (instanceId?: string) => {
      return runCloudInstanceWake(instanceId, {
        pendingRef,
        setPending,
        requestWake: (target) => wakeCloudInstance(target, { apiFetch }),
        refresh,
        onError: () => Alert.alert(i18n.t('deviceLink.cloudInstance.wakeFailed')),
      });
    },
    [apiFetch, refresh],
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
        refresh,
        onError: onActionError,
      }),
    [apiFetch, onActionError, refresh],
  );

  const deleteInstance = useCallback(
    (instanceId: string) =>
      runCloudInstanceAction(instanceId, 'delete', {
        pendingRef,
        setPending,
        request: () => deleteCloudInstance(instanceId, { apiFetch }),
        refresh,
        onError: onActionError,
      }),
    [apiFetch, onActionError, refresh],
  );

  // 稳定对象身份:消费端整体透传给 DeviceMenuModal,memo 化后不随无关渲染变化。
  return useMemo(
    () => ({ instances, loadState, pending, wake, stopInstance, deleteInstance }),
    [deleteInstance, instances, loadState, pending, stopInstance, wake],
  );
}

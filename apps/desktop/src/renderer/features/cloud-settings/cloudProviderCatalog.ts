import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isModelVisible, type ProviderView } from '@cindy/model-providers';

import type { ModelListSource } from '@/components/settings/UnifiedModelList';
import { extractIpcError } from '@/utils/ipcError';
import { CloudModelDrawer } from './CloudModelDrawer';
import {
  CLOUD_PROVIDER_SETTINGS_CHANNEL,
  type CloudProviderSettingsList,
  type CloudProviderSettingsRequest,
  type CloudProviderSettingsWriteReceipt,
} from '../../../shared/cloudProviderSettings';
import { visibilityPreferenceKey } from '../../../shared/modelPresentationPreferences';

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Writes carry the catalog's owner generation and, for visibility, its revision. */
export type CloudProviderWrite = Without<
  Exclude<CloudProviderSettingsRequest, { op: 'list' }>,
  'ownerGeneration' | 'revision'
>;
/**
 * `unsupported`: the instance runtime predates the channel, or this account does not own the
 * instance. The page then keeps the ticket-only authorization list.
 */
export type CloudProviderCatalogStatus = 'loading' | 'ready' | 'unsupported' | 'unavailable';

function isCatalog(value: unknown): value is CloudProviderSettingsList {
  const list = value as Partial<CloudProviderSettingsList> | null;
  return (
    !!list &&
    list.version === 1 &&
    Number.isInteger(list.ownerGeneration) &&
    Array.isArray(list.providers) &&
    list.providers.every(
      (provider) =>
        !!provider &&
        typeof (provider as ProviderView).id === 'string' &&
        Array.isArray((provider as ProviderView).agents),
    ) &&
    Array.isArray(list.providerOrder) &&
    !!list.visibility &&
    typeof list.visibility.overrides === 'object' &&
    Array.isArray(list.supportedOps)
  );
}

/** The instance's provider catalog over the private DeviceLink channel. */
export function useCloudProviderCatalog({
  deviceId,
  online,
  active,
  refresh = 0,
}: {
  deviceId: string;
  online: boolean;
  active: boolean;
  refresh?: number;
}) {
  const [status, setStatus] = useState<CloudProviderCatalogStatus>('loading');
  const [list, setList] = useState<CloudProviderSettingsList | null>(null);
  const [visibilityVersion, setVisibilityVersion] = useState(0);
  const listRef = useRef(list);
  const sequence = useRef(0);
  const scope = useRef(deviceId);
  scope.current = deviceId;
  const invoke = useCallback(
    async <T>(request: CloudProviderSettingsRequest): Promise<T> =>
      (await window.electronAPI.deviceLink.invoke(deviceId, CLOUD_PROVIDER_SETTINGS_CHANNEL, [
        request,
      ])) as T,
    [deviceId],
  );
  const accept = (next: CloudProviderSettingsList | null) => {
    listRef.current = next;
    setList(next);
    setVisibilityVersion((version) => version + 1);
  };
  const load = useCallback(async () => {
    if (!deviceId || !online) return;
    const seq = ++sequence.current;
    try {
      const next = await invoke<unknown>({ op: 'list' });
      if (seq !== sequence.current || scope.current !== deviceId) return;
      if (!isCatalog(next)) throw new Error('INVALID_CATALOG');
      accept(next);
      setStatus('ready');
    } catch (error) {
      if (seq !== sequence.current || scope.current !== deviceId) return;
      const code = extractIpcError(error)?.code;
      if (code === 'DEVICE_LINK_CHANNEL_NOT_ALLOWED' || code === 'PERMISSION_DENIED')
        setStatus('unsupported');
      // A failed refresh keeps the last catalog, as the local page keeps its last snapshot.
      else setStatus(listRef.current ? 'ready' : 'unavailable');
    }
  }, [deviceId, online, invoke]);
  useEffect(() => {
    sequence.current++;
    accept(null);
    setStatus('loading');
  }, [deviceId]);
  useEffect(() => {
    if (active && online) void load();
  }, [active, online, refresh, load]);

  /** Resolves false when the instance refused the write; the catalog is then reread. */
  const write = useCallback(
    async (request: CloudProviderWrite): Promise<boolean> => {
      const current = listRef.current;
      if (!current || !online) return false;
      const visibility = request.op === 'visibility-set' || request.op === 'visibility-reset';
      if (visibility && (current.visibility.status !== 'ready' || !current.visibility.revision))
        return false;
      try {
        const receipt = await invoke<CloudProviderSettingsWriteReceipt>({
          ...request,
          ownerGeneration: current.ownerGeneration,
          ...(visibility ? { revision: current.visibility.revision } : {}),
        } as CloudProviderSettingsRequest);
        if (receipt?.ok !== true) throw new Error('INVALID_RECEIPT');
        if (receipt.visibility && listRef.current === current)
          accept({ ...current, visibility: receipt.visibility });
        if (receipt.catalogChanged) await load();
        return true;
      } catch {
        // Owner, revision and catalog changes all resolve the same way: show the instance's state.
        await load();
        return false;
      }
    },
    [invoke, load, online],
  );

  const source = useMemo<ModelListSource | null>(() => {
    if (!list) return null;
    const { visibility } = list;
    return {
      visibilityVersion,
      isModelEnabled: (agent, providerId, model) =>
        isModelVisible(
          visibility.status === 'ready'
            ? visibility.overrides[visibilityPreferenceKey(agent, providerId, model.id)]
            : undefined,
          model.defaultEnabled,
        ),
      setModelVisibilities: (providerId, targets, enabled) =>
        targets.length
          ? write({ op: 'visibility-set', providerId, targets: [...targets], enabled })
          : Promise.resolve(true),
      resetModelVisibilities: (providerId, targets) =>
        targets.length
          ? write({ op: 'visibility-reset', providerId, targets: [...targets] })
          : Promise.resolve(true),
      async setModelDisable(input) {
        if (!(await write({ op: 'model-disable', ...input }))) throw new Error('WRITE_FAILED');
      },
      AdvancedDrawer: CloudModelDrawer,
    };
  }, [list, visibilityVersion, write]);

  return {
    status,
    providers: (list?.providers ?? []) as ProviderView[],
    providerOrder: list?.providerOrder ?? [],
    supportedOps: list?.supportedOps ?? [],
    source,
    load,
    write,
  };
}

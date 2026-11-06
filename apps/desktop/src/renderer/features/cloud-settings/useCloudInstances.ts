import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import type { CloudSettingsRendererApi } from '../../../shared/cloudSettingsClient';
import type { CloudInstanceView } from '../../../shared/cloudInstanceControl';
import { stableInstanceState, canChangeInstancePower } from './instanceState';

export type CloudInstancesApi = Pick<
  CloudSettingsRendererApi,
  'instanceList' | 'instanceClaim' | 'instanceInitialize' | 'instancePower'
> & { onLoginCompleted?(cb: () => void): () => void };
export type PowerPending = { deviceId: string; action: 'wake' | 'sleep'; uncertain: boolean };

/**
 * The owner's CIS instance list with its claim, login and power actions. Shared by the
 * instances page and Settings → Remote connections → My devices, so one view polls once:
 * every 30 s, every 5 s while an instance is changing, never while the window is hidden.
 * Membership discovery is read-only; only an explicit claim ensures a first instance.
 */
export function useCloudInstances(api: CloudInstancesApi, onOpen: (deviceId: string) => void) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [instances, setInstances] = useState<CloudInstanceView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const [powerPending, setPowerPending] = useState<PowerPending>();
  const powerRef = useRef<PowerPending | undefined>(undefined);
  const markPower = (value: PowerPending | undefined) => {
    powerRef.current = value;
    setPowerPending(value);
  };
  const live = useRef(false),
    inFlight = useRef(false),
    openWhenReady = useRef<string | undefined>(undefined);
  const load = useCallback(
    async (explicit = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const next = await api.instanceList({});
        if (live.current) {
          setInstances(next);
          setError(undefined);
          const pending = powerRef.current;
          const observed = next.find((item) => item.deviceId === pending?.deviceId);
          if (
            pending &&
            ((pending.uncertain && explicit) ||
              (!pending.uncertain &&
                observed &&
                observed.desiredState === (pending.action === 'wake' ? 'running' : 'stopped') &&
                stableInstanceState(observed)))
          ) {
            powerRef.current = undefined;
            setPowerPending(undefined);
          }
        }
      } catch {
        if (live.current) setError('readFailed');
      } finally {
        inFlight.current = false;
      }
    },
    [api],
  );
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);
  useEffect(
    () =>
      api.onLoginCompleted?.(() => {
        void load();
      }),
    [api, load],
  );
  useEffect(() => {
    const pending =
      !!powerPending || instances?.some((v) => v.loginRequired || !stableInstanceState(v));
    const timer = setInterval(
      () => {
        if (document.visibilityState !== 'hidden') void load();
      },
      pending ? 5_000 : 30_000,
    );
    const visible = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [instances, load, powerPending]);
  useEffect(() => {
    const completed = instances?.find(
      (v) => v.deviceId === openWhenReady.current && !v.loginRequired && v.ready,
    );
    if (completed) {
      openWhenReady.current = undefined;
      onOpen(completed.deviceId);
    }
  }, [instances, onOpen]);

  const initialize = async (deviceId: string) => {
    await api.instanceInitialize({ deviceId });
    if (live.current) {
      setWaiting(deviceId);
      // An auxiliary login must not navigate the workspace when it completes.
      if (!api.onLoginCompleted) openWhenReady.current = deviceId;
    }
  };
  const act = async (claim: boolean, deviceId?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    let creating = claim;
    try {
      if (claim) {
        const next = await api.instanceClaim({});
        if (!live.current) return;
        setInstances(next);
        setUncertain(false);
        creating = false;
        if (next.length === 1 && next[0]!.loginRequired) await initialize(next[0]!.deviceId);
        else if (next.length === 1) openWhenReady.current = next[0]!.deviceId;
      } else if (deviceId) await initialize(deviceId);
    } catch {
      if (live.current) {
        setError(creating ? 'claimUnconfirmed' : 'loginFailed');
        if (creating) setUncertain(true);
      }
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  };
  const power = async (instance: CloudInstanceView, name: string) => {
    if (inFlight.current || powerRef.current || error || !canChangeInstancePower(instance)) return;
    inFlight.current = true;
    setBusy(true);
    const action = instance.desiredState === 'stopped' ? 'wake' : 'sleep';
    try {
      if (
        action === 'sleep' &&
        !(await confirm({
          presentation: 'standard',
          title: t('cloudSettings.instance.sleepTitle'),
          description: t('cloudSettings.instance.sleepBody', { name }),
          confirmText: t('cloudSettings.instance.sleep'),
        }))
      )
        return;
      if (!live.current) return;
      if (action === 'sleep') {
        if (openWhenReady.current === instance.deviceId) openWhenReady.current = undefined;
        setWaiting((current) => (current === instance.deviceId ? undefined : current));
      }
      markPower({ deviceId: instance.deviceId, action, uncertain: false });
      await api.instancePower({ deviceId: instance.deviceId, action });
    } catch {
      if (live.current) markPower({ deviceId: instance.deviceId, action, uncertain: true });
    } finally {
      inFlight.current = false;
      if (live.current) {
        setBusy(false);
        await load();
      }
    }
  };
  return {
    instances,
    busy,
    error,
    waiting,
    uncertain,
    powerPending,
    load,
    act,
    power,
    checkClaim: async () => {
      await load();
      if (live.current) setUncertain(false);
    },
  };
}

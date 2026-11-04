import { useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
} from '@/contexts/dataOwnerGeneration';
import type { CloudInstanceView } from '../../../shared/cloudInstanceControl';
import { DeviceSectionHeader } from '@/features/cc-agent/sidebar/DeviceSectionHeader';
import { useCloudInstanceAccess } from './CloudInstanceAccess';

/** CIS owns management discovery. A stopped local relay must not remove it.
 * This list never adds task targets or changes DeviceLink availability. */
function useOwnedCloudInstances() {
  const access = useCloudInstanceAccess();
  const { dataOwnerId, dataOwnerGeneration } = useAuth();
  const scope =
    access === 'allowed' && dataOwnerId ? JSON.stringify([dataOwnerId, dataOwnerGeneration]) : null;
  const [result, setResult] = useState<{ scope: string; instances: CloudInstanceView[] }>();
  useEffect(() => {
    if (!scope) return;
    const owner = getDataOwnerGeneration();
    let live = true;
    let inFlight = false;
    let lastReadAt = -Infinity;
    const current = () => live && isDataOwnerGenerationCurrent(owner);
    const refresh = async () => {
      if (!current() || inFlight || Date.now() - lastReadAt < 5_000) return;
      inFlight = true;
      lastReadAt = Date.now();
      try {
        const instances = await window.electronAPI.cloudSettings.instanceList({});
        if (current()) setResult({ scope, instances });
      } catch {
        if (current()) setResult({ scope, instances: [] });
      } finally {
        inFlight = false;
      }
    };
    const visible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    void refresh();
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [scope]);
  return scope && result?.scope === scope ? result.instances : [];
}

/** Fill only missing device headers; grouped task rows keep their own shortcut. */
export function CloudInstanceSidebarEntries({
  visibleDeviceIds,
}: {
  visibleDeviceIds: readonly (string | null)[];
}) {
  const access = useCloudInstanceAccess();
  if (access !== 'allowed') return null;
  return <OwnedCloudInstanceSidebarEntries visibleDeviceIds={visibleDeviceIds} />;
}

function OwnedCloudInstanceSidebarEntries({
  visibleDeviceIds,
}: {
  visibleDeviceIds: readonly (string | null)[];
}) {
  const instances = useOwnedCloudInstances();
  const location = useLocation();
  const { t } = useTranslation();
  const missing = instances.filter(
    (instance) =>
      instance.desiredState !== 'deleted' && !visibleDeviceIds.includes(instance.deviceId),
  );
  if (!missing.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1 pt-1 pl-3">
      {missing.map((instance) => {
        const name =
          instance.name ??
          t('cloudSettings.onboarding.defaultName', { number: instance.nameSequence });
        return (
          <DeviceSectionHeader key={instance.instanceId} deviceId={instance.deviceId} name={name}>
            <Link
              to={`/cloud-settings?${new URLSearchParams({ deviceId: instance.deviceId })}`}
              state={{ returnTo: location.pathname + location.search }}
              className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-full px-2 text-[var(--sidebar-list-muted)] transition-colors hover:text-[var(--sidebar-nav-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <MonitorSmartphone size={13} className="shrink-0" aria-hidden />
              <span className="truncate text-xs font-medium">{name}</span>
            </Link>
          </DeviceSectionHeader>
        );
      })}
    </div>
  );
}

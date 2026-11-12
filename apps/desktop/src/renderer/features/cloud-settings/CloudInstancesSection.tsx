import { useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import { useTranslation } from 'react-i18next';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import { toast } from '@/lib/toast';
import { CloudInstancesPage } from './CloudInstancesPage';
import { useCloudInstanceAccess } from './CloudInstanceAccess';
import { cloudInstanceName } from './instanceName';
import { CLOUD_INSTANCES_SETTINGS_PATH } from './cloudInstancesLink';
import { gatedCloudSettings, refuseWhileSimulating } from './cloudFaults';

/** Account-level discovery belongs inside Settings → Remote connections; instance
 * configuration keeps its own explicit target and returns to that group. */
export function CloudInstancesSection() {
  const navigate = useNavigate();
  const { mode, dataOwnerId } = useAuth();
  const access = useCloudInstanceAccess();
  const { t } = useTranslation();
  const devices = useDeviceLinkDeviceList();
  const owner = getDataOwnerGeneration();
  const api = useMemo(
    () => ({
      ...gatedCloudSettings(),
      instanceInitialize: async ({ deviceId }: { deviceId: string }) => {
        refuseWhileSimulating();
        await window.electronAPI.cloudLoginWindow.open({ deviceId });
      },
      onLoginCompleted: (cb: () => void) => window.electronAPI.cloudLoginWindow.onCompleted(cb),
    }),
    [],
  );
  if (mode !== 'cloud' || access !== 'allowed') return null;
  return (
    <CloudInstancesPage
      key={JSON.stringify([dataOwnerId, owner.generation])}
      embedded
      api={api}
      canOpenDesktop={(instance) =>
        !!devices?.some(
          (device) =>
            device.deviceId === instance.deviceId &&
            !device.isSelf &&
            device.online &&
            device.controlEnabled &&
            device.remoteControlEnabled,
        )
      }
      onOpenDesktop={(instance) => {
        void window.electronAPI
          .openRemoteDesktop({
            deviceId: instance.deviceId,
            name: cloudInstanceName(t, instance),
          })
          .catch(() => toast.error(t('remoteDesktop.connectionError')));
      }}
      onOpen={(deviceId, section) =>
        navigate(
          `/cloud-settings?${new URLSearchParams({ deviceId, ...(section ? { section } : {}) })}`,
          {
            state: { returnTo: CLOUD_INSTANCES_SETTINGS_PATH },
          },
        )
      }
    />
  );
}

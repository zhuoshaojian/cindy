import { useLocalSearchParams } from 'expo-router';

import { DeviceManagementScreen } from '@/device-link/DeviceManagementScreen';
import { resolveMobileDeviceDisplayName } from '@/device-link/devicePresentation';

export default function DeviceManagementRoute() {
  const params = useLocalSearchParams<{
    deviceId: string;
    name?: string;
    online?: string;
    cloudInstanceId?: string;
    cpuLabel?: string;
    image?: string;
    kind?: string;
    latestReleaseTag?: string;
    lastFailedUpgradeImage?: string;
    memoryGb?: string;
    modelLabel?: string;
    platform?: string;
    updateAvailable?: string;
    upgradeState?: string;
  }>();
  const upgradeState = readRouteString(params.upgradeState);
  return (
    <DeviceManagementScreen
      cloudInstanceId={readRouteString(params.cloudInstanceId) ?? undefined}
      cpuLabel={readRouteString(params.cpuLabel) ?? undefined}
      deviceId={readRouteString(params.deviceId) ?? ''}
      image={readRouteString(params.image) ?? undefined}
      kind={readRouteString(params.kind) ?? undefined}
      latestReleaseTag={readRouteString(params.latestReleaseTag) ?? undefined}
      lastFailedUpgradeImage={readRouteString(params.lastFailedUpgradeImage) ?? undefined}
      memoryGb={readFiniteNumber(params.memoryGb)}
      modelLabel={readRouteString(params.modelLabel) ?? undefined}
      name={resolveMobileDeviceDisplayName(
        readRouteString(params.name) ?? readRouteString(params.deviceId) ?? '',
      )}
      online={readRouteString(params.online) === '1'}
      platform={readRouteString(params.platform) ?? undefined}
      updateAvailable={readRouteString(params.updateAvailable) === '1'}
      upgradeState={
        upgradeState === 'verifying' || upgradeState === 'rolled-back'
          ? upgradeState
          : 'idle'
      }
    />
  );
}

function readRouteString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readFiniteNumber(value: unknown): number | undefined {
  const raw = readRouteString(value);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

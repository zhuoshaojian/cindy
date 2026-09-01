import { useLocalSearchParams } from 'expo-router';

import { DeviceManagementScreen } from '@/device-link/DeviceManagementScreen';
import { resolveMobileDeviceDisplayName } from '@/device-link/devicePresentation';

export default function DeviceManagementRoute() {
  const params = useLocalSearchParams<{
    deviceId: string;
    name?: string;
    online?: string;
    cpuLabel?: string;
    memoryGb?: string;
    modelLabel?: string;
    platform?: string;
  }>();
  return (
    <DeviceManagementScreen
      cpuLabel={readRouteString(params.cpuLabel) ?? undefined}
      deviceId={readRouteString(params.deviceId) ?? ''}
      memoryGb={readFiniteNumber(params.memoryGb)}
      modelLabel={readRouteString(params.modelLabel) ?? undefined}
      name={resolveMobileDeviceDisplayName(
        readRouteString(params.name) ?? readRouteString(params.deviceId) ?? '',
      )}
      online={readRouteString(params.online) === '1'}
      platform={readRouteString(params.platform) ?? undefined}
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

import {
  deviceDisplayName,
  parseCloudDeviceName,
  type DeviceListDeviceLike,
} from '@cindy/maker-shared/device-list';
import { i18n } from '@/i18n';

/** Marker-aware device presentation helpers shared by mobile selectors. */
export interface CloudMarkedDevice {
  kind?: 'cloud';
}

/** Render a cloud-device marker with the app's active language preference. */
export function formatMobileCloudDeviceName(): string {
  return i18n.t('deviceLink.cloudInstance.cloud');
}

type DevicePresentationInput = Pick<DeviceListDeviceLike, 'name' | 'selfName' | 'deviceInfo'>;

/** Resolve the cloud self-name sentinel using the app's active language preference. */
export function resolveMobileDeviceDisplayName(device: DevicePresentationInput): string {
  const name = deviceDisplayName(device);
  const marker = parseCloudDeviceName(name);
  return marker
    ? formatMobileCloudDeviceName()
    : name;
}

/** Preserve ordinary order while placing cloud Pods at the bottom. */
export function sortCloudDevicesLast<T>(devices: readonly T[]): T[] {
  return [...devices].sort((a, b) => {
    const aCloud = (a as CloudMarkedDevice).kind === 'cloud';
    const bCloud = (b as CloudMarkedDevice).kind === 'cloud';
    return Number(aCloud) - Number(bCloud);
  });
}

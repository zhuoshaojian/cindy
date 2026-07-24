import {
  CLOUD_DEVICE_NAME_SENTINEL,
  deviceDisplayName,
  type DeviceListDeviceLike,
} from '@lizi/maker-shared/device-list';

/** Marker-aware device presentation helpers shared by mobile selectors. */
export interface CloudMarkedDevice {
  kind?: 'cloud';
}

const CLOUD_DEVICE_NAMES = {
  en: 'Cloud',
  ja: 'クラウド',
  ko: '클라우드',
  zh: '云端',
} as const;

type DevicePresentationInput = Pick<DeviceListDeviceLike, 'name' | 'selfName' | 'deviceInfo'>;

/** Resolve the cloud self-name sentinel using the viewer's language code. */
export function resolveMobileDeviceDisplayName(
  device: DevicePresentationInput,
  languageCode?: string | null,
): string {
  const name = deviceDisplayName(device);
  if (name !== CLOUD_DEVICE_NAME_SENTINEL) return name;

  const normalized = languageCode?.toLowerCase() ?? '';
  if (normalized.startsWith('zh')) return CLOUD_DEVICE_NAMES.zh;
  if (normalized.startsWith('ja')) return CLOUD_DEVICE_NAMES.ja;
  if (normalized.startsWith('ko')) return CLOUD_DEVICE_NAMES.ko;
  return CLOUD_DEVICE_NAMES.en;
}

/** Preserve ordinary order while placing cloud Pods at the bottom. */
export function sortCloudDevicesLast<T>(devices: readonly T[]): T[] {
  return [...devices].sort((a, b) => {
    const aCloud = (a as CloudMarkedDevice).kind === 'cloud';
    const bCloud = (b as CloudMarkedDevice).kind === 'cloud';
    return Number(aCloud) - Number(bCloud);
  });
}

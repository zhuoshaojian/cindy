import {
  deviceDisplayName,
  parseCloudDeviceName,
  type DeviceListDeviceLike,
} from '@cindy/maker-shared/device-list';

/** Marker-aware device presentation helpers shared by mobile selectors. */
export interface CloudMarkedDevice {
  kind?: 'cloud';
}

export const CLOUD_DEVICE_NAMES = {
  en: 'Cloud',
  ja: 'クラウド',
  ko: '클라우드',
  zh: '云端',
} as const;

export type MobileLanguageBucket = keyof typeof CLOUD_DEVICE_NAMES;

/** Render a cloud-device marker with the viewer's mobile language. */
export function formatMobileCloudDeviceName(
  languageCode?: string | null,
): string {
  return CLOUD_DEVICE_NAMES[resolveMobileLanguageBucket(languageCode)];
}

/** Fold a BCP-47 language code into mobile's supported translation buckets. */
export function resolveMobileLanguageBucket(
  languageCode?: string | null,
): MobileLanguageBucket {
  const normalized = languageCode?.toLowerCase() ?? '';
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('ko')) return 'ko';
  return 'en';
}

type DevicePresentationInput = Pick<DeviceListDeviceLike, 'name' | 'selfName' | 'deviceInfo'>;

/** Resolve the cloud self-name sentinel using the viewer's language code. */
export function resolveMobileDeviceDisplayName(
  device: DevicePresentationInput,
  languageCode?: string | null,
): string {
  const name = deviceDisplayName(device);
  const marker = parseCloudDeviceName(name);
  return marker
    ? formatMobileCloudDeviceName(languageCode)
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

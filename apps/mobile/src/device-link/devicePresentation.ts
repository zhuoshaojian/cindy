import {
  deviceDisplayName,
  isCloudInstanceDeviceId,
  parseCloudDeviceName,
  type DeviceListDeviceLike,
} from '@cindy/maker-shared/device-list';
import { i18n } from '@/i18n';

/** Render a cloud-device marker with the app's active language preference. */
export function formatMobileCloudDeviceName(): string {
  return i18n.t('deviceLink.cloudInstance.cloud');
}

type DevicePresentationInput = Pick<DeviceListDeviceLike, 'deviceId' | 'name' | 'selfName'>;

/** Resolve the cloud self-name sentinel using the app's active language preference. */
export function resolveMobileDeviceDisplayName(device: DevicePresentationInput | string): string {
  const name = typeof device === 'string' ? device : deviceDisplayName(device);
  const marker = parseCloudDeviceName(name);
  return marker || isCloudInstanceDeviceId(name)
    ? formatMobileCloudDeviceName()
    : name;
}

/**
 * Preserve ordinary order while placing cloud Pods at the bottom.
 *
 * 判据与桌面 switcherDevices 一致:只看 deviceId 前缀。此前读的是调用方带过来的
 * `kind` 字段,一旦传入的设备结构没有那个字段,两边都是 undefined、比较子恒为 0,
 * 排序静默空转 —— 正是「把云端身份缓存回某个字段」这类 bug。要求 deviceId 让漏传
 * 变成编译错误。
 */
export function sortCloudDevicesLast<T extends { deviceId: string }>(devices: readonly T[]): T[] {
  return [...devices].sort(
    (a, b) => Number(isCloudInstanceDeviceId(a.deviceId)) - Number(isCloudInstanceDeviceId(b.deviceId)),
  );
}

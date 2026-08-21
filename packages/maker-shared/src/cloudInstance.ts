import { CLOUD_DEVICE_NAME_SENTINEL } from './deviceList.js';

/**
 * 唤醒受理(控制面返回)到 Pod presence 上线之间约一分钟空窗,此时 pending 已清
 * 但设备仍离线;两端消费者用 wake-watch 在这段时间维持「唤醒中」态,超过此时限
 * 视为唤醒失败并解除,避免异常时入口永久卡死。桌面/手机必须同值,故落在共享层。
 */
export const CLOUD_WAKE_WATCH_TIMEOUT_MS = 180_000;

/**
 * Extract the explicit tag from a container image reference without guessing
 * `latest`. Digest-qualified refs keep the tag before `@sha256:...`.
 */
export function parseCloudInstanceImageTag(
  image: string | null | undefined,
): string | null {
  const value = image?.trim();
  if (!value) return null;
  const digestSeparator = value.indexOf('@');
  const name = digestSeparator >= 0 ? value.slice(0, digestSeparator) : value;
  const lastSlash = name.lastIndexOf('/');
  const tagSeparator = name.lastIndexOf(':');
  if (tagSeparator <= lastSlash) return null;
  const tag = name.slice(tagSeparator + 1);
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag) ? tag : null;
}

/** Control-plane naming metadata joined to a relay device by stable deviceId. */
export interface CloudInstanceNameMetadata {
  customLabel: string | null;
  nameSequence: number;
}

/**
 * Pure, locale-free cloud instance name presentation.
 *
 * UI hosts translate `default` with their viewer locale, render `custom`
 * verbatim, and resolve `fallback` through the existing generic cloud-device
 * sentinel when control-plane metadata is unavailable or malformed.
 */
export type CloudInstanceNameDescriptor =
  | { kind: 'custom'; label: string }
  | { kind: 'default'; sequence: number }
  | { kind: 'fallback'; name: typeof CLOUD_DEVICE_NAME_SENTINEL };

export function describeCloudInstanceName(
  metadata: CloudInstanceNameMetadata | null | undefined,
): CloudInstanceNameDescriptor {
  if (
    !metadata ||
    !Number.isInteger(metadata.nameSequence) ||
    metadata.nameSequence < 1
  ) {
    return { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL };
  }
  if (typeof metadata.customLabel === 'string') {
    return metadata.customLabel.length > 0
      ? { kind: 'custom', label: metadata.customLabel }
      : { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL };
  }
  if (metadata.customLabel !== null) {
    return { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL };
  }
  return { kind: 'default', sequence: metadata.nameSequence };
}

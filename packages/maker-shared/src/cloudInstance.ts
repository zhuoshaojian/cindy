import { CLOUD_DEVICE_NAME_SENTINEL } from './deviceList.js';

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

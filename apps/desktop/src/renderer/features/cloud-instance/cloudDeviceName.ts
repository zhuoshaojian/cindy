import type { CloudInstanceNameDescriptor } from '@cindy/maker-shared/cloud-instance';
import {
  CLOUD_DEVICE_NAME_SENTINEL,
  parseCloudDeviceName,
} from '@cindy/maker-shared/device-list';

export type CloudDeviceNameTranslator = (key: string) => string;

/** Single desktop i18n endpoint for control-plane and relay cloud names. */
export function translateDesktopCloudInstanceName(
  descriptor: CloudInstanceNameDescriptor,
  translate: CloudDeviceNameTranslator,
): string {
  if (descriptor.kind === 'custom') return descriptor.label;
  return translate('settings.devices.cloudDeviceName');
}

/**
 * Translate a locale-neutral relay cloud-device marker at the final renderer
 * boundary. Ordinary and manually renamed device names remain verbatim.
 */
export function resolveDesktopCloudDeviceName(
  name: string,
  translate: CloudDeviceNameTranslator,
): string {
  const marker = parseCloudDeviceName(name);
  if (!marker) return name;
  return translateDesktopCloudInstanceName(
    marker.sequence === null
      ? { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL }
      : { kind: 'default', sequence: marker.sequence },
    translate,
  );
}

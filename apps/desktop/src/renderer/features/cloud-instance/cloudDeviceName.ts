import {
  describeCloudInstanceName,
  type CloudInstanceNameDescriptor,
  type CloudInstanceNameMetadata,
} from '@cindy/maker-shared/cloud-instance';
import {
  CLOUD_DEVICE_NAME_SENTINEL,
  isCloudInstanceDeviceId,
  parseCloudDeviceName,
} from '@cindy/maker-shared/device-list';

export type CloudDeviceNameTranslator = (key: string) => string;

/**
 * 控制面实例 → 展示名的一步到位入口(describe + translate)。
 * 机器切换菜单与创建页此前各自手拼这两步,收敛到这里。
 */
export function desktopCloudInstanceDisplayName(
  instance: CloudInstanceNameMetadata,
  translate: CloudDeviceNameTranslator,
): string {
  return translateDesktopCloudInstanceName(describeCloudInstanceName(instance), translate);
}

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
  if (!marker && !isCloudInstanceDeviceId(name)) return name;
  return translateDesktopCloudInstanceName(
    marker === null || marker.sequence === null
      ? { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL }
      : { kind: 'default', sequence: marker.sequence },
    translate,
  );
}

/** Format relay device names for user-visible multi-device labels. */
export function formatDesktopDeviceNameList(
  names: readonly string[],
  locale: string,
  translate: CloudDeviceNameTranslator,
): string {
  return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(
    names.map((name) => resolveDesktopCloudDeviceName(name, translate)),
  );
}

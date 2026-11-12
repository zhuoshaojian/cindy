import type { TFunction } from 'i18next';
import { deviceDisplayName } from '@/lib/deviceName';

/** CIS's name for a cloud Cindy: the owner's rename there, or the plain default. */
export function cloudInstanceName(t: TFunction, instance: { name: string | null }): string {
  return instance.name ?? t('cloudSettings.onboarding.defaultNameSole');
}

// What a runtime reports when CIS has no default label configured (CIS provider-shared.ts).
const DEVICE_NAME_MARKER = /^__cindy_cloud_device_name__:\d+$/u;

/**
 * A cloud Cindy's own name, before any 「(n)」: the name the user gave it, which CIS keeps for the
 * client and the web alike (its card's rename sets it there); otherwise the name the device list
 * has for it; otherwise the default.
 */
export function cloudBaseName(
  t: TFunction,
  deviceId: string,
  listedName: string | null | undefined,
  instance: { name: string | null } | undefined,
): string {
  if (instance?.name) return instance.name;
  const listed = listedName?.trim();
  if (listed && listed !== deviceId && !DEVICE_NAME_MARKER.test(listed)) return listed;
  return t('cloudSettings.onboarding.defaultNameSole');
}

/**
 * The name a cloud Cindy shows wherever this computer shows it (card, menu, dialogs, toasts,
 * settings, remote desktop): its own name, and when another device has the same name, the client's
 * usual 「(1)」「(2)」 (deviceDisplayName), as the sidebar and device pickers show it. `devices` are
 * all listed devices with their own names (cloudBaseName for cloud Cindys).
 */
export function cloudDisplayName(
  deviceId: string,
  baseName: string,
  devices: readonly { deviceId: string; name?: string | null }[],
): string {
  return deviceDisplayName(deviceId, baseName, devices);
}

/** Cards and lists of cloud Cindys in name order, so 「(1)」 comes before 「(2)」. */
export const byShownName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

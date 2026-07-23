import type { SupportedLocale } from '../../shared/locale.js';

/**
 * Pod-specific device-link startup defaults.
 *
 * A provisioned Pod is the account owner's always-on device. Its relay
 * connection is still restricted to the same account, so enabling inbound
 * remote control is safe for this mode only. Ordinary desktop/headless
 * instances keep the explicit opt-in default.
 */
export interface PodDeviceLinkStartupDeps {
  initDeviceLinkService: () => void;
  readRemoteControlEnabled: () => boolean;
  setRemoteControlEnabled: (enabled: boolean) => Promise<void>;
  logger?: { info(message: string, context?: unknown): void };
}

/**
 * Start device-link for a provisioned Pod and enable inbound control once.
 * The init call intentionally precedes the setter so an online client can
 * immediately receive the presence update; an already-enabled setting is a
 * no-op and avoids an unnecessary write/broadcast.
 */
export async function initializePodDeviceLink(
  podMode: boolean,
  deps: PodDeviceLinkStartupDeps,
): Promise<boolean> {
  if (!podMode) return false;
  deps.initDeviceLinkService();
  if (!deps.readRemoteControlEnabled()) {
    await deps.setRemoteControlEnabled(true);
    deps.logger?.info('Pod device-link remote control enabled');
  }
  return true;
}

/**
 * Localized self-name sent in hello as the device's default name.
 *
 * The relay stores this as selfName and keeps a user-selected manual name
 * authoritative, so reconnects never overwrite an account owner's rename.
 */
export const POD_DEVICE_NAME_BY_LOCALE: Record<SupportedLocale, string> = {
  'zh-CN': '云端',
  en: 'Cloud',
  ja: 'クラウド',
  ko: '클라우드',
};

export interface DeviceNameOptions {
  podMode: boolean;
  locale: SupportedLocale;
  hostname: string;
}

/** Resolve the hello self-name without changing ordinary instances. */
export function resolveDeviceLinkDeviceName(options: DeviceNameOptions): string {
  if (options.podMode) return POD_DEVICE_NAME_BY_LOCALE[options.locale];
  const hostname = options.hostname.trim();
  return hostname || 'Unknown Device';
}

/**
 * Pod-specific device-link startup defaults.
 *
 * A provisioned Pod is the account owner's always-on device. Its relay
 * connection is still restricted to the same account, so enabling inbound
 * remote control is safe for this mode only. Ordinary desktop/headless
 * instances keep the explicit opt-in default.
 */
import {
  formatCloudDeviceName,
  parseCloudDeviceName,
} from '@cindy/maker-shared/device-list';

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

export interface DeviceNameOptions {
  podMode: boolean;
  hostname: string;
  /** Locale-neutral self-name provisioned by the cloud control plane. */
  provisionedName?: string;
}

/**
 * Resolve the hello self-name without changing ordinary instances.
 * Pod names are deliberately locale-neutral: clients translate the unchanged
 * `name === selfName` sentinel for each viewer, while manual names stay raw.
 */
export function resolveDeviceLinkDeviceName(options: DeviceNameOptions): string {
  if (options.podMode) {
    const marker = parseCloudDeviceName(options.provisionedName?.trim() ?? '');
    return formatCloudDeviceName(marker?.sequence);
  }
  const hostname = options.hostname.trim();
  return hostname || 'Unknown Device';
}

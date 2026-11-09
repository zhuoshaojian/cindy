import { createCloudSettingsService } from '../../main/cloud-settings-client/service';
import { cloudSettingsClientHandlers } from '../../main/cloud-settings-client/ipc';
import { CloudClientError } from '../../main/cloud-settings-client/transport';
import type { CloudSettingsRendererApi } from '../../shared/cloudSettingsClient';
import type { CloudInstanceView } from '../../shared/cloudInstanceControl';
import { createIpcError, isIpcErrorCode, type IpcErrorCode } from '../../shared/ipc-errors';
import { SETTINGS_WEB_CHANNELS } from '../../shared/settingsWeb';
import { createCisClientHttp, createCisFetch, CisSignedOutError } from './cisHttp';
import { createHostRelay, HostCallError, type HostChannel } from './hostRelay';

export interface CisSession {
  membershipId: string;
  passportId: string;
  kind: string;
  orgSlug: string | null;
}

/**
 * The cloud pages' Main-side adapters, run in the page instead: the native client's own
 * cloud settings service over the CIS browser session, plus the relayed Host calls.
 */
export function createWebCloudApi(session: CisSession, onSignedOut: () => void) {
  const request = createCisFetch(onSignedOut);
  const http = createCisClientHttp(request);
  const identity = { key: `web:${session.membershipId}`, generation: 1, baseUrl: location.origin, accessToken: '' };
  const service = createCloudSettingsService({ identity: () => identity, http });
  const handlers = cloudSettingsClientHandlers(service);
  const caller = { id: 1, assertCurrent() {} };
  const cloudSettings = Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      (input: unknown) => (handler as (c: typeof caller, raw: unknown) => Promise<unknown>)(caller, input),
    ]),
  ) as unknown as CloudSettingsRendererApi;

  let instances: CloudInstanceView[] = [];
  const listeners = new Set<() => void>();
  const listInstances = async () => {
    const next = await cloudSettings.instanceList({});
    instances = next;
    for (const listener of listeners) listener();
    return next;
  };
  const instanceFor = async (deviceId: string) => {
    let found = instances.find((item) => item.deviceId === deviceId);
    if (!found) found = (await listInstances()).find((item) => item.deviceId === deviceId);
    if (!found) throw createIpcError('DEVICE_LINK_DEVICE_OFFLINE', 'DEVICE_LINK_DEVICE_OFFLINE');
    return found.instanceId;
  };
  const relay = createHostRelay(request, instanceFor);

  /** DeviceLink failure shapes the cloud pages already decode. */
  const invokeFailure = (error: unknown): Error => {
    if (error instanceof CisSignedOutError) return createIpcError('DEVICE_LINK_NOT_CONNECTED', 'DEVICE_LINK_NOT_CONNECTED');
    if (error instanceof HostCallError) {
      if (error.code === 'SETTINGS_UNSUPPORTED')
        return createIpcError('DEVICE_LINK_CHANNEL_NOT_ALLOWED', 'DEVICE_LINK_CHANNEL_NOT_ALLOWED');
      if (error.code === 'INVOKE_TIMEOUT') return createIpcError('DEVICE_LINK_TIMEOUT', 'DEVICE_LINK_TIMEOUT');
      return isIpcErrorCode(error.code)
        ? createIpcError(error.code as IpcErrorCode, error.code)
        : createIpcError('INTERNAL', error.code);
    }
    if (error instanceof CloudClientError) {
      const remote = (error as CloudClientError & { remoteCode?: unknown }).remoteCode;
      if (remote === 'SETTINGS_HOST_OFFLINE' || remote === 'SETTINGS_RUNTIME_CHANGED')
        return createIpcError('DEVICE_LINK_DEVICE_OFFLINE', 'DEVICE_LINK_DEVICE_OFFLINE');
      if (error.code === 'CLOUD_SETTINGS_BUSY') return createIpcError('DEVICE_LINK_BUSY', 'DEVICE_LINK_BUSY');
    }
    return error instanceof Error && isIpcErrorCode((error as { code?: unknown }).code)
      ? error
      : createIpcError('DEVICE_LINK_UNAVAILABLE', 'DEVICE_LINK_UNAVAILABLE');
  };
  const online = (item: CloudInstanceView) =>
    item.ready && item.desiredState === 'running' && !item.loginRequired;

  const deviceLink = {
    async invoke(deviceId: string, channel: string, args: unknown[]) {
      if (!(SETTINGS_WEB_CHANNELS as readonly string[]).includes(channel))
        throw createIpcError('DEVICE_LINK_CHANNEL_NOT_ALLOWED', 'DEVICE_LINK_CHANNEL_NOT_ALLOWED');
      try {
        return await relay.call(deviceId, { kind: 'channel', channel: channel as HostChannel, args: Array.isArray(args) ? args : [] });
      } catch (error) {
        throw invokeFailure(error);
      }
    },
    async getState() {
      return {
        remoteControlEnabled: true,
        keepAwake: false,
        linkStatus: 'online' as const,
        connectionIssue: null,
        standby: false,
        controlledBy: [],
        revokedControllers: [],
        disabledControlDeviceIds: [],
        unresponsiveDeviceIds: [],
      };
    },
    async listDevices() {
      const list = await listInstances().catch(() => instances);
      return {
        devices: list.map((item) => ({
          deviceId: item.deviceId,
          name: item.name ?? '',
          platform: 'linux',
          appVersion: item.version,
          lastSeenAt: null,
          online: online(item),
          busy: false,
          remoteControlEnabled: true,
          controlEnabled: true,
          isSelf: false,
        })),
      };
    },
  };

  return {
    cloudSettings,
    deviceLink,
    relay,
    listInstances,
    instances: () => instances,
    onInstancesChanged(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    online,
    invokeFailure,
  };
}
export type WebCloudApi = ReturnType<typeof createWebCloudApi>;

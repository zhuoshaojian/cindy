import { createCloudSettingsService } from '../../main/cloud-settings-client/service';
import { cloudSettingsClientHandlers } from '../../main/cloud-settings-client/ipc';
import { CloudClientError } from '../../main/cloud-settings-client/transport';
import type { CloudSettingsRendererApi } from '../../shared/cloudSettingsClient';
import type { CloudInstanceView } from '../../shared/cloudInstanceControl';
import { createIpcError, isIpcErrorCode, type IpcErrorCode } from '../../shared/ipc-errors';
import { SETTINGS_WEB_CHANNELS } from '../../shared/settingsWeb';
import { MODEL_CATALOG_READ_CHANNELS } from '../../shared/controlledModelCatalog';
import { isProviderManagementRequest, type ProviderManagementReply } from '../../shared/providerManagement';
import { PROVIDER_SHARE_LINK_TTL_MS } from '@cindy/device-link';
import { createCisClientHttp, createCisFetch, CisSignedOutError } from './cisHttp';
import { createHostRelay, HostCallError, type HostChannel } from './hostRelay';

export interface CisSession {
  membershipId: string;
  passportId: string;
  kind: string;
  orgSlug: string | null;
}

const CLOUD_DEVICE = /^cloud-device-[a-f0-9]{24}$/u;

/**
 * Where a DeviceLink call from the cloud pages goes. The browser reaches only the owner's
 * instances. Model catalogs of the sources an instance lists (providers shared with it, the
 * owner's other computers) live behind that instance, so the settings page reads them through
 * the instance it shows, as the instance's own model picker does (`maker:model-catalog:read`).
 */
export function routeDeviceLinkCall(deviceId: string, channel: string, args: unknown[], viewing: string | null) {
  const list = Array.isArray(args) ? args : [];
  if (!CLOUD_DEVICE.test(deviceId) && (MODEL_CATALOG_READ_CHANNELS as readonly string[]).includes(channel)) {
    if (!viewing) throw createIpcError('DEVICE_LINK_DEVICE_OFFLINE', 'DEVICE_LINK_DEVICE_OFFLINE');
    return {
      deviceId: viewing,
      channel: 'maker:model-catalog:read' as HostChannel,
      args: [{ op: 'read', agentDeviceId: deviceId, channel, args: list }],
    };
  }
  if (!(SETTINGS_WEB_CHANNELS as readonly string[]).includes(channel))
    throw createIpcError('DEVICE_LINK_CHANNEL_NOT_ALLOWED', 'DEVICE_LINK_CHANNEL_NOT_ALLOWED');
  return { deviceId, channel: channel as HostChannel, args: list };
}

/**
 * The instance's reply to one owner provider-management request (its remote and share page),
 * unwrapped as the native client's Main does. A link the instance created expires on the
 * instance's clock, so its lifetime is carried over as the remaining duration. Join requests
 * are approved in that page's request list: a browser cannot show the approval prompt.
 */
export function unwrapProviderManagementReply(request: unknown, raw: unknown, now = Date.now()): unknown {
  const reply = raw as ProviderManagementReply | null;
  if (!reply || typeof reply !== 'object' || !Object.hasOwn(reply, 'result') || !Number.isFinite(reply.respondedAt))
    throw createIpcError('PRECONDITION_FAILED', 'Invalid provider management response');
  const command = (request as { action?: string; command?: { action?: string } }).command;
  if ((request as { action?: string }).action !== 'manage-share' || command?.action !== 'create-link') return reply.result;
  const created = reply.result as { link?: unknown; linkId?: unknown; expiresAt?: unknown } | null;
  if (!created || typeof created.link !== 'string' || !created.link || created.link.length > 4096
    || typeof created.linkId !== 'string' || !/^[a-f0-9]{64}$/u.test(created.linkId)
    || typeof created.expiresAt !== 'string' || !Number.isFinite(Date.parse(created.expiresAt)))
    throw createIpcError('PRECONDITION_FAILED', 'Invalid provider share link');
  const remaining = Math.max(0, Math.min(PROVIDER_SHARE_LINK_TTL_MS, Date.parse(created.expiresAt) - reply.respondedAt));
  return { link: created.link, linkId: created.linkId, expiresAt: new Date(now + remaining).toISOString() };
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

  // The instance the settings page shows; see routeDeviceLinkCall.
  let viewing: string | null = null;
  const deviceLink = {
    async invoke(deviceId: string, channel: string, args: unknown[]) {
      const call = routeDeviceLinkCall(deviceId, channel, args, viewing);
      try {
        return await relay.call(call.deviceId, { kind: 'channel', channel: call.channel, args: call.args });
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

  /** The provider bridge the remote and share page uses: only management of an instance. */
  const providerGroup = {
    async command(raw: { action?: string; deviceId?: unknown; request?: unknown }) {
      if (raw?.action !== 'remote-manage' || typeof raw.deviceId !== 'string' || !isProviderManagementRequest(raw.request))
        throw new Error('UNSUPPORTED_IN_WEB');
      let reply: unknown;
      try {
        reply = await deviceLink.invoke(raw.deviceId, 'provider-group:remote', [raw.request]);
      } catch (error) {
        // An instance before cloud.4 does not take it from the browser yet.
        if ((error as { code?: unknown }).code === 'DEVICE_LINK_CHANNEL_NOT_ALLOWED')
          throw createIpcError('UNSUPPORTED_CAPABILITY', 'Provider management requires an update on the instance');
        throw error;
      }
      return unwrapProviderManagementReply(raw.request, reply);
    },
  };

  return {
    cloudSettings,
    deviceLink,
    providerGroup,
    relay,
    listInstances,
    /** The existing CIS page owns SSO and verification for this selected instance. */
    async initializeInstance(deviceId: string) {
      const instance = instances.find((item) => item.deviceId === deviceId);
      if (!instance) throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
      const result = await request('/instance-login/api/attempts', 'POST', {
        instanceId: instance.instanceId,
        ...(session.kind === 'org' && session.orgSlug ? { org: session.orgSlug } : {}),
        ...(instance.desiredState === 'stopped' ? { wake: true } : {}),
      }, AbortSignal.timeout(10_000)) as { continueUrl?: unknown };
      if (typeof result?.continueUrl !== 'string' || !result.continueUrl.startsWith('/instance-login/#'))
        throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
      location.assign(result.continueUrl);
    },
    instances: () => instances,
    onInstancesChanged(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    online,
    invokeFailure,
    /** The instance whose settings page is open, or null. */
    view(deviceId: string | null) {
      viewing = deviceId;
    },
  };
}
export type WebCloudApi = ReturnType<typeof createWebCloudApi>;

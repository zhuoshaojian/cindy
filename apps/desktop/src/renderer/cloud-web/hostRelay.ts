import { z } from 'zod';
import { CloudClientError } from '../../main/cloud-settings-client/transport';
import {
  settingsWebResultSchema,
  SETTINGS_WEB_CHANNELS,
  type SettingsWebCommand,
} from '../../shared/settingsWeb';
import { CIS_LARGE_RESULT_BYTES, type CisFetch } from './cisHttp';

/**
 * Calls the native client makes over DeviceLink (settings channels, remote desktop
 * signaling), relayed by CIS from this signed-in owner's browser to the instance's Host.
 */
export type HostCall = Extract<SettingsWebCommand, { kind: 'channel' | 'desktop' | 'desktopIce' }>;
export type HostChannel = (typeof SETTINGS_WEB_CHANNELS)[number];

/** A Host-side failure, carrying the Host's stable code. */
export class HostCallError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const capabilitiesSchema = z.object({
  runtimeId: z.string().uuid(),
  channels: z.array(z.string()).optional(),
  desktop: z.literal(true).optional(),
});
const viewSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'complete', 'unknown']),
  result: settingsWebResultSchema.optional(),
});
type Capabilities = z.infer<typeof capabilitiesSchema>;

export function createHostRelay(request: CisFetch, instanceFor: (deviceId: string) => Promise<string>) {
  // A restarted or upgraded Host registers again; reread what it offers now and then.
  const capabilities = new Map<string, { at: number; value: Promise<Capabilities> }>();
  const read = (instanceId: string) => {
    const cached = capabilities.get(instanceId);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const value = request(`/instance-login/api/manage/instances/${encodeURIComponent(instanceId)}/settings`, 'GET', undefined, AbortSignal.timeout(10_000))
      .then((raw) => capabilitiesSchema.parse(raw));
    value.catch(() => {
      if (capabilities.get(instanceId)?.value === value) capabilities.delete(instanceId);
    });
    capabilities.set(instanceId, { at: Date.now(), value });
    return value;
  };
  async function once(instanceId: string, command: HostCall, signal?: AbortSignal): Promise<unknown> {
    const caps = await read(instanceId);
    const supported =
      command.kind === 'channel' ? caps.channels?.includes(command.channel) : caps.desktop === true;
    if (!supported) throw new HostCallError('SETTINGS_UNSUPPORTED');
    const base = `/instance-login/api/manage/instances/${encodeURIComponent(instanceId)}/settings/requests`;
    const requestId = crypto.randomUUID();
    const deadline = Date.now() + 35_000;
    const live = signal ?? new AbortController().signal;
    let raw = await request(base, 'POST', { requestId, runtimeId: caps.runtimeId, command }, live, CIS_LARGE_RESULT_BYTES);
    for (;;) {
      const view = viewSchema.parse(raw);
      if (view.requestId !== requestId) throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
      if (view.status === 'complete' && view.result) {
        const result = view.result;
        if (!result.ok) throw new HostCallError(result.code);
        if ('channel' in result) return result.channel;
        if ('desktop' in result) return result.desktop;
        if ('ice' in result) return result.ice;
        throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
      }
      if (view.status === 'unknown' || Date.now() >= deadline) throw new HostCallError('INVOKE_TIMEOUT');
      raw = await request(`${base}/${requestId}?wait=1`, 'GET', undefined, live, CIS_LARGE_RESULT_BYTES);
    }
  }
  return {
    async call(deviceId: string, command: HostCall, signal?: AbortSignal): Promise<unknown> {
      const instanceId = await instanceFor(deviceId);
      try {
        return await once(instanceId, command, signal);
      } catch (error) {
        // A restarted Host registers a new runtime: read its capabilities once more.
        if (!(error instanceof CloudClientError) || error.code !== 'CLOUD_SETTINGS_SCOPE_CHANGED') throw error;
        capabilities.delete(instanceId);
        return once(instanceId, command, signal);
      }
    },
    /** Whether the instance's current Host takes remote desktop calls from the browser. */
    async desktop(instanceId: string): Promise<boolean> {
      try {
        return (await read(instanceId)).desktop === true;
      } catch {
        return false;
      }
    },
    forget(instanceId?: string) {
      if (instanceId) capabilities.delete(instanceId);
      else capabilities.clear();
    },
  };
}
export type HostRelay = ReturnType<typeof createHostRelay>;

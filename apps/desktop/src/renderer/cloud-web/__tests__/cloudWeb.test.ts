// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCisClientHttp, createCisFetch, CisSignedOutError } from '../cisHttp';
import { createHostRelay, HostCallError } from '../hostRelay';
import { installWebElectronApi } from '../electronApi';
import { routeDeviceLinkCall, unwrapProviderManagementReply } from '../webApi';
import { createWebRemoteDesktopViewer } from '../remoteDesktopViewer';

const instanceId = 'cloud-instance-0123456789abcdef';
const deviceId = `cloud-device-${'a'.repeat(24)}`;
const runtimeId = '00000000-0000-4000-8000-000000000001';
const reply = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const identity = { key: 'web:fixture', generation: 1, baseUrl: 'https://cloud.example.invalid', accessToken: '' };

afterEach(() => vi.unstubAllGlobals());

describe('CIS browser session for the shared cloud client', () => {
  it('uses the session cookie on the same origin and never a bearer token', async () => {
    const fetch = vi.fn(async () => reply({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await createCisFetch(() => {})('/instance-login/api/session', 'GET', undefined, new AbortController().signal);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/iu);
  });

  it('returns to sign-in when the CIS session has ended', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: { code: 'UNAUTHORIZED' } }, 401)));
    const signedOut = vi.fn();
    await expect(createCisFetch(signedOut)('/instance-login/api/manage/instances', 'GET', undefined, new AbortController().signal)).rejects.toBeInstanceOf(CisSignedOutError);
    expect(signedOut).toHaveBeenCalledOnce();
  });

  it('keeps a CIS refusal as its own code, and the status mapping for anything else', async () => {
    const call = (remote: string, status: number) => {
      vi.stubGlobal('fetch', vi.fn(async () => reply({ error: { code: remote, message: 'private-detail' } }, status)));
      return createCisFetch(() => {})('/instance-login/api/manage/instances/wake', 'POST', {}, new AbortController().signal)
        .catch((error: Error) => error.message);
    };
    expect(await call('CLOUD_MEMBER_SUSPENDED', 403)).toBe('CLOUD_SETTINGS_MEMBER_SUSPENDED');
    expect(await call('CLOUD_INSTANCE_TRANSFERRED', 409)).toBe('CLOUD_SETTINGS_INSTANCE_TRANSFERRED');
    expect(await call('INSTANCE_QUOTA_EXCEEDED', 409)).toBe('CLOUD_SETTINGS_QUOTA_EXCEEDED');
    expect(await call('SOMETHING_ELSE', 403)).toBe('CLOUD_SETTINGS_SCOPE_CHANGED');
  });

  it('maps native caller paths onto the browser routes and opens no server session', async () => {
    const calls: Array<[string, string, unknown]> = [];
    const http = createCisClientHttp(async (path, method, body) => {
      calls.push([path, method, body]);
      if (path === '/instance-login/api/manage/instances') return { instances: [{ instanceId, deviceId }] };
      if (path.endsWith('/settings')) return { runtimeId, domains: ['appearance'], readBatch: true, managementV1: true, resultWait: true, channels: ['maker:provider:list'] };
      return { requestId: 'r', status: 'queued' };
    });
    const signal = new AbortController().signal;
    const ok = () => {};
    await http.request(identity, '/instance-login/api/manage/instances', 'GET', undefined, signal, ok);
    const session = await http.request(identity, `/client/instances/${instanceId}/settings/sessions`, 'POST', {}, signal, ok);
    expect(session).toMatchObject({ instanceId, deviceId, runtimeId, readBatch: true, managementV1: true, resultWait: true });
    expect(session).not.toHaveProperty('channels');
    const sid = (session as { sessionId: string }).sessionId;
    await http.request(identity, `/client/instances/${instanceId}/settings/sessions/${sid}/requests`, 'POST', { requestId: 'r' }, signal, ok);
    await http.request(identity, `/client/instances/${instanceId}/settings/sessions/${sid}/requests/r?wait=1`, 'GET', undefined, signal, ok);
    await http.request(identity, `/instances/${instanceId}/maintenance/upgrade`, 'GET', undefined, signal, ok);
    expect(await http.request(identity, `/client/instances/${instanceId}/settings/sessions/${sid}/heartbeat`, 'POST', {}, signal, ok)).toEqual({ ok: true });
    expect(await http.request(identity, `/client/instances/${instanceId}/settings/sessions/${sid}`, 'DELETE', undefined, signal, ok)).toBeUndefined();
    expect(calls.map(([path, method]) => `${method} ${path}`)).toEqual([
      'GET /instance-login/api/manage/instances',
      `GET /instance-login/api/manage/instances/${instanceId}/settings`,
      `POST /instance-login/api/manage/instances/${instanceId}/settings/requests`,
      `GET /instance-login/api/manage/instances/${instanceId}/settings/requests/r?wait=1`,
      `GET /instance-login/api/manage/instances/${instanceId}/maintenance/upgrade`,
    ]);
  });

  it('refuses to open settings for an instance the owner list did not return', async () => {
    const http = createCisClientHttp(async () => ({ runtimeId, domains: [] }));
    await expect(http.request(identity, `/client/instances/${instanceId}/settings/sessions`, 'POST', {}, new AbortController().signal, () => {}))
      .rejects.toMatchObject({ code: 'CLOUD_SETTINGS_SCOPE_CHANGED' });
  });
});

describe('Host calls relayed from the browser', () => {
  const relay = (results: unknown[], capabilities: Record<string, unknown> = { runtimeId, channels: ['cloud:storage-usage:v1'], desktop: true }) => {
    const sent: unknown[] = [];
    const request = vi.fn(async (path: string, method: string, body: unknown) => {
      if (path.endsWith('/settings')) return capabilities;
      if (method === 'POST') sent.push(body);
      const id = (sent.at(-1) as { requestId: string }).requestId;
      return { requestId: id, ...(results.shift() as object) };
    });
    return { relay: createHostRelay(request, async () => instanceId), request, sent };
  };

  it('submits once, then waits on the same request for the Host result', async () => {
    const r = relay([{ status: 'running' }, { status: 'complete', result: { ok: true, channel: { used: 1 } } }]);
    await expect(r.relay.call(deviceId, { kind: 'channel', channel: 'cloud:storage-usage:v1', args: [{ op: 'read' }] })).resolves.toEqual({ used: 1 });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ runtimeId, command: { kind: 'channel', channel: 'cloud:storage-usage:v1' } });
    expect(r.request.mock.calls.at(-1)?.[0]).toMatch(/\/requests\/[0-9a-f-]+\?wait=1$/u);
  });

  it('passes the Host code and never calls an undeclared feature', async () => {
    const failed = relay([{ status: 'complete', result: { ok: false, code: 'DESKTOP_UNAVAILABLE' } }]);
    await expect(failed.relay.call(deviceId, { kind: 'desktop', request: { op: 'capabilities' } })).rejects.toEqual(new HostCallError('DESKTOP_UNAVAILABLE'));
    const old = relay([], { runtimeId });
    await expect(old.relay.call(deviceId, { kind: 'desktopIce' })).rejects.toEqual(new HostCallError('SETTINGS_UNSUPPORTED'));
    expect(old.sent).toHaveLength(0);
  });
});

describe('web bridge', () => {
  it('keeps bridge objects stable and leaves local-only bridges inert', async () => {
    const parts = installWebElectronApi();
    parts.remoteDesktopViewer = { state: async () => null };
    const api = window.electronAPI as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>;
    expect(api.remoteDesktopViewer).toBe(api.remoteDesktopViewer);
    expect(api.localDb).toBe(api.localDb);
    expect(typeof api.localDb!.onChanged!(() => {})).toBe('function');
    await expect(api.localDb!.list!()).rejects.toThrow('UNSUPPORTED_IN_WEB');
    await expect((api.setClassicalReplyStyle as unknown as () => Promise<void>)()).resolves.toBeUndefined();
  });

  it('answers bridges called through call/apply/bind like direct calls', async () => {
    const parts = installWebElectronApi();
    parts.deviceLink = { invoke: async () => null };
    const api = window.electronAPI as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>;
    // The provider page subscribes as `maker.onModelPricingChanged.call(maker, listener)` and
    // calls the result on cleanup; a rejected promise there crashed the page.
    const listener = () => {};
    expect(typeof api.maker!.onModelPricingChanged!.call(api.maker, listener)).toBe('function');
    expect(typeof api.maker!.onProvidersChanged!.apply(api.maker, [listener])).toBe('function');
    expect(typeof api.maker!.onAgentsChanged!.bind(api.maker)(listener)).toBe('function');
    // Missing members of a supplied bridge fall back the same way.
    expect(typeof api.deviceLink!.onStatusChanged!.call(api.deviceLink, listener)).toBe('function');
    expect(api.localDb!.readSync!.call(api.localDb)).toBeUndefined();
    await expect(api.localDb!.list!.call(api.localDb)).rejects.toThrow('UNSUPPORTED_IN_WEB');
  });

  it('activates the viewer after its first state read, as the native window does', async () => {
    const calls: unknown[] = [];
    const viewer = createWebRemoteDesktopViewer(
      { call: vi.fn(async (_device, command) => { calls.push(command); return { version: 1 }; }), desktop: vi.fn(async () => true), forget: vi.fn() },
      { deviceId, name: 'fixture' },
    );
    const seen: boolean[] = [];
    viewer.onActive((state) => seen.push(state.active));
    const first = viewer.state();
    const ready = viewer.rendererReady();
    expect((await first).active).toBe(false);
    await ready;
    expect(seen).toEqual([true]);
    const { generation } = await viewer.state();
    await expect(viewer.request(generation, { op: 'capabilities' })).resolves.toEqual({ version: 1 });
    expect(calls).toEqual([{ kind: 'desktop', request: { op: 'capabilities' } }]);
    await expect(viewer.credential!(generation, 'unlock')).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
  });
});

describe('DeviceLink calls from the cloud pages', () => {
  it('reads catalogs of sources behind the instance through that instance', () => {
    const options = { capabilities: ['provider-logo-kinds-v2'] };
    expect(routeDeviceLinkCall('share:abc', 'maker:provider:list', [options], deviceId)).toEqual({
      deviceId,
      channel: 'maker:model-catalog:read',
      args: [{ op: 'read', agentDeviceId: 'share:abc', channel: 'maker:provider:list', args: [options] }],
    });
    // Also catalog reads the browser could never send directly, for the owner's other computers.
    expect(routeDeviceLinkCall('mac-device-1', 'maker:agent:status', ['codex'], deviceId).args).toEqual([
      { op: 'read', agentDeviceId: 'mac-device-1', channel: 'maker:agent:status', args: ['codex'] },
    ]);
  });

  it('keeps instance calls direct and refuses what no instance can answer', () => {
    expect(routeDeviceLinkCall(deviceId, 'maker:provider:list', [], deviceId)).toEqual({ deviceId, channel: 'maker:provider:list', args: [] });
    expect(() => routeDeviceLinkCall('share:abc', 'maker:provider:list', [], null)).toThrow('DEVICE_LINK_DEVICE_OFFLINE');
    expect(() => routeDeviceLinkCall('share:abc', 'maker:session:delete', [], deviceId)).toThrow('DEVICE_LINK_CHANNEL_NOT_ALLOWED');
    expect(() => routeDeviceLinkCall(deviceId, 'maker:session:delete', [], deviceId)).toThrow('DEVICE_LINK_CHANNEL_NOT_ALLOWED');
    // cloud.4 instances also answer account quota, favorites and provider management.
    expect(routeDeviceLinkCall(deviceId, 'maker:usage:account', ['claude-code'], deviceId).channel).toBe('maker:usage:account');
    expect(routeDeviceLinkCall(deviceId, 'provider-group:remote', [{}], deviceId).channel).toBe('provider-group:remote');
  });
});

describe('provider management of an instance from the browser', () => {
  const manage = (action: string, extra: object = {}) => ({ action: 'manage-share', command: { action, ...extra } });

  it('unwraps the reply as the native client does', () => {
    expect(unwrapProviderManagementReply(manage('owned'), { result: { ready: true }, respondedAt: 1 })).toEqual({ ready: true });
    for (const raw of [null, { respondedAt: 1 }, { result: 1 }, { result: 1, respondedAt: Number.NaN }])
      expect(() => unwrapProviderManagementReply(manage('owned'), raw)).toThrow('PRECONDITION_FAILED');
  });

  it('carries a created link over as its remaining lifetime on the instance', () => {
    const respondedAt = Date.parse('2026-11-10T08:00:00Z');
    const created = { link: 'cindy://provider-share/join?x=1', linkId: 'a'.repeat(64),
      expiresAt: new Date(respondedAt + 120_000).toISOString() };
    const now = Date.parse('2026-11-10T09:00:00Z');
    expect(unwrapProviderManagementReply(manage('create-link', { providerId: 'openai' }), { result: created, respondedAt }, now))
      .toEqual({ ...created, expiresAt: new Date(now + 120_000).toISOString() });
    expect(() => unwrapProviderManagementReply(manage('create-link'), { result: { ...created, linkId: 'x' }, respondedAt }))
      .toThrow('PRECONDITION_FAILED');
  });
});

describe('web bridge links', () => {
  it('opens only https pages in a new tab and reports a blocked pop-up', async () => {
    installWebElectronApi();
    const api = window.electronAPI as unknown as { openExternal(url: string): Promise<{ success: boolean }> };
    const tab = { opener: {} as unknown };
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(tab as Window).mockReturnValueOnce(null);
    await expect(api.openExternal('https://auth.example.invalid/authorize?state=x')).resolves.toEqual({ success: true });
    expect(tab.opener).toBeNull();
    await expect(api.openExternal('https://auth.example.invalid/again')).resolves.toEqual({ success: false });
    await expect(api.openExternal('javascript:alert(1)')).resolves.toEqual({ success: false });
    await expect(api.openExternal('http://insecure.example.invalid')).resolves.toEqual({ success: false });
    expect(open).toHaveBeenCalledTimes(2);
  });
});

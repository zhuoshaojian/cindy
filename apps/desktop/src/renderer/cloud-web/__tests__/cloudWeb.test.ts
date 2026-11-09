// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCisClientHttp, createCisFetch, CisSignedOutError } from '../cisHttp';
import { createHostRelay, HostCallError } from '../hostRelay';
import { installWebElectronApi } from '../electronApi';
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

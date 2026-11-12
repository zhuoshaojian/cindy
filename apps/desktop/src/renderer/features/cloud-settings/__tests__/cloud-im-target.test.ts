// @vitest-environment jsdom
// The local IM cards' API for a cloud instance: settings over the private channel, binding
// starts on authorization tickets, provider links open on this computer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_HOOK_PROVIDER_ACTION_URL,
  CLOUD_IM_SETTINGS_CHANNEL,
} from '../../../../shared/cloudImSettings';
import { createCloudImTarget, type CloudImAuthorization } from '../cloudImTarget';

const DEVICE = 'cloud-device-1';
let replies: Array<{ call: string; result: unknown; generation?: number }>;
const invoke = vi.fn(async (_device: string, _channel: string, args: unknown[]) => {
  const request = args[0] as { call: string; args: unknown[] };
  const reply = replies.find((entry) => entry.call === request.call);
  return { ownerGeneration: reply?.generation ?? 1, result: reply?.result ?? null };
});
const openExternal = vi.fn(async () => ({ success: true }));

function target(overrides: Partial<CloudImAuthorization> = {}) {
  const authorization: CloudImAuthorization = {
    start: vi.fn(async () => {}),
    cancel: vi.fn(async () => false),
    ...overrides,
  };
  const pickDirectory = vi.fn(async () => '/home/cindy/work');
  return {
    authorization,
    pickDirectory,
    target: createCloudImTarget(DEVICE, { authorization, pickDirectory }),
  };
}
const requests = () =>
  invoke.mock.calls.map(([device, channel, args]) => {
    expect(device).toBe(DEVICE);
    expect(channel).toBe(CLOUD_IM_SETTINGS_CHANNEL);
    return args[0] as { call: string; args: unknown[] };
  });

beforeEach(() => {
  replies = [{ call: 'maker:hook-control:get', result: { hook: { enabled: true } } }];
  Object.assign(window, { electronAPI: { deviceLink: { invoke }, openExternal } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  invoke.mockClear();
  openExternal.mockClear();
});

describe('cloud IM target', () => {
  it('sends the same payloads the local preload sends', async () => {
    const { target: t } = target();
    await t.api.hookControl.setWorkspaces({ repo: '/home/cindy/repo' });
    await t.api.hookControl.setWorkspacePrefs('repo', { model: 'm' }, 'T1');
    await t.api.hookControl.setTelegramGroupActivation('b1', '-100', 'always');
    await t.api.telegramBot.setPersona({ botName: 'Cindy', soul: 's', syncProfile: true });
    await t.api.imDefaultSettingsGet('slack');
    expect(requests()).toEqual([
      { call: 'maker:hook-control:set-workspaces', args: [{ workspaces: { repo: '/home/cindy/repo' } }] },
      { call: 'maker:hook-control:prefs-set', args: [{ workspace: 'repo', patch: { model: 'm' }, teamId: 'T1' }] },
      {
        call: 'maker:hook-control:telegram-group-activation-set',
        args: [{ bindingId: 'b1', chatId: '-100', mode: 'always' }],
      },
      { call: 'telegramBot:set-persona', args: [{ botName: 'Cindy', soul: 's', syncProfile: true }] },
      { call: 'maker:im-default-settings:get', args: ['slack'] },
    ]);
  });

  it('starts bindings on the authorization ticket and ends them over the channel', async () => {
    const { target: t, authorization } = target();
    await expect(t.api.hookControl.setEnabled(true)).resolves.toEqual({ hook: { enabled: true } });
    await t.api.hookControl.addBinding();
    await t.api.hookControl.rebindTeam('T9');
    await t.api.hookControl.providerBindStart('x');
    await t.api.hookControl.providerBindStart('feishu');
    expect(vi.mocked(authorization.start).mock.calls.map(([request]) => request)).toEqual([
      { kind: 'slack' },
      { kind: 'slack' },
      { kind: 'slack-rebind', teamId: 'T9' },
      { kind: 'provider', provider: 'x' },
      { kind: 'provider', provider: 'feishu' },
    ]);
    expect(requests().every((request) => request.call === 'maker:hook-control:get')).toBe(true);
    invoke.mockClear();
    await t.api.hookControl.setEnabled(false);
    await t.api.hookControl.providerBindRevoke('telegram');
    expect(requests()).toEqual([
      { call: 'maker:hook-control:set-enabled', args: [{ enabled: false }] },
      { call: 'maker:hook-control:provider-bind-revoke', args: [{ provider: 'telegram' }] },
    ]);
  });

  it.each(['telegram', 'x', 'feishu'] as const)('cancels only the running %s ticket', async (provider) => {
    const running = target({ cancel: vi.fn(async () => true) });
    await running.target.api.hookControl.providerBindCancel(provider);
    expect(requests()).toEqual([{ call: 'maker:hook-control:get', args: [] }]);
    invoke.mockClear();
    const idle = target();
    await idle.target.api.hookControl.providerBindCancel(provider);
    expect(requests()).toEqual([
      { call: 'maker:hook-control:provider-bind-cancel', args: [{ provider }] },
    ]);
  });

  it('opens provider links on this computer', async () => {
    replies.push({ call: CLOUD_HOOK_PROVIDER_ACTION_URL, result: { url: 'https://t.me/cindy' } });
    const { target: t } = target();
    await t.api.hookControl.openProviderAction('telegram', 'provider');
    expect(requests()).toEqual([
      { call: CLOUD_HOOK_PROVIDER_ACTION_URL, args: [{ provider: 'telegram', action: 'provider' }] },
    ]);
    expect(openExternal).toHaveBeenCalledWith('https://t.me/cindy');
  });

  // Unit/jsdom: the remote adapter swallowed browser rejection and disabled native Feishu
  // actions. Existing coverage mocked successful opening and only exercised Telegram/X.
  it('reports a rejected browser opening instead of a successful action', async () => {
    replies.push({ call: CLOUD_HOOK_PROVIDER_ACTION_URL, result: { url: 'https://t.me/cindy' } });
    openExternal.mockResolvedValueOnce({ success: false });
    await expect(target().target.api.hookControl.openProviderAction('telegram', 'provider'))
      .rejects.toThrow('OPEN_FAILED');
  });

  it('reserves the web tab during the click, then navigates after the remote URL arrives', async () => {
    Object.assign(window.electronAPI, { platform: 'web' });
    const opened = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    const popup = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    let resolve!: (value: { ownerGeneration: number; result: { url: string } }) => void;
    invoke.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const opening = target().target.api.hookControl.openProviderAction('feishu', 'connect');
    expect(popup).toHaveBeenCalledWith('about:blank', '_blank');
    expect(opened.opener).toBeNull();
    expect(opened.location.replace).not.toHaveBeenCalled();
    const url = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=fixture';
    resolve({ ownerGeneration: 1, result: { url } });
    await expect(opening).resolves.toEqual({ ok: true });
    expect(opened.location.replace).toHaveBeenCalledWith(url);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('closes the reserved tab if the remote request fails', async () => {
    Object.assign(window.electronAPI, { platform: 'web' });
    const opened = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    invoke.mockRejectedValueOnce(new Error('[OWNER_CHANGED] changed'));
    await expect(target().target.api.hookControl.openProviderAction('feishu', 'connect')).rejects.toThrow('OWNER_CHANGED');
    expect(opened.close).toHaveBeenCalledOnce();
    expect(opened.location.replace).not.toHaveBeenCalled();
  });

  it('reports a blocked web popup without issuing a remote action', async () => {
    Object.assign(window.electronAPI, { platform: 'web' });
    vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(target().target.api.hookControl.openProviderAction('feishu', 'connect')).rejects.toThrow('OPEN_FAILED');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('selects the working computer through its native handler and awaits the result', async () => {
    const result = { hook: { feishu: { binding: { state: 'confirmed' } } } };
    replies.push({ call: 'maker:hook-control:provider-bind-select', result });
    await expect(target().target.api.hookControl.providerBindSelect('feishu')).resolves.toEqual(result);
    expect(requests()).toEqual([
      { call: 'maker:hook-control:provider-bind-select', args: [{ provider: 'feishu' }] },
    ]);
  });

  it('starts an unbound provider switch on a ticket and preserves retained bindings', async () => {
    const { target: t, authorization } = target();
    replies[0]!.result = { hook: { feishu: { enabled: false, binding: null } } };
    await t.api.hookControl.setProviderEnabled('feishu', true);
    expect(authorization.start).toHaveBeenCalledWith({ kind: 'provider', provider: 'feishu' });
    expect(requests().every((r) => r.call === 'maker:hook-control:get')).toBe(true);
    vi.mocked(authorization.start).mockClear();
    invoke.mockClear();
    replies[0]!.result = { hook: { feishu: { enabled: false, binding: { state: 'confirmed' } } } };
    await t.api.hookControl.setProviderEnabled('feishu', true);
    expect(authorization.start).not.toHaveBeenCalled();
    expect(requests()).toContainEqual({ call: 'maker:hook-control:set-provider-enabled', args: [{ provider: 'feishu', enabled: true }] });
  });

  it('keeps the existing switch path on an older Host without a provider ticket', async () => {
    const { target: t, authorization } = target({ canAuthorizeProvider: () => false });
    await t.api.hookControl.setProviderEnabled('feishu', true);
    expect(authorization.start).not.toHaveBeenCalled();
    expect(requests()).toEqual([
      { call: 'maker:hook-control:set-provider-enabled', args: [{ provider: 'feishu', enabled: true }] },
    ]);
  });

  it('picks directories in the instance browser', async () => {
    const { target: t, pickDirectory } = target();
    await expect(t.api.showOpenDirectoryDialog()).resolves.toEqual({
      canceled: false,
      path: '/home/cindy/work',
    });
    pickDirectory.mockResolvedValueOnce(null as unknown as string);
    await expect(t.api.showOpenDirectoryDialog()).resolves.toEqual({ canceled: true });
  });

  it('refuses replies from another account generation', async () => {
    const { target: t } = target();
    await t.api.hookControl.get();
    replies[0]!.generation = 2;
    await expect(t.api.hookControl.get()).rejects.toThrow('[OWNER_CHANGED]');
  });

  it('polls the connection snapshot only while a card listens', async () => {
    vi.useFakeTimers();
    const { target: t } = target();
    const listener = vi.fn();
    const stop = t.api.hookControl.onStatusChanged(listener);
    await vi.advanceTimersByTimeAsync(2600);
    expect(listener).toHaveBeenCalledWith({ enabled: true });
    replies[0]!.result = { hook: { enabled: true } };
    await vi.advanceTimersByTimeAsync(2600);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    invoke.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stops polling while the IM page is hidden and refreshes once it returns', async () => {
    vi.useFakeTimers();
    const { target: t } = target();
    const listener = vi.fn();
    t.api.hookControl.onStatusChanged(listener);
    await vi.advanceTimersByTimeAsync(2600);
    expect(listener).toHaveBeenCalledTimes(1);
    t.setActive(false);
    invoke.mockClear();
    replies[0]!.result = { hook: { enabled: false } };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(invoke).not.toHaveBeenCalled();
    t.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ enabled: false });
    await vi.advanceTimersByTimeAsync(2600);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

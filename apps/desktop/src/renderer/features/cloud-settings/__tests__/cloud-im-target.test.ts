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
    expect(vi.mocked(authorization.start).mock.calls.map(([request]) => request)).toEqual([
      { kind: 'slack' },
      { kind: 'slack' },
      { kind: 'slack-rebind', teamId: 'T9' },
      { kind: 'provider', provider: 'x' },
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

  it('cancels a running ticket instead of the instance attempt', async () => {
    const running = target({ cancel: vi.fn(async () => true) });
    await running.target.api.hookControl.providerBindCancel('x');
    expect(requests()).toEqual([{ call: 'maker:hook-control:get', args: [] }]);
    invoke.mockClear();
    const idle = target();
    await idle.target.api.hookControl.providerBindCancel('x');
    expect(requests()).toEqual([
      { call: 'maker:hook-control:provider-bind-cancel', args: [{ provider: 'x' }] },
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
});

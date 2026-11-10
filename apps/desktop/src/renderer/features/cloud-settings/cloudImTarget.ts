import type { SettingsTarget, SettingsTargetApi } from '@/components/settings/settingsTarget';
import {
  CLOUD_HOOK_PROVIDER_ACTION_URL,
  CLOUD_IM_SETTINGS_CHANNEL,
  cloudImSettingsReplySchema,
  type CloudImSettingsCall,
} from '../../../shared/cloudImSettings';
import type { SlackHookView } from '../../../shared/hookControlIpc';

const FEISHU_ON_INSTANCE = '[UNSUPPORTED] Feishu is connected on the cloud instance';

type HookControl = SettingsTargetApi['hookControl'];
type HookReply = { hook: SlackHookView };

/**
 * Binding flows that open an authorization page run as cloud authorization tickets, so the
 * page opens beside this client as it does for the other cloud cards.
 */
export interface CloudImAuthorization {
  start(
    request:
      | { kind: 'slack' }
      | { kind: 'slack-rebind'; teamId: string }
      | { kind: 'provider'; provider: 'telegram' | 'x' },
  ): Promise<void>;
  /** Cancels the running ticket of this card; false when none is running. */
  cancel(card: 'slack' | 'telegram' | 'x'): Promise<boolean>;
}

/** One call over the instance's private IM channel; the reply must belong to the same account. */
export function createCloudImCaller(deviceId: string) {
  let generation: number | null = null;
  return async function call<T = unknown>(name: CloudImSettingsCall, ...args: unknown[]): Promise<T> {
    const raw = await window.electronAPI.deviceLink.invoke(deviceId, CLOUD_IM_SETTINGS_CHANNEL, [
      { call: name, args },
    ]);
    const reply = cloudImSettingsReplySchema.parse(raw);
    if (generation !== null && reply.ownerGeneration !== generation)
      throw new Error('[OWNER_CHANGED] the instance account changed');
    generation = reply.ownerGeneration;
    return reply.result as T;
  };
}

const POLL_MS = 2500;

/** The cards' target plus the raw caller for instance-only rows (WeChat directory, bot status). */
export type CloudImTarget = SettingsTarget & {
  call: ReturnType<typeof createCloudImCaller>;
  /** Whether the IM page is shown: a hidden page stops polling and refreshes on its return. */
  setActive(active: boolean): void;
};

/**
 * The local IM cards' API for a cloud instance. Settings run the instance's own handlers; only
 * binding flows go through tickets, and provider links open on this computer. There is no push
 * across the link: the connection snapshot is polled while a card listens, other views reload
 * after each write as the local page does.
 */
export function createCloudImTarget(
  deviceId: string,
  deps: {
    authorization: CloudImAuthorization;
    pickDirectory(): Promise<string | null>;
  },
): CloudImTarget {
  const call = createCloudImCaller(deviceId);
  const get = () => call<HookReply>('maker:hook-control:get');
  const after = async (action: () => Promise<unknown>): Promise<HookReply> => {
    await action();
    return get();
  };
  const statusListeners = new Set<(view: SlackHookView) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = '';
  let active = true;
  const poll = () => {
    if (document.visibilityState === 'hidden') return;
    void get()
      .then(({ hook }) => {
        const serialized = JSON.stringify(hook);
        if (serialized === last) return;
        last = serialized;
        for (const listener of statusListeners) listener(hook);
      })
      .catch(() => {});
  };
  // Each poll is a call in the instance's one-at-a-time queue: poll only while a card on a
  // shown IM page listens.
  const sync = () => {
    const wanted = active && statusListeners.size > 0;
    if (wanted) timer ??= setInterval(poll, POLL_MS);
    else if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const onStatusChanged: HookControl['onStatusChanged'] = (listener) => {
    statusListeners.add(listener);
    sync();
    return () => {
      statusListeners.delete(listener);
      if (!statusListeners.size) last = '';
      sync();
    };
  };
  const setActive = (next: boolean) => {
    if (active === next) return;
    active = next;
    sync();
    // Back on the page: show changes made meanwhile without waiting for the next tick.
    if (active && statusListeners.size) poll();
  };
  const quiet = () => () => {};
  const hookControl: HookControl = {
    get,
    setEnabled: (enabled) =>
      enabled
        ? after(() => deps.authorization.start({ kind: 'slack' }))
        : call('maker:hook-control:set-enabled', { enabled: false }),
    setLifecycleAnnouncement: (enabled) =>
      call('maker:hook-control:set-lifecycle-announcement', { enabled }),
    setProviderEnabled: (provider, enabled) =>
      call('maker:hook-control:set-provider-enabled', { provider, enabled }),
    setWorkspaces: (workspaces) => call('maker:hook-control:set-workspaces', { workspaces }),
    setXCompanion: () => Promise.reject(new Error('[UNSUPPORTED] teammates are set on the instance')),
    setProviderDefaultWorkspace: (provider, alias) =>
      call('maker:hook-control:set-provider-default-workspace', { provider, alias }),
    bindStart: async () => {
      await deps.authorization.start({ kind: 'slack' });
      return { ok: true as const };
    },
    bindRevoke: async () => {
      await call('maker:hook-control:set-enabled', { enabled: false });
      return { ok: true as const };
    },
    addBinding: () => after(() => deps.authorization.start({ kind: 'slack' })),
    rebindTeam: (teamId) => after(() => deps.authorization.start({ kind: 'slack-rebind', teamId })),
    setSlackCommunications: (teamId, enabled) =>
      call('maker:hook-control:set-slack-communications', { teamId, enabled }),
    revokeTeam: (teamId) => call('maker:hook-control:revoke-team', { teamId }),
    cancelPendingBind: async () =>
      (await deps.authorization.cancel('slack')) ? get() : call('maker:hook-control:cancel-pending-bind'),
    // The frozen CIS IM contract has no Feishu channel yet; it is connected on the instance itself.
    providerBindStart: (provider) =>
      provider === 'feishu'
        ? Promise.reject(new Error(FEISHU_ON_INSTANCE))
        : after(() => deps.authorization.start({ kind: 'provider', provider })),
    providerBindSelect: () => Promise.reject(new Error(FEISHU_ON_INSTANCE)),
    providerBindCancel: async (provider) =>
      provider !== 'feishu' && (await deps.authorization.cancel(provider))
        ? get()
        : call('maker:hook-control:provider-bind-cancel', { provider }),
    providerBindRevoke: (provider) => call('maker:hook-control:provider-bind-revoke', { provider }),
    openProviderAction: async (provider, action) => {
      const { url } = await call<{ url: string }>(CLOUD_HOOK_PROVIDER_ACTION_URL, { provider, action });
      await window.electronAPI.openExternal(url);
      return { ok: true as const };
    },
    getWorkspacePrefs: () => call('maker:hook-control:prefs-get'),
    setWorkspacePrefs: (workspace, patch, teamId) =>
      call('maker:hook-control:prefs-set', {
        workspace,
        patch,
        ...(teamId !== undefined ? { teamId } : {}),
      }),
    getProviderWorkspacePrefs: (provider) => call('maker:hook-control:provider-prefs-get', { provider }),
    setProviderWorkspacePrefs: (provider, workspace, patch) =>
      call('maker:hook-control:provider-prefs-set', { provider, workspace, patch }),
    getTelegramBehavior: (bindingId) => call('maker:hook-control:telegram-behavior-get', { bindingId }),
    setTelegramBehavior: (bindingId, patch) =>
      call('maker:hook-control:telegram-behavior-set', { bindingId, patch }),
    listTelegramGroups: (bindingId) => call('maker:hook-control:telegram-groups-list', { bindingId }),
    setTelegramGroupActivation: (bindingId, chatId, mode) =>
      call('maker:hook-control:telegram-group-activation-set', { bindingId, chatId, mode }),
    getWorkspaceProviderSources: () => call('maker:hook-control:workspace-provider-source-get'),
    setWorkspaceProviderSource: (payload) =>
      call('maker:hook-control:workspace-provider-source-set', payload),
    onWorkspaceProviderSourcesChanged: quiet,
    onPrefsChanged: quiet,
    onProviderPrefsChanged: quiet,
    onTelegramBehaviorChanged: quiet,
    onStatusChanged,
  };
  return {
    deviceId,
    call,
    setActive,
    api: {
      hookControl,
      telegramBot: {
        getBehavior: () => call('telegramBot:get-behavior'),
        setBehavior: (patch) => call('telegramBot:set-behavior', patch),
        getPersona: () => call('telegramBot:get-persona'),
        setPersona: (payload) => call('telegramBot:set-persona', payload),
        listGroups: () => call('telegramBot:list-groups'),
        setGroupActivation: (payload) => call('telegramBot:set-group-activation', payload),
      },
      imDefaultSettingsGet: (channel) => call('maker:im-default-settings:get', channel),
      imDefaultSettingsReset: (channel) => call('maker:im-default-settings:reset', channel),
      showOpenDirectoryDialog: async () => {
        const path = await deps.pickDirectory();
        return path ? { canceled: false, path } : { canceled: true };
      },
    },
  };
}

import { useSyncExternalStore } from 'react';
import {
  REMOTE_RESOURCE_GET_CHANNEL,
  REMOTE_RESOURCE_INVOKE_CHANNEL,
  REMOTE_RESOURCE_LIST_CHANNEL,
  REMOTE_RESOURCE_MANIFEST_CHANNEL,
} from '@cindy/device-link';
import { toast } from '@/lib/toast';
import { setRemoteResourceGuard } from '@/features/plugin/remoteResourceGuard';
import type { CloudSettingsDomain } from '../../../shared/cloudSettings';
import type {
  CloudInstanceView,
  CloudMaintenanceEdit,
  CloudMaintenanceView,
  CloudUpgradeOperation,
} from '../../../shared/cloudInstanceControl';
import { CLOUD_IM_SETTINGS_CHANNEL } from '../../../shared/cloudImSettings';
import { CLOUD_PERSONALIZATION_CHANNEL } from '../../../shared/cloudPersonalization';
import { CLOUD_PROVIDER_SETTINGS_CHANNEL } from '../../../shared/cloudProviderSettings';
import { CLOUD_STORAGE_USAGE_CHANNEL } from '../../../shared/cloudStorageUsage';
import type { CloudSettingsClient } from './client';
import type { CloudSettingsPageTab } from './cloudSettingsVisibility';
import type { CloudSyncFailureReason } from './cloudSettingsSync';
import type { ClaimState, PowerNote, PowerPending } from './useCloudInstances';

/**
 * The scenario panel's stage (owner, 2026-11-11: "我能通过这个模拟所有我可能碰得到的场景 点了就生效").
 * Choosing a frame pins one fixed world: the instance list, the instance, every settings read and
 * every channel answer, and the few local states a click would have started (an open dialog, a
 * spinning button). The real cloud components render from it as in production. Nothing is scripted
 * and nothing is waited for: an answer still under way never arrives and every retry gets the same
 * answer, so no timer or poll can move the frame. It stays until another frame is chosen or the
 * simulation ends. Dev options only; delete with them.
 *
 * Safety (T28, owner: "模拟期间任何一条写入都不能发到真实的云端 Cindy"): while a frame is chosen,
 * every request that would change an instance is refused before it leaves the page (the gate at the
 * end of this file), and the settings, the instance and its channels are answered by the stage.
 */

/** The device card on My devices. */
export type StageCard = {
  /** What the instance list says; empty offers the claim. */
  instances: CloudInstanceView[];
  /** DeviceLink does not have the instance (it restarts during an update, or cannot be reached). */
  linkOffline?: boolean;
  /** The instance list itself could not be read. */
  listError?: boolean;
  powerPending?: Omit<PowerPending, 'deviceId'>;
  powerNote?: Omit<PowerNote, 'deviceId'>;
  claim?: ClaimState;
  /** A request of the card is on its way (the claim button spins). */
  busy?: boolean;
  /** The card's Manage menu is open. */
  menu?: boolean;
  /** The updates dialog is open. */
  dialog?: boolean;
  /** The sleep confirmation is open. */
  confirmSleep?: boolean;
  /** The sign-in page was opened for the instance: the card waits for the sign-in. */
  waiting?: boolean;
  /** The card's own request failed (the sign-in page could not open). */
  error?: 'loginFailed';
  /** The instance list has not answered yet (the page just opened). */
  notLoaded?: boolean;
  /** The updates dialog's own read: still under way, or failed. */
  reload?: 'pending' | 'fail';
  /** An update this page saw under way just ended: the card's notice about it. */
  toast?: 'upgraded' | 'upgradeFailed';
};
/** Inside the updates dialog: what a click on "update now" or on the schedule would have started. */
export type StageUpdate = {
  /** The update confirmation is open. */
  confirm?: boolean;
  /** The request is on its way: the button spins. */
  submitting?: boolean;
  /** Its unknown result is being read back, or could not be read. */
  check?: 'checking' | 'unreadable';
  notStarted?: boolean;
  /** The cloud refused it (CONFLICT / UNSUPPORTED). */
  refused?: boolean;
  /** Replacing a custom schedule asks first: that confirmation is open. */
  confirmReplace?: boolean;
  /** The schedule: being saved, its unknown result unreadable, or what became of it. */
  policy?:
    | 'saving'
    | 'unreadable'
    | 'policyNotSaved'
    | 'policyChanged'
    | 'policyRejected'
    | 'policyUnavailable';
};
export type StageAnswer = 'ready' | 'pending' | 'fail' | 'unsupported';
/** The instance's settings page. */
export type StageSettings = {
  tab: CloudSettingsPageTab;
  /** The settings client the page reads (the stage's fixed values). */
  client: CloudSettingsClient;
  /** The page as a whole: still opening, every try failed, or an instance without settings sessions. */
  page?: 'loading' | 'failed' | 'unsupported';
  /** The instance is not available: asleep, or an update has it down. */
  offline?: 'asleep' | 'upgrading';
  /** Groups the instance answers without a value. */
  unreadable?: CloudSettingsDomain[];
  /** Groups read once, then without a value on the next read. */
  refreshFails?: CloudSettingsDomain[];
  /** A save that came back with this outcome (the page's own failure notice). */
  saveFailure?: CloudSyncFailureReason;
  /** A save that arrived but could not be applied everywhere on the instance. */
  saveApplyFailed?: boolean;
  /** The IM channel groups: unreadable, not offered by this instance, or too large to read. */
  imDomains?: 'unreadable' | 'unavailable' | 'tooLarge';
  /** The bot card shown opened (its id, e.g. bot:feishu). */
  openBot?: string;
  /** The authorization lists (providers, bots, MCP) cannot be read. */
  manage?: 'fail';
  /** Cindy AI's credential state on the providers page (op xd status). */
  xd?: 'syncing' | 'failed' | 'disabled' | 'unsupported';
  /** The instance's private channels. */
  im?: StageAnswer;
  providers?: StageAnswer;
  /** The plugin page's reads. */
  plugins?: 'ready' | 'fail';
};
export type StageAuthState =
  | 'running'
  | 'waiting'
  | 'checking'
  | 'connected'
  | 'failed'
  | 'unreadable'
  /** Ended by the instance as cancelled or expired. */
  | 'cancelled'
  | 'expired'
  /** The code typed back could not be sent; the sign-in still waits. */
  | 'submitFailed'
  /** The verification page could not be opened on this computer. */
  | 'openFailed'
  /** The sign-in was opened in the browser; its result is read back until it expires. */
  | 'waitingDone';
export type CloudStageWorld = {
  card?: StageCard;
  update?: StageUpdate;
  settings?: StageSettings;
  /** One authorization of the page, at this point. */
  auth?: { section: 'providers' | 'bots' | 'mcp'; state: StageAuthState };
};
export type CloudStageFrame = {
  /** The scenario code to report, as in the checklist. */
  code: string;
  /** What the frame shows, in a few words. */
  name: string;
  /** Its row in the 验收清单, which does not name the scenario; `name` when absent. */
  label?: string;
  /** What else this frame stands for. */
  note?: string;
  /**
   * In the 验收清单 (owner, 2026-11-11: "verify patterns, not instances"): the common path, and one
   * representative of each distinct failure or edge pattern. Every other frame is in 全部画面.
   */
  check?: boolean;
  world(deviceId: string): CloudStageWorld;
};
export type CloudStageScenario = {
  id: string;
  group: string;
  code: string;
  name: string;
  frames: readonly CloudStageFrame[];
};
export type ActiveCloudStage = {
  scenario: string;
  frame: number;
  deviceId: string;
  code: string;
  name: string;
  /** Changes with every choice: what the previous frame showed is mounted afresh. */
  key: string;
  world: CloudStageWorld;
  /**
   * 亲手体验 (owner, 2026-11-12: "我想亲自体验下"): the owner's own clicks move this stage along.
   * Its key stays for the whole run, so an open dialog and the card's memory of an update under
   * way carry over from one step to the next, as in production.
   */
  play?: { name: string; outcome: string; phase: string };
};

const STORE_KEY = 'cloud-preview:stage';
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
let scenarios: readonly CloudStageScenario[] = [];
let active: ActiveCloudStage | null = null;
let restored = false;
let count = 0;
let aborter = new AbortController();
const session = () =>
  import.meta.env.DEV && typeof sessionStorage !== 'undefined' ? sessionStorage : null;

/** The scenario catalog (cloudFaultScripts.ts) registers itself; a frame is found there. */
export function registerCloudScenarios(list: readonly CloudStageScenario[]) {
  scenarios = list;
  restored = false;
}

const build = (scenario: string, frame: number, deviceId: string): ActiveCloudStage | null => {
  const found = scenarios.find((item) => item.id === scenario)?.frames[frame];
  if (!found) return null;
  return {
    scenario,
    frame,
    deviceId,
    code: found.code,
    name: found.name,
    key: `stage-${++count}`,
    world: found.world(deviceId),
  };
};

/** The frame in force. A dev build keeps it for this run only (sessionStorage), never on disk. */
export function activeCloudStage(): ActiveCloudStage | null {
  if (!restored && scenarios.length) {
    restored = true;
    const saved = session()?.getItem(STORE_KEY);
    if (!active && saved) {
      try {
        const { scenario, frame, deviceId } = JSON.parse(saved) as {
          scenario: string;
          frame: number;
          deviceId: string;
        };
        active = build(scenario, frame, deviceId);
      } catch {
        active = null;
      }
    }
  }
  return active;
}

/**
 * Shows a frame at once. What the previous frame left on screen goes with it: its notices and any
 * confirmation it opened. Pages remount on the new key, so nothing of it carries over.
 */
export function selectCloudFrame(scenario: string, frame: number, deviceId: string) {
  activeCloudStage();
  const next = build(scenario, frame, deviceId);
  if (!next) return;
  clearStage();
  active = next;
  session()?.setItem(STORE_KEY, JSON.stringify({ scenario, frame, deviceId }));
  notify();
}

/**
 * Starts a 亲手体验 run on the instance: the world shown first, then each step of it comes from
 * the owner's clicks and the play's own timers (advanceCloudPlay). A page reload ends it.
 */
export function startCloudPlay(
  play: { id: string; name: string; outcome: string; phase: string },
  world: CloudStageWorld,
  deviceId: string,
) {
  activeCloudStage();
  clearStage();
  active = {
    scenario: `play:${play.id}`,
    frame: -1,
    deviceId,
    code: '',
    name: play.name,
    key: `stage-${++count}`,
    world,
    play: { name: play.name, outcome: play.outcome, phase: play.phase },
  };
  session()?.removeItem(STORE_KEY);
  notify();
}
/** The next step of the run in force, on the same key; nothing when the run has ended. */
export function advanceCloudPlay(world: CloudStageWorld, phase: string) {
  if (!active?.play) return;
  active = { ...active, world, play: { ...active.play, phase } };
  notify();
}
/**
 * Waits as the run's own clock: settles after `ms`, or never once the run has ended (another
 * frame, 结束模拟), so nothing of an ended run moves the page afterwards.
 */
export function playDelay(ms: number): Promise<void> {
  const run = active?.key;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (active?.play && active.key === run) resolve();
    }, ms);
    timers.add(timer);
  });
}
/** What the run answers for the update dialog's instance operations (cloudFaultScripts.ts). */
type PlayInstance = {
  upgrade(): Promise<CloudUpgradeOperation>;
  maintenance(change: CloudMaintenanceEdit): Promise<CloudMaintenanceView>;
};
let playInstance: PlayInstance | null = null;
export function registerCloudPlayInstance(answer: PlayInstance) {
  playInstance = answer;
}
const timers = new Set<ReturnType<typeof setTimeout>>();

/** Ends the simulation: the pages read the real instance again. */
export function endCloudStage() {
  if (!activeCloudStage()) return;
  clearStage();
  active = null;
  session()?.removeItem(STORE_KEY);
  notify();
}

function clearStage() {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  aborter.abort();
  aborter = new AbortController();
  toast.dismissAll();
}

/** For a confirmation a frame opens: closed as soon as another frame is chosen. */
export const stageSignal = () => aborter.signal;

export function useCloudStage(): ActiveCloudStage | null {
  return useSyncExternalStore(subscribe, activeCloudStage, activeCloudStage);
}
export const cloudSimulating = () => !!activeCloudStage();
export function useCloudSimulating(): boolean {
  return !!useCloudStage();
}
/** Changes with every frame and when the simulation ends: a page keyed on it starts afresh. */
export function useCloudStageKey(): string {
  return useCloudStage()?.key ?? 'live';
}

/** An answer still under way: it never arrives, so nothing waiting on it moves the frame. */
export const never = <T>() => new Promise<T>(() => {});

// ── The gate ───────────────────────────────────────────────────────────────────────────────────

/**
 * While a frame is chosen, every request that would change an instance is refused here, before it
 * leaves the page. Refused before anything was sent, it fails like a request the instance could not
 * take (NOT_READY), and the page reports it as not saved. Every cloud request goes through one of
 * the exits below.
 */
export const SIMULATION_BLOCKED = 'CLOUD_SETTINGS_NOT_READY';
const BRIDGE_WRITES = new Set([
  'instanceClaim',
  'instanceInitialize',
  'instanceLoginStart',
  'instanceLoginDispatch',
  'instanceUpgrade',
  'instancePower',
  'instancePolicy',
  'save',
  'cancelAuthorizations',
]);
const MANAGE_READS = new Set(['list', 'status']);
/** A call on the cloud settings bridge that changes the instance. */
export function bridgeWrites(method: string, input: unknown): boolean {
  if (method === 'manage')
    return !MANAGE_READS.has(
      (input as { command?: { operation?: string } } | undefined)?.command?.operation ?? '',
    );
  return BRIDGE_WRITES.has(method);
}
/** The cloud settings bridge with writes refused while simulating. */
export function gatedCloudSettings<T extends object>(
  api: T = window.electronAPI.cloudSettings as T,
): T {
  // The preload bridge is frozen, so this is a copy, not a Proxy over it.
  const gated: Record<string, unknown> = {};
  for (const key in api) {
    const value = (api as Record<string, unknown>)[key];
    gated[key] =
      typeof value === 'function'
        ? (input: unknown, ...rest: unknown[]) =>
            cloudSimulating() && bridgeWrites(key, input)
              ? Promise.reject(new Error(SIMULATION_BLOCKED))
              : (value as (...args: unknown[]) => unknown).call(api, input, ...rest)
        : value;
  }
  return gated as T;
}

const IM_READS = new Set([
  'maker:hook-control:get',
  'maker:hook-control:prefs-get',
  'maker:hook-control:provider-prefs-get',
  'maker:hook-control:telegram-behavior-get',
  'maker:hook-control:telegram-groups-list',
  'maker:hook-control:workspace-provider-source-get',
  'maker:im-default-settings:get',
  'telegramBot:get-behavior',
  'telegramBot:get-persona',
  'telegramBot:get-status',
  'telegramBot:list-groups',
  'wechatBot:get-channel-settings',
]);
const PROVIDER_READS = new Set([
  'list',
  'cli-scan',
  'presets',
  'provider-view',
  'models-fetch',
  'detect',
  'test-connection',
  'setup-result',
  'codex-limits',
  'account-usage',
  'refresh',
]);
type Request = { call?: string; op?: string; action?: string; command?: { action?: string } };
/** Per instance channel: whether a request only reads. Any other channel counts as a write. */
const CHANNEL_READS: Record<string, (request: Request | undefined) => boolean> = {
  [CLOUD_IM_SETTINGS_CHANNEL]: (r) => IM_READS.has(r?.call ?? ''),
  [CLOUD_PERSONALIZATION_CHANNEL]: (r) => r?.op === 'read',
  [CLOUD_STORAGE_USAGE_CHANNEL]: (r) => r?.op === 'read',
  [CLOUD_PROVIDER_SETTINGS_CHANNEL]: (r) =>
    PROVIDER_READS.has(r?.op ?? '') ||
    ((r?.op === 'xd' || r?.op === 'byok') && r.action === 'status') ||
    (r?.op === 'share' &&
      ['received', 'get-credential-consent'].includes(r.command?.action ?? '')),
  'maker:usage:account': () => true,
};
/** A request on an instance channel that changes the instance. */
export const channelWrites = (channel: string, args: readonly unknown[]) =>
  !(CHANNEL_READS[channel]?.(args[0] as Request | undefined) ?? false);

/** What the stage answers on an instance channel; nothing reaches the instance meanwhile. */
type ChannelAnswer = (stage: ActiveCloudStage, channel: string, args: readonly unknown[]) => Promise<unknown>;
let answerChannel: ChannelAnswer = () =>
  Promise.reject(new Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] not allowed'));
/** The catalog provides the stage's channel answers (a fixed provider catalog, IM failures). */
export function registerCloudChannelAnswers(answer: ChannelAnswer) {
  answerChannel = answer;
}
/** DeviceLink to the instance: while simulating, writes are refused and the stage answers reads. */
export async function invokeCloudChannel<T = unknown>(
  deviceId: string,
  channel: string,
  args: unknown[],
): Promise<T> {
  const stage = activeCloudStage();
  if (stage) {
    if (channelWrites(channel, args)) throw new Error(SIMULATION_BLOCKED);
    return (await answerChannel(stage, channel, args)) as T;
  }
  return (await window.electronAPI.deviceLink.invoke(deviceId, channel, args)) as T;
}
/** For exits that are neither (login windows, plugin secrets): refuse while simulating. */
export function refuseWhileSimulating() {
  if (cloudSimulating()) throw new Error(SIMULATION_BLOCKED);
}

/** The plugin and skill actions that only read; any other action changes the computer. */
const REMOTE_RESOURCE_READS: Record<string, readonly string[]> = {
  plugins: ['snapshot', 'market-detail', 'operation', 'preferences', 'project-state'],
  skills: ['snapshot', 'catalog', 'detail', 'children', 'operation', 'read-file'],
};
const REMOTE_RESOURCE_READ_CHANNELS = new Set([
  REMOTE_RESOURCE_MANIFEST_CHANNEL,
  REMOTE_RESOURCE_LIST_CHANNEL,
  REMOTE_RESOURCE_GET_CHANNEL,
]);
/** A request to a computer's plugins or skills (the remote plugin page) that changes it. */
export function remoteResourceWrites(channel: string, args: readonly unknown[]): boolean {
  if (REMOTE_RESOURCE_READ_CHANNELS.has(channel)) return false;
  if (channel !== REMOTE_RESOURCE_INVOKE_CHANNEL) return true;
  const request = args[0] as { collectionId?: string; actionId?: string } | undefined;
  const action = request?.actionId?.replace(/^management:/, '') ?? '';
  return !REMOTE_RESOURCE_READS[request?.collectionId ?? '']?.includes(action);
}
const isCloudInstance = (deviceId: string) => /^cloud-device-[a-f0-9]{24}$/.test(deviceId);
// The instance's plugin page (CloudPluginManagement) talks to it over DeviceLink, like any other
// computer's: while simulating, its writes to a cloud instance are held back too, and a frame whose
// plugin page cannot be read fails its reads as well.
setRemoteResourceGuard({
  check(deviceId, channel, args) {
    const stage = activeCloudStage();
    if (!stage || !isCloudInstance(deviceId)) return;
    if (remoteResourceWrites(channel, args)) throw new Error(SIMULATION_BLOCKED);
    if (stage.world.settings?.plugins === 'fail') throw new Error('[DEVICE_LINK_TIMEOUT] timeout');
  },
  writable: (deviceId) => !(cloudSimulating() && isCloudInstance(deviceId)),
  subscribe,
});

/**
 * The updates dialog's instance operations while simulating: the instance is the frame's, and an
 * update or schedule change is refused like any other write. In a 亲手体验 run the run answers the
 * update and the schedule itself; nothing is sent either way.
 */
export function stageInstanceClient(view: () => CloudInstanceView | undefined): CloudSettingsClient {
  const refused = () => Promise.reject(new Error(SIMULATION_BLOCKED));
  const playing = () => (activeCloudStage()?.play ? playInstance : null);
  return {
    instance: async () => view() ?? never(),
    upgrade: () => playing()?.upgrade() ?? refused(),
    power: refused,
    maintenance: (change) => playing()?.maintenance(change) ?? refused(),
    connect: refused,
    reconnect: refused,
    read: refused,
    save: refused,
    close() {},
  };
}

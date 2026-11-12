import { useSyncExternalStore } from 'react';
import { BUNDLED_CATALOG } from '@cindy/model-providers';
import type { CloudSettingsDomain, CloudSettingsState } from '../../../shared/cloudSettings';
import type { CloudInstanceView, CloudMaintenanceView } from '../../../shared/cloudInstanceControl';
import { CLOUD_IM_SETTINGS_CHANNEL } from '../../../shared/cloudImSettings';
import { CLOUD_PROVIDER_SETTINGS_CHANNEL } from '../../../shared/cloudProviderSettings';
import type { CloudSettingsClient } from './client';
import {
  SIMULATION_BLOCKED,
  activeCloudStage,
  advanceCloudPlay,
  endCloudStage,
  never,
  playDelay,
  registerCloudPlayInstance,
  startCloudPlay,
  registerCloudChannelAnswers,
  registerCloudScenarios,
  selectCloudFrame,
  type CloudStageFrame,
  type CloudStageScenario,
  type CloudStageWorld,
  type StageAnswer,
  type StageAuthState,
  type StageCard,
  type StageSettings,
  type StageUpdate,
} from './cloudFaults';
import {
  CLOUD_SETTINGS_VISIBILITY,
  cloudTabDomains,
  type CloudSettingsPageTab,
} from './cloudSettingsVisibility';
import { createTrialCloudSettingsClient } from './trialClient';

/**
 * Every scenario of the panel, frame by frame, as the world it pins (cloudFaults.ts). Derived from
 * what the cloud UI can show: the card's states (instanceStatus, the power and claim read-backs),
 * the update dialog's outcomes (instanceState.ts upgradeOutcome, the request and schedule saves),
 * the settings page's own states, and each authorization's phases. Codes the checklist and docs
 * already use keep their meaning; new cases have new codes.
 */

// ── The instance ───────────────────────────────────────────────────────────────────────────────

const VERSION = '0.1.130-cloud.12';
const NEXT = '0.1.130-cloud.13';
// An update outcome shows for 30 minutes after CIS last changed it (upgradeNoticeVisible); a frame
// stays as long as it is shown, so its operation is dated ahead.
const LATER = () => Date.now() + 365 * 24 * 3_600_000;
const policy = (instanceId: string): CloudMaintenanceView => ({
  instanceId,
  revision: 'a'.repeat(64),
  defaultsRevision: 1,
  autoUpdate: true,
  raw: { policyMode: 'inherit', calendar: null, scheduledTaskPolicy: 'protect', pausedUntilMs: null },
  effective: {
    source: 'inherit',
    calendar: {
      timezone: 'Asia/Shanghai',
      windows: [{ id: 'daily', weekdays: [1, 2, 3, 4, 5, 6, 7], startLocal: '03:00', endLocal: '05:00' }],
    },
  },
  executionMode: 'scheduled',
  nextEligibleAtMs: null,
  serverTimeMs: Date.now(),
  windows: [],
});
const instance = (deviceId: string, extra: Partial<CloudInstanceView> = {}): CloudInstanceView => ({
  instanceId: deviceId,
  deviceId,
  name: null,
  nameSequence: 1,
  ordinal: null,
  desiredState: 'running',
  runtimeState: 'running',
  ready: true,
  version: VERSION,
  imageId: null,
  updateAvailable: false,
  latestVersion: VERSION,
  upgradeState: 'idle',
  observedAtMs: Date.now(),
  manualUpgrade: true,
  maintenance: policy(deviceId),
  ...extra,
});
const RUNNING = {};
const UPDATE = { updateAvailable: true, latestVersion: NEXT };
const ASLEEP = { desiredState: 'stopped', runtimeState: 'stopped', ready: false } as const;
const operation = (phase: string, active: boolean) => ({
  upgradeOperation: { operationId: 'stage', phase, active, updatedAtMs: LATER() },
});
const UPDATING = (phase: string) => ({ ...operation(phase, true), latestVersion: NEXT });

type State = Partial<CloudInstanceView> | ((deviceId: string) => Partial<CloudInstanceView>);
const resolve = (deviceId: string, state: State) =>
  instance(deviceId, typeof state === 'function' ? state(deviceId) : state);
/** The update settings as CIS serves them, changed in the parts a frame shows. */
const POLICY = (change: (policy: CloudMaintenanceView) => CloudMaintenanceView) => (deviceId: string) => ({
  maintenance: change(policy(deviceId)),
});
const CUSTOM_CALENDAR = {
  timezone: 'Asia/Shanghai',
  windows: [
    { id: 'workdays', weekdays: [1, 2, 3, 4, 5], startLocal: '02:00', endLocal: '04:00' },
    { id: 'weekend', weekdays: [6, 7], startLocal: '10:00', endLocal: '12:00' },
  ],
};
const CUSTOM = POLICY((p) => ({
  ...p,
  raw: { ...p.raw, policyMode: 'custom', calendar: CUSTOM_CALENDAR },
  effective: { source: 'custom', calendar: CUSTOM_CALENDAR },
}));

const card = (state: State, more: Partial<StageCard> = {}) =>
  (deviceId: string): CloudStageWorld => ({ card: { instances: [resolve(deviceId, state)], ...more } });
/** The updates dialog, opened from the card. */
const dialog = (state: State, update: StageUpdate = {}, more: Partial<StageCard> = {}) =>
  (deviceId: string): CloudStageWorld => ({
    card: { instances: [resolve(deviceId, state)], dialog: true, ...more },
    update,
  });
const claim = (more: Partial<StageCard>, instances = false) =>
  (deviceId: string): CloudStageWorld => ({
    card: { instances: instances ? [instance(deviceId)] : [], ...more },
  });

// ── The settings page ──────────────────────────────────────────────────────────────────────────

const unreadable = (domain: CloudSettingsDomain): CloudSettingsState => ({
  domain,
  status: 'unreadable',
  revision: null,
  readErrorCode: 'SETTINGS_REQUEST_FAILED',
});
/**
 * The settings the page reads: the trial's fixed values, groups answered without a value as the
 * frame says, and nothing ever saved. Authorization lists are the trial's; running, stopping or
 * answering one is refused like any other write.
 */
function stageClient(
  deviceId: string,
  world: Pick<StageSettings, 'page' | 'unreadable' | 'refreshFails' | 'imDomains' | 'manage'>,
): CloudSettingsClient {
  let made: ReturnType<typeof createTrialCloudSettingsClient> | undefined;
  const trial = async () => (made ??= createTrialCloudSettingsClient());
  const read = new Set<CloudSettingsDomain>();
  const open = async () => {
    if (world.page === 'loading') return never<Awaited<ReturnType<CloudSettingsClient['connect']>>>();
    if (world.page === 'failed') throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
    // An instance without settings sessions answers the first open this way.
    if (world.page === 'unsupported') throw new Error('CLOUD_SETTINGS_UNSUPPORTED');
    return { ...(await (await trial()).connect()), deviceId };
  };
  return {
    connect: open,
    reconnect: open,
    async read(domains) {
      if (world.page === 'failed') throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
      const states = await (await trial()).read(domains);
      let again = false;
      const answered = states.map((state): CloudSettingsState => {
        if (world.unreadable?.includes(state.domain)) return unreadable(state.domain);
        if (world.imDomains && /^im[A-Z]/.test(state.domain))
          return world.imDomains === 'unavailable'
            ? { domain: state.domain, status: 'unavailable', revision: null }
            : world.imDomains === 'tooLarge'
              ? { ...unreadable(state.domain), readErrorCode: 'SETTINGS_RESPONSE_TOO_LARGE' }
              : unreadable(state.domain);
        if (!world.refreshFails?.includes(state.domain)) return state;
        if (read.has(state.domain)) return unreadable(state.domain);
        read.add(state.domain);
        again = true;
        return state;
      });
      // Read once; the page reads again at once, as on returning to the window, and that fails.
      if (again) setTimeout(() => document.dispatchEvent(new Event('visibilitychange')), 0);
      return answered;
    },
    save: () => Promise.reject(new Error(SIMULATION_BLOCKED)),
    async manage(command) {
      if (command.operation !== 'list' && command.operation !== 'status')
        throw new Error(SIMULATION_BLOCKED);
      if (world.manage === 'fail') throw new Error('CLOUD_SETTINGS_UNAVAILABLE');
      return (await trial()).manage(command);
    },
    close() {},
  };
}
const settings = (
  tab: CloudSettingsPageTab,
  world: Omit<StageSettings, 'client' | 'tab'> = {},
  auth?: CloudStageWorld['auth'],
) =>
  (deviceId: string): CloudStageWorld => ({
    settings: { tab, ...world, client: stageClient(deviceId, world) },
    ...(auth ? { auth } : {}),
  });

// A catalog like the instance's own: one connected provider and the built-ins it leaves out. A
// frame about Cindy AI lists it first, so it is the one shown.
const catalog = (xd: boolean) => ({
  version: 1,
  ownerGeneration: 1,
  providers: BUNDLED_CATALOG.providers
    .filter((provider) => ['anthropic', 'openai', 'deepseek', ...(xd ? ['xd'] : [])].includes(provider.id))
    .map((provider) => ({ ...provider, connected: provider.id === 'anthropic' })),
  providerOrder: xd ? ['xd'] : [],
  visibility: { status: 'ready', revision: 'r1', overrides: {} },
  supportedOps: xd ? ['list', 'xd'] : ['list'],
  efforts: {},
});
// The instance's IM channel with nothing connected yet (the cards as a new instance shows them).
const PROVIDER_HOOK = {
  enabled: false,
  url: '',
  status: 'disabled',
  lastError: null,
  available: true,
  capabilityPending: false,
  binding: null,
  defaultWorkspace: null,
};
const HOOK = {
  enabled: false,
  lifecycleAnnouncement: false,
  url: '',
  workspaces: {},
  status: 'disabled',
  lastError: null,
  binding: null,
  bindings: [],
  pendingBind: null,
  serverMultiTeam: false,
  telegram: PROVIDER_HOOK,
  x: PROVIDER_HOOK,
  feishu: PROVIDER_HOOK,
};
const answer = (kind: StageAnswer | undefined, ready: () => unknown) =>
  kind === 'pending'
    ? never()
    : kind === 'fail'
      ? Promise.reject(new Error('[DEVICE_LINK_TIMEOUT] timeout'))
      : kind === 'unsupported'
        ? Promise.reject(new Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] not allowed'))
        : Promise.resolve(ready());
registerCloudChannelAnswers((stage, channel, args) => {
  const world = stage.world.settings;
  const request = args[0] as { op?: string; call?: string; command?: { action?: string } } | undefined;
  if (channel === CLOUD_PROVIDER_SETTINGS_CHANNEL)
    return answer(world?.providers, () =>
      request?.op === 'list'
        ? catalog(!!world?.xd)
        : {
            ok: true,
            ownerGeneration: 1,
            catalogChanged: false,
            value:
              request?.op === 'share'
                ? []
                : request?.op === 'xd' && world?.xd
                  ? {
                      state: world.xd,
                      errorCode: world.xd === 'failed' ? 'SERVER_UNAVAILABLE' : undefined,
                      source: null,
                      endpoint: null,
                      accountTier: null,
                    }
                  : null,
          },
    );
  // The IM cards read the connection snapshot; nothing else of the channel has a fixed answer.
  // A frame without IM cards of its own uses the ticket cards (the channel is not offered).
  if (channel === CLOUD_IM_SETTINGS_CHANNEL)
    return world?.im === 'ready'
      ? request?.call === 'maker:hook-control:get'
        ? Promise.resolve({ ownerGeneration: 1, result: { hook: HOOK } })
        : Promise.reject(new Error('[UNAVAILABLE] not part of this frame'))
      : answer(world?.im ?? 'unsupported', () => null);
  // Prompt, storage and quota rows: as on a runtime without those channels.
  return answer('unsupported', () => null);
});

// ── Frames ─────────────────────────────────────────────────────────────────────────────────────

/**
 * One frame per distinct screen (owner, 2026-11-11: "verify patterns, not instances"). Situations
 * that look the same share one frame, and its note names every cause that looks like this. `check`
 * puts it in the 验收清单: the common path and one representative of each failure or edge pattern.
 */
const frame = (
  code: string,
  name: string,
  world: (deviceId: string) => CloudStageWorld,
  { note, check, label }: { note?: string; check?: boolean; label?: string } = {},
): CloudStageFrame => ({
  code,
  name,
  world,
  ...(note ? { note } : {}),
  ...(check ? { check } : {}),
  ...(label ? { label } : {}),
});
const auth = (section: 'providers' | 'bots' | 'mcp', state: StageAuthState) => ({ section, state });
// Each authorization on the page that lists it; providers and bots on their ticket lists, the
// rows the instance offers before its own provider and IM channels answer.
const providerAuth = (state: StageAuthState) =>
  settings('providers', { providers: 'unsupported' }, auth('providers', state));
const botAuth = (state: StageAuthState) =>
  settings('im-bot', { im: 'unsupported' }, auth('bots', state));
const mcpAuth = (state: StageAuthState) => settings('builtin-tools', {}, auth('mcp', state));
const SAME_AUTH = '和本机供应商向导一样（D11 F）';
const GENERAL_DOMAINS = cloudTabDomains(CLOUD_SETTINGS_VISIBILITY, 'general');

export const CLOUD_SCENARIOS: readonly CloudStageScenario[] = [
  {
    id: 'card',
    group: '我的设备卡片',
    code: '32',
    name: '卡片的各种状态',
    frames: [
      frame('32A', '运行中', card(RUNNING), {
        check: true,
        note: '领取成功后出现的卡片、唤醒成功、正在调整配置（菜单里休眠和更新不能点）都是这样',
      }),
      frame('32P', '运行中但远程连接断开', card(RUNNING, { linkOffline: true }), {
        note: '和其他离线设备一样：灰点加「最后在线」',
      }),
      frame('32O', '列表还没读到', card(RUNNING, { notLoaded: true }), {
        note: '刚打开时一闪而过：副标题转圈写「正在读取状态…」，管理菜单还没出来',
      }),
      frame('32B', '正在启动', card(ASLEEP, { powerPending: { action: 'wake', uncertain: true } }), {
        check: true,
        note: '点了唤醒（菜单里唤醒项转圈）、云端自己启动都是这样',
      }),
      frame('32G', '正在进入休眠', card(RUNNING, { powerPending: { action: 'sleep', uncertain: true } }), {
        note: '点了休眠、云端自己休眠都是这样',
      }),
      frame('32H', '已休眠', card(ASLEEP), { check: true, note: '休眠成功也是这样' }),
      frame('32I', '正在更新', card(UPDATING('backup-running')), {
        check: true,
        note: '立即更新和自动更新进行中都是这样；更新中重启、暂时连不上（原 29A）看起来也一样',
      }),
      frame('32C', '出错', card({ runtimeState: 'error', ready: false })),
      frame('32D', '需要登录', card({ loginRequired: true, runtimeState: 'starting', ready: false }), {
        note: '领取后第一次登录前',
      }),
      frame('32N', '登录已失效', card({ loginRequired: true, loginWakeSupported: true, runtimeState: 'starting', ready: false }), {
        note: '运行中',
      }),
      frame('32L', '已打开登录页，等待登录', card({ loginRequired: true, runtimeState: 'starting', ready: false }, { waiting: true })),
      frame('32M', '登录页打开失败', card({ loginRequired: true, runtimeState: 'starting', ready: false }, { error: 'loginFailed' })),
      // Signing in wakes it: no separate wake, the sign-in button says so.
      frame('32J', '已休眠，需要重新登录', card({ ...ASLEEP, loginRequired: true, loginWakeSupported: true })),
      frame('32K', '已休眠，需先唤醒再登录', card({ ...ASLEEP, loginRequired: true, loginWakeSupported: false }), {
        note: '不支持登录时唤醒。较早的云端才会这样',
      }),
      frame('32F', '状态加载失败', card(RUNNING, { listError: true }), {
        check: true,
        note: '卡片上的设备列表读不到。同一种失败在别处长得不一样：见 30C、28D、25C',
      }),
    ],
  },
  {
    id: 'claim',
    group: '我的设备卡片',
    code: '28',
    name: '领取云端 Cindy',
    frames: [
      frame('28', '领取入口', claim({}), { note: '实例被删除后也回到这里' }),
      frame('28', '按钮转圈', claim({ claim: 'checking' }), { note: '提交中和结果确认中都只转圈' }),
      frame('28B', '领取失败', claim({ claim: 'notClaimed' })),
      frame('28C', '领取结果加载失败', claim({ claim: 'unreadable' })),
      frame('28D', '还没有卡片时状态加载失败', claim({ listError: true }), { note: '还没有卡片。设备列表的错误行写「加载失败」，领取按钮不能点' }),
    ],
  },
  {
    id: 'power',
    group: '我的设备卡片',
    code: '30',
    name: '休眠和唤醒',
    frames: [
      frame('30', '休眠确认弹窗', card(RUNNING, { confirmSleep: true }), { note: '本机共用的确认弹窗；立即更新的确认（25）同一种' }),
      frame('30B', '休眠失败', card(RUNNING, { powerNote: { action: 'sleep', kind: 'notTaken' } }), {
        check: true,
        note: '唤醒失败（30WB）同一个样式，只是文字不同',
      }),
      frame('30WB', '唤醒失败', card(ASLEEP, { powerNote: { action: 'wake', kind: 'notTaken' } })),
      frame('30C', '休眠或唤醒后状态加载失败', card(RUNNING, { powerNote: { action: 'sleep', kind: 'unreadable' } }), {
        note: '副标题写「状态加载失败」，灰点，用列表的「刷新」重读。唤醒之后也是这样',
      }),
    ],
  },
  {
    id: 'card-upgrading',
    group: '我的设备卡片',
    code: '29',
    name: '卡片上的更新',
    frames: [
      frame('29C', '有新版本', card(UPDATE)),
      frame('29H', '已安排：管理菜单里「更新」是时钟', card(UPDATING('requested'), { menu: true }), {
        note: '等任务做完才开始：卡片还是绿点「运行中」，菜单里「更新」标「已安排」',
      }),
      frame('29B', '管理菜单里「更新」在转圈', card(UPDATING('backup-running'), { menu: true }), {
        note: '正在更新；重启、暂时连不上时也一样',
      }),
      frame('29E', '更新完成提示', card({ version: NEXT, latestVersion: NEXT, ...operation('completed', false) }, { toast: 'upgraded' }), {
        check: true,
        note: '更新在弹窗关着时结束：弹一条「已更新到…」',
      }),
      frame('29F', '更新失败提示', card({ ...UPDATE, ...operation('cancelled', false) }, { toast: 'upgradeFailed' }), {
        note: '更新在弹窗关着时失败：弹一条「更新失败」，带「查看更新」',
      }),
      frame('29D', '管理菜单里标着更新失败', card({ ...UPDATE, ...operation('cancelled', false) }, { menu: true })),
      frame('29G', '更新暂停', card({ ...UPDATE, ...operation('recovery-hold', false) }), {
        note: 'recovery-hold。副标题「运行中」，点也跟着是绿的；更新失败只在「更新」标记和弹窗里说',
      }),
    ],
  },
  {
    id: 'upgrade',
    group: '更新',
    code: '25',
    name: '立即更新',
    frames: [
      frame('25', '有新版本', dialog(UPDATE), { check: true }),
      frame('25K', '有更新，版本号不变', dialog({ updateAvailable: true, latestVersion: VERSION }), {
        note: '同版本修订。标题只写「有更新」，不带版本号',
      }),
      frame('25L', '有新版本，只能自动更新', dialog({ ...UPDATE, manualUpgrade: false }), {
        note: '没有按钮，状态行写「当前 X。将在更新时段内自动更新。」',
      }),
      frame('25M', '有新版本，实例已休眠', dialog({ ...ASLEEP, ...UPDATE }), {
        note: '按钮是灰的，状态行写「当前 X。唤醒后可更新。」；需要登录时写「登录后可更新。」',
      }),
      frame('25', '确认弹窗', dialog(UPDATE, { confirm: true }), { note: '点了马上关，不转圈' }),
      frame('25A', '已安排', dialog(UPDATING('requested')), {
        note: '时钟图标。刚确认（云端还没回话）、云端排队等任务做完都是这样',
      }),
      frame('25D', '正在更新', dialog(UPDATING('backup-running')), {
        note: '转圈图标在标题前，右边没有按钮；重启、暂时连不上（原 25E）看起来一样',
      }),
      frame('25F', '更新完成', dialog({ version: NEXT, latestVersion: NEXT, ...operation('completed', false) }), {
        note: '打勾图标，「现在是最新版本。」',
      }),
      frame('25B', '没能开始更新', dialog(UPDATE, { notStarted: true }), {
        check: true,
        note: '没开始和云端不接受都是一条提示「无法开始更新，请稍后重试。」，状态行回到「有新版本」，可以再点',
      }),
      frame('25H', '更新失败，已回到旧版本', dialog({ ...UPDATE, upgradeState: 'rolled-back', ...operation('completed', false) }), {
        note: '红色图标「更新失败」，「已回到 X，可以再更新一次。」，右边立即更新',
      }),
      frame('25I', '更新失败（recovery-hold）', dialog({ ...UPDATE, ...operation('recovery-hold', false) }), {
        note: '语义待后端确认：只写「更新失败」，不给按钮',
      }),
      frame('25C', '状态加载失败', dialog(UPDATE, { check: 'unreadable' }), {
        note: '状态行写「当前版本 X」「无法读取状态，请重试。」，右边是重试图标',
      }),
    ],
  },
  {
    id: 'policy',
    group: '更新',
    code: '26',
    name: '自动更新设置',
    frames: [
      frame('26K', '更新设置读取中', dialog({ maintenance: null }, {}, { reload: 'pending' }), { note: '打开弹窗时一闪而过' }),
      frame('26D', '弹窗读取失败', dialog({ maintenance: null }, {}, { reload: 'fail' })),
      frame('26A', '已是最新版本', dialog(RUNNING), { note: '改了开关或时段并且已保存时也是这样，另有一条提示（已开启自动更新等）' }),
      frame('26', '正在保存', dialog(RUNNING, { policy: 'saving' }), { note: '控件变灰：保存中只让开关和下拉不能点，不写字' }),
      frame('26B', '保存失败', dialog(RUNNING, { policy: 'policyNotSaved' }), {
        check: true,
        note: '一条提示。没保存上、被别处改过、云端不接受、连不上、时段无效都是一条「保存失败」提示',
      }),
      frame('26C', '状态加载失败', dialog(RUNNING, { policy: 'unreadable' }), { note: '时段下方写「状态加载失败」，上面有刷新' }),
      frame('26E', '自定义时段', dialog(CUSTOM), { note: '网页端设过多个时段，这里只能显示' }),
      frame('26F', '替换自定义时段的确认', dialog(CUSTOM, { confirmReplace: true })),
      frame('26G', '默认时段在别的时区', dialog(POLICY((p) => ({ ...p, effective: { ...p.effective, calendar: { ...p.effective.calendar, timezone: 'America/Los_Angeles' } } })))),
      frame('26H', '暂不支持自动更新', dialog(POLICY((p) => ({ ...p, executionMode: 'preview-only' })))),
      frame('26I', '自动更新已暂停', dialog(POLICY((p) => ({ ...p, raw: { ...p.raw, pausedUntilMs: Date.now() + 3 * 24 * 3_600_000 } })))),
      frame('26J', '请在网页端修改', dialog(POLICY((p) => ({ ...p, raw: { ...p.raw, scheduledTaskPolicy: 'defer' } }))), {
        note: '任务保护策略不是「保护」时，控件全部不能用',
      }),
    ],
  },
  {
    id: 'session',
    group: '云端设置页',
    code: '18',
    name: '整页',
    frames: [
      frame('19A', '设置页', settings('general'), {
        check: true,
        label: '正常',
        note: '顶部是「正在管理」提示。改设置后已保存（含结果一时不确定、读回来已保存）时也是这样，什么都不说',
      }),
      frame('18', '正在加载…', settings('general', { page: 'loading' }), {
        check: true,
        label: '正在加载',
        note: '「正在管理」提示里写「正在读取设置…」。供应商页、IM 页读取中不另外写字',
      }),
      frame('18', '加载失败', settings('general', { page: 'failed' }), {
        check: true,
        note: '「正在管理」提示里写「无法读取设置，请重试。」加「重试」。没有位置的组读不到、保存后读不到而页面已在报时也是这样',
      }),
      frame('18A', '版本不支持', settings('general', { page: 'unsupported' }), {
        note: '「正在管理」提示里写「请更新另一台设备上的 Cindy 以编辑这些设置。」较早的云端才会这样',
      }),
      frame('18B', '这一类一组都没读到', settings('general', { unreadable: [...GENERAL_DOMAINS] }), {
        note: '每组标题行各自写加载失败，不再有搜索用的那句',
      }),
      frame('33A', '已离线', settings('general', { offline: 'asleep' }), {
        check: true,
        note: '「正在管理」提示写「已离线，暂时无法管理」加「远程连接」。休眠、启动中、需要登录、出错都是这样',
      }),
      frame('33B', '正在更新', settings('general', { offline: 'upgrading' }), {
        note: '「正在管理」提示写「正在更新，完成后可修改」',
      }),
    ],
  },
  {
    id: 'group',
    group: '云端设置页',
    code: '31',
    name: '一组设置读不到',
    frames: [
      frame('31A', '刷新时读不到', settings('general', { refreshFails: ['agentResource'] }), {
        check: true,
        label: '一组读不到',
        note: '读到过一次，再读失败：值留在原处变灰，不能改。每个设置组都一样',
      }),
      frame('31B', '刚打开就读不到', settings('general', { unreadable: ['agentResource'] }), {
        note: '一次都没读到：只有标题行，右边是加载失败和重试',
      }),
    ],
  },
  {
    id: 'save-result',
    group: '云端设置页',
    code: '19',
    name: '改设置后',
    frames: [
      frame('19B', '未能保存', settings('general', { saveFailure: 'notSaved' }), {
        check: true,
        note: '提示「未能保存设置，请重试。」，没有按钮，控件回到原值。没保存上、一直读不到、连不上都是这样',
      }),
      frame('23', '被别处改过', settings('general', { saveFailure: 'conflict' }), {
        note: '提示「设置已在另一台设备上更改，已显示最新设置。」，没有按钮',
      }),
      frame('24', '云端不接受', settings('general', { saveFailure: 'rejected' }), {
        note: '提示「设置未保存，已恢复上次确认的设置。」，没有按钮',
      }),
      frame('19D', '已保存，但没能应用到所有执行端窗口', settings('general', { saveApplyFailed: true }), {
        note: '一条 warning 提示，页面上不写字',
      }),
    ],
  },
  {
    id: 'providers',
    group: '模型供应商 / IM / 插件',
    code: '20',
    name: '模型供应商',
    frames: [
      frame('20A', '列表', settings('providers'), { check: true, label: '模型供应商' }),
      frame('20', '正在加载…', settings('providers', { providers: 'pending' }), {
        note: '列表处不放字，和本机一样',
      }),
      frame('20', '加载失败', settings('providers', { providers: 'fail' }), {
        note: '本机的「模型列表暂时无法更新，请重新加载模型。」。授权列表读不到也是这一条',
      }),
      frame('20D', 'Cindy AI 正在同步', settings('providers', { xd: 'syncing' })),
      frame('20E', 'Cindy AI 同步失败', settings('providers', { xd: 'failed' })),
      frame('20F', 'Cindy AI 未开通', settings('providers', { xd: 'disabled' })),
      frame('20G', 'Cindy AI 不支持', settings('providers', { xd: 'unsupported' }), { note: '企业未接入' }),
      frame('20B', '旧版授权列表', settings('providers', { providers: 'unsupported' }), { note: '较早的云端没有新的供应商页' }),
    ],
  },
  {
    id: 'im',
    group: '模型供应商 / IM / 插件',
    code: '21',
    name: 'IM 机器人',
    frames: [
      frame('21A', '正常', settings('im-bot', { im: 'ready' }), { check: true, label: 'IM 机器人', note: '还没接任何渠道' }),
      frame('21', '正在加载…', settings('im-bot', { im: 'pending' }), { note: '卡片处不放字' }),
      frame('21', '加载失败', settings('im-bot', { im: 'fail' })),
      frame('21C', '新对话配置读不到', settings('im-bot', { im: 'ready', imDomains: 'unreadable', openBot: 'bot:feishu' }), {
        note: '一行小字加「重新读取」，和本机 Telegram 设置读不到一样',
      }),
      frame('21D', '这项配置版本不支持', settings('im-bot', { im: 'ready', imDomains: 'unavailable', openBot: 'bot:feishu' })),
      frame('21E', '配置过大，无法读取', settings('im-bot', { im: 'ready', imDomains: 'tooLarge', openBot: 'bot:feishu' })),
      frame('21B', '旧版授权卡片', settings('im-bot', { im: 'unsupported' }), { note: '较早的云端没有新的 IM 卡片' }),
    ],
  },
  {
    id: 'plugins',
    group: '模型供应商 / IM / 插件',
    code: '34',
    name: '插件',
    frames: [
      frame('34A', '列表', settings('ghosts'), {
        check: true,
        label: '插件',
        note: '显示的是这台云端 Cindy 真实的插件（只读），顶部是插件页自己的「正在管理」提示',
      }),
      frame('34', '加载失败', settings('ghosts', { plugins: 'fail' })),
    ],
  },
  {
    id: 'auth',
    group: '授权',
    code: '27',
    name: '授权',
    frames: [
      frame('27P', '正在处理…', providerAuth('running'), { note: `只有按钮变成「取消」，不写字。${SAME_AUTH}` }),
      frame('27W', '等浏览器完成授权', providerAuth('waiting'), {
        check: true,
        note: '供应商、机器人、MCP 一样。只有设备码卡片，上方不写字。机器人（35W）一样，MCP 没有这一步',
      }),
      frame('27', '结果确认中，只转圈', providerAuth('checking'), {
        note: '浏览器已打开、等授权完成时也是这样',
      }),
      frame('27A', '授权已完成', providerAuth('connected'), { check: true, note: '一条「已登录 X」提示，供应商标为已连接' }),
      frame('27B', '授权失败', providerAuth('failed'), {
        check: true,
        note: '一条「X 登录失败，请重试」提示。已过期也是这样；取消什么都不显示',
      }),
      frame('27F', '提交失败', providerAuth('submitFailed'), { note: '同样一条「X 登录失败，请重试」，设备码还在' }),
      frame('27G', '打不开验证页', providerAuth('openFailed')),
      frame('27C', '授权进度加载失败', providerAuth('unreadable'), {
        note: '一条 warning 提示「操作结果尚未确认」，按钮「检查授权状态」',
      }),
      frame('35W', '机器人等浏览器完成授权', botAuth('waiting'), { note: 'IM 页上。和 27W 一样，设备码放在机器人卡片里' }),
      frame('36A', 'MCP 凭证已保存', mcpAuth('connected'), { note: '一条「MCP 服务器已更新」提示，和本机 MCP 页一样' }),
    ],
  },
];
// By what the user is looking at, in the order they meet it (owner, 2026-11-11).
export const DEMO_GROUPS = ['我的设备卡片', '更新', '云端设置页', '模型供应商 / IM / 插件', '授权'] as const;
registerCloudScenarios(CLOUD_SCENARIOS);

// ── 亲手体验: the update flow ──────────────────────────────────────────────────────────────────

/**
 * Owner, 2026-11-12: 「我想试一下更新的流程 … 我想亲自体验下」. The real instance is on the latest
 * version and an update cannot be undone, so this run plays one: the card offers a new version,
 * the owner opens the dialog and confirms as usual, and the run answers the request itself and
 * moves through the states CIS reports (the same ones the frames above pin: 25 → 25A 已安排 → 25D
 * 正在更新 → the outcome chosen; T57). Nothing is sent; the schedule saves are answered too.
 */
export const PLAY_UPDATE_OUTCOMES = [
  { id: 'done', label: '更新成功' },
  { id: 'notStarted', label: '没能开始' },
  { id: 'rolledBack', label: '失败后回到旧版本' },
  { id: 'held', label: '更新卡住（recovery-hold）' },
] as const;
export type PlayUpdateOutcome = (typeof PLAY_UPDATE_OUTCOMES)[number]['id'];
/** Compressed timings: scheduled, then updating (its restart looks the same, T57). */
export const PLAY_UPDATE_MS = { queued: 3000, updating: 12000, save: 600 };
export const PLAY_UPDATE_HINT = '在卡片上点「⋯ → 更新」，再点「立即更新」并确认。不会真的更新，中途可以关掉弹窗再打开';
const PLAY_ENDS: Record<Exclude<PlayUpdateOutcome, 'notStarted'>, [State, string]> = {
  done: [{ version: NEXT, latestVersion: NEXT, ...operation('completed', false) }, '已更新'],
  rolledBack: [{ ...UPDATE, upgradeState: 'rolled-back', ...operation('completed', false) }, '已回到旧版本'],
  held: [{ ...UPDATE, ...operation('recovery-hold', false) }, '更新卡住'],
};
type UpdatePlay = {
  key: string;
  deviceId: string;
  outcome: PlayUpdateOutcome;
  state: State;
  linkOffline: boolean;
  maintenance: CloudMaintenanceView;
  phase: string;
  saves: number;
};
let updatePlay: UpdatePlay | null = null;
/** The run in force, when it is this one. */
const playing = () => (updatePlay && activeCloudStage()?.key === updatePlay.key ? updatePlay : null);
const showPlay = (run: UpdatePlay) =>
  advanceCloudPlay(
    {
      card: {
        instances: [{ ...resolve(run.deviceId, run.state), maintenance: run.maintenance }],
        ...(run.linkOffline ? { linkOffline: true } : {}),
      },
    },
    run.phase,
  );
const playStep = (run: UpdatePlay, state: State, phase: string, linkOffline = false) => {
  if (playing() !== run) return;
  Object.assign(run, { state, phase, linkOffline });
  showPlay(run);
};
export function startUpdatePlay(outcome: PlayUpdateOutcome, deviceId: string) {
  const label = PLAY_UPDATE_OUTCOMES.find((item) => item.id === outcome)!.label;
  const maintenance = policy(deviceId);
  startCloudPlay(
    { id: 'update', name: '更新流程', outcome: label, phase: '有新版本' },
    { card: { instances: [{ ...resolve(deviceId, UPDATE), maintenance }] } },
    deviceId,
  );
  updatePlay = {
    key: activeCloudStage()!.key,
    deviceId,
    outcome,
    state: UPDATE,
    linkOffline: false,
    maintenance,
    phase: '有新版本',
    saves: 0,
  };
}
async function playUpdateTimeline(run: UpdatePlay, outcome: Exclude<PlayUpdateOutcome, 'notStarted'>) {
  await playDelay(PLAY_UPDATE_MS.queued);
  playStep(run, UPDATING('backup-running'), '正在更新');
  await playDelay(PLAY_UPDATE_MS.updating);
  const [state, phase] = PLAY_ENDS[outcome];
  playStep(run, state, phase);
}
registerCloudPlayInstance({
  async upgrade() {
    const run = playing();
    if (!run) return never();
    if (run.outcome === 'notStarted') {
      playStep(run, run.state, '没能开始');
      // As the cloud would not take it: a toast right after the confirmation; the row stays offered.
      throw new Error('CLOUD_SETTINGS_CONFLICT');
    }
    playStep(run, UPDATING('requested'), '已安排');
    void playUpdateTimeline(run, run.outcome);
    return { operationId: 'stage', phase: 'requested', active: true, updatedAtMs: Date.now() };
  },
  async maintenance(change) {
    const run = playing();
    if (!run) return never();
    await playDelay(PLAY_UPDATE_MS.save);
    const custom = change.policyMode === 'custom';
    run.maintenance = {
      ...run.maintenance,
      revision: (++run.saves).toString(16).padStart(64, '0'),
      autoUpdate: change.autoUpdate,
      raw: { ...run.maintenance.raw, policyMode: change.policyMode, calendar: custom ? change.calendar : null },
      effective: custom ? { source: 'custom', calendar: change.calendar } : policy(run.deviceId).effective,
    };
    if (playing() === run) showPlay(run);
    return run.maintenance;
  },
});

// ── The panel's own state ──────────────────────────────────────────────────────────────────────

type PanelState = { open: boolean; folded: boolean };
const OPEN_KEY = 'cloud-preview:scenarios-open';
// A dev build keeps the panel open across a page reload in this run only.
const session = import.meta.env.DEV && typeof sessionStorage !== 'undefined' ? sessionStorage : null;
let panel: PanelState = { open: session?.getItem(OPEN_KEY) === '1', folded: false };
const listeners = new Set<() => void>();
const update = (next: Partial<PanelState>) => {
  panel = { ...panel, ...next };
  if (panel.open) session?.setItem(OPEN_KEY, '1');
  else session?.removeItem(OPEN_KEY);
  for (const listener of listeners) listener();
};

export function openCloudScenarios() {
  update({ open: true, folded: false });
}
export function foldCloudScenarios(folded: boolean) {
  update({ folded });
}
/** Shows a scenario's frame at once, on the given instance (the owner's own, when there is one). */
export function showCloudFrame(scenario: string, index: number, deviceId: string) {
  update({ open: true });
  selectCloudFrame(scenario, index, deviceId);
}
/** Starts 亲手体验 · 更新流程 with the outcome chosen, on the given instance. */
export function playCloudUpdate(outcome: PlayUpdateOutcome, deviceId: string) {
  update({ open: true });
  startUpdatePlay(outcome, deviceId);
}
/** Ends the simulation and closes the panel. */
export function endCloudScenarios() {
  endCloudStage();
  update({ open: false, folded: false });
}
export function useCloudScenarios(): PanelState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => panel,
  );
}

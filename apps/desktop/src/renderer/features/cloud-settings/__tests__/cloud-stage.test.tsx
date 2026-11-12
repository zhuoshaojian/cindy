// @vitest-environment jsdom
// The scenario panel's frames (cloudFaultScripts.ts over cloudFaults.ts). Tier: unit. Why: the
// owner checks every cloud state by choosing frames on a dev build connected to a real instance
// (Lead T35, 2026-11-11: "点了就生效"). The scripted frames before this showed a state for a moment
// and lost it to the page's own reads, retries and timers, or never arrived at all. Production entry:
// the real card (CloudDeviceDirectory + MyDevicesPanel) and the real settings page
// (CloudSettingsPanel). For every frame: what it shows is there at once, still there a minute later,
// and nothing of it is left after another frame is chosen. Nothing reaches a real instance meanwhile.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { transferableAbortController } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLED_CATALOG } from '@cindy/model-providers';
import type { DeviceLinkSettings } from '@/hooks/useDeviceLinkSettings';
import { MyDevicesPanel } from '@/components/settings/MyDevicesPanel';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog-provider';
import { CloudDeviceDirectory } from '../CloudDeviceDirectory';
import { CloudSettingsPanel } from '../CloudSettingsView';
import { activeCloudStage, endCloudStage, selectCloudFrame, useCloudStage } from '../cloudFaults';
import { CLOUD_SCENARIOS, PLAY_UPDATE_MS, startUpdatePlay, type PlayUpdateOutcome } from '../cloudFaultScripts';
import { CLOUD_SETTINGS_VISIBILITY } from '../cloudSettingsVisibility';

vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && typeof values === 'object'
        ? `${key} ${Object.values(values).filter((v) => typeof v !== 'object').join(' ')}`.trim()
        : key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ toast: toasts }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ mode: 'cloud', dataOwnerId: 'owner' }),
  useOptionalAuthUser: () => null,
}));
vi.mock('../CloudInstanceAccess', () => ({ useCloudInstanceAccess: () => 'allowed' }));
vi.mock('@/features/device-link/useDeviceLinkDeviceList', () => ({
  useDeviceLinkDeviceList: () => [],
}));
vi.mock('../CloudModelSettings', () => ({
  CloudAuxiliarySettings: () => null,
  CloudBotsSettings: () => null,
  CloudSubagentSettings: () => null,
  CloudVisionBridgeSettings: () => null,
}));
vi.mock('@/hooks/useModelPricing', () => ({
  useGatewayModelPricing: () => null,
  useReferenceModelPricing: () => null,
}));
vi.mock('@/hooks/useDeviceProviders', () => ({
  useDeviceProviders: () => ({ providers: [], loading: false, error: null, unsupported: false }),
}));
vi.mock('@/components/settings/useProviderSubscriptionCard', () => ({
  useDeviceProviderSubscriptionCard: () => null,
}));
vi.mock('@/features/provider-share/providerShareStore', () => ({
  useProviderSharePendingRequests: () => [],
  useProviderShareReceived: () => ({ received: [], loaded: true }),
  ensureProviderShareReceivedStarted: () => undefined,
  requestProviderShareJoin: () => undefined,
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const CLOUD = 'cloud-device-0123456789abcdef01234567';
const device = {
  deviceId: CLOUD, name: '我的云端 Cindy', platform: 'linux', appVersion: '0.1.130', lastSeenAt: null,
  online: true, busy: false, remoteControlEnabled: true, controlEnabled: true, isSelf: false,
};
const s = {
  enabled: true, linkStatus: 'online', connectionIssue: null, standby: false, devices: [device],
  controlledBy: [], revokedControllers: [], disabledControlDeviceIds: [], listError: null,
  refreshing: false, refresh: vi.fn(), setEnabled: vi.fn(), rename: vi.fn(), remove: vi.fn(),
  disconnectAll: vi.fn(), revoke: vi.fn(), restore: vi.fn(), setDeviceControlEnabled: vi.fn(),
} as unknown as DeviceLinkSettings;

const I = 'cloudSettings.instance.';
const ANTHROPIC = BUNDLED_CATALOG.providers.find((p) => p.id === 'anthropic')!.name;
/** What each frame shows: texts on the page, a confirmation, a notice, or marked controls. */
type Shows = {
  text?: string[];
  not?: string[];
  selector?: string[];
  confirm?: string;
  toast?: string;
  /** A notice of success, that stays while the frame is shown. */
  success?: string;
  /** A warning notice, that stays while the frame is shown. */
  warning?: string;
  /** The error notice has no button (D11 B2, B3: as the client's settings). */
  bare?: boolean;
  check?(label: string): void;
};
const noNotice = () => expect(toasts.error).not.toHaveBeenCalled();
const disabledButton = (text: string) => () =>
  expect(
    [...document.querySelectorAll<HTMLButtonElement>('button')].some(
      (button) => button.textContent?.trim() === text && button.disabled,
    ),
    `${text} disabled`,
  ).toBe(true);
const noButtonSpins = (label: string) =>
  expect(document.querySelector('[role=dialog] button[aria-busy="true"]'), `${label}: no spinning button`).toBeNull();
const EXPECTED: Record<string, Shows> = {
  'card:32A': { text: [`${I}state.running`] },
  // Until the list answers: reading, with a spinner, not the directory's online state.
  'card:32O': {
    text: [`${I}statusLoading`],
    not: [`${I}state.running`, 'settings.devices.status.online'],
    check: () => expect(document.querySelector(`button[aria-label^="${I}manage"]`)).toBeNull(),
  },
  // A running instance DeviceLink does not have: the directory's offline state, as any device.
  'card:32P': { text: ['settings.devices.lastSeen'], not: [`${I}state.running`] },
  'card:32B': { text: [`${I}state.starting`] },
  'card:32G': { text: [`${I}state.stopping`] },
  'card:32H': { text: [`${I}state.asleep`] },
  'card:32I': { text: [`${I}cardUpdating`], not: [`${I}cardUpdatingOffline`] },
  'card:32C': { text: [`${I}state.error`, `${I}errorRecovery`] },
  'card:32D': { text: ['cloudSettings.onboarding.needsLogin'] },
  'card:32N': { text: ['cloudSettings.onboarding.needsLogin', 'cloudSettings.onboarding.recoveryDescription'] },
  'card:32L': { text: ['cloudSettings.onboarding.waitingLogin', 'cloudSettings.onboarding.reopenLogin'] },
  'card:32M': { text: ['cloudSettings.onboarding.loginFailed'] },
  // Asleep and signed out: signing in wakes it where it can, otherwise it is woken first.
  'card:32J': {
    text: ['cloudSettings.onboarding.asleepNeedsLogin', 'cloudSettings.onboarding.wakeAndLogin'],
  },
  'card:32K': {
    text: ['cloudSettings.onboarding.asleepNeedsLogin', 'cloudSettings.onboarding.initialize'],
  },
  // The card says its status could not be read; no caption above it. (Its retry is being moved, T40.)
  // 「请重试」 has its retry right beside it (T52): the icon-only quiet button.
  'card:32F': {
    text: [`${I}statusUnreadable`],
    not: ['cloudSettings.onboarding.readFailed', `${I}state.running`],
    selector: ['button[data-cloud-inline-retry][aria-label="commonUi.retry"]'],
  },
  'claim:28 领取入口': { text: ['cloudSettings.onboarding.emptyTitle', 'cloudSettings.onboarding.claim'] },
  'claim:28 按钮转圈': { selector: ['button[aria-busy="true"]'] },
  'claim:28B': { text: ['cloudSettings.onboarding.claimNotDone'] },
  'claim:28C': { text: ['cloudSettings.onboarding.claimUnreadable'] },
  'claim:28D': {
    text: ['cloudSettings.onboarding.readFailed', 'commonUi.retry'],
    check: disabledButton('cloudSettings.onboarding.claim'),
  },
  'power:30': { confirm: `${I}sleepConfirm` },
  // 「…失败，请重试」 has its retry right beside it: the same request again (T54).
  'power:30B': { text: [`${I}sleepNotTaken`, 'commonUi.retry'] },
  'power:30WB': { text: [`${I}wakeNotTaken`, 'commonUi.retry'] },
  // 「状态加载失败」 in the subtitle; no notice of its own (A2 #15).
  'power:30C': { text: [`${I}statusUnreadable`], not: ['cloudSettings.reload'], selector: ['button[data-cloud-inline-retry][aria-label="commonUi.retry"]'] },
  // The trigger is just 「管理」 with its dot; the state is said in the menu row (T59).
  'card-upgrading:29C': {
    selector: [`button[aria-label="${I}manage"]`],
    check: (label) =>
      expect(document.querySelector(`button[aria-label="${I}manage ${I}updateBadge"]`), label).toBeNull(),
  },
  // Scheduled: the instance is still usable; the menu's Updates item says 已安排 (T57).
  'card-upgrading:29H': {
    selector: ['[role=menu]'],
    // The greyed sleep item says why, as 设置 does (T58).
    text: [`${I}badgeScheduled`, `${I}state.running`, `${I}sleepAfterUpdate`],
    not: [`${I}cardUpdating`],
  },
  'card-upgrading:29B': { selector: ['[role=menu]'], text: [`${I}badgeUpdating`, `${I}sleepAfterUpdate`] },
  'card-upgrading:29E': { success: `${I}toastUpgraded` },
  'card-upgrading:29F': { toast: `${I}toastUpgradeFailed` },
  'card-upgrading:29D': { selector: ['[role=menu]'], text: [`${I}upgradeFailed`] },
  'card-upgrading:29G': { text: [`${I}state.running`] },
  // T57: one status row, the first of the card; nothing said twice, no notice above it.
  'upgrade:25 有新版本': {
    text: [`${I}newVersion ${'0.1.130-cloud.13'}`, `${I}currentShort`, `${I}upgradeNow`],
    not: [`${I}updateBadge`, `${I}upgradeDescription`],
  },
  'upgrade:25K': { text: [`${I}revisionAvailable`], not: [`${I}newVersion`] },
  'upgrade:25L': { text: [`${I}newVersion`, `${I}offeredScheduledOnly`], not: [`${I}upgradeNow`] },
  'upgrade:25M': {
    text: [`${I}newVersion`, `${I}offeredWakeFirst`],
    check: disabledButton(`${I}upgradeNow`),
  },
  'upgrade:25 确认弹窗': { confirm: `${I}upgradeConfirm` },
  // Under way: the state icon before the title, no button and no spinner on the right.
  'upgrade:25A': {
    text: [`${I}upgradeScheduledTo`, `${I}upgradeQueuedHint`],
    not: [`${I}upgradeNow`],
    check: noButtonSpins,
  },
  'upgrade:25D': {
    text: [`${I}upgradingTo`, `${I}upgradingHint`],
    not: [`${I}upgradeOffline`, `${I}upgradeNow`],
    check: noButtonSpins,
  },
  'upgrade:25F': { text: [`${I}upgradedTo`, `${I}upgradedHint`], not: [`${I}upgradeNow`] },
  // Refused or not started: a toast, as the local About page; the dialog still offers the update.
  'upgrade:25B': {
    toast: `${I}upgradeNotStarted`,
    text: [`${I}newVersion`, `${I}upgradeNow`],
    not: [`${I}upgradeFailed`],
  },
  'upgrade:25H': { text: [`${I}upgradeFailed`, `${I}rolledBackHint`, `${I}upgradeNow`] },
  'upgrade:25I': { text: [`${I}upgradeFailed`], not: [`${I}upgradeNow`] },
  'upgrade:25C': {
    // One retry, beside the text: no 「刷新状态」 above the card as well (T53).
    text: [`${I}currentVersionIs`, `${I}statusUnreadable`],
    not: ['cloudSettings.reload', `${I}refresh`],
    selector: ['[role=dialog] button[data-cloud-inline-retry][aria-label="commonUi.retry"]'],
  },
  'policy:26K': { text: ['cloudSettings.loading'] },
  'policy:26D': { text: [`${I}readFailed`, `${I}unavailable`] },
  'policy:26A': { text: [`${I}autoUpdate`], not: [`${I}saving`, `${I}policyNotSaved`] },
  // Saving only disables the controls; its result is a toast (the local auto-update switch).
  'policy:26': { selector: ['[role=dialog] [role=switch][disabled]'], not: [`${I}saving`] },
  'policy:26B': { toast: `${I}policyNotSaved`, not: [`${I}saving`] },
  'policy:26C': {
    // One retry, beside the text: no 「刷新状态」 above the card as well (T53).
    text: [`${I}statusUnreadable`],
    not: ['cloudSettings.reload', `${I}refresh`],
    selector: ['[role=dialog] button[data-cloud-inline-retry][aria-label="commonUi.retry"]'],
  },
  'policy:26E': { text: [`${I}scheduleKept`] },
  'policy:26F': { confirm: `${I}replaceConfirm` },
  'policy:26G': { text: [`${I}scheduleZone`] },
  'policy:26H': { text: [`${I}notEnrolled`] },
  'policy:26I': { text: [`${I}paused`] },
  'policy:26J': { text: [`${I}unsupportedPolicy`] },
  // D11 A3–A7: one 「正在管理」 notice at the top, its text saying what the page is doing.
  'session:19A': {
    text: ['settings.agentResource.title', `settings.ghosts.remote.managingTarget`, `settings.ghosts.remote.managingDescription`],
    not: ['cloudSettings.title'],
    check: noNotice,
  },
  'session:18 正在加载…': { text: [`settings.ghosts.remote.configurationLoading`], not: ['cloudSettings.loading'] },
  'session:18 加载失败': {
    text: ['bots.remoteSettings.loadFailed', `settings.ghosts.remote.retry`],
    not: ['cloudSettings.readFailedTitle'],
    check: noNotice,
  },
  'session:18A': { text: ['bots.remoteSettings.unsupported'], not: ['cloudSettings.unsupported'] },
  'session:18B': { text: ['cloudSettings.groupReadFailed'], not: ['cloudSettings.noFields'] },
  'session:33A': { text: [`settings.ghosts.remote.offlineNotice`, 'settings.tabs.remoteControl'] },
  'session:33B': { text: ['cloudSettings.upgradingNotice'] },
  'group:31A': { check: (label) => groupFailure('settings-agent-resource', true, label) },
  'group:31B': { check: (label) => groupFailure('settings-agent-resource-unreadable', false, label) },
  'save-result:19B': { toast: 'cloudSettings.sync.notSaved', bare: true },
  'save-result:23': { toast: 'cloudSettings.sync.conflict', bare: true },
  'save-result:24': { toast: 'cloudSettings.sync.rejected', bare: true },
  'save-result:19D': { warning: 'hostSettings.savedApplyFailed', not: ['hostSettings.savedApplyFailed'] },
  'providers:20A': { text: [ANTHROPIC], not: ['cloudSettings.providersReadFailedTitle'] },
  'providers:20 正在加载…': { check: (label) => panelLacks('providers', 'cloudSettings.loading', label) },
  'providers:20 加载失败': {
    text: ['settings.providers.catalogRecovery.catalog'],
    not: ['cloudSettings.providersReadFailedTitle'],
  },
  'providers:20D': { text: ['settings.providers.xd.sync.syncing'] },
  'providers:20E': { text: ['settings.providers.xd.asset.syncFailed'] },
  'providers:20F': { text: ['settings.providers.xd.sync.disabled'] },
  'providers:20G': { text: ['settings.providers.xd.sync.unsupported'] },
  'providers:20B': { text: ['OpenAI'], not: ['cloudSettings.providersReadFailedTitle'] },
  // The IM category itself (the hidden categories keep their own state).
  'im:21A': {
    check: (label) => {
      const panel = document.getElementById('settings-panel-im-bot')?.textContent ?? '';
      expect(panel, label).toContain('settings.imBot.groups.cindy');
      for (const notice of ['cloudSettings.botsReadFailed', 'cloudSettings.loading', 'cloudSettings.imReadFailed'])
        expect(panel, `${label}: no ${notice}`).not.toContain(notice);
    },
  },
  'im:21 正在加载…': { check: (label) => panelLacks('im-bot', 'cloudSettings.loading', label) },
  'im:21 加载失败': { text: ['cloudSettings.botsReadFailed'] },
  'im:21C': { text: ['cloudSettings.imReadFailed', 'commonUi.retry'] },
  'im:21D': { text: ['bots.remoteSettings.unsupported'], not: ['cloudSettings.imReadUnavailable'] },
  'im:21E': { text: ['cloudSettings.imReadTooLarge'] },
  'im:21B': { text: ['cloudSettings.authDisconnected'], not: ['cloudSettings.botsReadFailed'] },
  // The plugin page itself is the native client's; the frame fails its reads (cloud-faults.test.ts).
  'plugins:34A': { text: ['settings.tabs.ghosts'] },
  'plugins:34': { text: ['settings.tabs.ghosts'] },
  // D11 F: as the client's provider wizard. No progress lines; the outcome is a toast.
  'auth:27P': { text: ['settings.providers.button.cancel'], not: [phase('running')] },
  'auth:27W': { text: ['WDJB-MJHT'], not: [phase('waiting')] },
  // Only a spinning button while the result is read back: no words.
  'auth:27': {
    not: [phase('running'), phase('failed'), 'cloudSettings.authProgressUnreadable', 'cloudSettings.authWaitingDone'],
    selector: ['button[aria-busy="true"]'],
  },
  'auth:27A': { success: 'settings.providers.wizard.authorizedToast', not: [phase('succeeded')] },
  'auth:27B': { toast: 'settings.providers.wizard.authorizeFailed', not: [phase('failed')] },
  'auth:27F': { toast: 'settings.providers.wizard.authorizeFailed', text: ['WDJB-MJHT'] },
  'auth:27G': { text: ['cloudSettings.authOpenFailed'] },
  'auth:27C': { warning: 'settings.ghosts.remote.unknown', not: ['cloudSettings.authProgressUnreadable'] },
  'auth:35W': { text: ['WDJB-MJHT'], not: [phase('waiting')] },
  'auth:36A': { success: 'settings.mcp.toast.updated', not: [phase('succeeded')] },
};
/** A category's own panel does not say this (the hidden categories keep their own state). */
function panelLacks(tab: string, text: string, label: string) {
  const panel = document.getElementById(`settings-panel-${tab}`);
  expect(panel, label).not.toBeNull();
  expect(panel!.textContent, `${label}: no ${text}`).not.toContain(text);
}
function phase(name: string) {
  return `cloudSettings.authPhase.${name}`;
}
const FRAMES = CLOUD_SCENARIOS.flatMap((scenario) =>
  scenario.frames.map((frame, index) => {
    const exact = `${scenario.id}:${frame.code} ${frame.name}`;
    const key = exact in EXPECTED ? exact : `${scenario.id}:${frame.code}`;
    return { scenario: scenario.id, index, label: exact, key };
  }),
);

function Page() {
  const stage = useCloudStage();
  const settings = stage?.world.settings;
  return (
    <ConfirmDialogProvider>
      {settings ? (
        // As AuthorizedCloudSettingsView passes a simulated frame on.
        <CloudSettingsPanel
          key={stage!.key}
          name="我的云端 Cindy"
          client={settings.client}
          online={!settings.offline}
          upgrading={settings.offline === 'upgrading'}
          initialTab={settings.tab}
          visibility={CLOUD_SETTINGS_VISIBILITY}
          onBack={() => {}}
          onOpenDeviceCard={() => {}}
        />
      ) : (
        <CloudDeviceDirectory enabled directory={[CLOUD]} offline={[]} devicesOpen>
          {(cloud) => <MyDevicesPanel s={s} variant="cloud" cloud={cloud} />}
        </CloudDeviceDirectory>
      )}
    </ConfirmDialogProvider>
  );
}
const show = async (scenario: string, index: number) => {
  await act(async () => selectCloudFrame(scenario, index, CLOUD));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
function renderPage() {
  const router = createMemoryRouter([{ path: '*', element: <Page /> }], {
    initialEntries: ['/settings?tab=remote-control'],
  });
  return render(<RouterProvider router={router} />);
}
const pageText = () => document.body.textContent ?? '';
/**
 * T39 (owner, D10 position 1): the failure sits in the group's heading row, on the right, and
 * 「重试」 there stays usable. Read before, the rest of the group is faded and not editable.
 */
function groupFailure(id: string, kept: boolean, label: string) {
  const group = document.getElementById(id);
  expect(group, `${label}: group`).not.toBeNull();
  const status = group!.querySelector<HTMLElement>('[data-cloud-group-status]');
  expect(status?.textContent, `${label}: status`).toContain('cloudSettings.groupReadFailed');
  const heading = group!.querySelector('h1, h2, h3, h4')!;
  let row: HTMLElement = status!;
  while (!row.contains(heading)) row = row.parentElement!;
  expect(heading.textContent, `${label}: heading`).toContain('settings.agentResource.title');
  // Icon only, as the local restore control: named by its aria-label.
  const retry = [...status!.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === 'commonUi.retry',
  );
  expect(retry, `${label}: retry`).toBeDefined();
  const inert = (element: Element | null): boolean =>
    !!element && ((element as HTMLElement).inert || inert(element.parentElement));
  expect(inert(retry!), `${label}: retry usable`).toBe(false);
  expect(retry!.disabled, `${label}: retry enabled`).toBe(false);
  const faded = [...group!.querySelectorAll<HTMLElement>('*')].filter((element) => element.inert);
  if (kept) {
    expect(faded.length, `${label}: the values are faded`).toBeGreaterThan(0);
    for (const element of faded) expect(element.contains(row), `${label}: heading row not faded`).toBe(false);
    expect(faded.some((element) => element.querySelector('input, button, [role=radio], [role=switch]')), `${label}: controls inert`).toBe(true);
  } else expect(group!.textContent, `${label}: only the heading row`).not.toContain('settings.agentResource.description');
}
function expectShown(
  { text = [], not = [], selector = [], confirm, toast, success, warning, bare, check }: Shows,
  label: string,
) {
  check?.(label);
  for (const value of text) expect(pageText(), `${label}: ${value}`).toContain(value);
  for (const value of not) expect(pageText(), `${label}: no ${value}`).not.toContain(value);
  for (const value of selector) expect(document.querySelector(value), `${label}: ${value}`).not.toBeNull();
  if (confirm)
    expect(
      [...document.querySelectorAll('[role=alertdialog] button, [role=dialog] button')].some(
        (button) => button.textContent?.trim() === confirm,
      ),
      `${label}: confirmation`,
    ).toBe(true);
  for (const [kind, key] of [[toasts.error, toast], [toasts.success, success], [toasts.warning, warning]] as const) {
    if (!key) continue;
    const shown = kind.mock.calls.filter(([message]) => String(message).startsWith(key));
    expect(shown, `${label}: notice`).toHaveLength(1);
    expect(shown[0]![1]?.duration, `${label}: the notice stays`).toBe(0);
    if (bare && kind === toasts.error) expect(shown[0]![1]?.action, `${label}: no button`).toBeUndefined();
  }
}

const nativeAbortController = transferableAbortController();
const invoke = vi.fn(async () => {
  throw new Error('REAL_INSTANCE_REACHED');
});
const bridge = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
  get: (target, name: string) => (target[name] ??= vi.fn(async () => [])),
});
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.stubGlobal('AbortController', nativeAbortController.constructor);
  vi.stubGlobal('AbortSignal', nativeAbortController.signal.constructor);
  Object.assign(window, {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  // jsdom has no CSS.escape; the app's Chromium does (a stale group marks itself with it).
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') });
  vi.stubGlobal('electronAPI', {
    cloudSettings: bridge,
    deviceLink: { invoke },
    cloudLoginWindow: { open: vi.fn(), onCompleted: vi.fn(() => () => undefined) },
    openRemoteDesktop: vi.fn(),
    openExternal: vi.fn(),
  });
});
afterEach(() => {
  act(() => endCloudStage());
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const key of Object.keys(bridge)) delete (bridge as Record<string, unknown>)[key];
});

describe('every scenario frame', () => {
  it('has what it shows written down here', () => {
    expect(FRAMES.filter((frame) => !(frame.key in EXPECTED)).map((frame) => frame.label)).toEqual([]);
  });

  it.each(FRAMES)('$label: shows at once and stays', async ({ scenario, index, key, label }) => {
    renderPage();
    await show(scenario, index);
    expectShown(EXPECTED[key]!, label);
    // A minute of the page's own polls, retries and timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expectShown(EXPECTED[key]!, `${label} after 60 s`);
    // Nothing of it reached a real instance: no write on the bridge, nothing on DeviceLink.
    for (const name of ['instancePower', 'instanceClaim', 'instanceUpgrade', 'instancePolicy', 'save'])
      expect(bridge[name] ?? { mock: { calls: [] } }, name).toEqual(
        expect.objectContaining({ mock: expect.objectContaining({ calls: [] }) }),
      );
    expect(invoke).not.toHaveBeenCalled();
    expect(window.electronAPI.openExternal).not.toHaveBeenCalled();
  });
});

describe('choosing another frame', () => {
  const at = (id: string, code: string) => {
    const scenario = CLOUD_SCENARIOS.find((item) => item.id === id)!;
    return [id, scenario.frames.findIndex((frame) => frame.code === code)] as const;
  };
  it('leaves no notice, confirmation or state of the frame before', async () => {
    renderPage();
    await show(...at('save-result', '19B'));
    expect(toasts.error).toHaveBeenCalledTimes(1);
    toasts.dismissAll.mockClear();
    // A card frame with its confirmation open, then a plain one.
    await show(...at('power', '30'));
    expect(toasts.dismissAll).toHaveBeenCalled();
    expectShown({ confirm: `${I}sleepConfirm` }, '30');
    await show(...at('power', '30B'));
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
    expectShown({ text: [`${I}sleepNotTaken`] }, '30B');
    await show(...at('card', '32A'));
    expectShown({ text: [`${I}state.running`], not: [`${I}sleepNotTaken`] }, '32A');
    // The update dialog of one frame is not open in the next.
    await show(...at('upgrade', '25D'));
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await show(...at('card', '32B'));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expectShown({ text: [`${I}state.starting`], not: [`${I}upgradeOffline`] }, '32B');
    expect(toasts.error).toHaveBeenCalledTimes(1);
  });
});

// T55 (owner, 2026-11-12: 「我想亲自体验下」): 亲手体验 · 更新流程. The owner's own clicks on the real
// card and dialog drive it; the run answers the update itself and moves through CIS's states on
// its clock. Nothing is sent, and ending the simulation leaves nothing of the run behind.
describe('亲手体验 · 更新流程', () => {
  const button = (text: string, root: ParentNode = document) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
  const press = async (element: HTMLElement | null | undefined, label: string) => {
    expect(element, label).toBeTruthy();
    await act(async () => {
      element!.click();
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  const wait = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const dialog = () => document.querySelector<HTMLElement>('[role=dialog]');
  /** As the owner does: the card's ⋯ menu (the card's only variant), then 更新. */
  const openUpdates = async () => {
    const trigger = document.querySelector<HTMLElement>('[data-cloud-updates-opener]');
    expect(trigger, 'the card menu').toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(trigger!, { key: 'Enter' });
      await vi.advanceTimersByTimeAsync(0);
    });
    await press(
      [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find((item) =>
        item.textContent?.includes(`${I}updates`),
      ),
      'the menu offers 更新',
    );
    expect(dialog(), 'the dialog').not.toBeNull();
  };
  const phase = () => activeCloudStage()?.play?.phase;
  const nothingSent = () => {
    for (const name of ['instancePower', 'instanceClaim', 'instanceUpgrade', 'instancePolicy', 'save'])
      expect(bridge[name] ?? { mock: { calls: [] } }, name).toEqual(
        expect.objectContaining({ mock: expect.objectContaining({ calls: [] }) }),
      );
    expect(invoke).not.toHaveBeenCalled();
  };
  /** Starts the run, opens the dialog from the card and confirms 立即更新. */
  const startAndConfirm = async (outcome: PlayUpdateOutcome) => {
    renderPage();
    await act(async () => startUpdatePlay(outcome, CLOUD));
    await wait(0);
    expect(phase()).toBe('有新版本');
    await openUpdates();
    expectShown({ text: [`${I}newVersion 0.1.130-cloud.13`, `${I}upgradeNow`] }, 'offered');
    await press(button(`${I}upgradeNow`, dialog()!), '立即更新');
    await press(button(`${I}upgradeConfirm`), 'the confirmation');
    // The confirmation closes at once; the row says it is scheduled, nothing spins on the right.
    expect(document.querySelector('[role=alertdialog]'), 'the confirmation closed').toBeNull();
    expect(document.querySelector('[role=dialog] button[aria-busy="true"]'), 'no spinning button').toBeNull();
  };
  const ENDS: Record<Exclude<PlayUpdateOutcome, 'notStarted'>, Shows> = {
    done: { text: [`${I}upgradedTo`] },
    rolledBack: { text: [`${I}upgradeFailed`, `${I}rolledBackHint`] },
    held: { text: [`${I}upgradeFailed`], not: [`${I}upgradeNow`] },
  };

  it.each(['done', 'rolledBack', 'held'] as const)('%s: each step as CIS reports it, then the outcome', async (outcome) => {
    await startAndConfirm(outcome);
    await wait(0);
    expect(phase()).toBe('已安排');
    // Scheduled: the dialog says so; the card still runs (green, 运行中).
    expectShown({ text: [`${I}upgradeScheduledTo`, `${I}state.running`] }, 'scheduled');
    await wait(PLAY_UPDATE_MS.queued);
    expect(phase()).toBe('正在更新');
    expectShown({ text: [`${I}upgradingTo`, `${I}cardUpdating`], not: [`${I}upgradeOffline`] }, 'updating');
    await wait(PLAY_UPDATE_MS.updating);
    expectShown(ENDS[outcome], outcome);
    // The dialog was open: no notice; the run stays where it ended, whatever the page polls.
    expect(toasts.success).not.toHaveBeenCalled();
    await wait(60_000);
    expectShown(ENDS[outcome], `${outcome} after 60 s`);
    nothingSent();
  });

  it('not started: a toast right after the request, the update still offered', async () => {
    await startAndConfirm('notStarted');
    await wait(0);
    expect(phase()).toBe('没能开始');
    expectShown(
      { toast: `${I}upgradeNotStarted`, text: [`${I}upgradeNow`], not: [`${I}upgradeScheduledTo`] },
      'not started',
    );
    nothingSent();
  });

  it('closed mid-way: the card follows, and says when it is updated', async () => {
    await startAndConfirm('done');
    await wait(0);
    await press(button(`${I}done`), '完成 closes the dialog');
    expect(dialog()).toBeNull();
    await wait(PLAY_UPDATE_MS.queued);
    expectShown({ text: [`${I}cardUpdating`] }, 'the card, updating');
    await wait(PLAY_UPDATE_MS.updating);
    expectShown({ success: `${I}toastUpgraded` }, 'the notice');
    nothingSent();
  });

  it('the auto-update switch saves, with its own notice', async () => {
    renderPage();
    await act(async () => startUpdatePlay('done', CLOUD));
    await wait(0);
    await openUpdates();
    await press(dialog()!.querySelector<HTMLElement>('[role=switch]'), 'the switch');
    await wait(PLAY_UPDATE_MS.save);
    expect(toasts.success.mock.calls.map(([message]) => String(message))).toEqual([`${I}autoUpdateOffToast`]);
    expect(dialog()!.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('false');
    nothingSent();
  });

  it('结束模拟 mid-way leaves no timer, step or notice of the run', async () => {
    await startAndConfirm('done');
    await wait(0);
    await press(button(`${I}done`), '完成 closes the dialog');
    expect(phase()).toBe('已安排');
    await act(async () => endCloudStage());
    expect(activeCloudStage()).toBeNull();
    await wait(PLAY_UPDATE_MS.queued + PLAY_UPDATE_MS.updating + 60_000);
    expect(activeCloudStage()).toBeNull();
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
    nothingSent();
  });
});

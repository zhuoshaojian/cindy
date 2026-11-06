// @vitest-environment jsdom
// Settings → Remote connections → My devices: cloud instance operations on their device cards
// (2026-11-05 product decision). Production entry: CloudDeviceDirectory + the real MyDevicesPanel,
// in a data router as in the app. Guards admission (no CIS request or extra controls outside the
// allowlist), the hidden directory delete for CIS-managed instances, CIS-only rows, the card's
// settings rows and state subtitle, the one-shot policy read (the list carries no policy), and the
// leave confirmation for an unsaved maintenance draft. Unit tier; ~2 s.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { transferableAbortController } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceLinkSettings } from '@/hooks/useDeviceLinkSettings';
import { MyDevicesPanel } from '@/components/settings/MyDevicesPanel';
import type { CloudInstanceView } from '../../../../shared/cloudInstanceControl';
import { CloudDeviceDirectory } from '../CloudDeviceDirectory';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${Object.values(values).join(' ')}` : key,
    i18n: { language: 'en' },
  }),
}));
const mock = vi.hoisted(() => ({
  access: 'allowed',
  confirm: vi.fn<() => Promise<boolean>>(),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ mode: 'cloud', dataOwnerId: 'owner' }),
}));
vi.mock('../CloudInstanceAccess', () => ({ useCloudInstanceAccess: () => mock.access }));
vi.mock('@/components/ui/confirm-dialog-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/confirm-dialog-provider')>()),
  useConfirmDialog: () => ({ confirm: mock.confirm }),
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
const PENDING = 'cloud-device-89abcdef0123456789abcdef';
const device = (deviceId: string, name: string, platform: string) => ({
  deviceId, name, platform, appVersion: '0.1.121', lastSeenAt: null, online: true, busy: false,
  remoteControlEnabled: true, controlEnabled: true, isSelf: false,
});
const s = {
  enabled: true, linkStatus: 'online', connectionIssue: null, standby: false,
  devices: [device(CLOUD, '我的云端 Cindy', 'linux'), device('mac-1', 'Studio Mac', 'darwin')],
  controlledBy: [], revokedControllers: [], disabledControlDeviceIds: [], listError: null,
  refreshing: false, refresh: vi.fn(), setEnabled: vi.fn(), rename: vi.fn(), remove: vi.fn(),
  disconnectAll: vi.fn(), revoke: vi.fn(), restore: vi.fn(), setDeviceControlEnabled: vi.fn(),
} as unknown as DeviceLinkSettings;
const view = (deviceId: string, extra: Partial<CloudInstanceView> = {}): CloudInstanceView => ({
  instanceId: deviceId, deviceId, name: null, nameSequence: 1, desiredState: 'running',
  runtimeState: 'running', ready: true, version: '0.1.121-cloud.10', imageId: null,
  updateAvailable: false, latestVersion: null, upgradeState: 'idle', observedAtMs: null,
  manualUpgrade: true,
  // Main's list projection never carries the policy; only instanceRead does.
  maintenance: null,
  ...extra,
});
const withPolicy = (deviceId: string, autoUpdate = true) => ({
  ...view(deviceId),
  maintenance: {
    instanceId: deviceId, revision: 'a'.repeat(64), defaultsRevision: 1, autoUpdate,
    raw: { policyMode: 'inherit', calendar: null, scheduledTaskPolicy: 'protect', pausedUntilMs: null },
    effective: {
      source: 'inherit',
      calendar: {
        timezone: 'Asia/Shanghai',
        windows: [{ id: 'daily', weekdays: [1, 2, 3, 4, 5, 6, 7], startLocal: '03:00', endLocal: '05:00' }],
      },
    },
    executionMode: 'scheduled' as const, nextEligibleAtMs: 10000, serverTimeMs: 100, windows: [],
  },
});
let api: Record<string, ReturnType<typeof vi.fn>>;

function renderDevices() {
  const router = createMemoryRouter(
    [
      {
        path: '/settings',
        element: (
          <CloudDeviceDirectory
            enabled
            directory={s.devices!.map((d) => d.deviceId)}
            devicesOpen={false}
          >
            {(cloud) => (
              <>
                <MyDevicesPanel s={s} variant="cloud" cloud={cloud} />
                <MyDevicesPanel s={s} variant="others" cloud={cloud} />
              </>
            )}
          </CloudDeviceDirectory>
        ),
      },
      { path: '/cloud-settings', element: <p>cloud settings page</p> },
    ],
    { initialEntries: ['/settings?tab=remote-control'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
const row = (deviceId: string) =>
  document.querySelector<HTMLElement>(`li[data-device-id="${deviceId}"]`)!;

// React Router builds Node Requests; their signal must come from the same realm (as in
// botSettingsDrawer.test.tsx), or jsdom's AbortController rejects every navigation.
const nativeAbortController = transferableAbortController();

beforeEach(() => {
  vi.stubGlobal('AbortController', nativeAbortController.constructor);
  vi.stubGlobal('AbortSignal', nativeAbortController.signal.constructor);
  mock.access = 'allowed';
  mock.confirm.mockResolvedValue(false);
  api = {
    instanceList: vi.fn().mockResolvedValue([view(CLOUD), view(PENDING, { loginRequired: true, ready: false, runtimeState: 'starting', nameSequence: 2 })]),
    instanceRead: vi.fn(async ({ deviceId }: { deviceId: string }) => withPolicy(deviceId)),
    instanceClaim: vi.fn(),
    instancePower: vi.fn(),
  };
  vi.stubGlobal('electronAPI', {
    cloudSettings: api,
    cloudLoginWindow: { open: vi.fn(), onCompleted: vi.fn(() => () => undefined) },
    openRemoteDesktop: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('cloud instances on My devices cards', () => {
  it.each(['allowed', 'checking', 'hidden'])('adds instance operations only for admitted accounts (%s)', async (access) => {
    mock.access = access;
    renderDevices();
    const cloudRow = row(CLOUD);
    if (access !== 'allowed') {
      expect(within(cloudRow).getByRole('button', { name: 'settings.devices.delete' })).toBeTruthy();
      expect(within(cloudRow).queryByRole('button', { name: /cloudSettings\.onboarding\.openSettings/ })).toBeNull();
      // The directory's own status stays; nothing is added between the header and the switches.
      expect(within(cloudRow).getByText(/settings\.devices\.status\.online/)).toBeTruthy();
      expect(cloudRow.querySelector('[data-cloud-instance]')).toBeNull();
      expect(row(PENDING)).toBeNull();
      expect(screen.queryByRole('list', { name: 'cloudSettings.instance.title' })).toBeNull();
      expect(api.instanceList).not.toHaveBeenCalled();
      expect(api.instanceRead).not.toHaveBeenCalled();
      return;
    }
    // CIS state replaces the directory's online / last seen in the subtitle; no separate state row.
    await within(cloudRow).findByText(/· cloudSettings\.instance\.state\.running$/);
    expect(within(cloudRow).queryByText(/settings\.devices\.status\.online/)).toBeNull();
    // Other devices keep the directory's status and gain no instance rows.
    expect(within(row('mac-1')).getByText(/settings\.devices\.status\.online/)).toBeTruthy();
    expect(row('mac-1').querySelector('[data-cloud-instance]')).toBeNull();
    // The directory delete would only drop a record the running instance re-creates.
    expect(within(cloudRow).queryByRole('button', { name: 'settings.devices.delete' })).toBeNull();
    expect(within(row('mac-1')).getByRole('button', { name: 'settings.devices.delete' })).toBeTruthy();
    // Cloud instances are pinned with this computer, outside the collapsible list: the
    // directory's instance first, then a CIS-only instance waiting for login.
    const pending = row(PENDING);
    expect(within(pending).getByRole('button', { name: 'cloudSettings.onboarding.initialize' })).toBeTruthy();
    const pinned = screen.getByRole('list', { name: 'cloudSettings.instance.title' });
    expect([...pinned.querySelectorAll('li[data-device-id]')].map((li) => li.getAttribute('data-device-id'))).toEqual([CLOUD, PENDING]);
    expect(within(pinned).queryByText('Studio Mac')).toBeNull();
    expect(api.instanceList).toHaveBeenCalledTimes(1);
  });

  it('asks before leaving an unsaved maintenance draft', async () => {
    const router = renderDevices();
    const cloudRow = row(CLOUD);
    fireEvent.click(await within(cloudRow).findByRole('button', { name: /cloudSettings\.instance\.updates/ }));
    // Embedded: versions and maintenance only; sleep stays on the card itself.
    await within(cloudRow).findByText('0.1.121-cloud.10');
    expect(within(cloudRow).getAllByRole('button', { name: /cloudSettings\.instance\.sleep/ })).toHaveLength(1);
    fireEvent.click(within(cloudRow).getByRole('switch', { name: 'cloudSettings.instance.autoUpdate' }));
    const settings = within(cloudRow).getByRole('button', { name: /cloudSettings\.onboarding\.openSettings/ });
    fireEvent.click(settings);
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledTimes(1));
    expect(router.state.location.pathname).toBe('/settings');
    // Any route change is held too, not only the card's own buttons.
    void router.navigate('/settings?tab=general');
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledTimes(2));
    expect(router.state.location.search).toBe('?tab=remote-control');
    mock.confirm.mockResolvedValue(true);
    fireEvent.click(settings);
    await screen.findByText('cloud settings page');
    expect(router.state.location.search).toBe(`?deviceId=${CLOUD}`);
    // Coming back is not a deep link: no section or device, so nothing scrolls or flashes.
    expect(router.state.location.state.returnTo).toBe('/settings?tab=remote-control');
    expect(api.instancePower).not.toHaveBeenCalled();
  });

  it('sums up updates and maintenance from one policy read, without polling for it', async () => {
    const timer = vi.spyOn(globalThis, 'setInterval');
    api.instanceList!.mockResolvedValue([
      view(CLOUD, { updateAvailable: true, latestVersion: '0.1.126-cloud.3-cn-amd64' }),
    ]);
    renderDevices();
    const cloudRow = row(CLOUD);
    const updates = await within(cloudRow).findByRole('button', {
      name: /cloudSettings\.instance\.updateAvailable 0\.1\.126-cloud\.3 · cloudSettings\.instance\.autoUpdateDaily/,
    });
    expect(api.instanceRead).toHaveBeenCalledTimes(1);
    // Opening the panel re-reads once; the form then runs on the card's data.
    fireEvent.click(updates);
    await within(cloudRow).findByRole('switch', { name: 'cloudSettings.instance.autoUpdate' });
    expect(api.instanceRead).toHaveBeenCalledTimes(2);
    // Every 30 s timer alive so far fires once: the list reads again, the policy does not.
    const polls = timer.mock.calls.filter(([, ms]) => ms === 30_000).map(([poll]) => poll as () => void);
    expect(polls.length).toBeGreaterThan(0);
    await act(async () => polls.forEach((poll) => poll()));
    expect(api.instanceRead).toHaveBeenCalledTimes(2);
    timer.mockRestore();
  });

  it('reports auto-update off and an unread policy without inventing a window', async () => {
    api.instanceRead!.mockImplementationOnce(async ({ deviceId }: { deviceId: string }) =>
      withPolicy(deviceId, false),
    );
    api.instanceList!.mockResolvedValue([view(CLOUD)]);
    renderDevices();
    await within(row(CLOUD)).findByRole('button', {
      name: /cloudSettings\.instance\.upToDate · cloudSettings\.instance\.autoUpdateOff/,
    });
  });

  it('disables instance settings and remote desktop while asleep, and keeps wake and maintenance', async () => {
    api.instanceList!.mockResolvedValue([
      view(CLOUD, { desiredState: 'stopped', runtimeState: 'stopped', ready: false }),
    ]);
    renderDevices();
    const cloudRow = row(CLOUD);
    await within(cloudRow).findByText(/· cloudSettings\.instance\.state\.asleep$/);
    const settings = within(cloudRow).getByRole<HTMLButtonElement>('button', {
      name: /cloudSettings\.onboarding\.openSettings.*cloudSettings\.instance\.settingsWakeFirst/,
    });
    expect(settings.disabled).toBe(true);
    expect(
      within(cloudRow).getByRole<HTMLButtonElement>('button', { name: 'remoteDesktop.title' }).disabled,
    ).toBe(true);
    expect(within(cloudRow).getByText('cloudSettings.instance.wakeHint')).toBeTruthy();
    expect(
      within(cloudRow).getByRole<HTMLButtonElement>('button', { name: 'cloudSettings.instance.wake' }).disabled,
    ).toBe(false);
    expect(
      within(cloudRow).getByRole<HTMLButtonElement>('button', { name: /cloudSettings\.instance\.updates/ }).disabled,
    ).toBe(false);
  });

  it('closes the maintenance form when a route change discards its draft', async () => {
    const router = renderDevices();
    const cloudRow = row(CLOUD);
    const updates = await within(cloudRow).findByRole('button', { name: /cloudSettings\.instance\.updates/ });
    fireEvent.click(updates);
    fireEvent.click(await within(cloudRow).findByRole('switch', { name: 'cloudSettings.instance.autoUpdate' }));
    mock.confirm.mockResolvedValue(true);
    // Collapsing My devices only changes the search, so the card stays on the page.
    void router.navigate('/settings?tab=remote-control&collapsed=1');
    await waitFor(() => expect(router.state.location.search).toContain('collapsed'));
    await waitFor(() => expect(updates.getAttribute('aria-expanded')).toBe('false'));
    expect(within(cloudRow).queryByRole('switch', { name: 'cloudSettings.instance.autoUpdate' })).toBeNull();
    // No draft is left behind: the next route change passes without asking again.
    mock.confirm.mockClear();
    await router.navigate('/settings?tab=general');
    expect(mock.confirm).not.toHaveBeenCalled();
  });
});

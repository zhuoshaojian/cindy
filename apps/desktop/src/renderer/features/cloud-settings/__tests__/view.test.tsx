// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudSettingsView } from '../CloudSettingsView';
import { createTrialCloudSettingsClient } from '../trial';
import { createCloudSettingsClient } from '../client';
import { CloudInstancesSection } from '../CloudInstancesSection';
import { CloudPreviewSwitches } from '../CloudPreviewSwitches';
const state = vi.hoisted(() => ({
  online: true,
  access: 'allowed',
  deviceId: 'cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa',
}));
vi.mock('../CloudInstanceAccess', () => ({ useCloudInstanceAccess: () => state.access }));
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ mode: 'cloud', dataOwnerId: 'owner-a' }),
}));
vi.mock('@/contexts/dataOwnerGeneration', () => ({
  getDataOwnerGeneration: () => ({ generation: 1 }),
  isDataOwnerGenerationCurrent: () => true,
}));
vi.mock('@/features/device-link/useDeviceLinkDeviceList', () => ({
  useDeviceLinkDeviceList: () => [
    {
      deviceId: state.deviceId,
      name: 'Cloud A',
      isSelf: false,
      online: state.online,
      remoteControlEnabled: false,
      controlEnabled: false,
    },
  ],
}));
// Model pickers read the target catalog over DeviceLink; covered in model-settings.test.tsx.
vi.mock('../CloudModelSettings', () => ({
  CloudAuxiliarySettings: () => null,
  CloudBotsSettings: () => null,
  CloudSubagentSettings: () => null,
  CloudVisionBridgeSettings: () => null,
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('../client', () => ({ createCloudSettingsClient: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.online = true;
  state.access = 'allowed';
});
// A cloud device deep link must not bypass the account's admission result.
it.each(['checking', 'hidden'])(
  'does not connect or render cloud settings while access is %s',
  (access) => {
    state.access = access;
    render(
      <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
        <Routes>
          <Route path="/cloud-settings" element={<CloudSettingsView />} />
          <Route path="/settings" element={<p>Local settings</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(createCloudSettingsClient).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cloud-settings')).toBeNull();
    if (access === 'hidden') expect(screen.getByText('Local settings')).toBeTruthy();
  },
);
it('uses the Main bridge even if device-link remote control is disabled', async () => {
  const bridge = {},
    client = createTrialCloudSettingsClient();
  Object.assign(window, {
    electronAPI: { cloudSettings: bridge, cloudLoginWindow: { onCompleted: () => () => {} } },
  });
  vi.mocked(createCloudSettingsClient).mockReturnValue(client);
  const connect = vi.spyOn(client, 'connect');
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
      <CloudSettingsView />
    </MemoryRouter>,
  );
  await waitFor(() => expect(connect).toHaveBeenCalled());
  expect(createCloudSettingsClient).toHaveBeenCalledWith(
    state.deviceId,
    bridge,
    expect.any(Function),
  );
  expect(screen.queryByText('settings.ghosts.remote.offlineNotice')).toBeNull();
});
it('loads the plugin page for the selected instance only once its category is opened', async () => {
  Object.assign(window, { electronAPI: { cloudSettings: {} } });
  vi.mocked(createCloudSettingsClient).mockReturnValue(createTrialCloudSettingsClient());
  const Plugins = vi.fn((props: { deviceId: string; name: string; active: boolean }) => (
    <p data-testid="plugins">{`${props.deviceId} ${props.name} ${props.active}`}</p>
  ));
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
      <CloudSettingsView plugins={Plugins} />
    </MemoryRouter>,
  );
  await screen.findByRole('tab', { name: 'settings.tabs.ghosts' });
  expect(Plugins).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.ghosts' }));
  expect((await screen.findByTestId('plugins')).textContent).toBe(`${state.deviceId} Cloud A true`);
  // It stays mounted when another category is shown, so its page state is kept.
  fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.general' }));
  await waitFor(() =>
    expect(screen.getByTestId('plugins').textContent).toBe(`${state.deviceId} Cloud A false`),
  );
});
it.each([['tab=instance'], ['tab=cloud-instances'], ['section=maintenance']])(
  'sends the old overview link %s to the device card',
  async (query) => {
    const client = createTrialCloudSettingsClient();
    Object.assign(window, { electronAPI: { cloudSettings: {} } });
    vi.mocked(createCloudSettingsClient).mockReturnValue(client);
    const connect = vi.spyOn(client, 'connect');
    const Where = () => <p>{useLocation().search}</p>;
    render(
      <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}&${query}`]}>
        <Routes>
          <Route path="/cloud-settings" element={<CloudSettingsView />} />
          <Route path="/settings" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(new RegExp(`device=${state.deviceId}`))).toBeTruthy();
    expect(connect).not.toHaveBeenCalled();
  },
);
// Plan C (2026-11-09): General is shown again, so its links stay there; Plugins is shown again
// (2026-11-11), so its links stay there too.
it.each([
  ['ghosts', 'settings.tabs.ghosts'],
  ['general', 'settings.tabs.general'],
])('opens an old tab=%s link on the closest shown category', async (tab, landing) => {
  const client = createTrialCloudSettingsClient();
  Object.assign(window, { electronAPI: { cloudSettings: {} } });
  vi.mocked(createCloudSettingsClient).mockReturnValue(client);
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}&tab=${tab}`]}>
      <CloudSettingsView />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: landing }).getAttribute('aria-selected')).toBe('true'),
  );
});
it('does not connect or wake an offline instance', async () => {
  state.online = false;
  const client = createTrialCloudSettingsClient();
  Object.assign(window, { electronAPI: { cloudSettings: {} } });
  vi.mocked(createCloudSettingsClient).mockReturnValue(client);
  const connect = vi.spyOn(client, 'connect');
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
      <CloudSettingsView />
    </MemoryRouter>,
  );
  expect(connect).not.toHaveBeenCalled();
});
it('redirects the old list route into Settings and reads owned instances without creating one', async () => {
  state.deviceId = 'local-device';
  const bridge = {
    instanceList: vi.fn().mockResolvedValue([]),
    instanceClaim: vi.fn(),
    instanceInitialize: vi.fn(),
  };
  Object.assign(window, {
    electronAPI: { cloudSettings: bridge, cloudLoginWindow: { onCompleted: () => () => {} } },
  });
  try {
    render(
      <MemoryRouter initialEntries={['/cloud-settings']}>
        <Routes>
          <Route path="/cloud-settings" element={<CloudSettingsView />} />
          <Route path="/settings" element={<CloudInstancesSection />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'cloudSettings.onboarding.claim' });
    expect(bridge.instanceList).toHaveBeenCalledExactlyOnceWith({});
    expect(bridge.instanceClaim).not.toHaveBeenCalled();
    expect(createCloudSettingsClient).not.toHaveBeenCalled();
  } finally {
    state.deviceId = 'cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa';
  }
});

// Regression for the reported workspace-covering route: use the actual settings
// entry and click login; only the auxiliary bridge may open, the route stays put.
it('opens cloud login separately while keeping the settings workspace mounted', async () => {
  const open = vi.fn().mockResolvedValue(undefined);
  const bridge = {
    instanceList: vi.fn().mockResolvedValue([
      {
        instanceId: 'instance-a',
        deviceId: 'cloud-a',
        name: 'Test cloud',
        nameSequence: 1,
        ordinal: null,
        desiredState: 'stopped',
        runtimeState: 'missing',
        loginRequired: true,
        ready: false,
      },
    ]),
  };
  Object.assign(window, {
    electronAPI: { cloudSettings: bridge, cloudLoginWindow: { open, onCompleted: () => () => {} } },
  });
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<CloudInstancesSection />} />
        <Route path="*" element={<p>Workspace replaced</p>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'cloudSettings.onboarding.initialize' }),
  );
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith({ deviceId: 'cloud-a' }));
  expect(screen.queryByText('Workspace replaced')).toBeNull();
  expect(screen.getByText('Test cloud')).toBeTruthy();
});

const cisView = (patch: Record<string, unknown>) => ({
  instanceId: 'instance-a',
  deviceId: state.deviceId,
  name: 'CIS cloud',
  nameSequence: 1,
  ordinal: null,
  desiredState: 'running',
  runtimeState: 'running',
  ready: true,
  version: '0.1.119-cloud.3',
  imageId: null,
  updateAvailable: false,
  latestVersion: null,
  upgradeState: 'idle',
  observedAtMs: 1,
  maintenance: null,
  ...patch,
});

// Real packaged acceptance: the local relay had stopped with device-removed,
// while CIS and the cloud runtime remained healthy. The old entry treated the
// missing DeviceLink directory as a cloud outage and hid all settings.
// Unit tier: exercise the production route, with only CIS I/O replaced. Existing
// entry tests only covered the remote-control flag, not independent relay state.
it('loads CIS settings without a local relay and disables them when CIS becomes unavailable', async () => {
  state.online = false;
  const client = createTrialCloudSettingsClient();
  const instance = vi.fn().mockResolvedValue(cisView({}));
  client.instance = instance;
  Object.assign(window, { electronAPI: { cloudSettings: {} } });
  vi.mocked(createCloudSettingsClient).mockReturnValue(client);
  const connect = vi.spyOn(client, 'connect');
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
      <CloudSettingsView />
    </MemoryRouter>,
  );
  await waitFor(() => expect(connect).toHaveBeenCalled());
  expect(screen.queryByText('settings.ghosts.remote.offlineNotice')).toBeNull();
  instance.mockRejectedValue(new Error('CLOUD_SETTINGS_SCOPE_CHANGED'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(screen.getByText('settings.ghosts.remote.offlineNotice')).toBeTruthy());
});
it.each(['stopped', 'login-required', 'unready', 'wrong-target'])(
  'does not use stale DeviceLink presence to open a CIS %s target',
  async (status) => {
    state.online = true;
    const client = createTrialCloudSettingsClient();
    const instance = vi.fn().mockResolvedValue(
      cisView({
        deviceId:
          status === 'wrong-target' ? 'cloud-device-bbbbbbbbbbbbbbbbbbbbbbbb' : state.deviceId,
        name: 'CIS cloud',
        ready: status !== 'unready',
        desiredState: status === 'stopped' ? 'stopped' : 'running',
        loginRequired: status === 'login-required',
      }),
    );
    client.instance = instance;
    Object.assign(window, { electronAPI: { cloudSettings: {} } });
    vi.mocked(createCloudSettingsClient).mockReturnValue(client);
    const connect = vi.spyOn(client, 'connect');
    render(
      <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
        <CloudSettingsView />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(screen.getByText('settings.ghosts.remote.offlineNotice')).toBeTruthy();
    expect(connect).not.toHaveBeenCalled();
  },
);
// cloud-test, 2026-11-09: during an upgrade CIS still reported running/ready while the runtime was
// down, so the page connected, Main answered CLOUD_SETTINGS_SCOPE_CHANGED and the page showed a
// generic read failure. It must say the instance is upgrading and not try to connect.
it.each([
  ['an active operation', true, { upgradeOperation: { operationId: 'op', phase: 'backup-running', active: true, updatedAtMs: 2_000 } }],
  ['a finished operation newer than the last observation, with DeviceLink offline', false, { observedAtMs: 1_000, upgradeOperation: { operationId: 'op', phase: 'completed', active: false, updatedAtMs: 2_000 } }],
] as const)('says the instance is upgrading during %s instead of a read failure', async (_label, linkOnline, patch) => {
  state.online = linkOnline;
  const client = createTrialCloudSettingsClient();
  client.instance = vi.fn().mockResolvedValue(cisView(patch));
  Object.assign(window, { electronAPI: { cloudSettings: {} } });
  vi.mocked(createCloudSettingsClient).mockReturnValue(client);
  const connect = vi.spyOn(client, 'connect');
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
      <CloudSettingsView />
    </MemoryRouter>,
  );
  expect(await screen.findByText('cloudSettings.upgradingNotice')).toBeTruthy();
  expect(screen.queryByText('cloudSettings.targetUnavailable')).toBeNull();
  expect(connect).not.toHaveBeenCalled();
});
// Plan C settled the settings scope (2026-11-09): a scope a dev build stored earlier no longer
// changes the page, and the dev options offer no scope switch (since 2026-11-12 no switch at all:
// only the entry to the scenario panel). Plugins is a category again since 2026-11-11, when the
// native client began managing the instance's plugins. Through the real route.
it('shows the released categories whatever scope a dev build stored, and offers no scope switch', async () => {
  localStorage.setItem('cloud-preview:settings-scope', 'all');
  Object.assign(window, { electronAPI: { cloudSettings: {} } });
  vi.mocked(createCloudSettingsClient).mockImplementation(() => createTrialCloudSettingsClient());
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
      <CloudSettingsView />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
  const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
  expect(tabs.at(-1)).toBe('cloudSettings.moreSettings');
  expect(tabs).toContain('settings.tabs.ghosts');
  expect(screen.queryByRole('button', { name: 'cloudSettings.instance.title' })).toBeNull();
  cleanup();
  render(<CloudPreviewSwitches />);
  fireEvent.click(screen.getByRole('button', { name: '开发选项' }));
  const options = await screen.findByRole('dialog', { name: '开发选项' });
  expect(within(options).queryAllByRole('radiogroup')).toEqual([]);
  expect(within(options).getByRole('button', { name: '打开异常场景面板' })).toBeTruthy();
  localStorage.clear();
});

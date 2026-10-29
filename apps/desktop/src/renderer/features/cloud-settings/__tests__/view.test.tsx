// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudSettingsView } from '../CloudSettingsView';
import { createTrialCloudSettingsClient } from '../trial';
import { createCloudSettingsClient } from '../client';
import { CloudInstancesSection } from '../CloudInstancesSection';
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
  expect(screen.queryByText('cloudSettings.offline')).toBeNull();
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
  expect(screen.queryByText('cloudSettings.offline')).toBeNull();
  instance.mockRejectedValue(new Error('CLOUD_SETTINGS_SCOPE_CHANGED'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(screen.getByText('cloudSettings.offline')).toBeTruthy());
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
    expect(screen.getByText('cloudSettings.offline')).toBeTruthy();
    expect(connect).not.toHaveBeenCalled();
  },
);

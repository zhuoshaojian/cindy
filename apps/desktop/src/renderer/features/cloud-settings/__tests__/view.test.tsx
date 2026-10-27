// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useTranslation: () => ({ t: (key: string) => key }),
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
    instanceList: vi
      .fn()
      .mockResolvedValue([
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

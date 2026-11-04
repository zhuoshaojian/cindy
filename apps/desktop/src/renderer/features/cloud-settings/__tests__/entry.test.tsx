// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudSettingsShortcut } from '../CloudSettingsShortcut';
import { CloudInstanceSidebarEntries } from '../CloudInstanceSidebarEntries';
import { CloudInstanceAccessProvider, useCloudInstanceAccess } from '../CloudInstanceAccess';
import { setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';

const auth = vi.hoisted(() => ({
  mode: 'cloud',
  isAuthenticated: true,
  isInitializing: false,
  canEnterApp: true,
  dataOwnerId: 'owner-a',
  dataOwnerGeneration: 1,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
const instanceAccess = vi.fn();
const instanceList = vi.fn();
vi.mock('@/features/remote-desktop/useRemoteDesktopAvailability', () => ({
  useRemoteDesktopAvailability: () => ({ available: false, checking: false, reason: 'offline' }),
}));
beforeEach(() => {
  Object.assign(auth, {
    mode: 'cloud',
    isAuthenticated: true,
    isInitializing: false,
    canEnterApp: true,
    dataOwnerId: 'owner-a',
    dataOwnerGeneration: 1,
  });
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  instanceAccess.mockReset().mockResolvedValue({ schemaVersion: 1, allowed: true });
  instanceList.mockReset().mockResolvedValue([]);
  vi.stubGlobal('electronAPI', { cloudSettings: { instanceAccess, instanceList } });
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: { name?: string }) => (vars?.name ? `Configure ${vars.name}` : key),
  }),
}));
vi.mock('@/components/ui/tooltip', () => ({
  Tip: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function Destination() {
  const location = useLocation();
  return (
    <output>
      {JSON.stringify({ path: location.pathname, query: location.search, state: location.state })}
    </output>
  );
}
// Permission regression: the real shortcut previously exposed cloud settings
// based only on a device ID. Without an affirmative CIS result it must be absent.
// Unit tier; no existing entry test covered denied/unknown admission.
it('hides the shortcut until cloud admission has been confirmed', () => {
  render(
    <MemoryRouter>
      <CloudSettingsShortcut deviceId="cloud-device-example" name="My cloud" />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('link')).toBeNull();
});
it('opens the named instance directly and remembers the previous location', async () => {
  render(
    <CloudInstanceAccessProvider>
      <MemoryRouter initialEntries={['/cc-agent/new?workspace=example']}>
        <Routes>
          <Route
            path="/cc-agent/new"
            element={<CloudSettingsShortcut deviceId="cloud-device-example" name="My cloud" />}
          />
          <Route path="/cloud-settings" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    </CloudInstanceAccessProvider>,
  );
  await screen.findByRole('link');
  fireEvent.click(screen.getByRole('link', { name: 'Configure My cloud' }));
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({
    path: '/cloud-settings',
    query: '?deviceId=cloud-device-example',
    state: { returnTo: '/cc-agent/new?workspace=example' },
  });
});

function Probe() {
  return <output data-testid="access">{useCloudInstanceAccess()}</output>;
}
function content() {
  return (
    <CloudInstanceAccessProvider>
      <Probe />
      <Probe />
    </CloudInstanceAccessProvider>
  );
}
const access = () => screen.getAllByTestId('access')[0]!.textContent;

// Real provider + Main bridge substitute: covers permissions, read-only empty
// membership, account switch races and expiry; previously only link routing was tested.
it.each(['local', 'signed-out'])('does not query CIS in %s mode', async (mode) => {
  auth.mode = mode;
  render(content());
  expect(access()).toBe('hidden');
  expect(instanceAccess).not.toHaveBeenCalled();
});

it.each(['CLOUD_SETTINGS_SCOPE_CHANGED', 'CLOUD_SETTINGS_UNAVAILABLE'])(
  'keeps all consumers hidden on %s and recovers on focus',
  async (code) => {
    instanceAccess.mockRejectedValueOnce(new Error(code));
    render(content());
    expect(access()).toBe('checking');
    await act(async () => {});
    expect(access()).toBe('hidden');
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(access()).toBe('allowed'); // An admitted account may have no instances yet.
    expect(instanceAccess).toHaveBeenCalledTimes(2); // Shared across both consumers.
  },
);

it('discards an old account response and hides immediately on logout or generation change', async () => {
  let complete!: (value: { schemaVersion: 1; allowed: boolean }) => void;
  instanceAccess.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(content());
  auth.dataOwnerId = 'owner-b';
  auth.dataOwnerGeneration++;
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  instanceAccess.mockRejectedValueOnce(new Error('CLOUD_SETTINGS_SCOPE_CHANGED'));
  view.rerender(content());
  expect(access()).toBe('checking');
  await act(async () => {});
  expect(access()).toBe('hidden');
  await act(async () => complete({ schemaVersion: 1, allowed: true }));
  expect(access()).toBe('hidden');
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(access()).toBe('allowed');
  auth.dataOwnerGeneration++;
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  instanceAccess.mockImplementationOnce(() => new Promise(() => {}));
  view.rerender(content());
  expect(access()).toBe('checking');
  auth.mode = 'signed-out';
  auth.isAuthenticated = false;
  view.rerender(content());
  expect(access()).toBe('hidden');
});

it('rechecks visible permissions periodically and removes revoked access', async () => {
  vi.useFakeTimers();
  render(content());
  await act(async () => {});
  expect(access()).toBe('allowed');
  instanceAccess.mockRejectedValueOnce(new Error('CLOUD_SETTINGS_SCOPE_CHANGED'));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(access()).toBe('hidden');
});

// Query only after Main has committed login and Renderer finished startup.
it.each(['isInitializing', 'canEnterApp'])(
  'waits for %s before fetching admission',
  async (field) => {
    if (field === 'isInitializing') auth.isInitializing = true;
    else auth.canEnterApp = false;
    const view = render(content());
    expect(access()).toBe('hidden');
    expect(instanceAccess).not.toHaveBeenCalled();
    auth.isInitializing = false;
    auth.canEnterApp = true;
    view.rerender(content());
    await act(async () => {});
    expect(access()).toBe('allowed');
    expect(instanceAccess).toHaveBeenCalledTimes(1);
  },
);
it('keeps a signed-in denied account hidden, without treating the response as permission', async () => {
  instanceAccess.mockResolvedValue({ schemaVersion: 1, allowed: false });
  render(content());
  await act(async () => {});
  expect(access()).toBe('hidden');
});
it('coalesces focus and visibility events without missing a later revocation', async () => {
  vi.useFakeTimers();
  render(content());
  await act(async () => {});
  for (const event of ['focus', 'focus', 'online']) {
    await act(async () => window.dispatchEvent(new Event(event)));
  }
  expect(instanceAccess).toHaveBeenCalledTimes(1);
  instanceAccess.mockResolvedValue({ schemaVersion: 1, allowed: false });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(access()).toBe('hidden');
  expect(instanceAccess).toHaveBeenCalledTimes(2);
});

// Both consumers must recover immediately after denied -> admitted -> denied,
// without waiting for focus or the one-minute permission refresh interval.
it('refreshes both entries on every account switch without reusing denied or allowed results', async () => {
  instanceAccess.mockResolvedValueOnce({ schemaVersion: 1, allowed: false });
  const view = render(content());
  await act(async () => {});
  expect(screen.getAllByTestId('access').map((node) => node.textContent)).toEqual([
    'hidden',
    'hidden',
  ]);
  for (const [owner, allowed] of [
    ['enterprise', true],
    ['personal', false],
    ['enterprise', true],
  ] as const) {
    let resolve!: (value: { schemaVersion: 1; allowed: boolean }) => void;
    instanceAccess.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    auth.dataOwnerId = owner;
    auth.dataOwnerGeneration++;
    setDataOwnerGeneration(owner, auth.dataOwnerGeneration);
    view.rerender(content());
    expect(screen.getAllByTestId('access').map((node) => node.textContent)).toEqual([
      'checking',
      'checking',
    ]);
    await act(async () => resolve({ schemaVersion: 1, allowed }));
    expect(screen.getAllByTestId('access').map((node) => node.textContent)).toEqual(
      allowed ? ['allowed', 'allowed'] : ['hidden', 'hidden'],
    );
  }
  expect(instanceAccess).toHaveBeenCalledTimes(4);
});

// Main can publish a committed owner just before releasing its transition fence.
// The first read then rejects even though the next read is authorized. No focus
// or visible-page polling event is guaranteed after the switch.
it('recovers from the account transition fence without focus, even while hidden', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  instanceAccess.mockRejectedValueOnce(new Error('CLOUD_SETTINGS_SCOPE_CHANGED'));
  try {
    render(content());
    await act(async () => {});
    expect(access()).toBe('hidden');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.getAllByTestId('access').map((node) => node.textContent)).toEqual([
      'allowed',
      'allowed',
    ]);
    expect(instanceAccess).toHaveBeenCalledTimes(2);
  } finally {
    visibility.mockRestore();
  }
});

it('does not retry an explicit denial and cancels the outgoing account retry', async () => {
  vi.useFakeTimers();
  instanceAccess.mockRejectedValueOnce(new Error('CLOUD_SETTINGS_SCOPE_CHANGED'));
  const view = render(content());
  await act(async () => {});
  auth.dataOwnerId = 'denied-account';
  auth.dataOwnerGeneration++;
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  instanceAccess.mockResolvedValue({ schemaVersion: 1, allowed: false });
  view.rerender(content());
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(access()).toBe('hidden');
  expect(instanceAccess).toHaveBeenCalledTimes(2);
});

it('bounds failed-read retries and cancels them when unmounted', async () => {
  vi.useFakeTimers();
  instanceAccess.mockRejectedValue(new Error('CLOUD_SETTINGS_UNAVAILABLE'));
  const view = render(content());
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(access()).toBe('hidden');
  expect(instanceAccess).toHaveBeenCalledTimes(4);
  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(instanceAccess).toHaveBeenCalledTimes(4);
});

// Unit regression: production sidebar discovery + real header/link. Existing
// shortcut tests start with an already-visible device; they missed an empty
// DeviceLink directory after relay stop. CIS discovery must still expose the
// correct target, without inventing task/remote availability or claiming one.
const cloudDevice = 'cloud-device-0123456789abcdef01234567';
const cloudInstance = {
  instanceId: 'instance-a',
  deviceId: cloudDevice,
  name: 'CIS instance',
  desiredState: 'running',
};
function sidebar(visibleDeviceIds: string[] = []) {
  return (
    <CloudInstanceAccessProvider>
      <MemoryRouter initialEntries={['/cc-agent/new']}>
        <Routes>
          <Route
            path="/cc-agent/new"
            element={<CloudInstanceSidebarEntries visibleDeviceIds={visibleDeviceIds} />}
          />
          <Route path="/cloud-settings" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    </CloudInstanceAccessProvider>
  );
}
it('keeps CIS configuration reachable without a DeviceLink directory', async () => {
  instanceList.mockResolvedValue([cloudInstance]);
  render(sidebar());
  await screen.findByRole('link', { name: 'CIS instance' });
  fireEvent.click(screen.getByRole('link', { name: 'Configure CIS instance' }));
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({
    path: '/cloud-settings',
    query: `?deviceId=${cloudDevice}`,
    state: { returnTo: '/cc-agent/new' },
  });
  expect(instanceList).toHaveBeenCalledExactlyOnceWith({});
});
it('fills missing headers without duplicating grouped devices or deleted instances', async () => {
  instanceList.mockResolvedValue([
    cloudInstance,
    { ...cloudInstance, instanceId: 'deleted', deviceId: 'deleted', desiredState: 'deleted' },
  ]);
  const view = render(sidebar([cloudDevice]));
  await act(async () => {});
  expect(screen.queryByRole('link')).toBeNull();
  view.rerender(sidebar());
  fireEvent.click(await screen.findByRole('link', { name: 'CIS instance' }));
  expect(JSON.parse(screen.getByRole('status').textContent!).query).toBe(
    `?deviceId=${cloudDevice}`,
  );
});
it('never discovers instances for a denied account, including after switching away and back', async () => {
  instanceList.mockResolvedValue([cloudInstance]);
  const view = render(sidebar());
  await screen.findByRole('link', { name: 'CIS instance' });
  instanceAccess.mockResolvedValue({ allowed: false });
  auth.dataOwnerId = 'denied';
  auth.dataOwnerGeneration++;
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  view.rerender(sidebar());
  expect(screen.queryByRole('link')).toBeNull();
  await act(async () => {});
  expect(instanceList).toHaveBeenCalledTimes(1);
  instanceAccess.mockResolvedValue({ allowed: true });
  auth.dataOwnerId = 'owner-a';
  auth.dataOwnerGeneration++;
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  view.rerender(sidebar());
  await screen.findByRole('link', { name: 'CIS instance' });
  expect(instanceList).toHaveBeenCalledTimes(2);
});
it('discards an outgoing owner list even when the new account is also admitted', async () => {
  let resolve!: (value: unknown[]) => void;
  instanceList.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(sidebar());
  await act(async () => {});
  auth.dataOwnerId = 'owner-b';
  auth.dataOwnerGeneration++;
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  view.rerender(sidebar());
  await act(async () => {});
  await act(async () => resolve([cloudInstance]));
  expect(screen.queryByRole('link')).toBeNull();
});
it('refreshes read-only discovery after a failed list and removes deleted instances', async () => {
  vi.useFakeTimers();
  instanceList
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce([cloudInstance]);
  render(sidebar());
  await act(async () => {});
  expect(screen.queryByRole('link')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByRole('link', { name: 'CIS instance' })).toBeTruthy();
  instanceList.mockResolvedValue([]);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.queryByRole('link')).toBeNull();
});

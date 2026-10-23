// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudSettingsShortcut } from '../CloudSettingsShortcut';
import { CloudInstanceAccessProvider, useCloudInstanceAccess } from '../CloudInstanceAccess';
import { setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';

const auth = vi.hoisted(() => ({
  mode: 'cloud',
  isAuthenticated: true,
  dataOwnerId: 'owner-a',
  dataOwnerGeneration: 1,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
const instanceList = vi.fn();
beforeEach(() => {
  Object.assign(auth, {
    mode: 'cloud',
    isAuthenticated: true,
    dataOwnerId: 'owner-a',
    dataOwnerGeneration: 1,
  });
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  instanceList.mockReset().mockResolvedValue([]);
  vi.stubGlobal('electronAPI', { cloudSettings: { instanceList } });
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, vars: { name: string }) => `Configure ${vars.name}` }),
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
  expect(instanceList).not.toHaveBeenCalled();
});

it.each(['CLOUD_SETTINGS_SCOPE_CHANGED', 'CLOUD_SETTINGS_UNAVAILABLE'])(
  'keeps all consumers hidden on %s and recovers on focus',
  async (code) => {
    instanceList.mockRejectedValueOnce(new Error(code));
    render(content());
    expect(access()).toBe('checking');
    await act(async () => {});
    expect(access()).toBe('hidden');
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(access()).toBe('allowed'); // An admitted account may have no instances yet.
    expect(instanceList).toHaveBeenCalledTimes(2); // Shared across both consumers.
  },
);

it('discards an old account response and hides immediately on logout or generation change', async () => {
  let complete!: (value: []) => void;
  instanceList.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(content());
  auth.dataOwnerId = 'owner-b';
  auth.dataOwnerGeneration++;
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  instanceList.mockRejectedValueOnce(new Error('CLOUD_SETTINGS_SCOPE_CHANGED'));
  view.rerender(content());
  expect(access()).toBe('checking');
  await act(async () => {});
  expect(access()).toBe('hidden');
  await act(async () => complete([]));
  expect(access()).toBe('hidden');
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(access()).toBe('allowed');
  auth.dataOwnerGeneration++;
  setDataOwnerGeneration(auth.dataOwnerId, auth.dataOwnerGeneration);
  instanceList.mockImplementationOnce(() => new Promise(() => {}));
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
  instanceList.mockRejectedValueOnce(new Error('CLOUD_SETTINGS_SCOPE_CHANGED'));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(access()).toBe('hidden');
});

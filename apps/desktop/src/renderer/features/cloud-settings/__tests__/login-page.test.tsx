// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CloudInstanceLoginView } from '../../../../shared/cloudInstanceLogin';
import type { DesktopLoginAction } from '../../../../shared/authIpc';

// Unit: the cloud route must never initialize/switch a local account, and leaving
// it must cancel even a late capability. Existing local LoginPage tests do not
// cover this new controller; the UI fixture separately renders its real view.
const scope = vi.hoisted(() => ({ access: 'allowed', owner: 'owner-a' }));
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ dataOwnerId: scope.owner, dataOwnerGeneration: 1 }),
}));
vi.mock('../CloudInstanceAccess', () => ({ useCloudInstanceAccess: () => scope.access }));
vi.mock('@/components/login/LoginPage', () => ({
  LoginPageView: ({
    onClose,
    login,
    targetLabel,
  }: {
    onClose: () => void;
    targetLabel: string;
    login: {
      dispatch: (a: DesktopLoginAction) => Promise<boolean>;
      loginState: { step: string } | null;
    };
  }) => (
    <>
      <output>
        {targetLabel}:{login.loginState?.step}
      </output>
      <button onClick={() => void login.dispatch({ type: 'discover-sso-org', org: 'example' })}>
        SSO
      </button>
      <button onClick={onClose}>close</button>
    </>
  ),
}));
import { CloudInstanceLoginPage } from '../CloudInstanceLoginPage';
const view: CloudInstanceLoginView = {
  handle: '11111111-1111-4111-8111-111111111111',
  complete: false,
  state: {
    step: 'identifier',
    providers: {
      region: 'cn',
      attribution: 'phone',
      phone: true,
      email: false,
      social: ['wechat', 'apple'],
    },
  },
};
const api = {
  instanceList: vi.fn(async () => [
    { deviceId: 'cloud-device-test', loginRequired: true, name: 'Cloud Test' },
  ]),
  instanceLoginStart: vi.fn(async () => structuredClone(view)),
  instanceLoginDispatch: vi.fn(async () => structuredClone(view)),
  instanceLoginPoll: vi.fn(async () => structuredClone(view)),
  instanceLoginClose: vi.fn(async () => undefined),
};
function Route() {
  const location = useLocation();
  return location.pathname === '/cloud-login' ? (
    <CloudInstanceLoginPage />
  ) : (
    <output>Returned to settings</output>
  );
}
function mount() {
  return render(
    <MemoryRouter initialEntries={['/cloud-login?deviceId=cloud-device-test']}>
      <Route />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  scope.access = 'allowed';
  scope.owner = 'owner-a';
  vi.clearAllMocks();
  api.instanceLoginStart.mockResolvedValue(structuredClone(view));
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      cloudSettings: api,
      authInitialize: vi.fn(() => {
        throw Error('local login forbidden');
      }),
    },
  });
});
afterEach(cleanup);
it('routes SSO only to the cloud handle and cancels on exit', async () => {
  mount();
  await screen.findByText('Cloud Test:identifier');
  fireEvent.click(screen.getByText('SSO'));
  await waitFor(() =>
    expect(api.instanceLoginDispatch).toHaveBeenCalledWith({
      handle: view.handle,
      action: { type: 'discover-sso-org', org: 'example' },
    }),
  );
  fireEvent.click(screen.getByText('close'));
  await screen.findByText('Returned to settings');
  expect(api.instanceLoginClose).toHaveBeenCalledWith({ handle: view.handle });
  expect(window.electronAPI.authInitialize).not.toHaveBeenCalled();
});
it('does not open login for a denied account', async () => {
  scope.access = 'hidden';
  mount();
  await screen.findByText('Returned to settings');
  expect(api.instanceLoginStart).not.toHaveBeenCalled();
});
it('closes a handle that arrives after leaving the route', async () => {
  let resolve!: (v: CloudInstanceLoginView) => void;
  api.instanceLoginStart.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const mounted = mount();
  await waitFor(() => expect(api.instanceLoginStart).toHaveBeenCalledOnce());
  mounted.unmount();
  await act(async () => resolve(view));
  expect(api.instanceLoginClose).toHaveBeenCalledExactlyOnceWith({ handle: view.handle });
});
it('cancels the old owner scope before opening the new one', async () => {
  const mounted = mount();
  await screen.findByText('Cloud Test:identifier');
  scope.owner = 'owner-b';
  mounted.rerender(
    <MemoryRouter initialEntries={['/cloud-login?deviceId=cloud-device-test']}>
      <Route />
    </MemoryRouter>,
  );
  await waitFor(() => expect(api.instanceLoginStart).toHaveBeenCalledTimes(2));
  expect(api.instanceLoginClose).toHaveBeenCalledWith({ handle: view.handle });
});

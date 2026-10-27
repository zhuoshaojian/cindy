// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CloudInstanceLoginView } from '../../../../shared/cloudInstanceLogin';
import type { DesktopLoginAction } from '../../../../shared/authIpc';

// Unit: the auxiliary login must use only cloud handles, preserve SSO, and
// dispose late results. The shared local login tests cannot cover this scope.
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
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
import { CloudInstanceLoginFlow } from '../CloudInstanceLoginPage';
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
const target = { deviceId: 'cloud-device-test', name: 'Cloud Test', nameSequence: 1 };
function mount() {
  const close = vi.fn();
  return { ...render(<CloudInstanceLoginFlow target={target} api={api} onClose={close} />), close };
}
beforeEach(() => {
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
  const mounted = mount();
  await screen.findByText('Cloud Test:identifier');
  fireEvent.click(screen.getByText('SSO'));
  await waitFor(() =>
    expect(api.instanceLoginDispatch).toHaveBeenCalledWith({
      handle: view.handle,
      action: { type: 'discover-sso-org', org: 'example' },
    }),
  );
  fireEvent.click(screen.getByText('close'));
  expect(mounted.close).toHaveBeenCalledOnce();
  mounted.unmount();
  expect(api.instanceLoginClose).toHaveBeenCalledWith({ handle: view.handle });
  expect(window.electronAPI.authInitialize).not.toHaveBeenCalled();
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
it('starts a clean flow after close/reopen instead of reusing the previous form', async () => {
  const mounted = mount();
  await screen.findByText('Cloud Test:identifier');
  mounted.unmount();
  mount();
  await waitFor(() => expect(api.instanceLoginStart).toHaveBeenCalledTimes(2));
  expect(api.instanceLoginClose).toHaveBeenCalledWith({ handle: view.handle });
});

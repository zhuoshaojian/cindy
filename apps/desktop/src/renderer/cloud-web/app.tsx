import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import 'harmonyos-sans-sc-webfont-splitted';
import '@/i18n';
import '../themes/colors';
import '../styles/globals.css';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ThemeProvider, getInitialThemeVariant } from '@/hooks/useTheme';
import { LocaleProvider } from '@/hooks/useLocale';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog-provider';
import { ToastContainer } from '@/components/ui/toast';
import { toast } from '@/lib/toast';
import { StaticAuthContextProvider, type AuthContextValue } from '@/contexts/AuthContext';
import { CloudInstancesPage, type CloudInstancesApi } from '@/features/cloud-settings/CloudInstancesPage';
import { CloudSettingsPanel } from '@/features/cloud-settings/CloudSettingsView';
import { createCloudSettingsClient } from '@/features/cloud-settings/client';
import { cloudInstanceName } from '@/features/cloud-settings/instanceName';
import { themeService } from '../themes/theme-service';
import type { CloudInstanceView } from '../../shared/cloudInstanceControl';
import type { CisSession, WebCloudApi } from './webApi';
import { openDesktopTab } from './desktopTab';
import { CloudWebErrorBoundary } from './crash';

const unavailable = () => Promise.reject(new Error('UNSUPPORTED_IN_WEB'));

/** The CIS session is the account: the pages see a signed-in cloud owner and nothing else. */
function authValue(session: CisSession): AuthContextValue {
  return {
    user: { id: session.membershipId } as AuthContextValue['user'],
    mode: 'cloud',
    dataOwnerId: session.membershipId,
    dataOwnerRecoveryEpoch: 0,
    dataOwnerGeneration: 1,
    canEnterApp: true,
    isAuthenticated: true,
    isCanary: false,
    isInitializing: false,
    deviceId: null,
    loginState: null,
    loadLoginState: unavailable,
    dispatchLoginAction: unavailable,
    logout: async () => {
      await fetch('/instance-login/api/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
      location.replace('/instance-login/');
    },
    listAccounts: unavailable,
    syncAccounts: unavailable,
    switchAccount: unavailable,
    beginAddAccount: unavailable,
    cancelAddAccount: unavailable,
    enterLocalMode: unavailable,
    exitLocalMode: unavailable,
    hasAccountDeletionReceipt: false,
    accountDeletionRestored: false,
    credentialStoreUnavailable: false,
    getAccountDeletionAvailability: unavailable,
    requestAccountDeletionChallenge: unavailable,
    confirmAccountDeletion: unavailable,
    getAccountDeletionStatus: unavailable,
    clearAccountDeletionReceipt: unavailable,
    consumeAccountDeletionRestoredNotice: unavailable,
  } as AuthContextValue;
}

/** Signing in an instance stays on the existing CIS page, which owns SSO and verification. */
async function signInInstance(instance: CloudInstanceView | undefined) {
  if (!instance) throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
  const response = await fetch('/instance-login/api/attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceId: instance.instanceId,
      ...(instance.desiredState === 'stopped' ? { wake: true } : {}),
    }),
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('CLOUD_SETTINGS_UNAVAILABLE');
  const { continueUrl } = (await response.json()) as { continueUrl?: unknown };
  if (typeof continueUrl !== 'string' || !continueUrl.startsWith('/instance-login/#'))
    throw new Error('CLOUD_SETTINGS_INVALID_RESPONSE');
  location.assign(continueUrl);
}

/** Instances whose running Host takes remote desktop calls from this browser. */
function useDesktopReady(api: WebCloudApi) {
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    const check = async () => {
      const online = api.instances().filter(api.online);
      const supported = await Promise.all(online.map((item) => api.relay.desktop(item.instanceId)));
      if (!live) return;
      const next = new Set(online.filter((_, index) => supported[index]).map((item) => item.instanceId));
      setReady((current) => (current.size === next.size && [...next].every((id) => current.has(id)) ? current : next));
    };
    void check();
    const off = api.onInstancesChanged(() => void check());
    return () => {
      live = false;
      off();
    };
  }, [api]);
  return ready;
}

function Instances({ api }: { api: WebCloudApi }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const desktopReady = useDesktopReady(api);
  const pageApi = useMemo<CloudInstancesApi>(
    () => ({
      instanceList: () => api.listInstances(),
      instanceClaim: (input) => api.cloudSettings.instanceClaim(input),
      instancePower: (input) => api.cloudSettings.instancePower(input),
      instanceInitialize: ({ deviceId }) =>
        signInInstance(api.instances().find((item) => item.deviceId === deviceId)),
    }),
    [api],
  );
  return (
    <CloudInstancesPage
      api={pageApi}
      canOpenDesktop={(instance) => api.online(instance) && desktopReady.has(instance.instanceId)}
      onOpenDesktop={(instance) => {
        try {
          openDesktopTab(instance.deviceId, cloudInstanceName(t, instance));
        } catch {
          toast.error(t('remoteDesktop.connectionError'));
        }
      }}
      onOpen={(deviceId, section) =>
        navigate(`/settings?${new URLSearchParams({ deviceId, ...(section ? { section } : {}) })}`)
      }
    />
  );
}

function Settings({ api }: { api: WebCloudApi }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const deviceId = params.get('deviceId');
  const valid = !!deviceId && /^cloud-device-[a-f0-9]{24}$/u.test(deviceId);
  const client = useMemo(
    () => (valid ? createCloudSettingsClient(deviceId!, api.cloudSettings, () => {}) : undefined),
    [api, deviceId, valid],
  );
  const [instance, setInstance] = useState<CloudInstanceView | undefined>(() =>
    api.instances().find((item) => item.deviceId === deviceId),
  );
  // Model sources this instance lists (shared providers) are read through it.
  useEffect(() => {
    api.view(valid ? deviceId : null);
    return () => api.view(null);
  }, [api, deviceId, valid]);
  // As in the native window: availability comes from CIS, refreshed while the page is open.
  const refresh = useCallback(async () => {
    if (!client?.instance || document.visibilityState === 'hidden') return;
    try {
      setInstance(await client.instance());
    } catch {
      setInstance(undefined);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh]);
  if (!client) return <Navigate to="/" replace />;
  const online = !!instance?.ready && instance.desiredState === 'running' && !instance.loginRequired;
  return (
    <CloudSettingsPanel
      key={deviceId}
      name={instance ? cloudInstanceName(t, instance) : t('cloudSettings.instance.title')}
      client={client}
      online={online}
      onBack={() => navigate('/')}
      focusMaintenance={params.get('section') === 'maintenance'}
      version={instance?.version ?? undefined}
    />
  );
}

export function mountCloudApp(api: WebCloudApi, session: CisSession) {
  themeService.applyTheme(getInitialThemeVariant().theme);
  const auth = authValue(session);
  // A render error shows the crash screen and its report instead of a blank page.
  createRoot(document.getElementById('root')!).render(
    <CloudWebErrorBoundary>
      <ThemeProvider>
        <LocaleProvider>
          <ConfirmDialogProvider>
            <Tooltip.Provider>
              <StaticAuthContextProvider value={auth}>
                <HashRouter>
                  <div className="h-screen w-screen overflow-hidden bg-[var(--settings-theme-bg,var(--background))]">
                    <Routes>
                      <Route path="/" element={<Instances api={api} />} />
                      <Route path="/settings" element={<Settings api={api} />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </div>
                </HashRouter>
              </StaticAuthContextProvider>
              <ToastContainer />
            </Tooltip.Provider>
          </ConfirmDialogProvider>
        </LocaleProvider>
      </ThemeProvider>
    </CloudWebErrorBoundary>,
  );
}

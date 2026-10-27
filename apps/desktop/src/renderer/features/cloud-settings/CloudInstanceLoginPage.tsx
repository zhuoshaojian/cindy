import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LoginPageView } from '@/components/login/LoginPage';
import { useAppShellCover } from '@/contexts/AppShellCoverContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCloudInstanceAccess } from './CloudInstanceAccess';
import {
  cloudLoginActionSchema,
  type CloudInstanceLoginView,
} from '../../../shared/cloudInstanceLogin';
import type { DesktopLoginAction } from '../../../shared/authIpc';

const returnTo = '/settings?tab=cloud-instances';

export function CloudInstanceLoginPage() {
  const access = useCloudInstanceAccess();
  const { dataOwnerId, dataOwnerGeneration } = useAuth();
  const [params] = useSearchParams();
  const deviceId = params.get('deviceId');
  if (access === 'hidden' || !deviceId) return <Navigate to={returnTo} replace />;
  if (access === 'checking') return null;
  return (
    <CloudInstanceLoginFlow
      key={JSON.stringify([dataOwnerId, dataOwnerGeneration, deviceId])}
      deviceId={deviceId}
    />
  );
}

/** Separate controller, identical login UI. No local account/login dispatch. */
function CloudInstanceLoginFlow({ deviceId }: { deviceId: string }) {
  const api = useMemo(() => window.electronAPI.cloudSettings, []);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { reportLocalDbGate } = useAppShellCover();
  const [view, setView] = useState<CloudInstanceLoginView | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const handle = useRef<string | null>(null);
  const live = useRef(false);
  const inFlight = useRef(false);
  const [targetName, setTargetName] = useState<{ name: string | null; number: number } | null>(
    null,
  );
  const name =
    targetName?.name ??
    (targetName
      ? t('cloudSettings.onboarding.defaultName', { number: targetName.number })
      : t('cloudSettings.onboarding.initialize'));
  useEffect(() => {
    live.current = true;
    let disposed = false;
    let ownedHandle: string | null = null;
    reportLocalDbGate('ready');
    void (async () => {
      try {
        const instances = await api.instanceList({});
        if (disposed) return;
        const target = instances.find((i) => i.deviceId === deviceId);
        if (!target?.loginRequired) {
          navigate(returnTo, { replace: true });
          return;
        }
        setTargetName({ name: target.name, number: target.nameSequence });
        const initial = await api.instanceLoginStart({ deviceId });
        ownedHandle = initial.handle;
        if (disposed) {
          await api.instanceLoginClose({ handle: initial.handle });
          return;
        }
        handle.current = initial.handle;
        setView(initial);
      } catch {
        if (!disposed) setErrorCode('AUTH_SERVICE_UNAVAILABLE');
      } finally {
        if (!disposed) setBusy(false);
      }
    })();
    const timer = window.setInterval(() => {
      if (disposed || inFlight.current || !ownedHandle) return;
      inFlight.current = true;
      void api
        .instanceLoginPoll({ handle: ownedHandle })
        .then((next) => {
          if (!disposed) {
            setView(next);
            if (next.errorCode) setErrorCode(next.errorCode);
          }
        })
        .catch(() => {
          if (!disposed) setErrorCode('AUTH_REQUEST_FAILED');
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, 2000);
    return () => {
      disposed = true;
      live.current = false;
      handle.current = null;
      clearInterval(timer);
      if (ownedHandle) void api.instanceLoginClose({ handle: ownedHandle }).catch(() => undefined);
      reportLocalDbGate('pending');
    };
  }, [api, deviceId, navigate, reportLocalDbGate]);
  useEffect(() => {
    if (view?.complete) navigate(returnTo, { replace: true });
  }, [navigate, view?.complete]);

  const dispatchWithResult = async (action: DesktopLoginAction) => {
    const parsed = cloudLoginActionSchema.safeParse(action);
    if (!parsed.success || !handle.current) return { success: false, code: 'AUTH_REQUEST_FAILED' };
    if (inFlight.current) return { success: false, code: null };
    inFlight.current = true;
    setBusy(true);
    setErrorCode(null);
    try {
      const result = await api.instanceLoginDispatch({
        handle: handle.current,
        action: parsed.data,
      });
      if (!live.current) return { success: false, code: null };
      setView(result);
      setErrorCode(result.errorCode ?? null);
      return { success: !result.errorCode, code: result.errorCode ?? null };
    } catch {
      if (live.current) setErrorCode('AUTH_REQUEST_FAILED');
      return { success: false, code: 'AUTH_REQUEST_FAILED' };
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <LoginPageView
      intent="cloud-instance"
      targetLabel={name}
      captchaChallengeUrl={view?.captchaChallengeUrl}
      onClose={() => navigate(returnTo, { replace: true })}
      login={{
        isLoading: busy,
        errorCode,
        retryAt: view?.retryAt,
        loginState:
          view?.state ??
          (errorCode ? { step: 'error', code: errorCode, recoverTo: 'identifier' } : null),
        dispatchWithResult,
        dispatch: async (action) => (await dispatchWithResult(action)).success,
        clearError: () => setErrorCode(null),
      }}
    />
  );
}

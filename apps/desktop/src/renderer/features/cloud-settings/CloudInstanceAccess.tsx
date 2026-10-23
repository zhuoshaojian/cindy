import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
} from '@/contexts/dataOwnerGeneration';

type Access = 'checking' | 'allowed' | 'hidden';
const CloudInstanceAccessContext = createContext<Access>('hidden');

/** Presentation only. Main holds credentials; CIS still authorizes every action.
 * Only the dedicated capability response confirms management/placement access.
 * Never infer permission from login mode, organization names or cached devices. */
export function CloudInstanceAccessProvider({ children }: { children: ReactNode }) {
  const { mode, isAuthenticated, isInitializing, canEnterApp, dataOwnerId, dataOwnerGeneration } =
    useAuth();
  const scope =
    mode === 'cloud' && isAuthenticated && !isInitializing && canEnterApp && dataOwnerId
      ? JSON.stringify([dataOwnerId, dataOwnerGeneration])
      : null;
  const [result, setResult] = useState<{ scope: string; access: Access } | null>(null);

  useEffect(() => {
    if (!scope) {
      setResult(null);
      return;
    }
    const owner = getDataOwnerGeneration();
    let live = true;
    let inFlight = false;
    let lastDecisionAt = -Infinity;
    const current = () => live && isDataOwnerGenerationCurrent(owner);
    const refresh = async () => {
      if (inFlight || !current() || Date.now() - lastDecisionAt < 5_000) return;
      inFlight = true;
      try {
        // Main verifies the committed identity; CIS derives admission from its
        // current policy, without listing instances, waking or allocating one.
        const decision = await window.electronAPI.cloudSettings.instanceAccess({});
        if (current()) {
          lastDecisionAt = Date.now();
          setResult({ scope, access: decision.allowed ? 'allowed' : 'hidden' });
        }
      } catch {
        // A rejected or unavailable check is not permission to display the feature.
        if (current()) setResult({ scope, access: 'hidden' });
      } finally {
        inFlight = false;
      }
    };
    const visible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    void refresh();
    const timer = window.setInterval(visible, 60_000);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [scope]);

  // Hide synchronously on account/generation changes, before effect cleanup.
  const access = !scope ? 'hidden' : result?.scope === scope ? result.access : 'checking';
  return (
    <CloudInstanceAccessContext.Provider value={access}>
      {children}
    </CloudInstanceAccessContext.Provider>
  );
}

export function useCloudInstanceAccess(): Access {
  return useContext(CloudInstanceAccessContext);
}

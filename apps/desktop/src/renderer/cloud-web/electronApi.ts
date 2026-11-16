import { resolvePreferredSystemLocale } from '../../shared/locale';

/**
 * `window.electronAPI` for the browser build of the cloud pages. The pages and their
 * shared providers read a few Electron bridges; this page supplies the cloud ones over
 * CIS and leaves every other bridge inert: subscriptions do nothing, sync reads return
 * nothing and calls reject, so no local-only feature can act from a browser.
 */
export const UNSUPPORTED_IN_WEB = 'UNSUPPORTED_IN_WEB';
const noop = () => {};
const resolved = async () => {};

// Stable identities: React effects depend on the bridge objects they read.
const inertCache = new Map<string, unknown>();
function inert(path: string): unknown {
  let value = inertCache.get(path);
  if (!value) {
    const name = path.slice(path.lastIndexOf('.') + 1);
    const answer = () => {
      if (/^on[A-Z]/u.test(name)) return noop;
      if (/Sync$/u.test(name)) return undefined;
      return Promise.reject(new Error(UNSUPPORTED_IN_WEB));
    };
    // Shared code also calls bridges as `bridge.onX.call(owner, listener)`: those answer like a
    // direct call, so a subscription still hands back its unsubscribe function.
    const bound = () => answer;
    value = new Proxy(noop, {
      get: (_target, key) => {
        if (typeof key !== 'string' || key === 'then') return undefined;
        if (key === 'call' || key === 'apply') return answer;
        return key === 'bind' ? bound : inert(`${path}.${key}`);
      },
      apply: answer,
    });
    inertCache.set(path, value);
  }
  return value;
}

const wrapped = new WeakMap<object, Record<string, unknown>>();
function withFallback(value: Record<string, unknown>, path: string): Record<string, unknown> {
  const cached = wrapped.get(value);
  if (cached) return cached;
  const proxy = new Proxy(value, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (!(key in target)) return inert(`${path}.${key}`);
      const item = target[key];
      return item && typeof item === 'object' && !Array.isArray(item)
        ? withFallback(item as Record<string, unknown>, `${path}.${key}`)
        : item;
    },
  });
  wrapped.set(value, proxy);
  return proxy;
}

/** Installs the bridge; `parts` stays mutable so cloud adapters can join after sign-in. */
export function installWebElectronApi(): Record<string, unknown> {
  const parts: Record<string, unknown> = {
    platform: 'web',
    preferredSystemLocale: resolvePreferredSystemLocale(navigator.languages ?? [navigator.language]),
    // Signed in to CIS already: keep the owner's chosen theme instead of a first-run light gate.
    authHasPersistedSessionHintSync: () => true,
    logToMain: noop,
    setUpdateRelaunchTheme: resolved,
    setApplicationMenuLocale: resolved,
    setClassicalReplyStyle: resolved,
    theme: { applyVibrancy: noop },
    getFullscreenState: async () => Boolean(document.fullscreenElement),
    windowMaximize: () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen().catch(() => {});
    },
    windowMinimize: noop,
    // Authorization and help pages open in a new tab; a blocked pop-up reports failure so the
    // page offers its retry button, which is a user gesture.
    openExternal: async (url: string) => {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return { success: false };
      }
      if (target.protocol !== 'https:') return { success: false };
      const opened = window.open(target.href, '_blank');
      if (!opened) return { success: false };
      opened.opener = null;
      return { success: true };
    },
    windowClose: () => window.close(),
    onFullscreenChange: (cb: (value: boolean) => void) => {
      const listener = () => cb(Boolean(document.fullscreenElement));
      document.addEventListener('fullscreenchange', listener);
      return () => document.removeEventListener('fullscreenchange', listener);
    },
  };
  Object.defineProperty(window, 'electronAPI', { value: withFallback(parts, 'electronAPI'), configurable: true });
  // Inert bridges are not failures of this page.
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason instanceof Error && event.reason.message === UNSUPPORTED_IN_WEB) event.preventDefault();
  });
  return parts;
}

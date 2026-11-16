import type { DesktopIceServer, RemoteDesktopRequest } from '@cindy/device-link';
import { RemoteViewerConnection } from '../../main/remote-desktop-viewer/connection';
import { createIpcError } from '../../shared/ipc-errors';
import {
  DEFAULT_VIEWER_PREFERENCES,
  parseRememberedViewerResolution,
  type RemoteDesktopViewerApi,
  type RemoteViewerChannelRequest,
  type RemoteViewerPreferences,
  type RemoteViewerState,
  type RemoteViewerTarget,
} from '../../shared/remoteDesktopViewer';
import { CisSignedOutError } from './cisHttp';
import { HostCallError, type HostRelay } from './hostRelay';

/** Viewer choices stay in this browser, per instance, like the native per-device files. */
const PREFERENCES_KEY = (device: string) => `cindy.cloudWeb.viewer.${device}`;
const RESOLUTION_KEY = (device: string, display: string) => `cindy.cloudWeb.resolution.${device}.${display}`;
function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
/** Clipboard content sync needs the native clipboard helper; it stays off on the web. */
function readPreferences(device: string): RemoteViewerPreferences {
  const stored = readJson(PREFERENCES_KEY(device));
  return {
    ...DEFAULT_VIEWER_PREFERENCES,
    ...(stored && typeof stored === 'object' ? (stored as Partial<RemoteViewerPreferences>) : {}),
    clipboardSync: false,
  };
}

/** Codes only, as the native bridge passes them; never transport detail. */
function desktopCode(error: unknown): string {
  if (error instanceof HostCallError) {
    if (error.code === 'SETTINGS_UNSUPPORTED') return 'DESKTOP_UNAVAILABLE';
    return /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'DESKTOP_UNAVAILABLE';
  }
  if (error instanceof CisSignedOutError) return 'DESKTOP_STOPPED';
  const message = error instanceof Error ? error.message : '';
  return /^(DESKTOP|CLIPBOARD|CREDENTIAL)_[A-Z_]+$|^INVOKE_TIMEOUT$/.test(message) ? message : 'DESKTOP_UNAVAILABLE';
}

/**
 * The native viewer window's Main side, in the page: the same connection object decides
 * and checks every request; requests go to the instance through the CIS relay, or ride the
 * page's own media data channel once it is open.
 */
export function createWebRemoteDesktopViewer(relay: HostRelay, target: RemoteViewerTarget): RemoteDesktopViewerApi {
  const active = new Set<(state: RemoteViewerState) => void>();
  const channelListeners = new Set<(request: RemoteViewerChannelRequest) => void>();
  const closeListeners = new Set<(generation: number) => void>();
  const hiddenListeners = new Set<(hidden: boolean) => void>();
  const request = async (deviceId: string, message: RemoteDesktopRequest, check: () => void) => {
    check();
    try {
      return await relay.call(deviceId, { kind: 'desktop', request: message as Record<string, unknown> });
    } catch (error) {
      throw new Error(desktopCode(error));
    }
  };
  const connection = new RemoteViewerConnection({
    owner: () => 'web',
    request,
    // Clipboard copy and paste use the page's own clipboard; content sync is not offered.
    readClipboard: () => '',
    writeClipboard: (value) => void navigator.clipboard?.writeText(value).catch(() => {}),
    focused: () => document.hasFocus(),
    preferences: readPreferences,
    savePreferences: async (device, patch) => {
      const next = { ...readPreferences(device), ...patch, clipboardSync: false };
      localStorage.setItem(PREFERENCES_KEY(device), JSON.stringify(next));
      return next;
    },
    resolution: (device, display) => parseRememberedViewerResolution(readJson(RESOLUTION_KEY(device, display))),
    saveResolution: async (device, display, value) => {
      if (value) localStorage.setItem(RESOLUTION_KEY(device, display), JSON.stringify(value));
      else localStorage.removeItem(RESOLUTION_KEY(device, display));
    },
    channel: (generation, id, message) => {
      if (!channelListeners.size) return false;
      for (const listener of channelListeners) listener({ generation, id, request: message });
      return true;
    },
  });
  connection.bind(target);
  const publish = () => {
    const snapshot = connection.snapshot();
    for (const listener of active) listener(snapshot);
  };
  const ipc = (code: string) => createIpcError('PRECONDITION_FAILED', code);
  const guard = <T>(run: () => Promise<T> | T, code: string) =>
    Promise.resolve()
      .then(run)
      .catch((error: unknown) => {
        throw ipc(error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message) ? error.message : code);
      });
  document.addEventListener('visibilitychange', () => {
    for (const listener of hiddenListeners) listener(document.visibilityState === 'hidden');
  });
  // Closing the tab ends the session at once instead of waiting for the lease to lapse.
  window.addEventListener('pagehide', () => {
    try {
      if (connection.active) connection.close(connection.generation);
    } catch {
      /* Already stopped. */
    }
  });

  return {
    // Read when the reply is delivered, never a snapshot older than a later activation.
    state: () => Promise.resolve().then(() => connection.snapshot()),
    async request(generation, message, mediaAttempt) {
      const result = await connection.request(generation, message, mediaAttempt);
      if (!result.ok) throw ipc(result.code);
      return result.result;
    },
    async ice(generation, attempt): Promise<DesktopIceServer[]> {
      try {
        connection.beginMedia(generation, attempt);
      } catch {
        throw ipc('DESKTOP_VIDEO_STOPPED');
      }
      let servers: DesktopIceServer[];
      try {
        servers = (await relay.call(target.deviceId, { kind: 'desktopIce' })) as DesktopIceServer[];
      } catch {
        servers = [];
      }
      try {
        connection.checkMedia(generation, attempt);
      } catch {
        throw ipc('DESKTOP_VIDEO_STOPPED');
      }
      return servers;
    },
    async clipboard(generation, action) {
      const result = await connection.clipboard(generation, action);
      if (!result.ok) throw ipc(result.code);
    },
    async close(generation) {
      if (generation !== connection.generation) return;
      try {
        connection.close(generation);
      } catch {
        throw ipc('DESKTOP_STOP_FAILED');
      }
      publish();
      // A tab this page opened can close itself; otherwise the stopped viewer stays.
      window.close();
    },
    fullscreen: async () => {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      else await document.documentElement.requestFullscreen().catch(() => {});
    },
    // A browser tab keeps the size the owner gave it.
    resize: async (generation) => connection.check(generation),
    // As with the native window, activation arrives after the page's first state read.
    rendererReady: () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          connection.setActive(true);
          publish();
          resolve();
        }, 0),
      ),
    presentationReady: async () => {},
    onActive(listener) {
      active.add(listener);
      return () => active.delete(listener);
    },
    onLocale: () => () => {},
    onCloseRequested(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    onHidden(listener) {
      hiddenListeners.add(listener);
      return () => hiddenListeners.delete(listener);
    },
    inputFocus: async (generation, focused) => {
      if (focused) connection.check(generation);
    },
    preferences: (generation, patch) => guard(() => connection.preferences(generation, patch), 'DESKTOP_SETTINGS_FAILED'),
    safety: (generation, retry) => guard(() => connection.safety(generation, retry), 'DESKTOP_STOPPED'),
    clipboardSync: (generation) => guard(() => connection.syncClipboard(generation), 'DESKTOP_STOPPED'),
    resolution: (generation, displayId, value) =>
      guard(() => connection.resolution(generation, displayId, value), 'DESKTOP_SETTINGS_FAILED'),
    onChannelRequest(listener) {
      channelListeners.add(listener);
      return () => channelListeners.delete(listener);
    },
    channelReply: (generation, id, outcome) => guard(() => connection.channelReply(generation, id, outcome), 'DESKTOP_STOPPED'),
    credential: async () => {
      throw ipc('CREDENTIAL_UNAVAILABLE');
    },
  };
}

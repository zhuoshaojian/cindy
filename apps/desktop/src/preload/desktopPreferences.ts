import type { IpcRenderer } from 'electron';
import { DESKTOP_PREFERENCES_CHANNELS as channels, type DesktopPreferencesRendererApi } from '../shared/desktopPreferences';

/** 固定本机通道；轻窗口只获得读取与通知，不获得迁移或写入能力。
 * Only a managed cloud instance exposes it; elsewhere the renderer hooks stay local. */
export function createDesktopPreferencesReadApi(ipc: Pick<IpcRenderer, 'invoke' | 'sendSync' | 'on' | 'removeListener'>): Pick<DesktopPreferencesRendererApi, 'get' | 'getSync' | 'onChanged'> | undefined {
  if (ipc.sendSync(channels.hostOwned) !== true) return undefined;
  return {
    get: () => ipc.invoke(channels.get),
    getSync: () => ipc.sendSync(channels.getSync),
    onChanged: callback => {
      const listener = (_event: unknown, stamp: string) => callback(stamp);
      ipc.on(channels.changed, listener);
      return () => { ipc.removeListener(channels.changed, listener); };
    },
  };
}

/** 仅供执行 Host 的本机主应用使用，不挂载到远程 Renderer 或隧道。 */
export function createDesktopPreferencesApi(ipc: Pick<IpcRenderer, 'invoke' | 'sendSync' | 'on' | 'removeListener'>): DesktopPreferencesRendererApi | undefined {
  const read = createDesktopPreferencesReadApi(ipc);
  return read && { ...read, update: request => ipc.invoke(channels.update, request) };
}

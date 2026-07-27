import type { RemoteSession } from '@/session/types';
import { parseCloudDeviceName } from '@cindy/maker-shared/device-list';

export * from '@cindy/maker-shared/mobile-home';

/**
 * 手机端隐藏 Orca worker 子会话(本期不支持进 worker 子会话聊天),Lead 会话与普通会话保留。
 * **只在 mobile 侧过滤**——桌面仍需显示/管理 worker,绝不动共享的 sessionList 过滤逻辑。
 */
export function excludeOrcaWorkerSessions<T extends Pick<RemoteSession, 'orcaRole'>>(
  sessions: readonly T[],
): T[] {
  return sessions.filter((session) => session.orcaRole !== 'worker');
}

export interface MobileHomeSourceDevice {
  deviceId: string;
  kind?: string;
}

/**
 * Cloud capability is applied once at the mobile Home aggregation boundary.
 * Downstream device filters, session groups, recent projects, and new-session
 * options all consume these same sources, so unsupported cloud data cannot
 * leak through a separately rendered path.
 */
export function selectMobileHomeSources<
  TDevice extends MobileHomeSourceDevice,
  TSession extends Pick<RemoteSession, 'deviceLinkDeviceId' | 'deviceLinkDeviceName'>,
>(
  devices: TDevice[],
  sessions: TSession[],
  cloudUnsupported: boolean,
): { devices: TDevice[]; sessions: TSession[] } {
  if (!cloudUnsupported) return { devices, sessions };
  const cloudDeviceIds = new Set(
    devices.filter((device) => device.kind === 'cloud').map((device) => device.deviceId),
  );
  return {
    devices: devices.filter((device) => device.kind !== 'cloud'),
    sessions: sessions.filter(
      (session) =>
        !cloudDeviceIds.has(session.deviceLinkDeviceId ?? '')
        && parseCloudDeviceName(session.deviceLinkDeviceName ?? '') === null,
    ),
  };
}

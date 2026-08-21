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
 * When control-plane capability is unavailable, live relay devices remain valid
 * remote targets. Only cached cloud sessions without a current relay device are
 * suppressed, so a transient control-plane failure cannot erase an online device.
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
    devices,
    sessions: sessions.filter((session) => {
      const deviceId = session.deviceLinkDeviceId ?? '';
      if (cloudDeviceIds.has(deviceId)) return true;
      return parseCloudDeviceName(session.deviceLinkDeviceName ?? '') === null;
    }),
  };
}

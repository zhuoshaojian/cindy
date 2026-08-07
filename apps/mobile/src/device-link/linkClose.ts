import type { Envelope, LinkClosePayload } from '@cindy/device-link';

type DeviceScopedState = Pick<Map<string, unknown>, 'delete'>;
type DeviceTopicAckState = Pick<Map<string, Set<string>>, 'delete' | 'get'>;

export type RehydrateSuppressionScope = 'durable' | 'connection';

export interface RehydrateSuppressionSnapshot {
  durable: boolean;
  connection: boolean;
}

/** Per-account suppression with lifecycle-only shutdown kept separate. */
export class RehydrateSuppressionState {
  private ownerId: string | null = null;
  private readonly durable = new Set<string>();
  private readonly connection = new Set<string>();

  has(deviceId: string): boolean {
    return this.durable.has(deviceId) || this.connection.has(deviceId);
  }

  suppress(deviceId: string, scope: RehydrateSuppressionScope): void {
    (scope === 'durable' ? this.durable : this.connection).add(deviceId);
  }

  delete(deviceId: string): void {
    this.durable.delete(deviceId);
    this.connection.delete(deviceId);
  }

  clearConnection(deviceId?: string): void {
    if (deviceId) this.connection.delete(deviceId);
    else this.connection.clear();
  }

  take(deviceId: string): RehydrateSuppressionSnapshot {
    const snapshot = {
      durable: this.durable.has(deviceId),
      connection: this.connection.has(deviceId),
    };
    this.delete(deviceId);
    return snapshot;
  }

  restore(deviceId: string, snapshot: RehydrateSuppressionSnapshot): void {
    if (snapshot.durable) this.durable.add(deviceId);
    if (snapshot.connection) this.connection.add(deviceId);
  }

  /** Logout/account switch is the only bulk reset for durable peer intent. */
  resetForOwner(ownerId: string | null | undefined): boolean {
    const next = ownerId?.trim() || null;
    if (this.ownerId === next) return false;
    this.ownerId = next;
    this.durable.clear();
    this.connection.clear();
    return true;
  }
}

export function invalidatePeerLinkState(
  deviceId: string,
  openLinks: DeviceScopedState,
  remoteTopicAcks: DeviceTopicAckState,
  onTopicsInterrupted: (topics: readonly string[]) => void,
): void {
  openLinks.delete(deviceId);
  const topics = remoteTopicAcks.get(deviceId);
  remoteTopicAcks.delete(deviceId);
  if (topics && topics.size > 0) onTopicsInterrupted([...topics]);
}

/**
 * 永久关闭(user/toggle-off/revoked 及未知新值)→ durable 抑制后台 rehydrate;
 * shutdown 只抑制当前 peer/socket 生命周期,下一权威代际可恢复。
 * 对该设备的自动重建:对方刚明确结束链路,在途 openLink 被 LINK_NOT_OPEN 拒后
 * 不得由 rehydrate/退避重试链再次建链;只有 transport-timeout(唯一可恢复的
 * 瞬时重置)解除抑制继续恢复。durable scope 只有显式 openLink 或账号切换解除;
 * connection scope 可由新 socket / 权威 peer 代际解除。
 */
export function updateRehydrateSuppressionOnLinkClose(
  suppressed: RehydrateSuppressionState,
  deviceId: string,
  reason: string | undefined,
): void {
  if (reason === 'transport-timeout') {
    suppressed.delete(deviceId);
    return;
  }
  suppressed.suppress(deviceId, reason === 'shutdown' ? 'connection' : 'durable');
}

/**
 * durable 抑制的合法解除点(除 transport-timeout 外)只有显式 openLink 或账号
 * 切换。普通 available=true 只清 connection-scoped shutdown,不能覆盖
 * user/toggle-off/revoked 意图。
 */

/** 显式 openLink 成功 = 用户/页面主动重建意图已落地,解除该设备抑制。 */
export function liftRehydrateSuppressionOnExplicitOpen(
  suppressed: RehydrateSuppressionState,
  deviceId: string,
): void {
  suppressed.delete(deviceId);
}

/** A new shared socket generation only lifts lifecycle-scoped shutdown. */
export function liftConnectionSuppressionForNewConnection(
  suppressed: RehydrateSuppressionState,
): void {
  suppressed.clearConnection();
}

/** A new authoritative peer generation only lifts that peer's shutdown scope. */
export function liftConnectionSuppressionForPeer(
  suppressed: RehydrateSuppressionState,
  deviceId: string,
): void {
  suppressed.clearConnection(deviceId);
}

export function handlePeerLinkCloseFrame(
  env: Envelope,
  onLinkClosed: (deviceId: string, reason?: string) => void,
): boolean {
  if (env.kind !== 'link-close' || !env.src) return false;
  // reason 透传给上层:transport-timeout(被控端对本机的可靠重试耗尽后的
  // peer 级瞬时重置)需要控制端立即重建链路,而不是等下一次外部 rehydrate。
  const reason = (env.payload as LinkClosePayload | undefined)?.reason;
  onLinkClosed(env.src, typeof reason === 'string' ? reason : undefined);
  return true;
}

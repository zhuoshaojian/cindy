import type { Logger } from './logger';

export interface AccountIntegrationStartupDeps {
  isOwnerCurrent(ownerId: string): boolean;
  startHookControlAccount(): void;
  startImConnection(): void;
  /**
   * Scheduler host. Starting it also brings up the goal controller and the
   * learn host, which live inside its startup.
   */
  startScheduler(): void;
  startEmbeddingHost(): void;
  log: Pick<Logger, 'warn'>;
}

/**
 * Start every account-scoped consumer that has to wait for provider discovery
 * to settle. Hook control, personal IM and the scheduler can all resolve routes
 * before `maker.createSession`, so none of them may run earlier.
 *
 * This is the single list of those consumers. Desktop reaches it from the
 * renderer-driven owner-DB readiness callback; a Pod reaches it from its own
 * rendererless bootstrap. Keeping one list is the point: the per-caller copies
 * drifted, and the cloud copy never had the scheduler at all, which left
 * automations, the goal controller and the learn host permanently unstarted
 * there — and, because a missing scheduler makes its activity counters
 * unreadable, also pinned the instance to `activity-unknown` so it could never
 * be considered idle enough to auto-update.
 *
 * Each entry is isolated: one damaged configuration must not keep the other
 * transports, or the rest of readiness startup, from coming up.
 */
export function startAccountReadinessConsumers(
  ownerId: string,
  deps: AccountIntegrationStartupDeps,
): boolean {
  // Readiness performs other asynchronous account initialization before it
  // reaches this point. Logout or account replacement can finish while one of
  // those awaits is pending, so reject the stale callback before it can bring
  // an old owner's *inbound* transports back online.
  const ownerCurrent = deps.isOwnerCurrent(ownerId);

  // Two tiers, deliberately. Inbound ingress is gated on the owner still being
  // current, because reviving it would accept traffic for an account that has
  // already gone away. The hosts below re-read live state and carry their own
  // generation fences, so they stay outside that gate: narrowing them to it
  // would drop a start that a same-owner rollover still depends on.
  const consumers = [
    ...(ownerCurrent
      ? ([
          ['hook-control', deps.startHookControlAccount],
          ['feishu-im', deps.startImConnection],
        ] as const)
      : []),
    ['scheduler', deps.startScheduler],
    ['embedding-host', deps.startEmbeddingHost],
  ] as const;

  for (const [name, start] of consumers) {
    try {
      start();
    } catch (err) {
      deps.log.warn(`${name} activation after owner DB ready failed (non-fatal)`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return ownerCurrent;
}

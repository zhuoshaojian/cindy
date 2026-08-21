import type { RehydratePlan } from '@/device-link/topicRegistry';

export interface PeerLinkRecoveryPlan extends RehydratePlan {
  /** Recovery-only opens must succeed before subscriptions or snapshots replay. */
  requireOpenSuccessBeforeReplay?: boolean;
}

export interface PreparePeerLinkRecoveryPlansInput {
  plans: readonly RehydratePlan[];
  recoveryRequiredDeviceIds: ReadonlySet<string>;
  isLinkReady(deviceId: string): boolean;
  hasReliableTransport(deviceId: string): boolean;
  hasPendingRequestsTo(deviceId: string): boolean;
  isOutboundExplicitlyClosed(deviceId: string): boolean;
  isRevoked(deviceId: string): boolean;
  isSuppressed(deviceId: string): boolean;
  isAvailable(deviceId: string): boolean;
}

export interface PreparedPeerLinkRecoveryPlans {
  plans: PeerLinkRecoveryPlan[];
  clearRecoveryDeviceIds: string[];
}

export function isPeerLinkRecoveryEligible(input: {
  isOnline: boolean;
  backgroundReleaseInFlight: boolean;
  isOutboundExplicitlyClosed: boolean;
  isRevoked: boolean;
  isSuppressed: boolean;
  isAvailable: boolean;
  hasRegistryIntent: boolean;
  hasPendingRequest: boolean;
  isUnresponsive: boolean;
}): boolean {
  return input.isOnline
    && !input.backgroundReleaseInFlight
    && !input.isOutboundExplicitlyClosed
    && !input.isRevoked
    && !input.isSuppressed
    && input.isAvailable
    && (
      input.hasRegistryIntent
      || input.hasPendingRequest
      || input.isUnresponsive
    );
}

export interface PeerLinkRecoveryRetryQueueOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry(deviceId: string): void;
}

interface PeerLinkRecoveryRunState {
  inFlight: Promise<void>;
  rerun: boolean;
  runPass: () => Promise<void>;
}

/** Reference-counted business requests retained across a relay reconnect. */
export class PendingPeerRequestTracker {
  private readonly counts = new Map<string, number>();
  private generation = 0;

  begin(deviceId: string): () => void {
    this.counts.set(deviceId, (this.counts.get(deviceId) ?? 0) + 1);
    const generation = this.generation;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (generation !== this.generation) return;
      const next = (this.counts.get(deviceId) ?? 1) - 1;
      if (next > 0) this.counts.set(deviceId, next);
      else this.counts.delete(deviceId);
    };
  }

  has(deviceId: string): boolean {
    return this.counts.has(deviceId);
  }

  deviceIds(): string[] {
    return [...this.counts.keys()];
  }

  clear(): void {
    this.generation += 1;
    this.counts.clear();
  }
}

/**
 * Register a newly-started business request and immediately kick the smallest
 * possible recovery when the shared relay socket is online but this peer's
 * link generation is not ready yet. Eligibility is deliberately rechecked by
 * the recovery pass; this trigger never creates durable open-link ownership.
 */
export function beginPendingPeerRequestWithRecovery(input: {
  tracker: PendingPeerRequestTracker;
  recoveryRequiredDeviceIds: Set<string>;
  deviceId: string;
  isOnline: boolean;
  hasReliableTransport: boolean;
  isLinkReady: boolean;
  recover(deviceId: string): void;
}): () => void {
  const release = input.tracker.begin(input.deviceId);
  if (
    input.isOnline
    && input.hasReliableTransport
    && !input.isLinkReady
  ) {
    markPeerLinkRecoveryRequired(
      input.recoveryRequiredDeviceIds,
      input.deviceId,
    );
    input.recover(input.deviceId);
  }
  return release;
}

/**
 * Single-flight is scoped to one peer. A slow or wedged peer must never hold
 * the recovery pass for another peer that shares the same relay socket.
 */
export class PeerLinkRecoverySingleFlight {
  private readonly states = new Map<string, PeerLinkRecoveryRunState>();

  run(deviceId: string, runPass: () => Promise<void>): Promise<void> {
    const existing = this.states.get(deviceId);
    if (existing) {
      existing.rerun = true;
      existing.runPass = runPass;
      return existing.inFlight;
    }

    const state: PeerLinkRecoveryRunState = {
      inFlight: Promise.resolve(),
      rerun: false,
      runPass,
    };
    let run!: Promise<void>;
    run = (async () => {
      try {
        do {
          state.rerun = false;
          await state.runPass();
        } while (state.rerun);
      } finally {
        if (this.states.get(deviceId) === state) this.states.delete(deviceId);
      }
    })();
    state.inFlight = run;
    this.states.set(deviceId, state);
    return run;
  }

  clear(): void {
    this.states.clear();
  }
}

/** Run distinct peers concurrently without creating an unbounded reconnect burst. */
export async function runPeerRecoveriesWithConcurrency(
  deviceIds: Iterable<string>,
  runPeer: (deviceId: string) => Promise<void>,
  concurrency = 3,
): Promise<void> {
  const pending = [...new Set(deviceIds)];
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const deviceId = pending[cursor];
      cursor += 1;
      await runPeer(deviceId);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), pending.length) },
      worker,
    ),
  );
}

export function collectPeerRecoveryDeviceIds(input: {
  plans: readonly RehydratePlan[];
  recoveryRequiredDeviceIds: Iterable<string>;
  unresponsiveDeviceIds: Iterable<string>;
  pendingRequestDeviceIds: Iterable<string>;
}): string[] {
  return [...new Set([
    ...input.plans.map((plan) => plan.deviceId),
    ...input.recoveryRequiredDeviceIds,
    ...input.unresponsiveDeviceIds,
    ...input.pendingRequestDeviceIds,
  ])];
}

interface PeerLinkRecoveryRetryEntry {
  timer: ReturnType<typeof setTimeout> | null;
  attempt: number;
}

/** Per-peer capped backoff: one unhealthy peer never delays another peer. */
export class PeerLinkRecoveryRetryQueue {
  private readonly entries = new Map<string, PeerLinkRecoveryRetryEntry>();
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly onRetry: (deviceId: string) => void;

  constructor(options: PeerLinkRecoveryRetryQueueOptions) {
    this.baseDelayMs = options.baseDelayMs ?? 2_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.onRetry = options.onRetry;
  }

  update(
    failedDeviceIds: ReadonlySet<string>,
    processedDeviceIds: ReadonlySet<string>,
  ): void {
    for (const deviceId of processedDeviceIds) {
      if (!failedDeviceIds.has(deviceId)) this.clear([deviceId]);
    }
    for (const deviceId of failedDeviceIds) this.schedule(deviceId);
  }

  clear(deviceIds?: Iterable<string>): void {
    const targets = deviceIds ? [...deviceIds] : [...this.entries.keys()];
    for (const deviceId of targets) {
      const entry = this.entries.get(deviceId);
      if (!entry) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.entries.delete(deviceId);
    }
  }

  private schedule(deviceId: string): void {
    const entry = this.entries.get(deviceId) ?? { timer: null, attempt: 0 };
    if (entry.timer) clearTimeout(entry.timer);
    const delay = Math.min(
      this.baseDelayMs * 2 ** entry.attempt,
      this.maxDelayMs,
    );
    entry.attempt += 1;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.onRetry(deviceId);
    }, delay);
    this.entries.set(deviceId, entry);
  }
}

export function selectRehydratePlansForDevices(
  plans: readonly RehydratePlan[],
  deviceIds: ReadonlySet<string> | null,
): RehydratePlan[] {
  return deviceIds
    ? plans.filter((plan) => deviceIds.has(plan.deviceId))
    : [...plans];
}

export function markPeerLinkRecoveryRequired(
  recoveryRequiredDeviceIds: Set<string>,
  deviceId: string,
): void {
  if (deviceId) recoveryRequiredDeviceIds.add(deviceId);
}

export function updatePeerLinkRecoveryOnLinkClose(
  recoveryRequiredDeviceIds: Set<string>,
  deviceId: string,
  reason: string | undefined,
): boolean {
  if (reason === 'transport-timeout') {
    markPeerLinkRecoveryRequired(recoveryRequiredDeviceIds, deviceId);
    return true;
  }
  recoveryRequiredDeviceIds.delete(deviceId);
  return false;
}

export function markMissingPeerLinksForRecovery(
  plans: readonly RehydratePlan[],
  recoveryRequiredDeviceIds: Set<string>,
  isLinkReady: (deviceId: string) => boolean,
): void {
  for (const plan of plans) {
    if (
      (plan.openLink || plan.topics.length > 0)
      && !isLinkReady(plan.deviceId)
    ) {
      markPeerLinkRecoveryRequired(recoveryRequiredDeviceIds, plan.deviceId);
    }
  }
}

/**
 * Merge transient peer-link recovery with the durable topic registry without
 * mutating that registry. A recovery-only open therefore never becomes a
 * persistent user control intent.
 */
export function preparePeerLinkRecoveryPlans(
  input: PreparePeerLinkRecoveryPlansInput,
): PreparedPeerLinkRecoveryPlans {
  const byDevice = new Map(input.plans.map((plan) => [plan.deviceId, plan]));
  const deviceIds = new Set<string>([
    ...byDevice.keys(),
    ...input.recoveryRequiredDeviceIds,
  ]);
  const plans: PeerLinkRecoveryPlan[] = [];
  const clearRecoveryDeviceIds: string[] = [];

  for (const deviceId of [...deviceIds].sort()) {
    const plan = byDevice.get(deviceId);
    const hasPendingRequest = input.hasPendingRequestsTo(deviceId);
    const hasRegistryIntent = Boolean(plan && (plan.openLink || plan.topics.length > 0));
    const hasReliablePendingRequest = hasPendingRequest
      && input.hasReliableTransport(deviceId);
    const hasRecoveryIntent = hasRegistryIntent || hasReliablePendingRequest;
    const recoveryRequired = input.recoveryRequiredDeviceIds.has(deviceId);
    const linkReady = input.isLinkReady(deviceId);
    const explicitlyClosed = input.isOutboundExplicitlyClosed(deviceId);
    const revoked = input.isRevoked(deviceId);
    const suppressed = input.isSuppressed(deviceId);

    // linkReady only proves the transport handshake completed. A recovery open
    // can still have settled in a stale presence epoch before its generation was
    // published, so keep the marker until the success callback clears it.
    if (
      recoveryRequired
      && (!hasRecoveryIntent || explicitlyClosed || revoked || suppressed)
    ) {
      clearRecoveryDeviceIds.push(deviceId);
    }

    // Keep the existing fail-closed availability gates. An offline peer keeps
    // its transient recovery marker so a later authoritative recovery edge can
    // retry; revoked/permanently closed peers are cleared above and stop here.
    if (explicitlyClosed || revoked || suppressed || !input.isAvailable(deviceId)) continue;
    if (!plan && !hasReliablePendingRequest) continue;

    const basePlan: RehydratePlan = plan ?? {
      deviceId,
      openLink: false,
      topics: [],
    };
    // explicitlyClosed already exits via the availability gate above, so it
    // can never be true for a plan that reaches this push.
    const forceRecoveryOpen = (recoveryRequired || !linkReady) && hasRecoveryIntent;

    plans.push({
      ...basePlan,
      // A socket generation can be new even when no before-link frame arrived.
      // Any still-owned topic or in-flight business request then needs a fresh
      // peer handshake before replay.
      openLink: basePlan.openLink || forceRecoveryOpen,
      ...(forceRecoveryOpen ? { requireOpenSuccessBeforeReplay: true } : {}),
    });
  }

  return { plans, clearRecoveryDeviceIds };
}

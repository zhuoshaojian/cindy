/** Activity signals required before a cloud instance may be considered idle. */
export interface CloudActivitySnapshot {
  observedAtMs: number;
  activeTurns: number | null;
  pendingInputs: number | null;
  pendingInteractions: number | null;
  schedulerInFlight: number | null;
  schedulerWaiting: number | null;
  /** `undefined` means unknown, `null` means no scheduled wake. */
  schedulerNextWakeAtMs: number | null | undefined;
  deviceLinkControllers: number | null;
  deviceLinkSubscriptions: number | null;
  embeddingJobs: number | null;
  keepAwake: boolean | null;
}

export type CloudIdleBlocker =
  | 'activity-unknown'
  | 'activity-stale'
  | 'runtime-not-ready'
  | 'active-turn'
  | 'pending-input'
  | 'pending-interaction'
  | 'scheduler-in-flight'
  | 'scheduler-waiting'
  | 'scheduler-next-wake'
  | 'device-link-controller'
  | 'device-link-subscription'
  | 'embedding-active'
  | 'keep-awake'
  | 'idle-grace';

export const CLOUD_IDLE_BLOCKERS = [
  'activity-unknown',
  'activity-stale',
  'runtime-not-ready',
  'active-turn',
  'pending-input',
  'pending-interaction',
  'scheduler-in-flight',
  'scheduler-waiting',
  'scheduler-next-wake',
  'device-link-controller',
  'device-link-subscription',
  'embedding-active',
  'keep-awake',
  'idle-grace',
] as const satisfies readonly CloudIdleBlocker[];

export interface CloudIdlePolicy {
  staleAfterMs: number;
  idleAfterMs: number;
  schedulerWakeGuardMs: number;
}

export interface CloudIdleAssessment {
  maySuspend: boolean;
  blockers: CloudIdleBlocker[];
  assessedAtMs: number;
  lastBusyAtMs: number;
  nextWakeAtMs: number | null;
}

const COUNT_KEYS = [
  ['activeTurns', 'active-turn'],
  ['pendingInputs', 'pending-input'],
  ['pendingInteractions', 'pending-interaction'],
  ['schedulerInFlight', 'scheduler-in-flight'],
  ['schedulerWaiting', 'scheduler-waiting'],
  ['deviceLinkControllers', 'device-link-controller'],
  ['deviceLinkSubscriptions', 'device-link-subscription'],
  ['embeddingJobs', 'embedding-active'],
] as const satisfies ReadonlyArray<
  readonly [
    Exclude<keyof CloudActivitySnapshot, 'observedAtMs' | 'schedulerNextWakeAtMs' | 'keepAwake'>,
    CloudIdleBlocker,
  ]
>;

function isKnownCount(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 0;
}

/**
 * Fail-closed idle policy. Any stale, missing, malformed, or active signal
 * prevents suspension; a near scheduler wake is also treated as activity.
 */
export function evaluateCloudIdle(
  snapshot: CloudActivitySnapshot,
  options: {
    nowMs: number;
    lastBusyAtMs: number;
    policy: CloudIdlePolicy;
  },
): CloudIdleAssessment {
  const blockers: CloudIdleBlocker[] = [];
  let hasUnknown = false;

  if (
    !Number.isFinite(snapshot.observedAtMs) ||
    snapshot.observedAtMs > options.nowMs ||
    options.nowMs - snapshot.observedAtMs > options.policy.staleAfterMs
  ) {
    blockers.push('activity-stale');
  }

  for (const [key, blocker] of COUNT_KEYS) {
    const value = snapshot[key];
    if (!isKnownCount(value)) {
      hasUnknown = true;
    } else if (value > 0) {
      blockers.push(blocker);
    }
  }

  if (snapshot.keepAwake !== true && snapshot.keepAwake !== false) {
    hasUnknown = true;
  } else if (snapshot.keepAwake) {
    blockers.push('keep-awake');
  }

  let nextWakeAtMs: number | null = null;
  if (snapshot.schedulerNextWakeAtMs === undefined) {
    hasUnknown = true;
  } else if (snapshot.schedulerNextWakeAtMs !== null) {
    if (!Number.isFinite(snapshot.schedulerNextWakeAtMs)) {
      hasUnknown = true;
    } else {
      nextWakeAtMs = snapshot.schedulerNextWakeAtMs;
      if (nextWakeAtMs <= options.nowMs + options.policy.schedulerWakeGuardMs) {
        blockers.push('scheduler-next-wake');
      }
    }
  }

  if (hasUnknown) blockers.unshift('activity-unknown');
  const currentWorkBlocker = blockers.length > 0;
  const lastBusyAtMs = currentWorkBlocker ? options.nowMs : options.lastBusyAtMs;
  if (
    blockers.length === 0 &&
    (!Number.isFinite(lastBusyAtMs) || options.nowMs - lastBusyAtMs < options.policy.idleAfterMs)
  ) {
    blockers.push('idle-grace');
  }

  return {
    maySuspend: blockers.length === 0,
    blockers,
    assessedAtMs: options.nowMs,
    lastBusyAtMs,
    nextWakeAtMs,
  };
}

/** A collector failure is represented explicitly so policy remains fail-closed. */
export function unknownCloudActivity(observedAtMs: number): CloudActivitySnapshot {
  return {
    observedAtMs,
    activeTurns: null,
    pendingInputs: null,
    pendingInteractions: null,
    schedulerInFlight: null,
    schedulerWaiting: null,
    schedulerNextWakeAtMs: undefined,
    deviceLinkControllers: null,
    deviceLinkSubscriptions: null,
    embeddingJobs: null,
    keepAwake: null,
  };
}

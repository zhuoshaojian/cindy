import type { CloudReadinessComponents, CloudStatusReadResult } from './status.js';

export type CloudReadinessReason =
  'ready' | 'missing-status' | 'corrupt-status' | 'stale-heartbeat' | 'runtime-not-ready';

export interface CloudReadinessAssessment {
  ready: boolean;
  reason: CloudReadinessReason;
  notReadyComponents: Array<keyof CloudReadinessComponents>;
}

/** Probe assessment: missing/corrupt/stale state always fails closed. */
export function evaluateCloudReadiness(
  result: CloudStatusReadResult,
  options: { nowMs: number; staleAfterMs: number },
): CloudReadinessAssessment {
  if (result.kind === 'missing') {
    return { ready: false, reason: 'missing-status', notReadyComponents: [] };
  }
  if (result.kind === 'corrupt') {
    return { ready: false, reason: 'corrupt-status', notReadyComponents: [] };
  }
  if (
    result.status.heartbeatAtMs > options.nowMs ||
    options.nowMs - result.status.heartbeatAtMs > options.staleAfterMs
  ) {
    return { ready: false, reason: 'stale-heartbeat', notReadyComponents: [] };
  }
  const notReadyComponents = (
    Object.entries(result.status.readiness) as Array<
      [keyof CloudReadinessComponents, CloudReadinessComponents[keyof CloudReadinessComponents]]
    >
  )
    .filter(([, value]) => value !== 'ready')
    .map(([key]) => key);
  if (result.status.phase !== 'ready' || notReadyComponents.length > 0) {
    return { ready: false, reason: 'runtime-not-ready', notReadyComponents };
  }
  return { ready: true, reason: 'ready', notReadyComponents: [] };
}

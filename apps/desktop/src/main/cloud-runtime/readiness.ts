import {
  CLOUD_BLOCKING_READINESS_COMPONENTS,
  type CloudBlockingReadinessComponent,
  type CloudStatusReadResult,
} from './status.js';
import type { CloudInstanceReadinessReason } from '../../shared/cloudInstanceIpc.js';

/** Runtime-local assessment is always concrete; `unknown` only exists before a control-plane observation. */
export type CloudReadinessReason = Exclude<CloudInstanceReadinessReason, 'unknown'>;

export interface CloudReadinessAssessment {
  ready: boolean;
  reason: CloudReadinessReason;
  notReadyComponents: CloudBlockingReadinessComponent[];
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
  const notReadyComponents = CLOUD_BLOCKING_READINESS_COMPONENTS.filter(
    (component) => result.status.readiness[component] !== 'ready',
  );
  if (result.status.phase !== 'ready' || notReadyComponents.length > 0) {
    return { ready: false, reason: 'runtime-not-ready', notReadyComponents };
  }
  return { ready: true, reason: 'ready', notReadyComponents: [] };
}

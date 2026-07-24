import type { ModelAccessStatus } from '../../shared/modelAccess.js';
import type { CloudReadinessComponents } from './status.js';

/**
 * Maps the existing credentials-sync state machine into the cloud status
 * observation. This value never participates in Pod phase, health, or idle
 * suspension gates.
 */
export function modelAccessReadiness(
  status: ModelAccessStatus,
): CloudReadinessComponents['modelAccess'] {
  switch (status.state) {
    case 'ok':
      return 'ready';
    case 'unsupported':
      return 'not-ready';
    case 'failed':
      // A temporarily unreachable service is not evidence that the Pod runtime
      // itself is misconfigured. Keep it observable without declaring a hard
      // model-access failure; exact codes remain in credentialsSync status/logs.
      return ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'GATEWAY_ERROR'].includes(
        status.errorCode ?? '',
      )
        ? 'unknown'
        : 'not-ready';
    case 'idle':
    case 'syncing':
    case 'disabled':
      return 'unknown';
  }
}

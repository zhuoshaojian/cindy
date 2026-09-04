import {
  MODEL_ACCESS_PERSISTENT_FAILURE_THRESHOLD,
  type ModelAccessStatus,
} from '../../shared/modelAccess.js';
import type { CloudReadinessComponents } from './status.js';

/**
 * 「仍在重试」是否已经久到该被当成持续故障。Pod 的退避永不耗尽,所以不能等
 * `failed`——那个状态在 Pod 里不可达。
 */
function isPersistentFailure(status: ModelAccessStatus): boolean {
  return (status.consecutiveFailures ?? 0) >= MODEL_ACCESS_PERSISTENT_FAILURE_THRESHOLD;
}

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
    case 'syncing':
      // 重试够久就不再是「还没结果」。少了这一条,Pod 里任何持续故障都永远显示
      // `unknown`(退避不耗尽 ⇒ 到不了 `failed`),控制面分不清刚启动与彻底坏掉。
      // 到这一步错误码只用于诊断,不再参与 ready/not-ready 判定。
      return isPersistentFailure(status) ? 'not-ready' : 'unknown';
    case 'idle':
    case 'disabled':
      return 'unknown';
  }
}

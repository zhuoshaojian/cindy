import { describe, expect, it } from 'vitest';
import { modelAccessReadiness } from '../cloud-runtime/model-access.js';
import { evaluateCloudReadiness } from '../cloud-runtime/readiness.js';
import {
  CLOUD_BLOCKING_READINESS_COMPONENTS,
  type CloudRuntimeStatus,
} from '../cloud-runtime/status.js';
import {
  MODEL_ACCESS_PERSISTENT_FAILURE_THRESHOLD,
  type ModelAccessStatus,
} from '../../shared/modelAccess.js';

function status(state: ModelAccessStatus['state']): ModelAccessStatus {
  // accountTier 只服务展示层的用户级身份，不参与 Pod 的 observation-only 判定，
  // 因此这些用例固定给 null。
  return { state, source: null, endpoint: null, accountTier: null };
}

describe('cloud runtime model-access observation', () => {
  it.each([
    ['ok', 'ready'],
    ['failed', 'not-ready'],
    ['unsupported', 'not-ready'],
    ['idle', 'unknown'],
    ['syncing', 'unknown'],
    ['disabled', 'unknown'],
  ] as const)('maps credentialsSync %s to %s', (state, expected) => {
    expect(modelAccessReadiness(status(state))).toBe(expected);
  });

  it.each(['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'GATEWAY_ERROR'])(
    'maps transient failed code %s to unknown',
    (errorCode) => {
      expect(modelAccessReadiness({ ...status('failed'), errorCode })).toBe('unknown');
    },
  );

  it.each(['AD_ACCOUNT_MISSING', 'SAFE_STORAGE_UNAVAILABLE', 'INVALID_RESPONSE'])(
    'maps actionable failed code %s to not-ready',
    (errorCode) => {
      expect(modelAccessReadiness({ ...status('failed'), errorCode })).toBe('not-ready');
    },
  );
});

/**
 * Pod 的退避永不耗尽,`failed` 因此不可达:没有持续性判据,任何长期故障都永远显示
 * `unknown`,控制面分不清「刚启动」与「彻底坏掉」。这组锁住那个判据。
 */
describe('cloud runtime model-access persistent-failure observation', () => {
  it.each([1, MODEL_ACCESS_PERSISTENT_FAILURE_THRESHOLD - 1])(
    'still reports unknown while only %i consecutive failures have accrued',
    (consecutiveFailures) => {
      expect(
        modelAccessReadiness({
          ...status('syncing'),
          errorCode: 'GATEWAY_ERROR',
          consecutiveFailures,
        }),
      ).toBe('unknown');
    },
  );

  it.each([
    MODEL_ACCESS_PERSISTENT_FAILURE_THRESHOLD,
    MODEL_ACCESS_PERSISTENT_FAILURE_THRESHOLD + 6,
  ])('reports not-ready once %i consecutive failures make it persistent', (consecutiveFailures) => {
    expect(
      modelAccessReadiness({ ...status('syncing'), consecutiveFailures }),
    ).toBe('not-ready');
  });

  // 这条是本次修复的核心:GATEWAY_ERROR 在 `failed` 分支被当作「临时不可达」→ unknown,
  // 持续重试下**不得**沿用那个结论,否则假 key / 网关长期不可用永远看不见。
  it.each(['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'GATEWAY_ERROR'])(
    'does not let transient code %s mask a persistent retry loop',
    (errorCode) => {
      expect(
        modelAccessReadiness({
          ...status('syncing'),
          errorCode,
          consecutiveFailures: MODEL_ACCESS_PERSISTENT_FAILURE_THRESHOLD,
        }),
      ).toBe('not-ready');
    },
  );

  it('keeps model-access out of the blocking readiness set', () => {
    expect(CLOUD_BLOCKING_READINESS_COMPONENTS).not.toContain('modelAccess');
  });

  it('stays ready with no blockers while model-access is not-ready', () => {
    const nowMs = 1_700_000_000_000;
    const runtimeStatus: CloudRuntimeStatus = {
      version: 1,
      instanceId: 'cloud-instance-test',
      membershipId: 'membership-test',
      phase: 'ready',
      startedAtMs: nowMs - 60_000,
      heartbeatAtMs: nowMs,
      draining: false,
      readiness: {
        auth: 'ready',
        database: 'ready',
        binaries: 'ready',
        maker: 'ready',
        deviceLink: 'ready',
        modelAccess: 'not-ready',
      },
      idle: { maySuspend: false, blockers: [], lastBusyAtMs: nowMs, nextWakeAtMs: null },
    };

    expect(
      evaluateCloudReadiness({ kind: 'ok', status: runtimeStatus }, { nowMs, staleAfterMs: 90_000 }),
    ).toEqual({ ready: true, reason: 'ready', notReadyComponents: [] });
  });
});

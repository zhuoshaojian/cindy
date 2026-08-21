import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginPendingPeerRequestWithRecovery,
  collectPeerRecoveryDeviceIds,
  isPeerLinkRecoveryEligible,
  markMissingPeerLinksForRecovery,
  markPeerLinkRecoveryRequired,
  PendingPeerRequestTracker,
  PeerLinkRecoveryRetryQueue,
  PeerLinkRecoverySingleFlight,
  preparePeerLinkRecoveryPlans,
  runPeerRecoveriesWithConcurrency,
  selectRehydratePlansForDevices,
  updatePeerLinkRecoveryOnLinkClose,
} from '@/device-link/peerLinkRecovery';
import {
  DeviceLinkTopicRegistry,
  type RehydratePlan,
} from '@/device-link/topicRegistry';
import { rehydrateDeviceLinkTopics } from '@/device-link/rehydrate';
import {
  createPresenceAvailabilityEpochs,
  getOrCreatePresenceTrackedRequest,
  isPresenceAvailabilityEpochCurrent,
  markPresenceAvailabilityEpoch,
  type PresenceTrackedRequest,
} from '@/device-link/presenceRecovery';

function prepare(input: Partial<Parameters<typeof preparePeerLinkRecoveryPlans>[0]> = {}) {
  return preparePeerLinkRecoveryPlans({
    plans: [],
    recoveryRequiredDeviceIds: new Set(),
    isLinkReady: () => false,
    hasReliableTransport: () => true,
    hasPendingRequestsTo: () => false,
    isOutboundExplicitlyClosed: () => false,
    isRevoked: () => false,
    isSuppressed: () => false,
    isAvailable: () => true,
    ...input,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('preparePeerLinkRecoveryPlans', () => {
  it('forces open before subscribe for a before-link peer with topic intent', () => {
    const registry = new DeviceLinkTopicRegistry();
    registry.trackSubscribe('home', 'peer-a', ['sessions']);

    const result = prepare({
      plans: registry.snapshot(),
      recoveryRequiredDeviceIds: new Set(['peer-a']),
    });

    expect(result.plans).toEqual([{
      deviceId: 'peer-a',
      openLink: true,
      topics: ['sessions'],
      requireOpenSuccessBeforeReplay: true,
    }]);
    // Recovery is transient state, not durable user open-link ownership.
    expect(registry.snapshot()).toEqual([{
      deviceId: 'peer-a',
      openLink: false,
      topics: ['sessions'],
    }]);
  });

  it('does not upgrade a cold-start legacy listing into a control link', () => {
    expect(prepare({
      recoveryRequiredDeviceIds: new Set(['peer-a']),
      hasPendingRequestsTo: () => true,
      hasReliableTransport: () => false,
    })).toEqual({
      plans: [],
      clearRecoveryDeviceIds: ['peer-a'],
    });
  });

  it('creates a recovery-only plan for a reliable pending request without registry state', () => {
    const hasPendingRequestsTo = vi.fn((deviceId: string) => deviceId === 'peer-a');

    expect(prepare({
      recoveryRequiredDeviceIds: new Set(['peer-a']),
      hasPendingRequestsTo,
      hasReliableTransport: () => true,
    }).plans).toEqual([{
      deviceId: 'peer-a',
      openLink: true,
      topics: [],
      requireOpenSuccessBeforeReplay: true,
    }]);
    expect(hasPendingRequestsTo).toHaveBeenCalledWith('peer-a');
  });

  it('recovers a missing peer generation on socket reconnect without waiting for a frame', () => {
    expect(prepare({
      plans: [{ deviceId: 'peer-a', openLink: false, topics: ['sessions'] }],
      recoveryRequiredDeviceIds: new Set(),
      isLinkReady: () => false,
    }).plans[0]).toMatchObject({
      deviceId: 'peer-a',
      openLink: true,
      requireOpenSuccessBeforeReplay: true,
    });
  });

  it.each([
    ['explicit close', { isOutboundExplicitlyClosed: () => true }],
    ['revoked', { isRevoked: () => true }],
    ['permanent close', { isSuppressed: () => true }],
  ] as const)('does not reopen after %s', (_label, gate) => {
    const result = prepare({
      plans: [{ deviceId: 'peer-a', openLink: false, topics: ['sessions'] }],
      recoveryRequiredDeviceIds: new Set(['peer-a']),
      ...gate,
    });

    expect(result.plans).toEqual([]);
    expect(result.clearRecoveryDeviceIds).toEqual(['peer-a']);
  });

  it('keeps an offline recovery marker dormant until availability returns', () => {
    const result = prepare({
      plans: [{ deviceId: 'peer-a', openLink: false, topics: ['sessions'] }],
      recoveryRequiredDeviceIds: new Set(['peer-a']),
      isAvailable: () => false,
    });

    expect(result.plans).toEqual([]);
    expect(result.clearRecoveryDeviceIds).toEqual([]);
  });

  it('keeps a ready recovery marker gated and leaves a healthy second peer untouched', () => {
    const result = prepare({
      plans: [
        { deviceId: 'peer-a', openLink: false, topics: ['sessions'] },
        { deviceId: 'peer-b', openLink: false, topics: ['session:b'] },
      ],
      recoveryRequiredDeviceIds: new Set(['peer-a']),
      isLinkReady: (deviceId) => deviceId === 'peer-a' || deviceId === 'peer-b',
    });

    expect(result.clearRecoveryDeviceIds).toEqual([]);
    expect(result.plans).toEqual([
      {
        deviceId: 'peer-a',
        openLink: true,
        topics: ['sessions'],
        requireOpenSuccessBeforeReplay: true,
      },
      { deviceId: 'peer-b', openLink: false, topics: ['session:b'] },
    ]);
  });

  it('retains a stale successful recovery until a current epoch emits exactly once', async () => {
    const recoveryRequired = new Set(['peer-a']);
    let linkReady = false;
    const presenceEpochs = createPresenceAvailabilityEpochs();
    const responseEvidenceEpochs = createPresenceAvailabilityEpochs();
    const retainedOpen = new Map<string, PresenceTrackedRequest<void>>();
    let resolveFirstOpen!: () => void;
    const firstOpen = new Promise<void>((resolve) => {
      resolveFirstOpen = resolve;
    });
    let openAttempt = 0;
    const calls: string[] = [];
    const onPeerLinkRecovered = vi.fn((deviceId: string) => {
      calls.push(`recovered:${deviceId}`);
      recoveryRequired.delete(deviceId);
    });
    const deps = {
      capturePresenceEpoch: vi.fn(() => presenceEpochs.byDevice.get('peer-a') ?? 0),
      captureResponseEvidenceEpoch: vi.fn(() => 0),
      isPresenceEpochCurrent: vi.fn((deviceId: string, epoch: number) =>
        isPresenceAvailabilityEpochCurrent(presenceEpochs, deviceId, epoch)),
      isResponseEvidenceEpochCurrent: vi.fn(() => true),
      createDeviceSendCohort: vi.fn(() => 1),
      openLink: vi.fn((deviceId: string) => {
        calls.push(`open:${deviceId}`);
        openAttempt += 1;
        return getOrCreatePresenceTrackedRequest(
          retainedOpen,
          presenceEpochs,
          responseEvidenceEpochs,
          deviceId,
          () => (openAttempt === 1 ? firstOpen : Promise.resolve()).then(() => {
            linkReady = true;
          }),
          { retainSuccessful: true },
        );
      }),
      subscribe: vi.fn(async (deviceId: string) => {
        calls.push(`subscribe:${deviceId}`);
      }),
      requestSessionsReseed: vi.fn((deviceId: string) => {
        calls.push(`reseed:${deviceId}`);
      }),
      onPeerLinkRecovered,
      rebuildSessionSnapshot: vi.fn(async () => undefined),
    };
    const preparePass = () => prepare({
      plans: [{ deviceId: 'peer-a', openLink: false, topics: ['sessions'] }],
      recoveryRequiredDeviceIds: recoveryRequired,
      isLinkReady: () => linkReady,
    });

    const stalePass = preparePass();
    const staleRun = rehydrateDeviceLinkTopics(stalePass.plans, deps);
    // Mirrors DeviceLinkContext.onPresenceChanged: advance the authoritative
    // peer epoch and discard only this peer's retained open before it settles.
    markPresenceAvailabilityEpoch(presenceEpochs, 'peer-a');
    retainedOpen.delete('peer-a');
    resolveFirstOpen();
    await staleRun;
    expect(recoveryRequired).toEqual(new Set(['peer-a']));
    expect(onPeerLinkRecovered).not.toHaveBeenCalled();
    expect(calls).toEqual(['open:peer-a']);

    const currentPass = preparePass();
    expect(currentPass.clearRecoveryDeviceIds).toEqual([]);
    expect(currentPass.plans[0]).toMatchObject({
      deviceId: 'peer-a',
      openLink: true,
      requireOpenSuccessBeforeReplay: true,
    });
    await rehydrateDeviceLinkTopics(currentPass.plans, deps);
    expect(onPeerLinkRecovered).toHaveBeenCalledTimes(1);
    expect(recoveryRequired.size).toBe(0);
    expect(calls).toEqual([
      'open:peer-a',
      'open:peer-a',
      'recovered:peer-a',
      'subscribe:peer-a',
      'reseed:peer-a',
    ]);

    const settledPass = preparePass();
    await rehydrateDeviceLinkTopics(settledPass.plans, deps);
    expect(onPeerLinkRecovered).toHaveBeenCalledTimes(1);
    expect(deps.openLink).toHaveBeenCalledTimes(2);
  });
});

describe('peer link recovery triggers', () => {
  it('marks before-link and transport-timeout, but clears permanent close', () => {
    const required = new Set<string>();

    markPeerLinkRecoveryRequired(required, 'peer-a');
    expect(required.has('peer-a')).toBe(true);

    required.clear();
    expect(updatePeerLinkRecoveryOnLinkClose(
      required,
      'peer-a',
      'transport-timeout',
    )).toBe(true);
    expect(required.has('peer-a')).toBe(true);

    expect(updatePeerLinkRecoveryOnLinkClose(required, 'peer-a', 'user')).toBe(false);
    expect(required.has('peer-a')).toBe(false);
  });

  it('marks missing topic generations immediately after socket reconnect', () => {
    const required = new Set<string>();
    markMissingPeerLinksForRecovery(
      [
        { deviceId: 'peer-a', openLink: false, topics: ['sessions'] },
        { deviceId: 'peer-b', openLink: false, topics: ['session:b'] },
      ],
      required,
      (deviceId) => deviceId === 'peer-b',
    );

    expect(required).toEqual(new Set(['peer-a']));
  });

  it('scopes a peer recovery sweep without touching a healthy peer plan', () => {
    const peerB: RehydratePlan = {
      deviceId: 'peer-b',
      openLink: false,
      topics: ['session:b'],
    };
    const scoped = selectRehydratePlansForDevices([
      { deviceId: 'peer-a', openLink: false, topics: ['sessions'] },
      peerB,
    ], new Set(['peer-a']));

    expect(scoped).toEqual([
      { deviceId: 'peer-a', openLink: false, topics: ['sessions'] },
    ]);
    expect(peerB).toEqual({
      deviceId: 'peer-b',
      openLink: false,
      topics: ['session:b'],
    });
  });

  it('includes a pending-only peer in the socket reconnect sweep', () => {
    const pending = new PendingPeerRequestTracker();
    const releaseFirst = pending.begin('peer-pending');
    const releaseSecond = pending.begin('peer-pending');

    expect(collectPeerRecoveryDeviceIds({
      plans: [],
      recoveryRequiredDeviceIds: [],
      unresponsiveDeviceIds: [],
      pendingRequestDeviceIds: pending.deviceIds(),
    })).toEqual(['peer-pending']);
    releaseFirst();
    expect(pending.has('peer-pending')).toBe(true);
    releaseSecond();
    expect(pending.deviceIds()).toEqual([]);
  });

  it('ignores a stale release from before tracker clear', () => {
    const pending = new PendingPeerRequestTracker();
    const releaseOldGeneration = pending.begin('peer-a');
    pending.clear();
    const releaseCurrentGeneration = pending.begin('peer-a');

    releaseOldGeneration();
    expect(pending.has('peer-a')).toBe(true);
    releaseCurrentGeneration();
    expect(pending.has('peer-a')).toBe(false);
  });

  it('immediately starts single-peer recovery for a request begun after socket online', () => {
    const pending = new PendingPeerRequestTracker();
    const required = new Set<string>();
    const recover = vi.fn();

    const release = beginPendingPeerRequestWithRecovery({
      tracker: pending,
      recoveryRequiredDeviceIds: required,
      deviceId: 'peer-provider',
      isOnline: true,
      hasReliableTransport: true,
      isLinkReady: false,
      recover,
    });

    expect(pending.has('peer-provider')).toBe(true);
    expect(required).toEqual(new Set(['peer-provider']));
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith('peer-provider');

    const recoveryPlan = prepare({
      recoveryRequiredDeviceIds: required,
      hasPendingRequestsTo: (deviceId) => pending.has(deviceId),
    }).plans;
    expect(recoveryPlan).toEqual([{
      deviceId: 'peer-provider',
      openLink: true,
      topics: [],
      requireOpenSuccessBeforeReplay: true,
    }]);

    release();
    expect(pending.has('peer-provider')).toBe(false);
  });

  it('does not trigger recovery for an offline socket or an already-ready peer', () => {
    const pending = new PendingPeerRequestTracker();
    const required = new Set<string>();
    const recover = vi.fn();

    const releaseOffline = beginPendingPeerRequestWithRecovery({
      tracker: pending,
      recoveryRequiredDeviceIds: required,
      deviceId: 'peer-offline',
      isOnline: false,
      hasReliableTransport: true,
      isLinkReady: false,
      recover,
    });
    const releaseReady = beginPendingPeerRequestWithRecovery({
      tracker: pending,
      recoveryRequiredDeviceIds: required,
      deviceId: 'peer-ready',
      isOnline: true,
      hasReliableTransport: true,
      isLinkReady: true,
      recover,
    });

    expect(recover).not.toHaveBeenCalled();
    expect(required.size).toBe(0);
    releaseOffline();
    releaseReady();
  });

  it('keeps a cold-start legacy pending request on the plain envelope path', () => {
    const pending = new PendingPeerRequestTracker();
    const required = new Set<string>();
    const recover = vi.fn();

    const release = beginPendingPeerRequestWithRecovery({
      tracker: pending,
      recoveryRequiredDeviceIds: required,
      deviceId: 'peer-legacy',
      isOnline: true,
      hasReliableTransport: false,
      isLinkReady: false,
      recover,
    });

    expect(pending.has('peer-legacy')).toBe(true);
    expect(required.size).toBe(0);
    expect(recover).not.toHaveBeenCalled();
    release();
  });

  it.each([
    ['socket offline', { isOnline: false }],
    ['background release', { backgroundReleaseInFlight: true }],
    ['explicit close', { isOutboundExplicitlyClosed: true }],
    ['revoked', { isRevoked: true }],
    ['permanent close', { isSuppressed: true }],
    ['authoritative offline', { isAvailable: false }],
  ] as const)('blocks an unresponsive probe after %s', (_label, override) => {
    expect(isPeerLinkRecoveryEligible({
      isOnline: true,
      backgroundReleaseInFlight: false,
      isOutboundExplicitlyClosed: false,
      isRevoked: false,
      isSuppressed: false,
      isAvailable: true,
      hasRegistryIntent: false,
      hasPendingRequest: false,
      isUnresponsive: true,
      ...override,
    })).toBe(false);
  });
});

describe('PeerLinkRecoveryRetryQueue', () => {
  it('retries each peer independently and clears only the peer that recovered', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const queue = new PeerLinkRecoveryRetryQueue({ onRetry });

    queue.update(new Set(['peer-a']), new Set(['peer-a', 'peer-b']));
    vi.advanceTimersByTime(2_000);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenLastCalledWith('peer-a');

    // A fails again (next delay 4s); B's first failure still starts at 2s.
    queue.update(new Set(['peer-a']), new Set(['peer-a']));
    queue.update(new Set(['peer-b']), new Set(['peer-b']));
    vi.advanceTimersByTime(2_000);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenLastCalledWith('peer-b');
    vi.advanceTimersByTime(2_000);
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenLastCalledWith('peer-a');

    // A recovery does not cancel or mutate B, and vice versa.
    queue.update(new Set(), new Set(['peer-a']));
    queue.clear();
  });

  it('caps repeated failures at 30 seconds', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const queue = new PeerLinkRecoveryRetryQueue({ onRetry });

    const delays = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [index, delay] of delays.entries()) {
      queue.update(new Set(['peer-a']), new Set(['peer-a']));
      vi.advanceTimersByTime(delay - 1);
      expect(onRetry).toHaveBeenCalledTimes(index);
      vi.advanceTimersByTime(1);
    }

    expect(onRetry).toHaveBeenCalledTimes(6);
    queue.clear();
  });
});

describe('PeerLinkRecoverySingleFlight', () => {
  it('lets peer B recover while peer A remains unresolved', async () => {
    let resolvePeerA!: () => void;
    const peerADeferred = new Promise<void>((resolve) => {
      resolvePeerA = resolve;
    });
    const completed: string[] = [];
    const singleFlight = new PeerLinkRecoverySingleFlight();

    const sweep = runPeerRecoveriesWithConcurrency(
      ['peer-a', 'peer-b'],
      (deviceId) => singleFlight.run(deviceId, async () => {
        if (deviceId === 'peer-a') await peerADeferred;
        completed.push(deviceId);
      }),
      2,
    );

    await vi.waitFor(() => expect(completed).toContain('peer-b'));
    expect(completed).not.toContain('peer-a');

    resolvePeerA();
    await sweep;
    expect(completed).toEqual(['peer-b', 'peer-a']);
  });

  it('coalesces concurrent passes for the same peer and reruns it once', async () => {
    let releaseFirstPass!: () => void;
    const firstPass = new Promise<void>((resolve) => {
      releaseFirstPass = resolve;
    });
    const calls: string[] = [];
    const singleFlight = new PeerLinkRecoverySingleFlight();

    const first = singleFlight.run('peer-a', async () => {
      calls.push('first');
      await firstPass;
    });
    const second = singleFlight.run('peer-a', async () => {
      calls.push('rerun');
    });

    expect(second).toBe(first);
    releaseFirstPass();
    await first;
    expect(calls).toEqual(['first', 'rerun']);
  });

  it('does not let an old pass evict the same peer in a new generation after clear', async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const calls: string[] = [];
    const singleFlight = new PeerLinkRecoverySingleFlight();

    const first = singleFlight.run('peer-a', async () => {
      calls.push('first');
      await firstGate;
    });
    singleFlight.clear();
    const second = singleFlight.run('peer-a', async () => {
      calls.push('second');
      await secondGate;
    });

    releaseFirst();
    await first;
    const third = singleFlight.run('peer-a', async () => {
      calls.push('third-rerun');
    });
    expect(third).toBe(second);

    releaseSecond();
    await second;
    expect(calls).toEqual(['first', 'second', 'third-rerun']);
  });
});

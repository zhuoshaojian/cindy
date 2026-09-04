import { describe, expect, it } from 'vitest';
import {
  evaluateCloudIdle,
  type CloudActivitySnapshot,
  type CloudIdleBlocker,
} from '../cloud-runtime/activity.js';

const NOW = 1_000_000;
const POLICY = {
  staleAfterMs: 30_000,
  idleAfterMs: 60_000,
  schedulerWakeGuardMs: 20_000,
};

function idleSnapshot(): CloudActivitySnapshot {
  return {
    observedAtMs: NOW,
    activeTurns: 0,
    pendingInputs: 0,
    pendingInteractions: 0,
    schedulerInFlight: 0,
    schedulerWaiting: 0,
    schedulerNextWakeAtMs: null,
    deviceLinkControllers: 0,
    deviceLinkSubscriptions: 0,
    embeddingJobs: 0,
    keepAwake: false,
  };
}

describe('cloud runtime idle policy', () => {
  it('allows suspension only after every signal is known and idle beyond grace', () => {
    expect(
      evaluateCloudIdle(idleSnapshot(), {
        nowMs: NOW,
        lastBusyAtMs: NOW - 60_000,
        policy: POLICY,
      }),
    ).toMatchObject({ maySuspend: true, blockers: [], nextWakeAtMs: null });
  });

  const blockers: Array<{
    blocker: CloudIdleBlocker;
    mutate: (snapshot: CloudActivitySnapshot) => void;
  }> = [
    { blocker: 'active-turn', mutate: (s) => void (s.activeTurns = 1) },
    { blocker: 'pending-input', mutate: (s) => void (s.pendingInputs = 1) },
    { blocker: 'pending-interaction', mutate: (s) => void (s.pendingInteractions = 1) },
    { blocker: 'scheduler-in-flight', mutate: (s) => void (s.schedulerInFlight = 1) },
    { blocker: 'scheduler-waiting', mutate: (s) => void (s.schedulerWaiting = 1) },
    {
      blocker: 'scheduler-next-wake',
      mutate: (s) => void (s.schedulerNextWakeAtMs = NOW + 10_000),
    },
    {
      blocker: 'device-link-controller',
      mutate: (s) => void (s.deviceLinkControllers = 1),
    },
    {
      blocker: 'device-link-subscription',
      mutate: (s) => void (s.deviceLinkSubscriptions = 1),
    },
    { blocker: 'embedding-active', mutate: (s) => void (s.embeddingJobs = 1) },
    { blocker: 'keep-awake', mutate: (s) => void (s.keepAwake = true) },
  ];

  for (const { blocker, mutate } of blockers) {
    it(`blocks idle for ${blocker}`, () => {
      const snapshot = idleSnapshot();
      mutate(snapshot);
      const result = evaluateCloudIdle(snapshot, {
        nowMs: NOW,
        lastBusyAtMs: NOW - 60_000,
        policy: POLICY,
      });
      expect(result.maySuspend).toBe(false);
      expect(result.blockers).toContain(blocker);
      expect(result.lastBusyAtMs).toBe(NOW);
    });
  }

  it('fails closed for unknown and stale activity', () => {
    const unknown = idleSnapshot();
    unknown.deviceLinkSubscriptions = null;
    unknown.schedulerNextWakeAtMs = undefined;
    unknown.observedAtMs = NOW - POLICY.staleAfterMs - 1;
    const result = evaluateCloudIdle(unknown, {
      nowMs: NOW,
      lastBusyAtMs: NOW - 60_000,
      policy: POLICY,
    });
    expect(result.maySuspend).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(['activity-unknown', 'activity-stale']));
  });

  it('keeps an idle grace blocker without resetting last busy time', () => {
    const result = evaluateCloudIdle(idleSnapshot(), {
      nowMs: NOW,
      lastBusyAtMs: NOW - 30_000,
      policy: POLICY,
    });
    expect(result).toMatchObject({
      maySuspend: false,
      blockers: ['idle-grace'],
      lastBusyAtMs: NOW - 30_000,
    });
  });
});

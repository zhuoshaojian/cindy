import { describe, expect, it } from 'vitest';
import { collectCloudRuntimeActivity, earliestScheduleWakeAt } from '../cloud-runtime/collector.js';

describe('cloud runtime activity collector', () => {
  it('uses the earliest active automatic schedule as next wake', () => {
    expect(
      earliestScheduleWakeAt([
        { status: 'paused', manual: false, nextFireAt: 10 },
        { status: 'active', manual: true, nextFireAt: 20 },
        { status: 'active', manual: false, nextFireAt: 40 },
        { status: 'active', manual: false, nextFireAt: 30 },
      ]),
    ).toBe(30);
    expect(earliestScheduleWakeAt([])).toBeNull();
  });

  it('collects scheduler, input, device-link, and embedding activity', async () => {
    const snapshot = await collectCloudRuntimeActivity({
      getMaker: () => ({}) as never,
      getInputActivity: () => ({
        activeTurns: 2,
        pendingInputs: 3,
        pendingInteractions: 1,
      }),
      getScheduler: () =>
        ({
          getRuntimeSnapshot: () => ({ inFlight: 1, waitingSchedules: [{ scheduleId: 's1' }] }),
          list: async () => [
            { status: 'active', manual: false, nextFireAt: 8_000 },
            { status: 'active', manual: false, nextFireAt: 7_000 },
          ],
        }) as never,
      getEmbeddingActivity: async () => ({ pendingCount: 4, runningCount: 1 }),
      getDeviceLinkActivity: () => ({ controllers: 1, subscriptions: 2 }),
      getKeepAwake: () => false,
      now: () => 5_000,
    });

    expect(snapshot).toEqual({
      observedAtMs: 5_000,
      activeTurns: 2,
      pendingInputs: 3,
      pendingInteractions: 1,
      schedulerInFlight: 1,
      schedulerWaiting: 1,
      schedulerNextWakeAtMs: 7_000,
      deviceLinkControllers: 1,
      deviceLinkSubscriptions: 2,
      embeddingJobs: 5,
      keepAwake: false,
    });
  });

  it('keeps unavailable runtime dependencies unknown', async () => {
    const snapshot = await collectCloudRuntimeActivity({
      getMaker: () => null,
      getInputActivity: () => ({
        activeTurns: 0,
        pendingInputs: null,
        pendingInteractions: null,
      }),
      getScheduler: () => null,
      getEmbeddingActivity: async () => ({ pendingCount: 0, runningCount: 0 }),
      getDeviceLinkActivity: () => ({ controllers: 0, subscriptions: 0 }),
      getKeepAwake: () => null,
      now: () => 5_000,
    });

    expect(snapshot).toMatchObject({
      activeTurns: null,
      pendingInputs: null,
      pendingInteractions: null,
      schedulerInFlight: null,
      schedulerWaiting: null,
      schedulerNextWakeAtMs: undefined,
      keepAwake: null,
    });
  });
});

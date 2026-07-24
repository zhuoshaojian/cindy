import { describe, expect, it, vi } from 'vitest';
import { createCloudRuntimeController } from '../cloud-runtime/controller.js';
import type { CloudActivitySnapshot } from '../cloud-runtime/activity.js';

function idleActivity(nowMs: number): CloudActivitySnapshot {
  return {
    observedAtMs: nowMs,
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

const READY = {
  auth: 'ready',
  database: 'ready',
  binaries: 'ready',
  maker: 'ready',
  deviceLink: 'ready',
  modelAccess: 'ready',
} as const;

describe('cloud runtime controller', () => {
  it('publishes heartbeat status through injected collectors and store', async () => {
    let nowMs = 100_000;
    const write = vi.fn(async () => undefined);
    const schedule = vi.fn(() => Symbol('timer'));
    const controller = createCloudRuntimeController({
      instanceId: 'pod-controller',
      membershipId: 'membership-controller',
      policy: { staleAfterMs: 10_000, idleAfterMs: 30_000, schedulerWakeGuardMs: 10_000 },
      heartbeatIntervalMs: 5_000,
      collectActivity: async () => idleActivity(nowMs),
      collectReadiness: async () => READY,
      statusStore: { write },
      now: () => nowMs,
      schedule,
      cancelSchedule: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const first = await controller.start();
    expect(first).toMatchObject({
      phase: 'ready',
      heartbeatAtMs: 100_000,
      idle: { maySuspend: false, blockers: ['idle-grace'] },
    });
    expect(write).toHaveBeenCalledWith(first);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 5_000);

    nowMs += 30_000;
    const second = await controller.sampleNow();
    expect(second.idle).toMatchObject({ maySuspend: true, blockers: [] });
    await expect(controller.stop()).resolves.toMatchObject({ phase: 'stopping' });
  });

  it('turns collector errors into degraded fail-closed state', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const controller = createCloudRuntimeController({
      instanceId: 'pod-failure',
      membershipId: 'membership-failure',
      policy: { staleAfterMs: 10_000, idleAfterMs: 0, schedulerWakeGuardMs: 10_000 },
      heartbeatIntervalMs: 5_000,
      collectActivity: async () => {
        throw new Error('collector unavailable');
      },
      collectReadiness: async () => {
        throw new Error('readiness unavailable');
      },
      statusStore: { write: vi.fn(async () => undefined) },
      now: () => 100_000,
      schedule: () => Symbol('timer'),
      cancelSchedule: vi.fn(),
      logger,
    });

    const result = await controller.start();
    expect(result.phase).toBe('degraded');
    expect(result.idle.maySuspend).toBe(false);
    expect(result.idle.blockers).toContain('runtime-not-ready');
    expect(result.idle.blockers).toContain('activity-unknown');
    expect(Object.values(result.readiness)).toEqual(Array(6).fill('unknown'));
    expect(logger.warn).toHaveBeenCalledTimes(2);
    await controller.stop();
  });

  it.each(['unknown', 'not-ready'] as const)(
    'keeps modelAccess=%s observation out of phase and suspend gates',
    async (modelAccess) => {
      const controller = createCloudRuntimeController({
        instanceId: 'pod-model-access-observation',
        membershipId: 'membership-model-access-observation',
        policy: { staleAfterMs: 10_000, idleAfterMs: 0, schedulerWakeGuardMs: 10_000 },
        heartbeatIntervalMs: 5_000,
        collectActivity: async () => idleActivity(100_000),
        collectReadiness: async () => ({ ...READY, modelAccess }),
        statusStore: { write: vi.fn(async () => undefined) },
        now: () => 100_000,
        schedule: () => Symbol('timer'),
        cancelSchedule: vi.fn(),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      const result = await controller.start();
      expect(result.phase).toBe('ready');
      expect(result.idle).toMatchObject({ maySuspend: true, blockers: [] });
      expect(result.readiness.modelAccess).toBe(modelAccess);
      await controller.stop();
    },
  );
});

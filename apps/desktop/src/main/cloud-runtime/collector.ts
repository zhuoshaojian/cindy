import type { Maker } from '@cindy/maker-core';
import type { Scheduler } from '@cindy/maker-scheduler';
import type { CloudActivitySnapshot } from './activity.js';

export interface CloudRuntimeActivityCollectorDeps {
  getMaker: () => Maker | null;
  getInputActivity: () => {
    activeTurns: number;
    pendingInputs: number | null;
    pendingInteractions: number | null;
  };
  getScheduler: () => Scheduler | null;
  getEmbeddingActivity: () => Promise<{ pendingCount: number; runningCount: number }>;
  getDeviceLinkActivity: () => {
    controllers: number;
    subscriptions: number;
  };
  getKeepAwake: () => boolean | null;
  now: () => number;
}

/** Earliest future automatic schedule timestamp, or null when none exists. */
export function earliestScheduleWakeAt(
  schedules: ReadonlyArray<{
    status: string;
    manual: boolean;
    nextFireAt?: number;
  }>,
): number | null {
  let earliest: number | null = null;
  for (const schedule of schedules) {
    if (schedule.status !== 'active' || schedule.manual || !Number.isFinite(schedule.nextFireAt)) {
      continue;
    }
    const nextFireAt = schedule.nextFireAt!;
    if (earliest === null || nextFireAt < earliest) earliest = nextFireAt;
  }
  return earliest;
}

/**
 * Collect an authoritative snapshot for cloud idle policy. Missing subsystems
 * remain unknown so the policy fails closed instead of suspending early.
 */
export async function collectCloudRuntimeActivity(
  deps: CloudRuntimeActivityCollectorDeps,
): Promise<CloudActivitySnapshot> {
  const observedAtMs = deps.now();
  const maker = deps.getMaker();
  const input = deps.getInputActivity();
  const scheduler = deps.getScheduler();
  const schedulerRuntime = scheduler?.getRuntimeSnapshot();
  const schedules = scheduler ? await scheduler.list({ status: 'active' }) : null;
  const embedding = await deps.getEmbeddingActivity();
  const deviceLink = deps.getDeviceLinkActivity();

  return {
    observedAtMs,
    activeTurns: maker === null ? null : input.activeTurns,
    pendingInputs: input.pendingInputs,
    pendingInteractions: input.pendingInteractions,
    schedulerInFlight: schedulerRuntime?.inFlight ?? null,
    schedulerWaiting: schedulerRuntime?.waitingSchedules.length ?? null,
    schedulerNextWakeAtMs: schedules === null ? undefined : earliestScheduleWakeAt(schedules),
    deviceLinkControllers: deviceLink.controllers,
    deviceLinkSubscriptions: deviceLink.subscriptions,
    embeddingJobs: embedding.pendingCount + embedding.runningCount,
    keepAwake: deps.getKeepAwake(),
  };
}

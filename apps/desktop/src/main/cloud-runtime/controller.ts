import {
  evaluateCloudIdle,
  unknownCloudActivity,
  type CloudActivitySnapshot,
  type CloudIdlePolicy,
} from './activity.js';
import type { CloudReadinessComponents, CloudRuntimeStatus, CloudStatusStore } from './status.js';

export interface CloudRuntimeLogger {
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

export interface CloudRuntimeControllerDeps {
  instanceId: string;
  membershipId: string;
  policy: CloudIdlePolicy;
  heartbeatIntervalMs: number;
  collectActivity: () => Promise<CloudActivitySnapshot>;
  collectReadiness: () => Promise<CloudReadinessComponents>;
  statusStore: Pick<CloudStatusStore, 'write'>;
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancelSchedule: (handle: unknown) => void;
  logger: CloudRuntimeLogger;
}

export interface CloudRuntimeController {
  start(): Promise<CloudRuntimeStatus>;
  sampleNow(): Promise<CloudRuntimeStatus>;
  stop(): Promise<CloudRuntimeStatus>;
  getLastStatus(): CloudRuntimeStatus | null;
}

const UNKNOWN_READINESS: CloudReadinessComponents = {
  auth: 'unknown',
  database: 'unknown',
  binaries: 'unknown',
  maker: 'unknown',
  deviceLink: 'unknown',
};

/**
 * Dependency-injected heartbeat controller. It does not own process exit or
 * lifecycle wiring; bootstrap/control-plane integration can consume the status
 * seam after all concrete activity collectors are available.
 */
export function createCloudRuntimeController(
  deps: CloudRuntimeControllerDeps,
): CloudRuntimeController {
  const startedAtMs = deps.now();
  let lastBusyAtMs = startedAtMs;
  let lastStatus: CloudRuntimeStatus | null = null;
  let timer: unknown = null;
  let stopped = false;
  let inFlight: Promise<CloudRuntimeStatus> | null = null;

  const scheduleNext = (): void => {
    if (stopped || timer !== null) return;
    timer = deps.schedule(() => {
      timer = null;
      void sampleNow().catch((error) => {
        deps.logger.error('cloud runtime heartbeat failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        scheduleNext();
      });
    }, deps.heartbeatIntervalMs);
  };

  const collect = async (): Promise<CloudRuntimeStatus> => {
    const nowMs = deps.now();
    let activity: CloudActivitySnapshot;
    let activityFailed = false;
    try {
      activity = await deps.collectActivity();
    } catch (error) {
      activityFailed = true;
      activity = unknownCloudActivity(nowMs);
      deps.logger.warn('cloud runtime activity collection failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let readiness: CloudReadinessComponents;
    try {
      readiness = await deps.collectReadiness();
    } catch (error) {
      readiness = UNKNOWN_READINESS;
      deps.logger.warn('cloud runtime readiness collection failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const idle = evaluateCloudIdle(activity, {
      nowMs,
      lastBusyAtMs,
      policy: deps.policy,
    });
    lastBusyAtMs = idle.lastBusyAtMs;
    const allReady = Object.values(readiness).every((value) => value === 'ready');
    const statusBlockers = allReady
      ? idle.blockers
      : Array.from(new Set(['runtime-not-ready' as const, ...idle.blockers]));
    const status: CloudRuntimeStatus = {
      version: 1,
      instanceId: deps.instanceId,
      membershipId: deps.membershipId,
      phase: allReady && !activityFailed ? 'ready' : 'degraded',
      startedAtMs,
      heartbeatAtMs: nowMs,
      draining: false,
      readiness,
      idle: {
        maySuspend: allReady && idle.maySuspend,
        blockers: statusBlockers,
        lastBusyAtMs: idle.lastBusyAtMs,
        nextWakeAtMs: idle.nextWakeAtMs,
      },
    };
    await deps.statusStore.write(status);
    lastStatus = status;
    return status;
  };

  const sampleNow = async (): Promise<CloudRuntimeStatus> => {
    if (inFlight) return inFlight;
    inFlight = collect().finally(() => {
      inFlight = null;
      scheduleNext();
    });
    return inFlight;
  };

  return {
    async start(): Promise<CloudRuntimeStatus> {
      stopped = false;
      deps.logger.info('cloud runtime controller started');
      return sampleNow();
    },
    sampleNow,
    async stop(): Promise<CloudRuntimeStatus> {
      stopped = true;
      if (timer !== null) {
        deps.cancelSchedule(timer);
        timer = null;
      }
      if (inFlight) await inFlight;
      const nowMs = deps.now();
      const status: CloudRuntimeStatus = {
        version: 1,
        instanceId: deps.instanceId,
        membershipId: deps.membershipId,
        phase: 'stopping',
        startedAtMs,
        heartbeatAtMs: nowMs,
        draining: true,
        readiness: lastStatus?.readiness ?? UNKNOWN_READINESS,
        idle: lastStatus?.idle ?? {
          maySuspend: false,
          blockers: ['activity-unknown'],
          lastBusyAtMs: nowMs,
          nextWakeAtMs: null,
        },
      };
      await deps.statusStore.write(status);
      lastStatus = status;
      deps.logger.info('cloud runtime controller stopped');
      return status;
    },
    getLastStatus: () => lastStatus,
  };
}

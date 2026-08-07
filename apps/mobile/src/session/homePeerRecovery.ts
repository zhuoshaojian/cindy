import type { DeviceView } from '@cindy/device-link';

export interface HomePeerRecoveryRefreshResult {
  failure: string | null;
}

interface HomePeerRecoveryRefreshOptions<TDevice> {
  getDeviceId(device: TDevice): string;
  hydrate(device: TDevice): Promise<HomePeerRecoveryRefreshResult>;
  onReady(deviceId: string, device: TDevice): void;
}

export interface HomePeerRecoveryRefresh<TDevice> {
  refresh(deviceId: string, generation: number): Promise<void>;
  setDevices(devices: readonly TDevice[]): Promise<void>;
  dispose(): void;
}

/**
 * Bridges a recovered peer link back into Home's read model without restarting
 * the shared relay client. Refreshes are single-flight per device and only a
 * successful authoritative hydrate may mark that device ready.
 */
export function createHomePeerRecoveryRefresh<TDevice>(
  options: HomePeerRecoveryRefreshOptions<TDevice>,
): HomePeerRecoveryRefresh<TDevice> {
  let devices = new Map<string, TDevice>();
  let candidateRevision = 0;
  let deviceCandidateRevisions = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();
  const requestedGenerations = new Map<string, number>();
  const completedGenerations = new Map<string, number>();
  let disposed = false;

  const refresh = (deviceId: string, generation: number): Promise<void> => {
    if (disposed) return Promise.resolve();
    const requested = Math.max(requestedGenerations.get(deviceId) ?? 0, generation);
    requestedGenerations.set(deviceId, requested);
    if ((completedGenerations.get(deviceId) ?? 0) >= requested) return Promise.resolve();
    const current = inFlight.get(deviceId);
    if (current) return current;
    const device = devices.get(deviceId);
    if (!device) return Promise.resolve();
    const runningGeneration = requested;
    const runningCandidateRevision = deviceCandidateRevisions.get(deviceId);

    const task = options.hydrate(device)
      .then((result) => {
        if (
          !disposed
          && result.failure === null
          && devices.has(deviceId)
          && deviceCandidateRevisions.get(deviceId) === runningCandidateRevision
        ) {
          completedGenerations.set(deviceId, runningGeneration);
          options.onReady(deviceId, device);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (inFlight.get(deviceId) !== task) return;
        inFlight.delete(deviceId);
        const latestRequested = requestedGenerations.get(deviceId) ?? 0;
        const candidateChanged = deviceCandidateRevisions.get(deviceId) !== runningCandidateRevision;
        if (
          !disposed
          && devices.has(deviceId)
          && (latestRequested > runningGeneration || candidateChanged)
          && (completedGenerations.get(deviceId) ?? 0) < latestRequested
        ) {
          void refresh(deviceId, latestRequested);
        }
      });
    inFlight.set(deviceId, task);
    return task;
  };

  return {
    refresh,
    async setDevices(nextDevices) {
      if (disposed) return;
      const nextDeviceMap = new Map(
        nextDevices.map((device) => [options.getDeviceId(device), device]),
      );
      const nextCandidateRevisions = new Map<string, number>();
      for (const deviceId of nextDeviceMap.keys()) {
        const currentRevision = deviceCandidateRevisions.get(deviceId);
        if (currentRevision !== undefined) {
          nextCandidateRevisions.set(deviceId, currentRevision);
          continue;
        }
        candidateRevision += 1;
        nextCandidateRevisions.set(deviceId, candidateRevision);
      }
      devices = nextDeviceMap;
      deviceCandidateRevisions = nextCandidateRevisions;
      for (const deviceId of [...requestedGenerations.keys()]) {
        if (devices.has(deviceId)) continue;
        requestedGenerations.delete(deviceId);
        completedGenerations.delete(deviceId);
      }
      await Promise.all(
        [...requestedGenerations]
          .filter(([deviceId, generation]) =>
            devices.has(deviceId)
            && (completedGenerations.get(deviceId) ?? 0) < generation)
          .map(([deviceId, generation]) => refresh(deviceId, generation)),
      );
    },
    dispose() {
      disposed = true;
      devices.clear();
      deviceCandidateRevisions.clear();
      inFlight.clear();
      requestedGenerations.clear();
      completedGenerations.clear();
    },
  };
}

export function markHomePeerReady(
  current: ReadonlySet<string>,
  deviceId: string,
): ReadonlySet<string> {
  if (current.has(deviceId)) return current;
  return new Set([...current, deviceId]);
}

export function pruneHomePeerReady(
  current: ReadonlySet<string>,
  eligibleDeviceIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = new Set([...current].filter((deviceId) => eligibleDeviceIds.has(deviceId)));
  return next.size === current.size ? current : next;
}

export function promoteRecoveredHomeDevice(
  current: DeviceView | null,
  fallback: DeviceView,
  lastSeenAt = new Date().toISOString(),
): DeviceView {
  const base = current ?? fallback;
  if (base.online && base.remoteControlEnabled) return base;
  return {
    ...base,
    online: true,
    remoteControlEnabled: true,
    lastSeenAt,
  };
}

export function isCurrentHomeStartupLoading(input: {
  initialHomeLoading: boolean;
  selectedDeviceId: string | null;
  recoveryReadyDeviceIds: ReadonlySet<string>;
}): boolean {
  return input.initialHomeLoading
    && (input.selectedDeviceId === null || !input.recoveryReadyDeviceIds.has(input.selectedDeviceId));
}

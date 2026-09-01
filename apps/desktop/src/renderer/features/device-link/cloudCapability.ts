import { useSyncExternalStore } from 'react';

/**
 * Renderer-local visibility projection for cloud-owned device-link data.
 * The control-plane hook publishes only ready/unsupported terminal states;
 * device-link selectors consume it without deleting cached shards or persisted
 * machine intent, so re-enabling the capability can restore both.
 */
const EMPTY_IDS: ReadonlySet<string> = new Set();

export interface CloudCapabilitySnapshot {
  unsupported: boolean;
  cloudDeviceIds: ReadonlySet<string>;
}

let snapshot: CloudCapabilitySnapshot = {
  unsupported: false,
  cloudDeviceIds: EMPTY_IDS,
};
const subscribers = new Set<() => void>();

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export function setCloudCapability(
  unsupported: boolean,
  cloudDeviceIds: ReadonlySet<string> = EMPTY_IDS,
): void {
  if (snapshot.unsupported === unsupported && sameIds(snapshot.cloudDeviceIds, cloudDeviceIds)) {
    return;
  }
  snapshot = {
    unsupported,
    cloudDeviceIds: cloudDeviceIds.size === 0 ? EMPTY_IDS : new Set(cloudDeviceIds),
  };
  subscribers.forEach((subscriber) => subscriber());
}

export function getCloudCapabilitySnapshot(): CloudCapabilitySnapshot {
  return snapshot;
}

export function subscribeCloudCapability(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function useCloudCapability(): CloudCapabilitySnapshot {
  return useSyncExternalStore(
    subscribeCloudCapability,
    getCloudCapabilitySnapshot,
    getCloudCapabilitySnapshot,
  );
}

import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
  type DataOwnerGeneration,
} from '@/contexts/dataOwnerGeneration';

export interface CloudInstanceRendererAuthority {
  /** undefined = no complete successful list is currently available. */
  activeDeviceIds: ReadonlySet<string> | undefined;
  /** Devices already proven retired remain fenced across a later list failure. */
  retiredDeviceIds: ReadonlySet<string>;
}

interface OwnerScopedAuthority extends CloudInstanceRendererAuthority {
  owner: DataOwnerGeneration;
}

const EMPTY_DEVICE_IDS: ReadonlySet<string> = new Set();
const UNKNOWN_AUTHORITY: CloudInstanceRendererAuthority = {
  activeDeviceIds: undefined,
  retiredDeviceIds: EMPTY_DEVICE_IDS,
};

let authority: OwnerScopedAuthority | null = null;
const subscribers = new Set<() => void>();

function sameOwner(left: DataOwnerGeneration, right: DataOwnerGeneration): boolean {
  return left.dataOwnerId === right.dataOwnerId && left.generation === right.generation;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function publish(next: OwnerScopedAuthority): void {
  if (
    authority &&
    sameOwner(authority.owner, next.owner) &&
    ((authority.activeDeviceIds === undefined && next.activeDeviceIds === undefined) ||
      (authority.activeDeviceIds !== undefined &&
        next.activeDeviceIds !== undefined &&
        setsEqual(authority.activeDeviceIds, next.activeDeviceIds))) &&
    setsEqual(authority.retiredDeviceIds, next.retiredDeviceIds)
  ) {
    return;
  }
  authority = next;
  subscribers.forEach((subscriber) => subscriber());
}

/**
 * Publish the same owner-scoped complete instance list used by the main-side
 * mirror-cache authority gate. A stale response from a previous auth generation
 * is ignored instead of being allowed to retire devices in the new account.
 */
export function publishCloudInstanceRendererAuthority(
  owner: DataOwnerGeneration,
  deviceIds: Iterable<string>,
): void {
  if (!isDataOwnerGenerationCurrent(owner)) return;
  const activeDeviceIds = new Set(deviceIds);
  const previous = authority && sameOwner(authority.owner, owner) ? authority : null;
  const retiredDeviceIds = new Set(previous?.retiredDeviceIds ?? []);
  for (const activeDeviceId of activeDeviceIds) retiredDeviceIds.delete(activeDeviceId);
  if (previous?.activeDeviceIds) {
    for (const previousDeviceId of previous.activeDeviceIds) {
      if (!activeDeviceIds.has(previousDeviceId)) retiredDeviceIds.add(previousDeviceId);
    }
  }
  publish({ owner, activeDeviceIds, retiredDeviceIds });
}

/**
 * A failed/unsupported/malformed list is deliberately "unknown", not empty.
 * Fail-open prevents a control-plane outage from unsubscribing live peers and
 * deleting their in-memory session shards. Already confirmed retirements stay
 * fenced until a later complete list explicitly contains that device again.
 */
export function markCloudInstanceRendererAuthorityUnknown(owner: DataOwnerGeneration): void {
  if (!isDataOwnerGenerationCurrent(owner)) return;
  const previous = authority && sameOwner(authority.owner, owner) ? authority : null;
  if (!previous?.activeDeviceIds) return;
  publish({
    owner,
    activeDeviceIds: undefined,
    retiredDeviceIds: new Set(previous.retiredDeviceIds),
  });
}

/** Remember a cloud shard proven absent from the current complete list. */
export function rememberRetiredCloudDevice(deviceId: string): void {
  const owner = getDataOwnerGeneration();
  const previous = authority && sameOwner(authority.owner, owner) ? authority : null;
  const retiredDeviceIds = new Set(previous?.retiredDeviceIds ?? []);
  if (retiredDeviceIds.has(deviceId)) return;
  retiredDeviceIds.add(deviceId);
  // No notification is needed here: while authority is known, the active set
  // already drives every subscriber to the same decision. Keeping this update
  // quiet also avoids a re-entrant reconciliation while the caller is midway
  // through retiring the shard. A later transition to unknown does notify and
  // carries this fence forward.
  authority = {
    owner,
    activeDeviceIds: previous?.activeDeviceIds,
    retiredDeviceIds,
  };
}

export function getCloudInstanceRendererAuthority(): CloudInstanceRendererAuthority {
  const owner = getDataOwnerGeneration();
  return authority && sameOwner(authority.owner, owner) ? authority : UNKNOWN_AUTHORITY;
}

export function subscribeCloudInstanceRendererAuthority(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

/** Unit-test isolation for the module-level renderer projection. */
export function __resetCloudInstanceRendererAuthorityForTest(): void {
  authority = null;
  subscribers.clear();
}

import type { CloudInstanceAction, CloudInstancePendingState } from './useCloudInstances';

export type CloudInstanceLifecycleAction = Extract<
  CloudInstanceAction,
  'wake' | 'stop' | 'rebuild' | 'delete'
>;

export type CloudInstanceLifecycleProgressKey =
  | 'settings.devices.cloudInstance.waking'
  | 'settings.devices.cloudInstance.stopping'
  | 'settings.devices.cloudInstance.rebuilding'
  | 'settings.devices.cloudInstance.rebuildStatusUnknown'
  | 'settings.devices.cloudInstance.deleting';

export function cloudInstanceLifecycleAction(
  pending: CloudInstancePendingState,
): CloudInstanceLifecycleAction | null {
  if (
    pending?.action === 'wake'
    || pending?.action === 'stop'
    || pending?.action === 'rebuild'
    || pending?.action === 'delete'
  ) {
    return pending.action;
  }
  return null;
}

export function cloudInstanceLifecycleProgressKey(
  action: CloudInstanceLifecycleAction,
  pending?: CloudInstancePendingState,
): CloudInstanceLifecycleProgressKey {
  if (action === 'wake') return 'settings.devices.cloudInstance.waking';
  if (action === 'stop') return 'settings.devices.cloudInstance.stopping';
  if (action === 'rebuild') {
    return pending?.syncState === 'unknown'
      ? 'settings.devices.cloudInstance.rebuildStatusUnknown'
      : 'settings.devices.cloudInstance.rebuilding';
  }
  return 'settings.devices.cloudInstance.deleting';
}

/**
 * Match a lifecycle action to the cloud row that represents it. Rebuild keeps
 * pending.target anchored to the old instance, so after the control plane
 * swaps rows we only transfer the progress label to a unique replacement.
 * Multiple rows stay conservative: never guess which instance is rebuilding.
 */
export function cloudInstanceLifecycleActionForTarget(
  pending: CloudInstancePendingState,
  target: string | 'new',
  availableTargets: readonly string[],
): CloudInstanceLifecycleAction | null {
  const action = cloudInstanceLifecycleAction(pending);
  if (!action || !pending) return null;
  if (pending.target === target) return action;
  if (
    action === 'rebuild' &&
    !availableTargets.includes(pending.target) &&
    availableTargets.length === 1 &&
    availableTargets[0] === target
  ) {
    return action;
  }
  return null;
}

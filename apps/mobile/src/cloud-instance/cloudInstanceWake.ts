import type {
  CloudInstanceApiOutcome,
  CloudInstanceWakeResult,
} from '@/api/cloudInstance';

export type CloudInstanceAction = 'wake' | 'stop' | 'upgrade' | 'autoUpdate' | 'delete';

export { CLOUD_WAKE_WATCH_TIMEOUT_MS } from '@cindy/maker-shared/cloud-instance';
export type CloudInstancePending = {
  target: string | 'new';
  action: CloudInstanceAction;
} | null;

/** Whether the selected cloud device should replace cached tasks with a waking placeholder. */
export function isSelectedCloudInstanceWaking(input: {
  deviceId: string | null;
  instanceId: string | null;
  online: boolean;
  pending: CloudInstancePending;
  wakeWatchDeviceId: string | null;
}): boolean {
  if (!input.deviceId || !input.instanceId || input.online) return false;
  return input.wakeWatchDeviceId === input.deviceId
    || (
      input.pending?.action === 'wake'
      && input.pending.target === input.instanceId
    );
}

interface PendingRef {
  current: CloudInstancePending;
}

interface RunCloudInstanceActionDeps<T> {
  pendingRef: PendingRef;
  setPending(value: CloudInstancePending): void;
  request(): Promise<CloudInstanceApiOutcome<T>>;
  refresh(): Promise<void>;
  /** Return true when the error is an expected conflict that should refresh silently. */
  onError(action: CloudInstanceAction, error: Extract<CloudInstanceApiOutcome<T>, { kind: 'error' }>['error']): boolean | void;
  onOptimisticStart?(): void;
  onOptimisticRollback?(): void;
}

/**
 * Deterministic lifecycle coordinator shared by the hook and unit tests.
 * The ref is updated before React state so two taps in the same render cannot
 * issue two control-plane requests.
 */
export async function runCloudInstanceAction<T>(
  target: string | 'new',
  action: CloudInstanceAction,
  deps: RunCloudInstanceActionDeps<T>,
): Promise<T | null> {
  if (deps.pendingRef.current !== null) return null;

  const pending = { target, action } satisfies Exclude<CloudInstancePending, null>;
  deps.pendingRef.current = pending;
  deps.setPending(pending);
  deps.onOptimisticStart?.();
  try {
    const result = await deps.request();
    if (result.kind === 'unsupported') {
      deps.onOptimisticRollback?.();
      deps.onError(action, {
        code: 'UNSUPPORTED_CAPABILITY',
        message: 'Cloud instance control is unavailable',
        status: null,
      });
      return null;
    }
    if (result.kind === 'error') {
      deps.onOptimisticRollback?.();
      if (deps.onError(action, result.error)) await deps.refresh();
      return null;
    }
    await deps.refresh();
    return result.value;
  } catch (error) {
    deps.onOptimisticRollback?.();
    throw error;
  } finally {
    deps.pendingRef.current = null;
    deps.setPending(null);
  }
}

export interface RunCloudInstanceWakeDeps {
  pendingRef: PendingRef;
  setPending(value: CloudInstancePending): void;
  requestWake(instanceId?: string): Promise<CloudInstanceApiOutcome<CloudInstanceWakeResult>>;
  refresh(): Promise<void>;
  onError(): void;
}

export function runCloudInstanceWake(
  instanceId: string | undefined,
  deps: RunCloudInstanceWakeDeps,
): Promise<CloudInstanceWakeResult | null> {
  return runCloudInstanceAction(instanceId ?? 'new', 'wake', {
    pendingRef: deps.pendingRef,
    setPending: deps.setPending,
    request: () => deps.requestWake(instanceId),
    refresh: deps.refresh,
    onError: () => deps.onError(),
  });
}

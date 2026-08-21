import type {
  CloudInstanceApiOutcome,
  CloudInstanceWakeResult,
} from '@/api/cloudInstance';

export type CloudInstanceAction = 'wake' | 'stop' | 'upgrade' | 'rebuild' | 'autoUpdate' | 'delete';

export type CloudInstancePending = {
  target: string | 'new';
  action: CloudInstanceAction;
} | null;

export interface CloudInstanceZeroInstancePresentation {
  busy: boolean;
  disabled: boolean;
  labelKey: string;
}

/** Shared zero-instance presentation so every wake entry respects rebuild gating. */
export function cloudInstanceZeroInstancePresentation(
  pending: CloudInstancePending,
): CloudInstanceZeroInstancePresentation {
  if (!pending) {
    return { busy: false, disabled: false, labelKey: 'deviceLink.cloudWake' };
  }
  const labelKey = pending.action === 'rebuild'
    ? 'deviceLink.cloudInstance.rebuilding'
    : pending.action === 'stop'
      ? 'deviceLink.cloudInstance.stopping'
      : pending.action === 'delete'
        ? 'deviceLink.cloudInstance.deleting'
        : pending.action === 'upgrade'
          ? 'deviceLink.cloudInstance.updating'
          : 'deviceLink.cloudWaking';
  return { busy: true, disabled: true, labelKey };
}

/** Older successful snapshots cannot overwrite a newer successfully applied snapshot. */
export function shouldApplyCloudInstanceRebuildSnapshot(
  requestSequence: number,
  latestAppliedSequence: number,
): boolean {
  return requestSequence >= latestAppliedSequence;
}

/** Whether the selected cloud device should replace cached tasks with a waking placeholder. */
export function isSelectedCloudInstanceWaking(input: {
  deviceId: string | null;
  instanceId: string | null;
  online: boolean;
  pending: CloudInstancePending;
}): boolean {
  if (!input.deviceId || !input.instanceId || input.online) return false;
  return input.pending?.action === 'wake'
    && input.pending.target === input.instanceId;
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
  onAccepted?(value: T): void;
  waitForTerminal?(value: T): Promise<void>;
  onTerminalError?(error: unknown): void;
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
    deps.onAccepted?.(result.value);
    await deps.refresh();
    if (deps.waitForTerminal) {
      try {
        await deps.waitForTerminal(result.value);
      } catch (error) {
        deps.onTerminalError?.(error);
        return null;
      }
    }
    return result.value;
  } catch (error) {
    deps.onOptimisticRollback?.();
    throw error;
  } finally {
    // A successful refresh may have replaced this local action with an
    // authoritative server-side rebuild. Never clear that hydrated guard.
    if (deps.pendingRef.current?.action === pending.action) {
      deps.pendingRef.current = null;
      deps.setPending(null);
    }
  }
}

export interface RunCloudInstanceWakeDeps {
  pendingRef: PendingRef;
  setPending(value: CloudInstancePending): void;
  requestWake(instanceId?: string): Promise<CloudInstanceApiOutcome<CloudInstanceWakeResult>>;
  refresh(): Promise<void>;
  onError(error: Extract<CloudInstanceApiOutcome<CloudInstanceWakeResult>, { kind: 'error' }>['error']): boolean | void;
  onAccepted?(value: CloudInstanceWakeResult): void;
  waitForTerminal?(value: CloudInstanceWakeResult): Promise<void>;
  onTerminalError?(error: unknown): void;
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
    onError: (_action, error) => deps.onError(error),
    onAccepted: deps.onAccepted,
    waitForTerminal: deps.waitForTerminal,
    onTerminalError: deps.onTerminalError,
  });
}

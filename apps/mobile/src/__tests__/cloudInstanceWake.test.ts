import { describe, expect, it, vi } from 'vitest';

import {
  runCloudInstanceAction,
  runCloudInstanceWake,
  type CloudInstancePending,
} from '@/cloud-instance/cloudInstanceWake';

describe('runCloudInstanceWake', () => {
  it('blocks duplicate wake taps while pending and refreshes after success', async () => {
    let releaseWake!: () => void;
    const wakeGate = new Promise<void>((resolve) => {
      releaseWake = resolve;
    });
    const pendingRef: { current: CloudInstancePending } = { current: null };
    const pendingHistory: CloudInstancePending[] = [];
    const requestWake = vi.fn(async () => {
      await wakeGate;
      return {
        kind: 'ok' as const,
        value: {
          instanceId: 'instance-1',
          deviceId: 'device-1',
          nameSequence: 1,
          customLabel: null,
          created: false,
          status: {},
        },
      };
    });
    const refresh = vi.fn(async () => undefined);
    const onError = vi.fn();
    const deps = {
      pendingRef,
      setPending: (value: CloudInstancePending) => pendingHistory.push(value),
      requestWake,
      refresh,
      onError,
    };

    const first = runCloudInstanceWake('instance-1', deps);
    const duplicate = runCloudInstanceWake('instance-1', deps);
    await expect(duplicate).resolves.toBeNull();
    expect(requestWake).toHaveBeenCalledTimes(1);
    expect(pendingRef.current).toEqual({ target: 'instance-1', action: 'wake' });

    releaseWake();
    await expect(first).resolves.toMatchObject({
      instanceId: 'instance-1',
      deviceId: 'device-1',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(pendingHistory).toEqual([
      { target: 'instance-1', action: 'wake' },
      null,
    ]);
    expect(pendingRef.current).toBeNull();
  });

  it('clears pending and reports a failed wake without refreshing', async () => {
    const pendingRef: { current: CloudInstancePending } = { current: null };
    const setPending = vi.fn();
    const refresh = vi.fn(async () => undefined);
    const onError = vi.fn();

    await expect(
      runCloudInstanceWake(undefined, {
        pendingRef,
        setPending,
        requestWake: async () => ({
          kind: 'error',
          error: { code: 'FAILED', message: 'failed', status: 500 },
        }),
        refresh,
        onError,
      }),
    ).resolves.toBeNull();

    expect(setPending).toHaveBeenNthCalledWith(1, { target: 'new', action: 'wake' });
    expect(setPending).toHaveBeenLastCalledWith(null);
    expect(refresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(pendingRef.current).toBeNull();
  });

  it('uses the same pending shape for stop/delete and refreshes once after success', async () => {
    const pendingRef: { current: CloudInstancePending } = { current: null };
    const pendingHistory: CloudInstancePending[] = [];
    const refresh = vi.fn(async () => undefined);
    const onError = vi.fn();
    const request = vi.fn(async () => ({
      kind: 'ok' as const,
      value: {
        status: {},
        revocation: { status: 'revoked' },
        archiveCleanup: 'removed',
      },
    }));

    const stop = runCloudInstanceAction('instance-1', 'stop', {
      pendingRef,
      setPending: (value) => pendingHistory.push(value),
      request,
      refresh,
      onError,
    });
    const duplicate = runCloudInstanceAction('instance-2', 'delete', {
      pendingRef,
      setPending: (value) => pendingHistory.push(value),
      request,
      refresh,
      onError,
    });

    await expect(duplicate).resolves.toBeNull();
    await expect(stop).resolves.toMatchObject({ status: {} });
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(pendingHistory).toEqual([
      { target: 'instance-1', action: 'stop' },
      null,
    ]);
    expect(onError).not.toHaveBeenCalled();
  });
});

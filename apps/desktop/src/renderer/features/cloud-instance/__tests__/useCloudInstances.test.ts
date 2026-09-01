// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_ACTION_WATCH_POLL_INTERVAL_MS,
  CLOUD_ACTION_WATCH_TIMEOUT_MS,
  CloudInstanceActionTimeoutError,
} from '@cindy/maker-shared/cloud-instance';

import {
  __resetCloudInstancesStoreForTest,
  CLOUD_INSTANCES_REFRESH_INTERVAL_MS,
  CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS,
  isCloudInstancesUnsupportedError,
  type CloudInstanceView,
  useCloudInstances,
} from '../useCloudInstances';
import { getCloudInstanceRendererAuthority } from '../cloudInstanceRendererAuthority';
import {
  __testing as dataOwnerGenerationTesting,
  setDataOwnerGeneration,
} from '@/contexts/dataOwnerGeneration';

const deviceListMock = vi.hoisted(() => ({
  devices: [] as Array<{
    deviceId: string;
    online: boolean;
  }>,
}));
vi.mock('@/features/device-link/useDeviceLinkDeviceList', () => ({
  useDeviceLinkDeviceList: () => deviceListMock.devices,
}));
vi.mock('@/features/device-link/cloudCapability', () => ({ setCloudCapability: vi.fn() }));
const rendererCacheMocks = vi.hoisted(() => ({
  clearRevoked: vi.fn(),
  removeDevice: vi.fn(),
  removeRemoteSessionActivityForDevice: vi.fn(),
}));
vi.mock('@/features/device-link/remoteProjectsStore', () => ({
  remoteProjectsStore: { removeDevice: rendererCacheMocks.removeDevice },
}));
vi.mock('@/features/device-link/revokedDevicesStore', () => ({
  revokedDevicesStore: { clearRevoked: rendererCacheMocks.clearRevoked },
}));
vi.mock('@/features/device-link/remoteSessionActivityStore', () => ({
  removeRemoteSessionActivityForDevice: rendererCacheMocks.removeRemoteSessionActivityForDevice,
}));

const cloudInstancesApi = {
  list: vi.fn(),
  wake: vi.fn(),
  stop: vi.fn(),
  upgrade: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  rebuild: vi.fn(),
  continueRebuild: vi.fn(),
};

function rebuildOperation(
  phase:
    | 'retiring'
    | 'retirement-timeout'
    | 'retired-awaiting-create'
    | 'creating'
    | 'starting'
    | 'succeeded'
    | 'delete-rejected'
    | 'create-failed-after-delete'
    | 'manual-wake-required' = 'retiring',
) {
  return {
    operationId: 'rebuild-operation-a',
    oldInstanceId: 'cloud-instance-a',
    oldDeviceId: 'cloud-device-a',
    resourceTier: 'small' as const,
    phase,
    startedAt: 1_000,
    retireDeadline: 121_000,
    clientCreateDeadline: phase === 'retired-awaiting-create' ? 301_000 : null,
    createDeadline: phase === 'creating' || phase === 'starting' ? 301_000 : null,
    newInstanceId: phase === 'creating' || phase === 'starting' || phase === 'succeeded'
      ? 'cloud-instance-b'
      : null,
    outcome: phase === 'succeeded' ? 'automatic-rebuild-succeeded' as const : null,
    updatedAt: 2_000,
  };
}

function cloudInstanceView(): CloudInstanceView {
  return {
    instanceId: 'cloud-instance-a',
    deviceId: 'cloud-device-a',
    nameSequence: 1,
    customLabel: null,
    status: {
      instanceId: 'cloud-instance-a',
      deviceId: 'cloud-device-a',
      ownership: {
        passportId: 'passport-a',
        membershipId: 'membership-a',
        membershipKind: 'personal' as const,
        orgSlug: null,
      },
      desiredState: 'running' as const,
      nextWakeAtMs: null,
      runtimeState: 'running' as const,
      resourceTier: 'small' as const,
      readiness: { ready: true, reason: 'ready' as const, blockers: [] },
      upgrade: {
        state: 'idle' as const,
        targetImage: null,
        previousImage: null,
        deadlineAtMs: null,
      },
      autoUpdate: false,
      updatedAtMs: 1_000,
    },
  };
}

beforeEach(() => {
  dataOwnerGenerationTesting.reset();
  setDataOwnerGeneration('owner-a', 1);
  __resetCloudInstancesStoreForTest();
  deviceListMock.devices = [];
  cloudInstancesApi.list.mockReset().mockImplementation(async () => ({
    instances: [cloudInstanceView()],
  }));
  cloudInstancesApi.wake.mockReset();
  cloudInstancesApi.stop.mockReset();
  cloudInstancesApi.upgrade.mockReset();
  cloudInstancesApi.patch.mockReset();
  cloudInstancesApi.delete.mockReset();
  cloudInstancesApi.rebuild.mockReset();
  cloudInstancesApi.continueRebuild.mockReset();
  rendererCacheMocks.clearRevoked.mockReset();
  rendererCacheMocks.removeDevice.mockReset();
  rendererCacheMocks.removeRemoteSessionActivityForDevice.mockReset();
  vi.stubGlobal(
    'window',
    Object.assign(window, { electronAPI: { cloudInstances: cloudInstancesApi } }),
  );
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dataOwnerGenerationTesting.reset();
});

describe('useCloudInstances capability visibility', () => {
  it('publishes only complete successful lists and degrades failures to unknown', async () => {
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));
    expect([...getCloudInstanceRendererAuthority().activeDeviceIds!]).toEqual([
      'cloud-device-a',
    ]);

    cloudInstancesApi.list.mockRejectedValueOnce(new Error('control plane unavailable'));
    await act(async () => {
      await mounted.result.current.refresh();
    });
    expect(getCloudInstanceRendererAuthority().activeDeviceIds).toBeUndefined();

    cloudInstancesApi.list.mockResolvedValueOnce({
      instances: [{ ...cloudInstanceView(), deviceId: '' }],
    });
    await act(async () => {
      await mounted.result.current.refresh();
    });
    expect(getCloudInstanceRendererAuthority().activeDeviceIds).toBeUndefined();
  });

  it('treats endpoint absence and server-side disablement as unsupported', () => {
    const endpointError = Object.assign(new Error('cloud instance control is unavailable'), {
      code: 'UNSUPPORTED_CAPABILITY' as const,
    });
    const disabledError = Object.assign(
      new Error('cloud instance control is disabled for this account'),
      {
        code: 'CLOUD_INSTANCE_DISABLED' as const,
      },
    );
    expect(isCloudInstancesUnsupportedError(endpointError)).toBe(true);
    expect(isCloudInstancesUnsupportedError(disabledError)).toBe(true);
  });

  it('keeps transient service failures as errors so the UI can retry', () => {
    const unavailableError = Object.assign(new Error('cloud instance service request failed'), {
      code: 'CLOUD_INSTANCE_UNAVAILABLE' as const,
    });
    expect(isCloudInstancesUnsupportedError(unavailableError)).toBe(false);
  });

  it('shares the pending action guard across hook mount points', async () => {
    let resolveWake!: (value: { instanceId: string; deviceId: string }) => void;
    cloudInstancesApi.wake.mockReturnValue(
      new Promise((resolve) => {
        resolveWake = resolve;
      }),
    );

    const firstMount = renderHook(() => useCloudInstances());
    const secondMount = renderHook(() => useCloudInstances());
    await waitFor(() => expect(firstMount.result.current.loadState).toBe('ready'));
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(1);

    let firstAction!: ReturnType<typeof firstMount.result.current.wake>;
    act(() => {
      firstAction = firstMount.result.current.wake('cloud-instance-a');
    });
    await waitFor(() =>
      expect(secondMount.result.current.pending).toEqual({
        target: 'cloud-instance-a',
        action: 'wake',
      }),
    );

    await expect(
      secondMount.result.current.deleteInstance('cloud-instance-a'),
    ).resolves.toBeUndefined();
    expect(cloudInstancesApi.delete).not.toHaveBeenCalled();
    expect(rendererCacheMocks.removeDevice).not.toHaveBeenCalled();
    expect(rendererCacheMocks.removeRemoteSessionActivityForDevice).not.toHaveBeenCalled();
    expect(rendererCacheMocks.clearRevoked).not.toHaveBeenCalled();

    await act(async () => {
      deviceListMock.devices = [{ deviceId: 'cloud-device-a', online: true }];
      firstMount.rerender();
    });
    resolveWake({ instanceId: 'cloud-instance-a', deviceId: 'cloud-device-a' });
    await act(async () => {
      await firstAction;
    });
    expect(cloudInstancesApi.wake).toHaveBeenCalledTimes(1);
    expect(firstMount.result.current.pending).toBeNull();
  });

  it('treats an upgrade race as accepted and refreshes into server state', async () => {
    cloudInstancesApi.upgrade.mockRejectedValue(
      Object.assign(new Error('already updating'), {
        code: 'CLOUD_INSTANCE_UPGRADE_IN_PROGRESS' as const,
      }),
    );
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await expect(
        mounted.result.current.upgradeInstance('cloud-instance-a'),
      ).resolves.toBeUndefined();
    });

    expect(cloudInstancesApi.upgrade).toHaveBeenCalledWith({
      instanceId: 'cloud-instance-a',
    });
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(2);
    expect(mounted.result.current.pending).toBeNull();
  });

  it('hydrates rebuild authority after wake is rejected by the rebuild gate', async () => {
    cloudInstancesApi.list
      .mockResolvedValueOnce({ instances: [], rebuildOperations: [] })
      .mockResolvedValueOnce({
        instances: [],
        rebuildOperations: [rebuildOperation('retiring')],
      });
    cloudInstancesApi.wake.mockRejectedValue(
      Object.assign(new Error('cleanup in progress'), {
        code: 'CLOUD_INSTANCE_REBUILD_IN_PROGRESS' as const,
      }),
    );
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await expect(mounted.result.current.wake()).rejects.toThrow('cleanup in progress');
    });

    expect(cloudInstancesApi.wake).toHaveBeenCalledTimes(1);
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(2);
    expect(mounted.result.current.pending).toEqual({
      target: 'cloud-instance-a',
      action: 'rebuild',
      syncState: 'synced',
    });
  });

  it('keeps an unknown rebuild guard when gate recovery cannot refresh', async () => {
    cloudInstancesApi.list
      .mockResolvedValueOnce({ instances: [], rebuildOperations: [] })
      .mockRejectedValueOnce(new Error('offline'));
    cloudInstancesApi.wake.mockRejectedValue(
      Object.assign(new Error('cleanup in progress'), {
        code: 'CLOUD_INSTANCE_REBUILD_IN_PROGRESS' as const,
      }),
    );
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await expect(mounted.result.current.wake()).rejects.toThrow('cleanup in progress');
    });

    expect(mounted.result.current.pending).toEqual({
      target: 'new',
      action: 'rebuild',
      syncState: 'unknown',
    });
  });

  it('optimistically patches auto-update and rolls back when the write fails', async () => {
    let rejectPatch!: (error: Error) => void;
    cloudInstancesApi.patch.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectPatch = reject;
      }),
    );
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    let action!: ReturnType<typeof mounted.result.current.setAutoUpdate>;
    act(() => {
      action = mounted.result.current.setAutoUpdate('cloud-instance-a', true);
    });
    await waitFor(() => {
      expect(mounted.result.current.instances[0]?.status.autoUpdate).toBe(true);
      expect(mounted.result.current.pending).toEqual({
        target: 'cloud-instance-a',
        action: 'autoUpdate',
      });
    });
    expect(cloudInstancesApi.patch).toHaveBeenCalledWith({
      instanceId: 'cloud-instance-a',
      autoUpdate: true,
    });

    rejectPatch(new Error('write failed'));
    await act(async () => {
      await expect(action).rejects.toThrow('write failed');
    });
    expect(mounted.result.current.instances[0]?.status.autoUpdate).toBe(false);
    expect(mounted.result.current.pending).toBeNull();
  });

  it('starts rebuild through the durable operation without delete or wake', async () => {
    cloudInstancesApi.list
      .mockResolvedValueOnce({ instances: [cloudInstanceView()] })
      .mockResolvedValue({ instances: [], rebuildOperations: [rebuildOperation()] });
    cloudInstancesApi.rebuild.mockResolvedValue({ rebuildOperation: rebuildOperation() });
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await expect(
        mounted.result.current.rebuildInstance('cloud-instance-a'),
      ).resolves.toMatchObject({ rebuildOperation: { phase: 'retiring' } });
    });

    expect(cloudInstancesApi.rebuild).toHaveBeenCalledWith({
      instanceId: 'cloud-instance-a',
      retryOfOperationId: undefined,
    });
    expect(cloudInstancesApi.delete).not.toHaveBeenCalled();
    expect(cloudInstancesApi.wake).not.toHaveBeenCalled();
    expect(rendererCacheMocks.removeDevice).toHaveBeenCalledWith('cloud-device-a');
    expect(rendererCacheMocks.removeRemoteSessionActivityForDevice).toHaveBeenCalledWith(
      'cloud-device-a',
    );
    expect(rendererCacheMocks.clearRevoked).toHaveBeenCalledWith('cloud-device-a');
    expect(mounted.result.current.pending).toEqual({
      target: 'cloud-instance-a',
      action: 'rebuild',
      syncState: 'synced',
    });
  });

  it('rotates the rebuild idempotency attempt after a delete-rejected operation', async () => {
    const rejected = rebuildOperation('delete-rejected');
    rejected.operationId = 'rejected-operation-a';
    cloudInstancesApi.list
      .mockResolvedValueOnce({ instances: [cloudInstanceView()], rebuildOperations: [rejected] })
      .mockResolvedValue({ instances: [], rebuildOperations: [rejected, rebuildOperation()] });
    cloudInstancesApi.rebuild.mockResolvedValue({ rebuildOperation: rebuildOperation() });
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await mounted.result.current.rebuildInstance('cloud-instance-a');
    });

    expect(cloudInstancesApi.rebuild).toHaveBeenCalledWith({
      instanceId: 'cloud-instance-a',
      retryOfOperationId: 'rejected-operation-a',
    });
  });

  it('does not retire local state when an idempotent replay reports delete-rejected', async () => {
    cloudInstancesApi.list.mockResolvedValue({
      instances: [cloudInstanceView()],
      rebuildOperations: [],
    });
    cloudInstancesApi.rebuild.mockResolvedValue({
      rebuildOperation: rebuildOperation('delete-rejected'),
    });
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await expect(
        mounted.result.current.rebuildInstance('cloud-instance-a'),
      ).rejects.toThrow('rebuild delete was rejected');
    });

    expect(rendererCacheMocks.removeDevice).not.toHaveBeenCalled();
    expect(rendererCacheMocks.removeRemoteSessionActivityForDevice).not.toHaveBeenCalled();
    expect(rendererCacheMocks.clearRevoked).not.toHaveBeenCalled();
    expect(mounted.result.current.pending).toBeNull();
  });

  it('keeps an ambiguous rebuild request pending until the server snapshot can recover it', async () => {
    cloudInstancesApi.list
      .mockResolvedValueOnce({ instances: [cloudInstanceView()], rebuildOperations: [] })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ instances: [], rebuildOperations: [rebuildOperation('retiring')] });
    cloudInstancesApi.rebuild.mockRejectedValue(new Error('response lost'));
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await expect(
        mounted.result.current.rebuildInstance('cloud-instance-a'),
      ).rejects.toThrow('response lost');
    });
    expect(mounted.result.current.pending).toEqual({
      target: 'cloud-instance-a',
      action: 'rebuild',
      syncState: 'unknown',
    });

    await act(async () => {
      await mounted.result.current.refresh();
    });
    expect(mounted.result.current.pending).toEqual({
      target: 'cloud-instance-a',
      action: 'rebuild',
      syncState: 'synced',
    });
  });

  it('hydrates rebuild pending from the server again after unmount and remount', async () => {
    cloudInstancesApi.list.mockResolvedValue({
      instances: [],
      rebuildOperations: [rebuildOperation('retiring')],
    });
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.pending?.action).toBe('rebuild'));
    mounted.unmount();
    const remounted = renderHook(() => useCloudInstances());
    expect(remounted.result.current.pending).toMatchObject({
      target: 'cloud-instance-a', action: 'rebuild', syncState: 'synced',
    });
  });

  it('keeps stop busy until runtime leaves running and presence is offline', async () => {
    vi.useFakeTimers();
    const stopped = cloudInstanceView();
    stopped.status.runtimeState = 'stopped';
    cloudInstancesApi.list
      .mockResolvedValueOnce({ instances: [cloudInstanceView()] })
      .mockResolvedValue({ instances: [stopped] });
    cloudInstancesApi.stop.mockResolvedValue({ status: stopped.status });
    deviceListMock.devices = [{ deviceId: 'cloud-device-a', online: true }];
    const mounted = renderHook(() => useCloudInstances());
    await act(async () => {
      await Promise.resolve();
    });

    let action!: ReturnType<typeof mounted.result.current.stopInstance>;
    act(() => {
      action = mounted.result.current.stopInstance('cloud-instance-a');
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.result.current.pending).toEqual({
      target: 'cloud-instance-a',
      action: 'stop',
    });

    deviceListMock.devices = [];
    mounted.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_ACTION_WATCH_POLL_INTERVAL_MS);
      await action;
    });
    expect(mounted.result.current.pending).toBeNull();
  });

  it('times out a terminal watch, clears pending, and keeps the request single-shot', async () => {
    vi.useFakeTimers();
    cloudInstancesApi.wake.mockResolvedValue({
      ...cloudInstanceView(),
      created: false,
    });
    const mounted = renderHook(() => useCloudInstances());
    await act(async () => {
      await Promise.resolve();
    });

    let action!: ReturnType<typeof mounted.result.current.wake>;
    act(() => {
      action = mounted.result.current.wake('cloud-instance-a');
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.result.current.pending?.action).toBe('wake');
    await expect(mounted.result.current.wake('cloud-instance-a')).resolves.toBeUndefined();
    expect(cloudInstancesApi.wake).toHaveBeenCalledTimes(1);

    const timedOut = expect(action).rejects.toBeInstanceOf(CloudInstanceActionTimeoutError);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_ACTION_WATCH_TIMEOUT_MS);
    });
    await timedOut;
    expect(mounted.result.current.pending).toBeNull();
  });

  it('keeps hydrated rebuild pending unknown when list refresh fails', async () => {
    cloudInstancesApi.list.mockResolvedValueOnce({
      instances: [], rebuildOperations: [rebuildOperation('retiring')],
    });
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.pending?.action).toBe('rebuild'));
    cloudInstancesApi.list.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await mounted.result.current.refresh();
    });
    expect(mounted.result.current.pending).toMatchObject({
      target: 'cloud-instance-a', action: 'rebuild', syncState: 'unknown',
    });
  });

  it('continues retired rebuild creation once with the server operation id', async () => {
    cloudInstancesApi.list.mockResolvedValue({
      instances: [],
      rebuildOperations: [rebuildOperation('retired-awaiting-create')],
    });
    cloudInstancesApi.continueRebuild.mockResolvedValue({
      rebuildOperation: rebuildOperation('creating'),
    });
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(cloudInstancesApi.continueRebuild).toHaveBeenCalledTimes(1));
    expect(cloudInstancesApi.continueRebuild).toHaveBeenCalledWith({
      operationId: 'rebuild-operation-a',
      oldInstanceId: 'cloud-instance-a',
      retryOfOperationId: undefined,
    });
    await act(async () => {
      await mounted.result.current.refresh();
    });
    expect(cloudInstancesApi.continueRebuild).toHaveBeenCalledTimes(1);
  });

  it('surfaces persistent manual recovery after the old instance is gone', async () => {
    cloudInstancesApi.list.mockResolvedValue({
      instances: [],
      rebuildOperations: [rebuildOperation('manual-wake-required')],
    });
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));
    expect(mounted.result.current.pending).toBeNull();
    expect(mounted.result.current.rebuildAttention).toEqual({
      kind: 'manual-wake-required', oldInstanceId: 'cloud-instance-a',
    });
  });

  it('polls only while the renderer is visible and refreshes immediately on return', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const mounted = renderHook(() => useCloudInstances());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mounted.result.current.loadState).toBe('ready');
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_INSTANCES_REFRESH_INTERVAL_MS);
    });
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_INSTANCES_REFRESH_INTERVAL_MS);
    });
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(3);
  });

  it('uses short polling while verifying and exits it after the server settles', async () => {
    vi.useFakeTimers();
    const verifying = cloudInstanceView();
    verifying.status.upgrade = {
      state: 'verifying' as const,
      targetImage: 'registry/cindy:0.1.6',
      previousImage: 'registry/cindy:0.1.5',
      deadlineAtMs: 10_000,
    };
    cloudInstancesApi.list
      .mockResolvedValueOnce({ instances: [verifying] })
      .mockResolvedValue({ instances: [cloudInstanceView()] });

    const mounted = renderHook(() => useCloudInstances());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mounted.result.current.instances[0]?.status.upgrade?.state).toBe('verifying');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS);
    });
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(2);
    expect(mounted.result.current.instances[0]?.status.upgrade?.state).not.toBe('verifying');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS);
    });
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(2);
  });
});

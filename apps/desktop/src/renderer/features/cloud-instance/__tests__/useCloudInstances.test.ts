// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCloudInstancesStoreForTest,
  CLOUD_INSTANCES_REFRESH_INTERVAL_MS,
  CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS,
  CloudInstanceRebuildCreateError,
  isCloudInstancesUnsupportedError,
  type CloudInstanceView,
  useCloudInstances,
} from '../useCloudInstances';

vi.mock('@/features/device-link/useDeviceLinkDeviceList', () => ({
  useDeviceLinkDeviceList: () => [],
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
};

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
  __resetCloudInstancesStoreForTest();
  cloudInstancesApi.list.mockReset().mockImplementation(async () => ({
    instances: [cloudInstanceView()],
  }));
  cloudInstancesApi.wake.mockReset();
  cloudInstancesApi.stop.mockReset();
  cloudInstancesApi.upgrade.mockReset();
  cloudInstancesApi.patch.mockReset();
  cloudInstancesApi.delete.mockReset();
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
});

describe('useCloudInstances capability visibility', () => {
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

  it('rebuilds through delete then first-wake while preserving the resource tier', async () => {
    cloudInstancesApi.delete.mockResolvedValue({ instanceId: 'cloud-instance-a' });
    cloudInstancesApi.wake.mockResolvedValue({
      ...cloudInstanceView(),
      instanceId: 'cloud-instance-b',
      deviceId: 'cloud-device-b',
      created: true,
    });
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await expect(
        mounted.result.current.rebuildInstance('cloud-instance-a'),
      ).resolves.toMatchObject({ instanceId: 'cloud-instance-b', created: true });
    });

    expect(cloudInstancesApi.delete).toHaveBeenCalledWith({
      instanceId: 'cloud-instance-a',
    });
    expect(cloudInstancesApi.wake).toHaveBeenCalledWith({ resourceTier: 'small' });
    expect(cloudInstancesApi.delete.mock.invocationCallOrder[0]).toBeLessThan(
      cloudInstancesApi.wake.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(rendererCacheMocks.removeDevice).toHaveBeenCalledWith('cloud-device-a');
    expect(rendererCacheMocks.removeRemoteSessionActivityForDevice).toHaveBeenCalledWith(
      'cloud-device-a',
    );
    expect(rendererCacheMocks.clearRevoked).toHaveBeenCalledWith('cloud-device-a');
    expect(mounted.result.current.pending).toBeNull();
  });

  it('removes the deleted card and reports a distinct error when replacement creation fails', async () => {
    cloudInstancesApi.list
      .mockResolvedValueOnce({ instances: [cloudInstanceView()] })
      .mockResolvedValue({ instances: [] });
    cloudInstancesApi.delete.mockResolvedValue({ instanceId: 'cloud-instance-a' });
    cloudInstancesApi.wake.mockRejectedValue(new Error('create unavailable'));
    const mounted = renderHook(() => useCloudInstances());
    await waitFor(() => expect(mounted.result.current.loadState).toBe('ready'));

    await act(async () => {
      await expect(
        mounted.result.current.rebuildInstance('cloud-instance-a'),
      ).rejects.toBeInstanceOf(CloudInstanceRebuildCreateError);
    });

    expect(mounted.result.current.instances).toEqual([]);
    expect(mounted.result.current.pending).toBeNull();
    expect(cloudInstancesApi.list).toHaveBeenCalledTimes(2);
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

// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCloudInstancesStoreForTest,
  isCloudInstancesUnsupportedError,
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
  delete: vi.fn(),
};

function cloudInstanceView() {
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
  cloudInstancesApi.delete.mockReset();
  rendererCacheMocks.clearRevoked.mockReset();
  rendererCacheMocks.removeDevice.mockReset();
  rendererCacheMocks.removeRemoteSessionActivityForDevice.mockReset();
  vi.stubGlobal('window', Object.assign(window, { electronAPI: { cloudInstances: cloudInstancesApi } }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useCloudInstances capability visibility', () => {
  it('treats endpoint absence and server-side disablement as unsupported', () => {
    const endpointError = Object.assign(new Error('cloud instance control is unavailable'), {
      code: 'UNSUPPORTED_CAPABILITY' as const,
    });
    const disabledError = Object.assign(new Error('cloud instance control is disabled for this account'), {
      code: 'CLOUD_INSTANCE_DISABLED' as const,
    });
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

    await expect(secondMount.result.current.deleteInstance('cloud-instance-a')).resolves.toBeUndefined();
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
});

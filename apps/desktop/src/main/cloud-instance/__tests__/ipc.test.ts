import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({ warn: vi.fn() }));
const purgeQueueMocks = vi.hoisted(() => ({ enqueuePurge: vi.fn(async () => undefined) }));
vi.mock('../../logger.js', () => ({
  createLogger: () => ({ warn: loggerMocks.warn }),
}));
vi.mock('../../device-link/mirrorCachePurgeQueue.js', () => ({
  enqueuePurge: purgeQueueMocks.enqueuePurge,
}));

import { ServerApiError } from '../../serverApiClient.js';
import { MirrorCachePurgeError } from '../../device-link/mirrorCacheStore.js';
import { CloudInstanceClientNotConfiguredError, type CloudInstanceClient } from '../client.js';
import {
  CLOUD_DEVICE_RETIREMENT_UNKNOWN_PRESENCE_GRACE_MS,
  handleCloudInstanceStatus,
  handleCreateCloudInstance,
  handleDeleteCloudInstance,
  handleListCloudInstances,
  handlePatchCloudInstance,
  handleRenameCloudInstance,
  handleStopCloudInstance,
  handleUpgradeCloudInstance,
  handleWakeCloudInstance,
  type CloudInstanceIpcDeps,
} from '../ipc.js';

function client(): CloudInstanceClient {
  return {
    list: vi.fn().mockResolvedValue({ instances: [] }),
    wake: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    rename: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ status: {} }),
    stop: vi.fn().mockResolvedValue({ status: {} }),
    upgrade: vi.fn().mockResolvedValue({ status: {} }),
    delete: vi.fn().mockResolvedValue({
      status: { deviceId: 'cloud-device-a' },
      revocation: { status: 'revoked' },
      archiveCleanup: 'removed',
    }),
  } as unknown as CloudInstanceClient;
}

function deps(accessToken: string | null = 'resource-access-test'): CloudInstanceIpcDeps {
  return {
    getAccessToken: vi.fn(() => accessToken),
    client: client(),
    forgetDeviceName: vi.fn(async () => true),
    retireMirrorCacheDevice: vi.fn(async () => undefined),
    listMirrorCacheRetiredDevices: vi.fn(async () => []),
    releaseMirrorCacheRetiredDevice: vi.fn(async () => undefined),
    getDevicePresenceState: vi.fn(() => 'unknown' as const),
    nowMs: vi.fn(() => 1_000_000),
  };
}

describe('cloud instance IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires a signed-in resource session before any control-plane call', async () => {
    const testDeps = deps(null);
    await expect(handleListCloudInstances(testDeps)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(testDeps.client.list).not.toHaveBeenCalled();
  });

  it('releases a retired mirror device only after fresh list absence and explicit relay offline', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.listMirrorCacheRetiredDevices).mockResolvedValue([
      { deviceId: 'cloud-device-old', instanceId: 'instance-old', createdAtMs: 100 },
    ]);
    vi.mocked(testDeps.getDevicePresenceState).mockReturnValue('offline');

    await handleListCloudInstances(testDeps);

    expect(testDeps.releaseMirrorCacheRetiredDevice).toHaveBeenCalledWith('cloud-device-old');
  });

  it('keeps a retired mirror device blocked while relay still reports it online', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.listMirrorCacheRetiredDevices).mockResolvedValue([
      { deviceId: 'cloud-device-old', instanceId: 'instance-old', createdAtMs: 0 },
    ]);
    vi.mocked(testDeps.getDevicePresenceState).mockReturnValue('online');

    await handleListCloudInstances(testDeps);

    expect(testDeps.releaseMirrorCacheRetiredDevice).not.toHaveBeenCalled();
  });

  it('clears stale data and releases immediately when control plane reuses a tombstoned deviceId', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.listMirrorCacheRetiredDevices).mockResolvedValue([
      { deviceId: 'cloud-device-reused', instanceId: 'instance-old', createdAtMs: 100 },
    ]);
    vi.mocked(testDeps.client.list).mockResolvedValue({
      instances: [{ deviceId: 'cloud-device-reused', instanceId: 'instance-new' }],
    } as Awaited<ReturnType<CloudInstanceClient['list']>>);
    vi.mocked(testDeps.getDevicePresenceState).mockReturnValue('online');

    await handleListCloudInstances(testDeps);

    expect(testDeps.releaseMirrorCacheRetiredDevice).toHaveBeenCalledWith('cloud-device-reused');
  });

  it('does not confuse an asynchronously retiring old instance with deviceId reuse', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.listMirrorCacheRetiredDevices).mockResolvedValue([
      { deviceId: 'cloud-device-old', instanceId: 'instance-old', createdAtMs: 100 },
    ]);
    vi.mocked(testDeps.client.list).mockResolvedValue({
      instances: [{ deviceId: 'cloud-device-old', instanceId: 'instance-old' }],
    } as Awaited<ReturnType<CloudInstanceClient['list']>>);
    vi.mocked(testDeps.getDevicePresenceState).mockReturnValue('offline');

    await handleListCloudInstances(testDeps);

    expect(testDeps.releaseMirrorCacheRetiredDevice).not.toHaveBeenCalled();
  });

  it('uses bounded unknown-presence fallback only after fresh control-plane absence', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.listMirrorCacheRetiredDevices).mockResolvedValue([
      { deviceId: 'cloud-device-old', instanceId: 'instance-old', createdAtMs: 100 },
    ]);
    vi.mocked(testDeps.getDevicePresenceState).mockReturnValue('unknown');
    vi.mocked(testDeps.nowMs).mockReturnValue(
      100 + CLOUD_DEVICE_RETIREMENT_UNKNOWN_PRESENCE_GRACE_MS - 1,
    );

    await handleListCloudInstances(testDeps);
    expect(testDeps.releaseMirrorCacheRetiredDevice).not.toHaveBeenCalled();

    vi.mocked(testDeps.nowMs).mockReturnValue(
      100 + CLOUD_DEVICE_RETIREMENT_UNKNOWN_PRESENCE_GRACE_MS,
    );
    await handleListCloudInstances(testDeps);
    expect(testDeps.releaseMirrorCacheRetiredDevice).toHaveBeenCalledWith('cloud-device-old');
  });

  it('validates and forwards wake/create/status inputs without accepting a token', async () => {
    const testDeps = deps();

    await handleWakeCloudInstance(testDeps, {
      instanceId: ' instance-2 ',
      resourceTier: 'large',
    });
    await handleCreateCloudInstance(testDeps, {});
    await handleCloudInstanceStatus(testDeps, { instanceId: 'instance-2' });

    expect(testDeps.client.wake).toHaveBeenCalledWith({
      instanceId: 'instance-2',
      resourceTier: 'large',
    });
    expect(testDeps.client.create).toHaveBeenCalledWith({});
    expect(testDeps.client.status).toHaveBeenCalledWith('instance-2');
    await expect(
      handleWakeCloudInstance(testDeps, {
        resourceTier: 'oversized',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      handleWakeCloudInstance(testDeps, {
        callerAccessToken: 'must-not-be-accepted',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('trims custom labels and preserves null as restore-default', async () => {
    const testDeps = deps();
    await handleRenameCloudInstance(testDeps, {
      instanceId: 'instance-1',
      customLabel: '  Build  ',
    });
    await handleRenameCloudInstance(testDeps, {
      instanceId: 'instance-1',
      customLabel: null,
    });

    expect(testDeps.client.rename).toHaveBeenNthCalledWith(1, 'instance-1', 'Build');
    expect(testDeps.client.rename).toHaveBeenNthCalledWith(2, 'instance-1', null);
  });

  it('validates and forwards mutable instance settings', async () => {
    const testDeps = deps();
    await handlePatchCloudInstance(testDeps, {
      instanceId: ' instance-1 ',
      autoUpdate: true,
    });
    await handlePatchCloudInstance(testDeps, {
      instanceId: 'instance-1',
      customLabel: '  Build  ',
    });

    expect(testDeps.client.patch).toHaveBeenNthCalledWith(1, 'instance-1', {
      autoUpdate: true,
    });
    expect(testDeps.client.patch).toHaveBeenNthCalledWith(2, 'instance-1', {
      customLabel: 'Build',
    });
    await expect(handlePatchCloudInstance(testDeps, {
      instanceId: 'instance-1',
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(handlePatchCloudInstance(testDeps, {
      instanceId: 'instance-1',
      autoUpdate: 'yes',
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('validates and forwards stop/upgrade/delete inputs', async () => {
    const testDeps = deps();
    await handleStopCloudInstance(testDeps, { instanceId: ' instance-1 ' });
    await handleUpgradeCloudInstance(testDeps, { instanceId: ' instance-1 ' });
    await handleDeleteCloudInstance(testDeps, { instanceId: ' instance-2 ' });

    expect(testDeps.client.stop).toHaveBeenCalledWith('instance-1');
    expect(testDeps.client.upgrade).toHaveBeenCalledWith('instance-1');
    expect(testDeps.client.delete).toHaveBeenCalledWith('instance-2');
    // 删除成功后必须清掉该设备的名字缓存,防止已删云端以缓存旧名再现。
    expect(testDeps.forgetDeviceName).toHaveBeenCalledWith('cloud-device-a');
    expect(testDeps.retireMirrorCacheDevice).toHaveBeenCalledWith(
      'cloud-device-a',
      1_000_000,
      'instance-2',
    );
    await expect(handleStopCloudInstance(testDeps, {})).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    await expect(
      handleUpgradeCloudInstance(testDeps, { instanceId: 'instance-1', image: 'forbidden' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(
      handleDeleteCloudInstance(testDeps, { instanceId: 'instance-2', token: 'forbidden' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it.each([
    ['UPGRADE_IN_PROGRESS', 'CLOUD_INSTANCE_UPGRADE_IN_PROGRESS'],
    ['CLOUD_INSTANCE_UPGRADE_IN_PROGRESS', 'CLOUD_INSTANCE_UPGRADE_IN_PROGRESS'],
    ['NO_RELEASE_AVAILABLE', 'NO_RELEASE_AVAILABLE'],
  ])('preserves upgrade outcome %s as a stable IPC code', async (serverCode, ipcCode) => {
    const testDeps = deps();
    vi.mocked(testDeps.client.upgrade).mockRejectedValue(
      new ServerApiError(serverCode, 409, 'control-plane detail'),
    );

    await expect(
      handleUpgradeCloudInstance(testDeps, { instanceId: 'instance-1' }),
    ).rejects.toMatchObject({ code: ipcCode });
  });

  it('maps stop/delete control-plane failures through the shared IPC error contract', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.client.stop).mockRejectedValue(
      new ServerApiError('CLOUD_INSTANCE_NOT_FOUND', 404, 'missing'),
    );
    vi.mocked(testDeps.client.delete).mockRejectedValue(
      new ServerApiError('UPSTREAM', 503, 'unavailable'),
    );

    await expect(
      handleStopCloudInstance(testDeps, { instanceId: 'instance-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      handleDeleteCloudInstance(testDeps, { instanceId: 'instance-1' }),
    ).rejects.toMatchObject({ code: 'CLOUD_INSTANCE_UNAVAILABLE' });
    expect(testDeps.retireMirrorCacheDevice).not.toHaveBeenCalled();
  });

  it('keeps delete successful and logs when local mirror-cache cleanup fails', async () => {
    const testDeps = deps();
    const retirement = {
      deviceId: 'cloud-device-a',
      instanceId: 'instance-2',
      createdAtMs: 1_000_000,
    };
    vi.mocked(testDeps.retireMirrorCacheDevice).mockRejectedValue(new MirrorCachePurgeError(
      '/owners/member/device-link-mirror-cache',
      ['/owners/member/device-link-mirror-cache/messages/cloud-device-a.json'],
      new Error('cache locked'),
      ['cloud-device-a'],
      ['device:cloud-device-a'],
      [retirement],
    ));

    await expect(
      handleDeleteCloudInstance(testDeps, { instanceId: 'instance-2' }),
    ).resolves.toMatchObject({ status: { deviceId: 'cloud-device-a' } });

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'failed to clear deleted cloud instance mirror cache (cloud-de)',
      { error: 'device-link mirror cache purge incomplete: 1 file(s) remain' },
    );
    expect(purgeQueueMocks.enqueuePurge).toHaveBeenCalledWith(
      '/owners/member/device-link-mirror-cache',
      ['/owners/member/device-link-mirror-cache/messages/cloud-device-a.json'],
      ['cloud-device-a'],
      ['device:cloud-device-a'],
      [retirement],
    );
  });

  it('keeps delete successful and logs when the mirror-cache purge retry cannot be queued', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.retireMirrorCacheDevice).mockRejectedValue(new MirrorCachePurgeError(
      '/owners/member/device-link-mirror-cache',
      ['/owners/member/device-link-mirror-cache/messages/cloud-device-a.json'],
      new Error('cache locked'),
      ['cloud-device-a'],
      ['device:cloud-device-a'],
    ));
    purgeQueueMocks.enqueuePurge.mockRejectedValueOnce(new Error('purge queue unavailable'));

    await expect(
      handleDeleteCloudInstance(testDeps, { instanceId: 'instance-2' }),
    ).resolves.toMatchObject({ status: { deviceId: 'cloud-device-a' } });

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'failed to queue deleted cloud instance mirror-cache purge retry',
      { error: 'purge queue unavailable' },
    );
  });

  it('clears only the deleted device from the injected mirror cache', async () => {
    const testDeps = deps();
    const cachedDeviceIds = new Set(['cloud-device-a', 'cloud-device-b']);
    vi.mocked(testDeps.retireMirrorCacheDevice).mockImplementation(async (deviceId) => {
      cachedDeviceIds.delete(deviceId);
    });

    await handleDeleteCloudInstance(testDeps, { instanceId: 'instance-2' });

    expect(cachedDeviceIds).toEqual(new Set(['cloud-device-b']));
  });

  it.each([
    [new CloudInstanceClientNotConfiguredError(), 'UNSUPPORTED_CAPABILITY'],
    [new ServerApiError('NETWORK_ERROR', 0, 'offline'), 'CLOUD_INSTANCE_UNAVAILABLE'],
    [new ServerApiError('UPSTREAM', 503, 'unavailable'), 'CLOUD_INSTANCE_UNAVAILABLE'],
    [new ServerApiError('CLOUD_PROVIDER_DISABLED', 403, 'disabled'), 'UNSUPPORTED_CAPABILITY'],
    [new ServerApiError('CLOUD_INSTANCE_DISABLED', 403, 'disabled'), 'CLOUD_INSTANCE_DISABLED'],
    [new ServerApiError('FORBIDDEN', 403, 'forbidden'), 'PERMISSION_DENIED'],
    [new ServerApiError('CLOUD_INSTANCE_NOT_FOUND', 404, 'missing'), 'NOT_FOUND'],
    [new ServerApiError('MULTIPLE_INSTANCES_REQUIRE_ID', 400, 'ambiguous'), 'INVALID_PARAMS'],
  ])('maps control-plane failure %# to a stable IPC code', async (error, code) => {
    const testDeps = deps();
    vi.mocked(testDeps.client.list).mockRejectedValue(error);
    await expect(handleListCloudInstances(testDeps)).rejects.toMatchObject({
      code,
    });
  });

  it('never exposes a control-plane response message through IPC errors', async () => {
    const testDeps = deps();
    const marker = 'TOKEN_MARKER_DO_NOT_EXPOSE';
    vi.mocked(testDeps.client.list).mockRejectedValue(
      new ServerApiError('UPSTREAM', 503, marker),
    );

    await expect(handleListCloudInstances(testDeps)).rejects.not.toMatchObject({
      message: expect.stringContaining(marker),
    });
  });
});

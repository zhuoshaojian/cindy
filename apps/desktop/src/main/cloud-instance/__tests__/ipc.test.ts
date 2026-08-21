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
  handleContinueCloudInstanceRebuild,
  handleCreateCloudInstance,
  handleDeleteCloudInstance,
  handleListCloudInstances,
  handlePatchCloudInstance,
  handleRebuildCloudInstance,
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
    rebuild: vi.fn().mockResolvedValue({
      rebuildOperation: {
        operationId: 'rebuild-operation-a',
        oldInstanceId: 'instance-1',
        oldDeviceId: 'cloud-device-a',
        resourceTier: 'small',
        phase: 'retiring',
        startedAt: 1,
        retireDeadline: 2,
        clientCreateDeadline: null,
        createDeadline: null,
        newInstanceId: null,
        outcome: null,
        updatedAt: 1,
      },
    }),
    continueRebuild: vi.fn().mockResolvedValue({
      rebuildOperation: {
        operationId: 'rebuild-operation-a',
        oldInstanceId: 'instance-1',
        oldDeviceId: 'cloud-device-a',
        resourceTier: 'small',
        phase: 'creating',
        startedAt: 1,
        retireDeadline: 2,
        clientCreateDeadline: 3,
        createDeadline: 4,
        newInstanceId: 'instance-2',
        outcome: null,
        updatedAt: 2,
      },
    }),
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
    captureMirrorCacheOwnerScope: vi.fn(async () => ({
      ownerRoot: '/data/owners/owner-a/device-link-mirror-cache',
      accountCounter: 7,
    })),
    reconcileMirrorCacheCloudDevices: vi.fn(async () => undefined),
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

  it('reconciles mirror cache from the complete successful membership list before retirement release', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.client.list).mockResolvedValue({
      instances: [{ deviceId: 'cloud-device-a' }, { deviceId: 'cloud-device-b' }],
    } as Awaited<ReturnType<CloudInstanceClient['list']>>);

    await handleListCloudInstances(testDeps);

    expect(testDeps.reconcileMirrorCacheCloudDevices).toHaveBeenCalledWith(
      ['cloud-device-a', 'cloud-device-b'],
      '/data/owners/owner-a/device-link-mirror-cache',
      7,
    );
    expect(
      vi.mocked(testDeps.captureMirrorCacheOwnerScope).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(testDeps.client.list).mock.invocationCallOrder[0]);
    expect(
      vi.mocked(testDeps.reconcileMirrorCacheCloudDevices).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(testDeps.releaseMirrorCacheRetiredDevice).mock.invocationCallOrder[0]
      ?? Number.POSITIVE_INFINITY);
  });

  it('does not publish an empty authority set when the control-plane list fails', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.client.list).mockRejectedValue(new Error('offline'));

    await expect(handleListCloudInstances(testDeps)).rejects.toMatchObject({
      code: 'INTERNAL',
    });

    expect(testDeps.reconcileMirrorCacheCloudDevices).not.toHaveBeenCalled();
  });

  it('hydrates a missing mirror retirement tombstone from rebuild operations', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.client.list).mockResolvedValue({
      instances: [],
      rebuildOperations: [{
        operationId: 'rebuild-operation-a',
        oldInstanceId: 'instance-old',
        oldDeviceId: 'cloud-device-old',
        resourceTier: 'small',
        phase: 'retiring',
        startedAt: 1234,
        retireDeadline: 5678,
        clientCreateDeadline: null,
        createDeadline: null,
        newInstanceId: null,
        outcome: null,
        updatedAt: 2345,
      }],
    });

    await handleListCloudInstances(testDeps);

    expect(testDeps.forgetDeviceName).toHaveBeenCalledWith('cloud-device-old');
    expect(testDeps.retireMirrorCacheDevice).toHaveBeenCalledWith(
      'cloud-device-old',
      1234,
      'instance-old',
    );
  });

  it('returns the successful list when local cloud session-list reconciliation fails', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.reconcileMirrorCacheCloudDevices).mockRejectedValue(
      new Error('cache locked'),
    );

    await expect(handleListCloudInstances(testDeps)).resolves.toEqual({ instances: [] });
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'failed to reconcile cloud device mirror-cache session list',
      { error: 'cache locked' },
    );
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

  it('validates rebuild inputs, forwards the retry seed, and retires the old mirror', async () => {
    const testDeps = deps();

    await handleRebuildCloudInstance(testDeps, {
      instanceId: ' instance-1 ',
      retryOfOperationId: ' rejected-operation-a ',
    });
    await handleContinueCloudInstanceRebuild(testDeps, {
      operationId: ' rebuild-operation-a ',
      oldInstanceId: ' instance-1 ',
      retryOfOperationId: ' rejected-operation-a ',
    });

    expect(testDeps.client.rebuild).toHaveBeenCalledWith(
      'instance-1',
      'rejected-operation-a',
    );
    expect(testDeps.client.continueRebuild).toHaveBeenCalledWith(
      'rebuild-operation-a',
      'instance-1',
      'rejected-operation-a',
    );
    expect(testDeps.forgetDeviceName).toHaveBeenCalledWith('cloud-device-a');
    expect(testDeps.retireMirrorCacheDevice).toHaveBeenCalledWith(
      'cloud-device-a',
      1_000_000,
      'instance-1',
    );
    await expect(handleRebuildCloudInstance(testDeps, {
      instanceId: 'instance-1',
      retryOfOperationId: 'x'.repeat(129),
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('does not retire a live mirror when an idempotent replay reports delete-rejected', async () => {
    const testDeps = deps();
    vi.mocked(testDeps.client.rebuild).mockResolvedValue({
      rebuildOperation: {
        operationId: 'rebuild-operation-a',
        oldInstanceId: 'instance-1',
        oldDeviceId: 'cloud-device-a',
        resourceTier: 'small',
        phase: 'delete-rejected',
        startedAt: 1,
        retireDeadline: 2,
        clientCreateDeadline: null,
        createDeadline: null,
        newInstanceId: null,
        outcome: 'delete-rejected',
        updatedAt: 2,
      },
    });

    await handleRebuildCloudInstance(testDeps, { instanceId: 'instance-1' });

    expect(testDeps.forgetDeviceName).not.toHaveBeenCalled();
    expect(testDeps.retireMirrorCacheDevice).not.toHaveBeenCalled();
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
    [new ServerApiError('INVALID_IDEMPOTENCY_KEY', 400, 'bad key'), 'CLOUD_INSTANCE_INVALID_IDEMPOTENCY_KEY'],
    [new ServerApiError('REBUILD_IN_PROGRESS', 409, 'busy'), 'CLOUD_INSTANCE_REBUILD_IN_PROGRESS'],
    [new ServerApiError('IDEMPOTENCY_KEY_REUSED', 409, 'reused'), 'CLOUD_INSTANCE_IDEMPOTENCY_KEY_REUSED'],
    [new ServerApiError('REBUILD_OPERATION_NOT_FOUND', 404, 'missing'), 'CLOUD_INSTANCE_REBUILD_OPERATION_NOT_FOUND'],
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

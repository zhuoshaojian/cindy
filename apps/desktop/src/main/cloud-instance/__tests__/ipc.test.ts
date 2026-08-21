import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerApiError } from '../../serverApiClient.js';
import { CloudInstanceClientNotConfiguredError, type CloudInstanceClient } from '../client.js';
import {
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
      status: {},
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
    expect(testDeps.forgetDeviceName).toHaveBeenCalledTimes(1);
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

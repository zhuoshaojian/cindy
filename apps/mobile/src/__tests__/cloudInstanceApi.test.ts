import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudInstanceApiFetch } from '@/api/cloudInstance';

function normalizedStatus(patch: Record<string, unknown> = {}) {
  return {
    ...patch,
    image: typeof patch.image === 'string' && patch.image.trim() ? patch.image.trim() : null,
    updateAvailable: patch.updateAvailable === true,
    latestReleaseTag: typeof patch.latestReleaseTag === 'string' ? patch.latestReleaseTag : null,
    lastFailedUpgradeImage:
      typeof patch.lastFailedUpgradeImage === 'string' ? patch.lastFailedUpgradeImage : null,
    upgrade: {
      state: 'idle' as const,
      targetImage: null,
      previousImage: null,
      deadlineAtMs: null,
    },
  };
}

async function loadCloudInstanceApi(baseUrl: string | undefined) {
  if (baseUrl === undefined) {
    delete process.env.EXPO_PUBLIC_XDT_CLOUD_INSTANCE_API_BASE_URL;
  } else {
    process.env.EXPO_PUBLIC_XDT_CLOUD_INSTANCE_API_BASE_URL = baseUrl;
  }
  vi.resetModules();
  const client = await import('@/api/client');
  const cloudInstance = await import('@/api/cloudInstance');
  return { ...client, ...cloudInstance };
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_XDT_CLOUD_INSTANCE_API_BASE_URL;
  vi.resetModules();
});

describe('mobile cloud-instance API', () => {
  it('lists instances through authenticated apiFetch and parses the response', async () => {
    const { listCloudInstances } = await loadCloudInstanceApi('https://cloud.example.invalid/');
    const apiFetch = vi.fn(async () => ({
      instances: [
        {
          instanceId: 'instance-1',
          deviceId: 'device-1',
          nameSequence: 2,
          customLabel: null,
          status: {
            image: ' registry.example/public/cindy-cloud:0.1.7@sha256:abc ',
            runtimeState: 'stopped',
          },
        },
      ],
    }));

    await expect(
      listCloudInstances({ apiFetch: apiFetch as unknown as CloudInstanceApiFetch }),
    ).resolves.toEqual({
      kind: 'ok',
      value: {
        instances: [
          {
            instanceId: 'instance-1',
            deviceId: 'device-1',
            nameSequence: 2,
            customLabel: null,
            status: normalizedStatus({
              image: 'registry.example/public/cindy-cloud:0.1.7@sha256:abc',
              runtimeState: 'stopped',
            }),
          },
        ],
        rebuildOperations: [],
      },
    });
    expect(apiFetch).toHaveBeenCalledWith('/instances', {
      baseUrl: 'https://cloud.example.invalid',
      method: 'GET',
      timeoutMs: 30_000,
    });
  });

  it('parses active rebuild operations from the atomic instance snapshot', async () => {
    const { listCloudInstances } = await loadCloudInstanceApi('https://cloud.example.invalid/');
    const operation = {
      operationId: 'op-1',
      oldInstanceId: 'old-1',
      oldDeviceId: 'device-old-1',
      resourceTier: 'small',
      phase: 'retiring',
      startedAt: 1,
      retireDeadline: 2,
      clientCreateDeadline: null,
      createDeadline: null,
      newInstanceId: null,
      outcome: null,
      updatedAt: 3,
    };
    const apiFetch = vi.fn(async () => ({ instances: [], rebuildOperations: [operation] }));

    await expect(
      listCloudInstances({ apiFetch: apiFetch as unknown as CloudInstanceApiFetch }),
    ).resolves.toEqual({ kind: 'ok', value: { instances: [], rebuildOperations: [operation] } });
  });

  it('wakes the zero-instance path with an empty body and a targeted instance with its id', async () => {
    const { wakeCloudInstance } = await loadCloudInstanceApi('https://cloud.example.invalid');
    const response = {
      instanceId: 'instance-1',
      deviceId: 'device-1',
      nameSequence: 1,
      customLabel: '工作云端',
      created: false,
      status: { runtimeState: 'starting' },
    };
    const apiFetch = vi.fn(async () => response);

    const authenticatedFetch = apiFetch as unknown as CloudInstanceApiFetch;
    await expect(wakeCloudInstance(undefined, { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'ok',
      value: { ...response, status: normalizedStatus(response.status) },
    });
    await wakeCloudInstance('instance-1', { apiFetch: authenticatedFetch });

    expect(apiFetch).toHaveBeenNthCalledWith(1, '/instances/wake', {
      baseUrl: 'https://cloud.example.invalid',
      method: 'POST',
      timeoutMs: 30_000,
      body: {},
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/instances/wake', {
      baseUrl: 'https://cloud.example.invalid',
      method: 'POST',
      timeoutMs: 30_000,
      body: { instanceId: 'instance-1' },
    });
  });

  it('stops and deletes a targeted instance with encoded paths', async () => {
    const { deleteCloudInstance, stopCloudInstance } = await loadCloudInstanceApi(
      'https://cloud.example.invalid/',
    );
    const apiFetch = vi.fn()
      .mockResolvedValueOnce({ status: { runtimeState: 'stopped' } })
      .mockResolvedValueOnce({
        status: { runtimeState: 'deleted' },
        archiveCleanup: 'removed',
      });
    const authenticatedFetch = apiFetch as unknown as CloudInstanceApiFetch;

    await expect(stopCloudInstance('instance/a', { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'ok',
      value: { status: normalizedStatus({ runtimeState: 'stopped' }) },
    });
    await expect(deleteCloudInstance('instance/a', { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'ok',
      value: {
        status: normalizedStatus({ runtimeState: 'deleted' }),
        archiveCleanup: 'removed',
      },
    });
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/instances/instance%2Fa/stop', {
      baseUrl: 'https://cloud.example.invalid',
      method: 'POST',
      timeoutMs: 30_000,
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/instances/instance%2Fa', {
      baseUrl: 'https://cloud.example.invalid',
      method: 'DELETE',
      timeoutMs: 30_000,
    });
  });

  it('upgrades without a client-selected image and normalizes release hints', async () => {
    const { upgradeCloudInstance } = await loadCloudInstanceApi('https://cloud.example.invalid');
    const apiFetch = vi.fn(async () => ({
      status: {
        runtimeState: 'running',
        updateAvailable: true,
        latestReleaseTag: 'v1.2.3',
        upgrade: {
          state: 'verifying',
          targetImage: 'registry.example/cindy:v1.2.3',
          previousImage: 'registry.example/cindy:v1.2.2',
          deadlineAtMs: 1234,
        },
      },
      outcome: 'verifying',
    }));

    await expect(
      upgradeCloudInstance('instance/a', {
        apiFetch: apiFetch as unknown as CloudInstanceApiFetch,
      }),
    ).resolves.toMatchObject({
      kind: 'ok',
      value: {
        outcome: 'verifying',
        status: {
          updateAvailable: true,
          latestReleaseTag: 'v1.2.3',
          upgrade: { state: 'verifying' },
        },
      },
    });
    expect(apiFetch).toHaveBeenCalledWith('/instances/instance%2Fa/upgrade', {
      baseUrl: 'https://cloud.example.invalid',
      method: 'POST',
      timeoutMs: 30_000,
    });
  });

  it('patches auto-update and preserves support detection in status parsing', async () => {
    const { listCloudInstances, patchCloudInstance } = await loadCloudInstanceApi(
      'https://cloud.example.invalid',
    );
    const apiFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        instances: [{
          instanceId: 'instance-1',
          deviceId: 'device-1',
          nameSequence: 1,
          customLabel: null,
          status: { autoUpdate: false },
        }],
      })
      .mockResolvedValueOnce({
        instances: [{
          instanceId: 'instance-1',
          deviceId: 'device-1',
          nameSequence: 1,
          customLabel: null,
          status: {},
        }],
      });
    const authenticatedFetch = apiFetch as unknown as CloudInstanceApiFetch;

    await expect(patchCloudInstance(
      'instance/a',
      { autoUpdate: true },
      { apiFetch: authenticatedFetch },
    )).resolves.toEqual({ kind: 'ok', value: true });
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/instances/instance%2Fa', {
      baseUrl: 'https://cloud.example.invalid',
      body: { autoUpdate: true },
      method: 'PATCH',
      timeoutMs: 30_000,
    });

    const supported = await listCloudInstances({ apiFetch: authenticatedFetch });
    const legacy = await listCloudInstances({ apiFetch: authenticatedFetch });
    expect(supported).toMatchObject({
      kind: 'ok',
      value: { instances: [{ status: { autoUpdate: false } }] },
    });
    expect(legacy).toMatchObject({ kind: 'ok' });
    if (legacy.kind === 'ok') {
      expect(legacy.value.instances[0]?.status).not.toHaveProperty('autoUpdate');
    }
  });

  it('passes the model-access observation through and drops unknown values', async () => {
    const { listCloudInstances } = await loadCloudInstanceApi(
      'https://cloud.example.invalid',
    );
    const row = (readiness: unknown) => ({
      instanceId: 'instance-1',
      deviceId: 'device-1',
      nameSequence: 1,
      customLabel: null,
      status: { readiness },
    });
    const apiFetch = vi.fn()
      .mockResolvedValueOnce({ instances: [row({ ready: true, modelAccess: 'not-ready' })] })
      .mockResolvedValueOnce({ instances: [row({ ready: true })] })
      .mockResolvedValueOnce({ instances: [row({ ready: true, modelAccess: 'later-new-state' })] });
    const authenticatedFetch = apiFetch as unknown as CloudInstanceApiFetch;

    const stale = await listCloudInstances({ apiFetch: authenticatedFetch });
    expect(stale).toMatchObject({
      kind: 'ok',
      value: { instances: [{ status: { modelAccess: 'not-ready' } }] },
    });
    // 旧控制面缺字段 / 未来新增取值:都按缺省处理,不进视图也不报错。
    for (const outcome of [
      await listCloudInstances({ apiFetch: authenticatedFetch }),
      await listCloudInstances({ apiFetch: authenticatedFetch }),
    ]) {
      expect(outcome).toMatchObject({ kind: 'ok' });
      if (outcome.kind === 'ok') {
        expect(outcome.value.instances[0]?.status).not.toHaveProperty('modelAccess');
      }
    }
  });

  it('maps structured API errors without exposing credentials', async () => {
    const { ApiError, listCloudInstances } = await loadCloudInstanceApi(
      'https://cloud.example.invalid',
    );
    const apiFetch = vi.fn(async () => {
      throw new ApiError(
        'MULTIPLE_INSTANCES_REQUIRE_ID',
        400,
        'Choose an instance',
      );
    });

    await expect(
      listCloudInstances({ apiFetch: apiFetch as unknown as CloudInstanceApiFetch }),
    ).resolves.toEqual({
      kind: 'error',
      error: {
        code: 'MULTIPLE_INSTANCES_REQUIRE_ID',
        message: 'Choose an instance',
        status: 400,
      },
    });
  });

  it('maps server-side cloud disablement to unsupported without exposing the disabled UI state', async () => {
    const { ApiError, listCloudInstances } = await loadCloudInstanceApi(
      'https://cloud.example.invalid',
    );
    const apiFetch = vi.fn(async () => {
      throw new ApiError(
        'CLOUD_INSTANCE_DISABLED',
        403,
        'cloud instances are not enabled for this membership',
      );
    });

    await expect(
      listCloudInstances({ apiFetch: apiFetch as unknown as CloudInstanceApiFetch }),
    ).resolves.toEqual({ kind: 'unsupported' });
  });

  it('maps malformed responses to INVALID_RESPONSE', async () => {
    const { listCloudInstances } = await loadCloudInstanceApi('https://cloud.example.invalid');
    const apiFetch = vi.fn(async () => ({ instances: [{ instanceId: 'missing-fields' }] }));

    await expect(
      listCloudInstances({ apiFetch: apiFetch as unknown as CloudInstanceApiFetch }),
    ).resolves.toMatchObject({
      kind: 'error',
      error: { code: 'INVALID_RESPONSE', status: 0 },
    });
  });

  it('returns unsupported without issuing a request when the endpoint is empty', async () => {
    const {
      deleteCloudInstance,
      listCloudInstances,
      stopCloudInstance,
      upgradeCloudInstance,
      wakeCloudInstance,
    } = await loadCloudInstanceApi(undefined);
    const apiFetch = vi.fn();

    const authenticatedFetch = apiFetch as unknown as CloudInstanceApiFetch;
    await expect(listCloudInstances({ apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'unsupported',
    });
    await expect(wakeCloudInstance(undefined, { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'unsupported',
    });
    await expect(stopCloudInstance('instance-1', { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'unsupported',
    });
    await expect(upgradeCloudInstance('instance-1', { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'unsupported',
    });
    await expect(deleteCloudInstance('instance-1', { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'unsupported',
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

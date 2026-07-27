import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudInstanceApiFetch } from '@/api/cloudInstance';

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
          status: { runtimeState: 'stopped' },
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
            status: { runtimeState: 'stopped' },
          },
        ],
      },
    });
    expect(apiFetch).toHaveBeenCalledWith('/instances', {
      baseUrl: 'https://cloud.example.invalid',
      method: 'GET',
      timeoutMs: 30_000,
    });
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
      value: response,
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
        revocation: { status: 'revoked' },
        archiveCleanup: 'removed',
      });
    const authenticatedFetch = apiFetch as unknown as CloudInstanceApiFetch;

    await expect(stopCloudInstance('instance/a', { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'ok',
      value: { status: { runtimeState: 'stopped' } },
    });
    await expect(deleteCloudInstance('instance/a', { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'ok',
      value: {
        status: { runtimeState: 'deleted' },
        revocation: { status: 'revoked' },
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
    await expect(deleteCloudInstance('instance-1', { apiFetch: authenticatedFetch })).resolves.toEqual({
      kind: 'unsupported',
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiFetchOptions } from '../../serverApiClient.js';

const defaultMocks = vi.hoisted(() => ({
  getClientEndpoint: vi.fn(),
  serverApiFetch: vi.fn(),
}));

vi.mock('../../clientEndpointsService.js', () => ({
  getClientEndpoint: defaultMocks.getClientEndpoint,
}));
vi.mock('../../serverApiClient.js', () => ({
  serverApiFetch: defaultMocks.serverApiFetch,
}));

import {
  CloudInstanceClientNotConfiguredError,
  createCloudInstanceClient,
  createDefaultCloudInstanceClient,
  type CloudInstanceRequest,
} from '../client.js';

describe('cloud instance HTTP client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps every operation to the standalone control-plane contract with a deadline', async () => {
    const requestMock = vi.fn(async (path: string, options: ApiFetchOptions) => {
      void path;
      void options;
      return {};
    });
    const request: CloudInstanceRequest = async <T>(
      path: string,
      options: ApiFetchOptions,
    ): Promise<T> => (await requestMock(path, options)) as T;
    const client = createCloudInstanceClient({
      getBaseUrl: () => 'http://127.0.0.1:3343',
      request,
      timeoutMs: 12_345,
    });

    await client.list();
    await client.wake({ instanceId: 'instance/a', resourceTier: 'large' });
    await client.create({ resourceTier: 'small' });
    await client.rename('instance/a', 'Build');
    await client.patch('instance/a', { autoUpdate: true });
    await client.status('instance/a');
    await client.stop('instance/a');
    await client.upgrade('instance/a');
    await client.delete('instance/a');

    expect(requestMock.mock.calls).toEqual([
      [
        '/instances',
        {
          method: 'GET',
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
      [
        '/instances/wake',
        {
          method: 'POST',
          body: { instanceId: 'instance/a', resourceTier: 'large' },
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
      [
        '/instances',
        {
          method: 'POST',
          body: { resourceTier: 'small' },
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
      [
        '/instances/instance%2Fa',
        {
          method: 'PATCH',
          body: { customLabel: 'Build' },
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
      [
        '/instances/instance%2Fa',
        {
          method: 'PATCH',
          body: { autoUpdate: true },
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
      [
        '/instances/status?instanceId=instance%2Fa',
        {
          method: 'GET',
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
      [
        '/instances/instance%2Fa/stop',
        {
          method: 'POST',
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
      [
        '/instances/instance%2Fa/upgrade',
        {
          method: 'POST',
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
      [
        '/instances/instance%2Fa',
        {
          method: 'DELETE',
          baseUrl: 'http://127.0.0.1:3343',
          timeoutMs: 12_345,
          logMetadataOnly: true,
        },
      ],
    ]);
    for (const [, options] of requestMock.mock.calls) {
      expect(options).not.toHaveProperty('token');
    }
  });

  it('fails closed when the endpoint manifest omits the service', async () => {
    const client = createCloudInstanceClient({
      getBaseUrl: () => '   ',
      request: vi.fn(),
    });
    await expect(client.list()).rejects.toBeInstanceOf(CloudInstanceClientNotConfiguredError);
  });

  it('default wiring reads the endpoint manifest and leaves live token injection to serverApiFetch', async () => {
    defaultMocks.getClientEndpoint.mockReturnValue('http://127.0.0.1:3343');
    defaultMocks.serverApiFetch.mockResolvedValue({ instances: [] });

    await expect(createDefaultCloudInstanceClient().list()).resolves.toEqual({
      instances: [],
    });

    expect(defaultMocks.getClientEndpoint).toHaveBeenCalledWith('cloudInstanceApiBaseUrl');
    expect(defaultMocks.serverApiFetch).toHaveBeenCalledWith('/instances', {
      method: 'GET',
      baseUrl: 'http://127.0.0.1:3343',
      timeoutMs: 30_000,
      logMetadataOnly: true,
    });
    // No explicit token is frozen in the client options. serverApiClient reads
    // authManager.getAccessToken() for this attempt and again after refresh.
    expect(defaultMocks.serverApiFetch.mock.calls[0]?.[1]).not.toHaveProperty('token');
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapPodProvisioning,
  createNodeFetchAdapter,
  POD_ACCOUNT_REFRESH_TOKEN_ENV,
  POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV,
  POD_DEVICE_ID_ENV,
  POD_MEMBERSHIP_ID_ENV,
  resolvePodProvisioningConfig,
  resolvePodDeviceIdOverride,
} from '../pod-provisioning.js';
import type { AuthFetch, AuthFetchResponse } from '@cindy/auth-client';

const membership = (id: string, kind: 'personal' | 'org') => ({
  id,
  kind,
  role: kind === 'personal' ? 'owner' : 'member',
  displayName: id,
  avatarUrl: null,
  email: `${id}@example.test`,
  orgId: kind === 'org' ? 'org-1' : null,
  orgName: kind === 'org' ? 'Example' : null,
  orgSlug: kind === 'org' ? 'example' : null,
});

function response(body: unknown, ok = true, status = 200): AuthFetchResponse {
  return { ok, status, json: async () => body };
}

describe('Pod provisioning bootstrap', () => {
  it('refreshes, lists memberships, exchanges, then installs the personal session', async () => {
    const calls: Array<{
      path: string;
      method: string;
      body?: unknown;
      token?: string;
      hasSignal: boolean;
    }> = [];
    const events: string[] = [];
    const logger = { info: vi.fn() };
    const fetch = vi.fn(async (input: string, init?: Parameters<AuthFetch>[1]) => {
      const request = init!;
      const url = new URL(input);
      calls.push({
        path: url.pathname,
        method: request.method!,
        body: request.body ? JSON.parse(request.body) : undefined,
        token: request.headers?.Authorization?.replace('Bearer ', ''),
        hasSignal: request.signal instanceof AbortSignal,
      });
      if (url.pathname.endsWith('/refresh')) {
        events.push('refresh');
        return response({
          accountToken: 'account-access',
          accountRefreshToken: 'account-rotated',
        });
      }
      if (url.pathname.endsWith('/account')) {
        events.push('list');
        return response({
          memberships: [
            membership('org-membership', 'org'),
            membership('personal-membership', 'personal'),
          ],
        });
      }
      events.push('exchange');
      return response({
        accessToken: 'resource-access',
        refreshToken: 'resource-refresh',
        membership: membership('personal-membership', 'personal'),
      });
    });
    const persist = vi.fn(() => events.push('persist'));
    const install = vi.fn(() => events.push('install'));

    await expect(
      bootstrapPodProvisioning({
        env: {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'account-injected',
          [POD_DEVICE_ID_ENV]: 'pod-1',
        },
        getAuthBaseUrl: () => 'http://localhost:3344/',
        authRegion: 'cn',
        fetch,
        logger,
        readPersistedAccountRefreshToken: () => null,
        readPersistedMembershipId: () => null,
        persistAccountRefreshToken: persist,
        persistMembershipId: vi.fn(),
        installSession: install,
      }),
    ).resolves.toBe(true);

    expect(calls).toEqual([
      {
        path: '/api/auth/account/refresh',
        method: 'POST',
        body: { accountRefreshToken: 'account-injected', deviceId: 'pod-1' },
        token: undefined,
        hasSignal: true,
      },
      {
        path: '/api/auth/account',
        method: 'GET',
        token: 'account-access',
        hasSignal: true,
      },
      {
        path: '/api/auth/account/exchange',
        method: 'POST',
        body: { membershipId: 'personal-membership' },
        token: 'account-access',
        hasSignal: true,
      },
    ]);
    expect(persist).toHaveBeenCalledWith('account-rotated');
    expect(events).toEqual(['refresh', 'persist', 'list', 'exchange', 'install']);
    expect(logger.info.mock.calls.map(([message]) => message)).toEqual([
      'Pod provisioning account refresh start',
      'Pod provisioning account refresh ok',
      'Pod provisioning memberships fetch start',
      'Pod provisioning memberships fetched',
      'Pod provisioning account exchange start',
      'Pod provisioning account exchange ok',
      'Pod provisioning session install start',
      'Pod provisioning session installed',
    ]);
    expect(install).toHaveBeenCalledWith({
      accessToken: 'resource-access',
      refreshToken: 'resource-refresh',
      membership: expect.objectContaining({
        id: 'personal-membership',
        kind: 'personal',
      }),
      deviceId: 'pod-1',
    });
  });

  it('skips without provisioning environment and does not touch credentials', async () => {
    const fetch = vi.fn();
    const read = vi.fn(() => null);
    const install = vi.fn();
    await expect(
      bootstrapPodProvisioning({
        env: {},
        getAuthBaseUrl: () => 'http://localhost:3344',
        authRegion: 'cn',
        fetch,
        logger: { info: vi.fn() },
        readPersistedAccountRefreshToken: read,
        readPersistedMembershipId: () => null,
        persistAccountRefreshToken: vi.fn(),
        persistMembershipId: vi.fn(),
        installSession: install,
      }),
    ).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('uses the rotated persisted account token on restart', async () => {
    const readSecretFile = vi.fn(() => 'mounted-secret');
    const fetch = vi.fn(async (input: string, _init?: Parameters<AuthFetch>[1]) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/refresh')) {
        return response({ accountToken: 'account-access', accountRefreshToken: 'next-rotation' });
      }
      if (path.endsWith('/account')) {
        return response({ memberships: [membership('personal', 'personal')] });
      }
      return response({
        accessToken: 'resource-access',
        refreshToken: 'resource-refresh',
        membership: membership('personal', 'personal'),
      });
    });

    await expect(
      bootstrapPodProvisioning({
        env: {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'stale-injected',
          [POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV]: '/run/secrets/pod-token',
          [POD_DEVICE_ID_ENV]: 'pod-2',
        },
        getAuthBaseUrl: () => 'http://localhost:3344',
        authRegion: 'cn',
        fetch,
        logger: { info: vi.fn() },
        readPersistedAccountRefreshToken: () => 'persisted-rotation',
        readPersistedMembershipId: () => null,
        readSecretFile,
        persistAccountRefreshToken: vi.fn(),
        persistMembershipId: vi.fn(),
        installSession: vi.fn(),
      }),
    ).resolves.toBe(true);

    const refreshCall = fetch.mock.calls[0];
    expect(JSON.parse(refreshCall[1]?.body ?? '{}')).toEqual({
      accountRefreshToken: 'persisted-rotation',
      deviceId: 'pod-2',
    });
    expect(readSecretFile).not.toHaveBeenCalled();
  });

  it('prefers a mounted secret over an inline token for initial provisioning', () => {
    const readSecretFile = vi.fn(() => ' mounted-token\n');
    expect(
      resolvePodProvisioningConfig(
        {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'inline-token',
          [POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV]: '/run/secrets/account-refresh-token',
          [POD_DEVICE_ID_ENV]: 'pod-secret',
        },
        null,
        null,
        readSecretFile,
      ),
    ).toEqual({
      accountRefreshToken: 'mounted-token',
      deviceId: 'pod-secret',
      membershipId: null,
    });
  });

  it('fails closed when the injected membership conflicts with persisted identity', () => {
    expect(() =>
      resolvePodProvisioningConfig(
        {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'token',
          [POD_DEVICE_ID_ENV]: 'pod-conflict',
          [POD_MEMBERSHIP_ID_ENV]: 'org-membership',
        },
        null,
        'personal-membership',
        () => 'unused',
      ),
    ).toThrow('does not match the persisted Pod membership');
  });

  it('fails closed when an explicit membership is unavailable', async () => {
    const exchange = vi.fn();
    const install = vi.fn();
    const fetch = vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/refresh')) {
        return response({ accountToken: 'account-access', accountRefreshToken: 'rotated-token' });
      }
      if (path.endsWith('/account')) {
        return response({ memberships: [membership('personal-membership', 'personal')] });
      }
      exchange();
      return response({});
    });

    await expect(
      bootstrapPodProvisioning({
        env: {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'initial',
          [POD_DEVICE_ID_ENV]: 'pod-org-missing',
          [POD_MEMBERSHIP_ID_ENV]: 'org-membership-missing',
        },
        getAuthBaseUrl: () => 'http://localhost:3344',
        authRegion: 'cn',
        fetch,
        logger: { info: vi.fn() },
        readPersistedAccountRefreshToken: () => null,
        readPersistedMembershipId: () => null,
        persistAccountRefreshToken: vi.fn(),
        persistMembershipId: vi.fn(),
        installSession: install,
      }),
    ).rejects.toThrow('requested membership was not found');
    expect(exchange).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('stops before membership fetch when rotated token persistence fails', async () => {
    const fetch = vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/refresh')) {
        return response({ accountToken: 'account-access', accountRefreshToken: 'rotated-token' });
      }
      throw new Error('membership fetch must not run');
    });

    await expect(
      bootstrapPodProvisioning({
        env: {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'initial',
          [POD_DEVICE_ID_ENV]: 'pod-persist-failure',
        },
        getAuthBaseUrl: () => 'http://localhost:3344',
        authRegion: 'cn',
        fetch,
        logger: { info: vi.fn() },
        readPersistedAccountRefreshToken: () => null,
        readPersistedMembershipId: () => null,
        persistAccountRefreshToken: () => {
          throw new Error('safeStorage unavailable');
        },
        persistMembershipId: vi.fn(),
        installSession: vi.fn(),
      }),
    ).rejects.toThrow('safeStorage unavailable');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects an empty mounted secret instead of falling back silently', () => {
    expect(() =>
      resolvePodProvisioningConfig(
        {
          [POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV]: '/run/secrets/empty-token',
          [POD_DEVICE_ID_ENV]: 'pod-empty-secret',
        },
        null,
        null,
        () => '  \n',
      ),
    ).toThrow('required for initial Pod provisioning');
  });

  it('selects an explicit org membership and preserves its routed resource token', async () => {
    const claims = Buffer.from(
      JSON.stringify({ ctx: 'org', orgSlug: 'enterprise', adAccount: 'ad-account-1' }),
    ).toString('base64url');
    const orgAccessToken = `header.${claims}.signature`;
    const persistAccount = vi.fn();
    const persistMembership = vi.fn();
    const install = vi.fn();
    const fetch = vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/refresh')) {
        return response({ accountToken: 'account-access', accountRefreshToken: 'rotated-first' });
      }
      if (path.endsWith('/account')) {
        return response({
          memberships: [
            membership('personal-membership', 'personal'),
            membership('org-membership', 'org'),
          ],
        });
      }
      return response({
        accessToken: orgAccessToken,
        refreshToken: 'org-resource-refresh',
        membership: membership('org-membership', 'org'),
      });
    });

    await expect(
      bootstrapPodProvisioning({
        env: {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'initial',
          [POD_DEVICE_ID_ENV]: 'pod-org',
          [POD_MEMBERSHIP_ID_ENV]: 'org-membership',
        },
        getAuthBaseUrl: () => 'http://localhost:3344',
        authRegion: 'cn',
        fetch,
        logger: { info: vi.fn() },
        readPersistedAccountRefreshToken: () => null,
        readPersistedMembershipId: () => null,
        persistAccountRefreshToken: persistAccount,
        persistMembershipId: persistMembership,
        installSession: install,
      }),
    ).resolves.toBe(true);

    expect(persistAccount).toHaveBeenCalledWith('rotated-first');
    expect(persistAccount.mock.invocationCallOrder[0]).toBeLessThan(
      persistMembership.mock.invocationCallOrder[0]!,
    );
    expect(persistMembership).toHaveBeenCalledWith('org-membership');
    expect(install).toHaveBeenCalledWith({
      accessToken: orgAccessToken,
      refreshToken: 'org-resource-refresh',
      membership: expect.objectContaining({ id: 'org-membership', kind: 'org' }),
      deviceId: 'pod-org',
    });
    expect(
      JSON.parse(Buffer.from(orgAccessToken.split('.')[1]!, 'base64url').toString('utf8')),
    ).toMatchObject({ ctx: 'org', orgSlug: 'enterprise', adAccount: 'ad-account-1' });
  });

  it('rejects missing personal membership and invalid device IDs', async () => {
    await expect(
      bootstrapPodProvisioning({
        env: {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'token',
          [POD_DEVICE_ID_ENV]: 'pod',
        },
        getAuthBaseUrl: () => 'http://localhost:3344',
        authRegion: 'cn',
        fetch: vi.fn(async (input: string) => {
          const path = new URL(input).pathname;
          if (path.endsWith('/refresh')) {
            return response({ accountToken: 'account', accountRefreshToken: 'rotated' });
          }
          return response({ memberships: [membership('org', 'org')] });
        }),
        logger: { info: vi.fn() },
        readPersistedAccountRefreshToken: () => null,
        readPersistedMembershipId: () => null,
        persistAccountRefreshToken: vi.fn(),
        persistMembershipId: vi.fn(),
        installSession: vi.fn(),
      }),
    ).rejects.toThrow('no personal membership');

    expect(() => resolvePodDeviceIdOverride({ [POD_DEVICE_ID_ENV]: 'x'.repeat(129) })).toThrow(
      'at most 128',
    );
  });

  it('forwards requests through the Node fetch adapter', async () => {
    const nodeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const adapter = createNodeFetchAdapter(nodeFetch as typeof globalThis.fetch);
    const signal = new AbortController().signal;

    await expect(
      adapter('http://localhost:3344/healthz', {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal,
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    expect(nodeFetch).toHaveBeenCalledWith(
      'http://localhost:3344/healthz',
      expect.objectContaining({ method: 'GET', signal }),
    );
  });

  it('times out a stalled account refresh before later provisioning steps', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        async (_input: string, init?: Parameters<AuthFetch>[1]): Promise<AuthFetchResponse> =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          }),
      );
      const logger = { info: vi.fn() };
      const install = vi.fn();
      const pending = expect(
        bootstrapPodProvisioning({
          env: {
            [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'account-injected',
            [POD_DEVICE_ID_ENV]: 'pod-timeout',
          },
          getAuthBaseUrl: () => 'http://localhost:3344',
          authRegion: 'cn',
          fetch,
          logger,
          timeoutMs: 25,
          readPersistedAccountRefreshToken: () => null,
          readPersistedMembershipId: () => null,
          persistAccountRefreshToken: vi.fn(),
          persistMembershipId: vi.fn(),
          installSession: install,
        }),
      ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });

      await vi.advanceTimersByTimeAsync(25);
      await pending;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(install).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('Pod provisioning account refresh start');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves structured auth-server errors', async () => {
    await expect(
      bootstrapPodProvisioning({
        env: {
          [POD_ACCOUNT_REFRESH_TOKEN_ENV]: 'token',
          [POD_DEVICE_ID_ENV]: 'pod',
        },
        getAuthBaseUrl: () => 'http://localhost:3344',
        authRegion: 'cn',
        fetch: vi.fn(async () =>
          response(
            {
              error: {
                code: 'INVALID_REFRESH_TOKEN',
                message: 'Refresh token is invalid',
              },
            },
            false,
            401,
          ),
        ),
        logger: { info: vi.fn() },
        readPersistedAccountRefreshToken: () => null,
        readPersistedMembershipId: () => null,
        persistAccountRefreshToken: vi.fn(),
        persistMembershipId: vi.fn(),
        installSession: vi.fn(),
      }),
    ).rejects.toMatchObject({
      name: 'AuthApiError',
      code: 'INVALID_REFRESH_TOKEN',
      statusCode: 401,
      message: 'Refresh token is invalid',
    });
  });
});

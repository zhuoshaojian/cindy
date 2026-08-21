import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, safeStorage } from 'electron';
import { CURRENT_CINDY_REGION } from '../../shared/brandRegion.js';

vi.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));
vi.mock('../canaryFlagSync', () => ({
  syncCanaryFlagAfterAuth: vi.fn(async () => ({
    kind: 'preserved',
    reason: 'request-failed',
    status: 0,
  })),
}));
vi.mock('../secrets/providerSecretStore.js', () => ({
  getProviderSecretStore: () => ({ reconcileOwner: vi.fn() }),
}));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-auth-provision-'));

describe('authManager provisioned session', () => {
  beforeAll(() => {
    process.env.XDT_DEVICE_ID_OVERRIDE = 'pod-auth-test';
    vi.spyOn(app, 'getPath').mockImplementation((name: string) =>
      name === 'userData' ? userDataDir : path.join(userDataDir, name),
    );
    vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true);
  });

  afterAll(() => {
    delete process.env.XDT_DEVICE_ID_OVERRIDE;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('installs an authenticated state and persists both refresh token classes', async () => {
    const authManager = await import('../authManager.js');
    const authListener = vi.fn();
    const unsubscribe = authManager.onAuthStateChange(authListener);

    authManager.persistProvisionedAccountRefreshToken('account-refresh-test');
    authManager.persistProvisionedMembershipId('membership-selection-test');
    const state = authManager.installProvisionedSession({
      accessToken: 'resource-access-test',
      refreshToken: 'resource-refresh-test',
      deviceId: 'pod-auth-test',
      membership: {
        id: 'personal-membership-test',
        passportId: 'passport-test',
        kind: 'personal',
        role: 'owner',
        displayName: 'Pod Test',
        avatarUrl: null,
        email: 'pod@example.test',
        orgId: null,
        orgName: null,
      },
    });

    expect(state.isAuthenticated).toBe(true);
    expect(state.deviceId).toBe('pod-auth-test');
    expect(state.user).toMatchObject({
      id: 'personal-membership-test',
      passportId: 'passport-test',
      membershipKind: 'personal',
    });
    expect(authManager.getAccessToken()).toBe('resource-access-test');
    expect(authManager.readProvisionedAccountRefreshToken()).toBe('account-refresh-test');
    expect(authManager.readProvisionedMembershipId()).toBe('membership-selection-test');
    expect(authListener).toHaveBeenCalledWith(state);
    unsubscribe();

    const storageDir = path.join(userDataDir, 'safe-storage');
    expect(JSON.parse(
      Buffer.from(
        fs.readFileSync(path.join(storageDir, 'cindy_auth_session_v1.enc'), 'utf8'),
        'base64',
      ).toString('utf8'),
    )).toMatchObject({
      version: 1,
      // 钉「落盘 realm == 运行时 active realm」这条不变量。不要拿
      // CURRENT_CINDY_REGION 比:env 未设时 authManager 的 AUTH_REGION 默认 cn、
      // brandRegion 的 CURRENT_CINDY_REGION 默认 global,两个默认值本就不同源,
      // 只有真实构建注入 VITE_CINDY_AUTH_REGION 时才一致。
      realm: authManager.getActiveAuthRealm(),
      refreshToken: 'resource-refresh-test',
    });
  });

  it('rejects a session minted for a different device', async () => {
    const authManager = await import('../authManager.js');
    expect(() =>
      authManager.installProvisionedSession({
        accessToken: 'other-access',
        refreshToken: 'other-refresh',
        deviceId: 'other-pod',
        membership: {
          id: 'personal-membership-test',
          kind: 'personal',
          role: 'owner',
          displayName: 'Pod Test',
          avatarUrl: null,
          email: 'pod@example.test',
          orgId: null,
          orgName: null,
        },
      }),
    ).toThrow('does not match');
  });

  it('keeps Account credentials and triggers re-provision after resource refresh rejection', async () => {
    const authManager = await import('../authManager.js');
    const recoverProvisionedSession = vi.fn();
    authManager.setAccountSwitchTeardown(vi.fn(async () => undefined));
    authManager.setProvisionedSessionRecovery(null);
    authManager.persistProvisionedAccountRefreshToken('account-refresh-retained');
    authManager.persistProvisionedMembershipId('membership-retained');
    authManager.installProvisionedSession({
      accessToken: 'resource-access-rejected',
      refreshToken: 'resource-refresh-rejected',
      deviceId: 'pod-auth-test',
      membership: {
        id: 'membership-retained',
        kind: 'personal',
        role: 'owner',
        displayName: 'Pod Test',
        avatarUrl: null,
        email: 'pod@example.test',
        orgId: null,
        orgName: null,
      },
    });

    await authManager.invalidateResourceSession('resource-refresh-rejected');

    expect(authManager.getAuthState().isAuthenticated).toBe(false);
    expect(authManager.readProvisionedAccountRefreshToken()).toBe('account-refresh-retained');
    expect(authManager.readProvisionedMembershipId()).toBe('membership-retained');
    expect(recoverProvisionedSession).not.toHaveBeenCalled();
    authManager.setProvisionedSessionRecovery(recoverProvisionedSession);
    await vi.waitFor(() => expect(recoverProvisionedSession).toHaveBeenCalledOnce());
    authManager.setProvisionedSessionRecovery(null);
    authManager.setAccountSwitchTeardown(null);
  });

  it.each(['decrypt', 'io'] as const)(
    'preserves Pod Account credentials across a temporary %s read failure',
    async (failureKind) => {
      const authManager = await import('../authManager.js');
      const recoverProvisionedSession = vi.fn();
      authManager.setAccountSwitchTeardown(vi.fn(async () => undefined));
      authManager.setProvisionedSessionRecovery(null);
      authManager.persistProvisionedAccountRefreshToken('account-refresh-unreadable');
      authManager.persistProvisionedMembershipId('membership-unreadable');
      authManager.installProvisionedSession({
        accessToken: 'resource-access-unreadable',
        refreshToken: 'resource-refresh-unreadable',
        deviceId: 'pod-auth-test',
        membership: {
          id: 'membership-unreadable',
          kind: 'personal',
          role: 'owner',
          displayName: 'Pod Test',
          avatarUrl: null,
          email: 'pod@example.test',
          orgId: null,
          orgName: null,
        },
      });

      const accountCredentialPath = path.join(
        userDataDir,
        'safe-storage',
        'cindy_pod_account_refresh_token.enc',
      );
      const membershipCredentialPath = path.join(
        userDataDir,
        'safe-storage',
        'cindy_pod_membership_id.enc',
      );
      const restoreFault = failureKind === 'decrypt'
        ? (() => {
            const spy = vi.spyOn(safeStorage, 'decryptString').mockImplementation(() => {
              throw new Error('temporary decrypt failure');
            });
            return () => spy.mockRestore();
          })()
        : (() => {
            const originalReadFileSync = fs.readFileSync;
            const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((function (
              filePath: unknown,
              ...args: unknown[]
            ) {
              if (String(filePath) === accountCredentialPath) {
                throw Object.assign(new Error('temporary read failure'), { code: 'EIO' });
              }
              return Reflect.apply(originalReadFileSync, fs, [filePath, ...args]);
            }) as typeof fs.readFileSync);
            return () => spy.mockRestore();
          })();

      try {
        expect(authManager.readProvisionedAccountCredentialState()).toEqual({
          kind: 'temporarily-unreadable',
        });
        expect(() => authManager.readProvisionedAccountRefreshTokenForProvisioning()).toThrow(
          authManager.ProvisionedAccountCredentialTemporarilyUnreadableError,
        );
        await authManager.invalidateResourceSession('resource-refresh-rejected');
      } finally {
        restoreFault();
      }

      expect(authManager.getAuthState().isAuthenticated).toBe(false);
      expect(fs.existsSync(accountCredentialPath)).toBe(true);
      expect(fs.existsSync(membershipCredentialPath)).toBe(true);
      expect(authManager.areProvisionedAccountCredentialsAbsent()).toBe(false);

      authManager.setProvisionedSessionRecovery(recoverProvisionedSession);
      await vi.waitFor(() => expect(recoverProvisionedSession).toHaveBeenCalledOnce());
      authManager.setProvisionedSessionRecovery(null);
      authManager.setAccountSwitchTeardown(null);
    },
    15_000,
  );

  it('clears both Account credential fields and cancels deferred recovery at rejection', async () => {
    const authManager = await import('../authManager.js');
    const recoverProvisionedSession = vi.fn();
    authManager.setAccountSwitchTeardown(vi.fn(async () => undefined));
    authManager.setProvisionedSessionRecovery(null);
    authManager.persistProvisionedAccountRefreshToken('account-refresh-rejected');
    authManager.persistProvisionedMembershipId('membership-rejected');

    await authManager.invalidateResourceSession('resource-refresh-rejected');

    authManager.clearProvisionedAccountCredentials();
    authManager.setProvisionedSessionRecovery(recoverProvisionedSession);
    await Promise.resolve();

    expect(authManager.readProvisionedAccountRefreshToken()).toBeNull();
    expect(authManager.readProvisionedMembershipId()).toBeNull();
    expect(authManager.areProvisionedAccountCredentialsAbsent()).toBe(true);
    expect(fs.existsSync(path.join(
      userDataDir,
      'safe-storage',
      'cindy_pod_account_refresh_token.enc',
    ))).toBe(false);
    expect(fs.existsSync(path.join(
      userDataDir,
      'safe-storage',
      'cindy_pod_membership_id.enc',
    ))).toBe(false);
    expect(recoverProvisionedSession).not.toHaveBeenCalled();
    authManager.setProvisionedSessionRecovery(null);
    authManager.setAccountSwitchTeardown(null);
  });
});

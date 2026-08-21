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
      realm: CURRENT_CINDY_REGION,
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
});

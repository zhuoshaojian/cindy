import {
  CindyAuthClient,
  type AuthFetch,
  type AuthRegion,
  type AuthTokenPair,
} from '@cindy/auth-client';
import { readFileSync } from 'node:fs';

export const POD_ACCOUNT_REFRESH_TOKEN_ENV = 'XDT_POD_ACCOUNT_REFRESH_TOKEN';
export const POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV = 'XDT_POD_ACCOUNT_REFRESH_TOKEN_FILE';
export const POD_DEVICE_ID_ENV = 'XDT_POD_DEVICE_ID';
export const POD_DEVICE_NAME_ENV = 'XDT_POD_DEVICE_NAME';
export const POD_MEMBERSHIP_ID_ENV = 'XDT_POD_MEMBERSHIP_ID';
export const POD_PROVISIONING_TIMEOUT_MS = 15_000;

export interface PodProvisioningLogger {
  info(message: string, context?: unknown): void;
}

export interface PodProvisioningConfig {
  accountRefreshToken: string;
  deviceId: string;
  membershipId: string | null;
}

export interface PodProvisioningDeps {
  env: NodeJS.ProcessEnv;
  getAuthBaseUrl: () => string;
  authRegion: AuthRegion;
  fetch: AuthFetch;
  logger: PodProvisioningLogger;
  timeoutMs?: number;
  readPersistedAccountRefreshToken: () => string | null;
  readPersistedMembershipId: () => string | null;
  readSecretFile?: (filePath: string) => string;
  persistAccountRefreshToken: (accountRefreshToken: string) => void;
  persistMembershipId: (membershipId: string) => void;
  installSession: (session: AuthTokenPair & { deviceId: string }) => unknown | Promise<unknown>;
}

/**
 * Electron net.fetch can stall before sending in a windowless main process.
 * Provisioning uses Node's built-in undici fetch, independent of Electron
 * session/window lifecycle.
 */
export function createNodeFetchAdapter(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): AuthFetch {
  return (input, init) => fetchImpl(input, init as RequestInit);
}

export function hasPodProvisioningInput(env: NodeJS.ProcessEnv): boolean {
  return (
    Boolean(env[POD_ACCOUNT_REFRESH_TOKEN_ENV]?.trim()) ||
    Boolean(env[POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV]?.trim()) ||
    Boolean(env[POD_DEVICE_ID_ENV]?.trim()) ||
    Boolean(env[POD_MEMBERSHIP_ID_ENV]?.trim())
  );
}

/** Parse and validate the stable Pod device identity shared by auth and relay. */
export function parsePodDeviceId(env: NodeJS.ProcessEnv): string | null {
  const deviceId = env[POD_DEVICE_ID_ENV]?.trim() ?? '';
  if (!deviceId) return null;
  if (deviceId.length > 128) {
    throw new Error(`${POD_DEVICE_ID_ENV} must be at most 128 characters`);
  }
  return deviceId;
}

/** Provisioning env is explicit; no env means the existing headless path is unchanged. */
export function resolvePodProvisioningConfig(
  env: NodeJS.ProcessEnv,
  persistedAccountRefreshToken: string | null,
  persistedMembershipId: string | null,
  readSecretFile: (filePath: string) => string = (filePath) => readFileSync(filePath, 'utf8'),
): PodProvisioningConfig | null {
  const injectedToken = env[POD_ACCOUNT_REFRESH_TOKEN_ENV]?.trim() ?? '';
  const tokenFile = env[POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV]?.trim() ?? '';
  const deviceId = parsePodDeviceId(env);
  const persistedToken = persistedAccountRefreshToken?.trim() ?? '';
  const injectedMembershipId = env[POD_MEMBERSHIP_ID_ENV]?.trim() ?? '';
  const persistedSelectedMembershipId = persistedMembershipId?.trim() ?? '';

  if (
    injectedMembershipId &&
    persistedSelectedMembershipId &&
    injectedMembershipId !== persistedSelectedMembershipId
  ) {
    throw new Error(`${POD_MEMBERSHIP_ID_ENV} does not match the persisted Pod membership`);
  }
  if (
    !injectedToken &&
    !tokenFile &&
    deviceId === null &&
    !persistedToken &&
    !injectedMembershipId &&
    !persistedSelectedMembershipId
  ) {
    return null;
  }
  if (deviceId === null) {
    throw new Error(`${POD_DEVICE_ID_ENV} is required for Pod provisioning`);
  }

  // After the first successful refresh both injected forms are stale. Prefer
  // the rotated safeStorage copy; for initial provisioning prefer a mounted
  // secret file over an inline environment value so the token does not appear
  // in container metadata.
  const fileToken = !persistedToken && tokenFile ? readSecretFile(tokenFile).trim() : '';
  const accountRefreshToken = persistedToken || fileToken || injectedToken;
  if (!accountRefreshToken) {
    throw new Error(
      `${POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV} or ${POD_ACCOUNT_REFRESH_TOKEN_ENV} is required for initial Pod provisioning`,
    );
  }
  const membershipId = injectedMembershipId || persistedSelectedMembershipId || null;
  if (membershipId !== null && membershipId.length > 128) {
    throw new Error(`${POD_MEMBERSHIP_ID_ENV} must be at most 128 characters`);
  }
  return { accountRefreshToken, deviceId, membershipId };
}

/** Resolve the early device override before authManager reads it at module load. */
export function resolvePodDeviceIdOverride(env: NodeJS.ProcessEnv): string | null {
  return parsePodDeviceId(env);
}

/**
 * Refresh the provisioned account session, resolve its configured Membership,
 * exchange a resource session, and install it into authManager. Tokens are
 * never logged. Explicit or persisted Membership ids are fail-closed; only a
 * first-time bootstrap without either id falls back to the personal identity.
 */
export async function bootstrapPodProvisioning(deps: PodProvisioningDeps): Promise<boolean> {
  if (!hasPodProvisioningInput(deps.env)) return false;

  const config = resolvePodProvisioningConfig(
    deps.env,
    deps.readPersistedAccountRefreshToken(),
    deps.readPersistedMembershipId(),
    deps.readSecretFile,
  )!;
  const client = new CindyAuthClient({
    baseUrl: deps.getAuthBaseUrl(),
    region: deps.authRegion,
    deviceId: config.deviceId,
    clientType: 'desktop',
    fetch: deps.fetch,
  });
  deps.logger.info('Pod provisioning account refresh start');
  const accountPair = await client.refreshAccount(config.accountRefreshToken, {
    timeoutMs: deps.timeoutMs ?? POD_PROVISIONING_TIMEOUT_MS,
  });
  deps.logger.info('Pod provisioning account refresh ok');
  // The account refresh endpoint rotates on every success. Persist immediately
  // before any later request can fail, otherwise the only usable token is lost.
  deps.persistAccountRefreshToken(accountPair.accountRefreshToken);

  deps.logger.info('Pod provisioning memberships fetch start');
  const memberships = await client.getAccountMemberships(accountPair.accountToken);
  deps.logger.info('Pod provisioning memberships fetched', { count: memberships.length });
  const selected = config.membershipId
    ? memberships.find((membership) => membership.id === config.membershipId)
    : memberships.find((membership) => membership.kind === 'personal');
  if (!selected) {
    throw new Error(
      config.membershipId
        ? 'Pod provisioning requested membership was not found'
        : 'Pod provisioning account has no personal membership',
    );
  }
  deps.persistMembershipId(selected.id);

  deps.logger.info('Pod provisioning account exchange start');
  const resourcePair = await client.exchangeAccountMembership(
    accountPair.accountToken,
    selected.id,
  );
  deps.logger.info('Pod provisioning account exchange ok');
  deps.logger.info('Pod provisioning session install start');
  await deps.installSession({
    ...resourcePair,
    deviceId: config.deviceId,
  });
  deps.logger.info('Pod provisioning session installed');
  return true;
}

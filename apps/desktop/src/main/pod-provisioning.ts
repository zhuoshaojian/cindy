import {
  AuthApiError,
  CindyAuthClient,
  type AuthFetch,
  type AuthRegion,
  type AuthTokenPair,
} from '@cindy/auth-client';
import { readFileSync } from 'node:fs';
import {
  hasHeadlessPodRuntimeInput,
  POD_RESOURCE_REFRESH_TOKEN_FILE_ENV,
  POD_DEVICE_ID_ENV,
  POD_USER_DATA_DIR_ENV,
  resolvePodDeviceIdOverride,
} from './headless-startup.js';
import { DEFINITIVE_REFRESH_FAILURE_CODES } from './authRefreshFailure.js';

export const POD_RESOURCE_REFRESH_TOKEN_ENV = 'XDT_POD_RESOURCE_REFRESH_TOKEN';
export const POD_DEVICE_NAME_ENV = 'XDT_POD_DEVICE_NAME';
export const POD_MEMBERSHIP_ID_ENV = 'XDT_POD_MEMBERSHIP_ID';
export const POD_PROVISIONING_TIMEOUT_MS = 15_000;
export {
  hasHeadlessPodRuntimeInput,
  POD_RESOURCE_REFRESH_TOKEN_FILE_ENV,
  POD_DEVICE_ID_ENV,
  POD_USER_DATA_DIR_ENV,
  resolvePodDeviceIdOverride,
} from './headless-startup.js';

export interface PodProvisioningLogger {
  info(message: string, context?: unknown): void;
}

export interface PodProvisioningConfig {
  resourceRefreshToken: string;
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
  readPersistedResourceRefreshToken: () => string | null;
  readPersistedMembershipId: () => string | null;
  readSecretFile?: (filePath: string) => string;
  persistResourceRefreshToken: (resourceRefreshToken: string) => void;
  clearPersistedResourceCredentials?: () => void;
  persistMembershipId: (membershipId: string) => void;
  installSession: (session: AuthTokenPair & { deviceId: string }) => unknown | Promise<unknown>;
  /** A validated local resource session makes the one-shot bootstrap token unnecessary. */
  hasLocalSession?: () => boolean;
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
    Boolean(env[POD_RESOURCE_REFRESH_TOKEN_ENV]?.trim()) ||
    Boolean(env[POD_RESOURCE_REFRESH_TOKEN_FILE_ENV]?.trim()) ||
    Boolean(env[POD_DEVICE_ID_ENV]?.trim())
  );
}

/** Select basic safeStorage without weakening ordinary packaged GUI storage. */
export function shouldUseBasicSafeStorage(
  env: NodeJS.ProcessEnv,
  input: {
    isPackaged: boolean;
    platform: NodeJS.Platform;
    headlessPodRuntime: boolean;
  },
): boolean {
  if (input.platform !== 'linux' || env.XDT_DEV_SAFE_STORAGE_BASIC !== '1') return false;
  return !input.isPackaged || input.headlessPodRuntime;
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
  persistedResourceRefreshToken: string | null,
  persistedMembershipId: string | null,
  readSecretFile: (filePath: string) => string = (filePath) => readFileSync(filePath, 'utf8'),
): PodProvisioningConfig | null {
  const injectedToken = env[POD_RESOURCE_REFRESH_TOKEN_ENV]?.trim() ?? '';
  const tokenFile = env[POD_RESOURCE_REFRESH_TOKEN_FILE_ENV]?.trim() ?? '';
  const deviceId = parsePodDeviceId(env);
  const persistedToken = persistedResourceRefreshToken?.trim() ?? '';
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
    !persistedToken
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
  const resourceRefreshToken = persistedToken || fileToken || injectedToken;
  if (!resourceRefreshToken) {
    throw new Error(
      `${POD_RESOURCE_REFRESH_TOKEN_FILE_ENV} or ${POD_RESOURCE_REFRESH_TOKEN_ENV} is required for initial Pod provisioning`,
    );
  }
  const membershipId = injectedMembershipId || persistedSelectedMembershipId || null;
  if (membershipId !== null && membershipId.length > 128) {
    throw new Error(`${POD_MEMBERSHIP_ID_ENV} must be at most 128 characters`);
  }
  return { resourceRefreshToken, deviceId, membershipId };
}

/**
 * Refresh the provisioned resource session and install it into authManager.
 * Tokens are never logged. Membership ids are no longer needed for selection;
 * when present they are a fail-closed cross-check against the token subject.
 */
export async function bootstrapPodProvisioning(deps: PodProvisioningDeps): Promise<boolean> {
  if (!hasPodProvisioningInput(deps.env)) return false;
  if (deps.hasLocalSession?.()) {
    deps.logger.info('Pod provisioning skipped; validated local session is ready');
    return true;
  }

  let resourceRefreshRejected = false;
  try {
    const config = resolvePodProvisioningConfig(
      deps.env,
      deps.readPersistedResourceRefreshToken(),
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
    deps.logger.info('Pod provisioning resource refresh start');
    let resourcePair: AuthTokenPair;
    try {
      resourcePair = await client.refresh(config.resourceRefreshToken, {
        timeoutMs: deps.timeoutMs ?? POD_PROVISIONING_TIMEOUT_MS,
      });
    } catch (error) {
      resourceRefreshRejected = error instanceof AuthApiError
        && DEFINITIVE_REFRESH_FAILURE_CODES.has(error.code);
      throw error;
    }
    deps.logger.info('Pod provisioning resource refresh ok');
    if (config.membershipId && resourcePair.membership.id !== config.membershipId) {
      throw new Error(
        'Pod provisioning resource token membership does not match the configured membership',
      );
    }
    // The resource refresh endpoint rotates on every success. Persist immediately
    // before any later request can fail, otherwise the only usable token is lost.
    deps.persistResourceRefreshToken(resourcePair.refreshToken);
    deps.persistMembershipId(resourcePair.membership.id);
    deps.logger.info('Pod provisioning session install start');
    await deps.installSession({
      ...resourcePair,
      deviceId: config.deviceId,
    });
    deps.logger.info('Pod provisioning session installed');
    return true;
  } catch (error) {
    if (deps.hasLocalSession?.()) {
      deps.logger.info('Pod provisioning failed after local session recovery; continuing');
      return true;
    }
    // Only an explicit rejection from the resource refresh endpoint invalidates
    // the durable Pod resource credential and Membership selection. Transient
    // refresh failures and install failures keep both for later recovery.
    if (resourceRefreshRejected) {
      deps.clearPersistedResourceCredentials?.();
    }
    throw error;
  }
}

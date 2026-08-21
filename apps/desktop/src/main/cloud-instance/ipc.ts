/**
 * Cloud instance IPC adapter.
 *
 * Business/network/auth work stays in main. Handler bodies accept injected
 * dependencies for Electron-free tests; registration is the only Electron
 * adapter.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  CLOUD_INSTANCE_INVOKE,
  type CloudInstanceCreateInput,
  type CloudInstanceDeleteResult,
  type CloudInstanceEnableResult,
  type CloudInstanceRenameResult,
  type CloudInstanceStatus,
  type CloudInstanceUpgradeResult,
  type CloudInstanceView,
  type CloudInstanceWakeInput,
} from '../../shared/cloudInstanceIpc.js';
import { isIpcError } from '../../shared/ipc-errors.js';
import * as authManager from '../authManager.js';
import { assertTrustedAppRendererEvent } from '../security/trustedAppRenderer.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import { ServerApiError } from '../serverApiClient.js';
import { forgetLastKnownDeviceName } from '../device-link/settings-store.js';
import {
  CLOUD_INSTANCE_RESOURCE_TIERS,
  CloudInstanceClientNotConfiguredError,
  createDefaultCloudInstanceClient,
  type CloudInstanceClient,
} from './client.js';

/** Dependencies used by pure cloud-instance IPC handlers. */
export interface CloudInstanceIpcDeps {
  getAccessToken(): string | null;
  client: CloudInstanceClient;
  /** Drop the deleted instance's cached device name (device-link settings). */
  forgetDeviceName(deviceId: string): Promise<boolean>;
}

/** Default main-process wiring. */
export function defaultCloudInstanceIpcDeps(): CloudInstanceIpcDeps {
  return {
    getAccessToken: authManager.getAccessToken,
    client: createDefaultCloudInstanceClient(),
    forgetDeviceName: forgetLastKnownDeviceName,
  };
}

function requireAuthenticated(deps: CloudInstanceIpcDeps): void {
  if (!deps.getAccessToken()) {
    throwIpcError('PRECONDITION_FAILED', 'cloud instance control requires sign-in');
  }
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throwIpcError('INVALID_PARAMS', 'payload must be an object');
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(payload: Record<string, unknown>, allowed: readonly string[]): void {
  const unexpected = Object.keys(payload).find((key) => !allowed.includes(key));
  if (unexpected) throwIpcError('INVALID_PARAMS', `unexpected field: ${unexpected}`);
}

function optionalInstanceId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throwIpcError('INVALID_PARAMS', 'instanceId must be a non-empty string');
  }
  return value.trim();
}

function optionalResourceTier(value: unknown): CloudInstanceCreateInput['resourceTier'] {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !CLOUD_INSTANCE_RESOURCE_TIERS.includes(
      value as CloudInstanceCreateInput['resourceTier'] & string,
    )
  ) {
    throwIpcError('INVALID_PARAMS', 'resourceTier must be small, medium, or large');
  }
  return value as NonNullable<CloudInstanceCreateInput['resourceTier']>;
}

function rethrowCloudInstanceError(error: unknown): never {
  if (isIpcError(error)) throw error;
  if (error instanceof CloudInstanceClientNotConfiguredError) {
    throwIpcError('UNSUPPORTED_CAPABILITY', 'cloud instance control is unavailable');
  }
  if (error instanceof ServerApiError) {
    if (
      error.code === 'UPGRADE_IN_PROGRESS'
      || error.code === 'CLOUD_INSTANCE_UPGRADE_IN_PROGRESS'
    ) {
      throwIpcError(
        'CLOUD_INSTANCE_UPGRADE_IN_PROGRESS',
        'cloud instance upgrade is already in progress',
      );
    }
    if (error.code === 'NO_RELEASE_AVAILABLE') {
      throwIpcError('NO_RELEASE_AVAILABLE', 'no cloud instance release is available');
    }
    if (error.statusCode === 0 || error.statusCode >= 500) {
      throwIpcError('CLOUD_INSTANCE_UNAVAILABLE', 'cloud instance service request failed');
    }
    if (error.statusCode === 401 || error.statusCode === 403) {
      throwIpcError(
        error.code === 'CLOUD_PROVIDER_DISABLED'
          ? 'UNSUPPORTED_CAPABILITY'
          : error.code === 'CLOUD_INSTANCE_DISABLED'
            ? 'CLOUD_INSTANCE_DISABLED'
            : 'PERMISSION_DENIED',
        error.code === 'CLOUD_PROVIDER_DISABLED'
          ? 'cloud instance control is unavailable'
          : error.code === 'CLOUD_INSTANCE_DISABLED'
            ? 'cloud instance control is disabled for this account'
            : 'cloud instance request is not authorized',
      );
    }
    if (error.statusCode === 404) {
      throwIpcError('NOT_FOUND', 'cloud instance was not found');
    }
    if (error.statusCode === 409) {
      throwIpcError('ALREADY_EXISTS', 'cloud instance request conflicts with the current state');
    }
    if (error.statusCode === 400) {
      throwIpcError('INVALID_PARAMS', 'cloud instance request was rejected');
    }
  }
  throwIpcError('INTERNAL', 'cloud instance request failed');
}

async function callClient<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    rethrowCloudInstanceError(error);
  }
}

/** List every instance owned by the signed-in membership. */
export async function handleListCloudInstances(
  deps: CloudInstanceIpcDeps,
): Promise<{ instances: CloudInstanceView[] }> {
  requireAuthenticated(deps);
  return callClient(() => deps.client.list());
}

/** Wake an explicit instance, or use the server's zero/one convenience path. */
export async function handleWakeCloudInstance(
  deps: CloudInstanceIpcDeps,
  rawInput: unknown,
): Promise<CloudInstanceEnableResult> {
  requireAuthenticated(deps);
  const payload = objectPayload(rawInput);
  assertOnlyKeys(payload, ['instanceId', 'resourceTier']);
  const instanceId = optionalInstanceId(payload.instanceId);
  const resourceTier = optionalResourceTier(payload.resourceTier);
  const input: CloudInstanceWakeInput = {
    ...(instanceId !== undefined ? { instanceId } : {}),
    ...(resourceTier !== undefined ? { resourceTier } : {}),
  };
  return callClient(() => deps.client.wake(input));
}

/** Explicitly create and start one additional membership-owned instance. */
export async function handleCreateCloudInstance(
  deps: CloudInstanceIpcDeps,
  rawInput: unknown,
): Promise<CloudInstanceEnableResult> {
  requireAuthenticated(deps);
  const payload = objectPayload(rawInput);
  assertOnlyKeys(payload, ['resourceTier']);
  const resourceTier = optionalResourceTier(payload.resourceTier);
  return callClient(() => deps.client.create(resourceTier === undefined ? {} : { resourceTier }));
}

/** Set a custom label, or clear it back to the localized ordinal default. */
export async function handleRenameCloudInstance(
  deps: CloudInstanceIpcDeps,
  rawInput: unknown,
): Promise<CloudInstanceRenameResult> {
  requireAuthenticated(deps);
  const payload = objectPayload(rawInput);
  assertOnlyKeys(payload, ['instanceId', 'customLabel']);
  const instanceId = optionalInstanceId(payload.instanceId);
  if (!instanceId) throwIpcError('INVALID_PARAMS', 'instanceId is required');
  const rawLabel = payload.customLabel;
  let customLabel: string | null;
  if (rawLabel === null) {
    customLabel = null;
  } else if (typeof rawLabel === 'string' && rawLabel.trim()) {
    customLabel = rawLabel.trim();
    if (customLabel.length > 64) {
      throwIpcError('INVALID_PARAMS', 'customLabel exceeds 64 characters');
    }
  } else {
    throwIpcError('INVALID_PARAMS', 'customLabel must be a non-empty string or null');
  }
  return callClient(() => deps.client.rename(instanceId, customLabel));
}

/** Read one instance status; omission is valid only when the server finds one instance. */
export async function handleCloudInstanceStatus(
  deps: CloudInstanceIpcDeps,
  rawInput: unknown,
): Promise<{ status: CloudInstanceStatus }> {
  requireAuthenticated(deps);
  const payload = objectPayload(rawInput);
  assertOnlyKeys(payload, ['instanceId']);
  return callClient(() => deps.client.status(optionalInstanceId(payload.instanceId)));
}

function requiredInstanceId(rawInput: unknown): string {
  const payload = objectPayload(rawInput);
  assertOnlyKeys(payload, ['instanceId']);
  const instanceId = optionalInstanceId(payload.instanceId);
  if (!instanceId) throwIpcError('INVALID_PARAMS', 'instanceId is required');
  return instanceId;
}

/** Manually sleep one membership-owned cloud instance. */
export async function handleStopCloudInstance(
  deps: CloudInstanceIpcDeps,
  rawInput: unknown,
): Promise<{ status: CloudInstanceStatus }> {
  requireAuthenticated(deps);
  const instanceId = requiredInstanceId(rawInput);
  return callClient(() => deps.client.stop(instanceId));
}

/** Update one cloud instance to the latest release selected by the control plane. */
export async function handleUpgradeCloudInstance(
  deps: CloudInstanceIpcDeps,
  rawInput: unknown,
): Promise<CloudInstanceUpgradeResult> {
  requireAuthenticated(deps);
  const instanceId = requiredInstanceId(rawInput);
  return callClient(() => deps.client.upgrade(instanceId));
}

/** Permanently delete one cloud instance and its account/relay identity. */
export async function handleDeleteCloudInstance(
  deps: CloudInstanceIpcDeps,
  rawInput: unknown,
): Promise<CloudInstanceDeleteResult> {
  requireAuthenticated(deps);
  const instanceId = requiredInstanceId(rawInput);
  const result = await callClient(() => deps.client.delete(instanceId));
  // 控制面已清服务端五层(容器/store/auth/relay 档案);这里补本机侧的
  // 设备名缓存,防止已删云端以缓存旧名再现(renderer 侧分片由 hook 清)。
  void deps.forgetDeviceName(result.status.deviceId);
  return result;
}

/** Register the renderer-facing cloud instance IPC surface. */
export function registerCloudInstanceIpc(
  deps: CloudInstanceIpcDeps = defaultCloudInstanceIpcDeps(),
): void {
  type Handler = (event: IpcMainInvokeEvent, input?: unknown) => unknown;
  const registerTrustedHandler = (channel: string, handler: Handler): void => {
    ipcMain.handle(channel, (event, input) => {
      assertTrustedAppRendererEvent(event);
      return handler(event, input);
    });
  };

  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.LIST, () => handleListCloudInstances(deps));
  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.WAKE, (_event, input) =>
    handleWakeCloudInstance(deps, input),
  );
  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.CREATE, (_event, input) =>
    handleCreateCloudInstance(deps, input),
  );
  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.RENAME, (_event, input) =>
    handleRenameCloudInstance(deps, input),
  );
  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.STATUS, (_event, input) =>
    handleCloudInstanceStatus(deps, input),
  );
  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.STOP, (_event, input) =>
    handleStopCloudInstance(deps, input),
  );
  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.UPGRADE, (_event, input) =>
    handleUpgradeCloudInstance(deps, input),
  );
  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.DELETE, (_event, input) =>
    handleDeleteCloudInstance(deps, input),
  );
}

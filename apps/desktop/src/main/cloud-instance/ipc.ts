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
  type CloudInstancePatchInput,
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
import { createLogger } from '../logger.js';
import { getMirrorCache, MirrorCachePurgeError } from '../device-link/mirrorCacheStore.js';
import { enqueuePurge } from '../device-link/mirrorCachePurgeQueue.js';
import {
  getDevicePresenceState,
  type DevicePresenceState,
} from '../device-link/presenceState.js';
import { forgetLastKnownDeviceName } from '../device-link/settings-store.js';
import {
  CLOUD_INSTANCE_RESOURCE_TIERS,
  CloudInstanceClientNotConfiguredError,
  createDefaultCloudInstanceClient,
  type CloudInstanceClient,
} from './client.js';

const log = createLogger('cloud-instance:ipc');
export const CLOUD_DEVICE_RETIREMENT_UNKNOWN_PRESENCE_GRACE_MS = 24 * 60 * 60 * 1_000;

/** Dependencies used by pure cloud-instance IPC handlers. */
export interface CloudInstanceIpcDeps {
  getAccessToken(): string | null;
  client: CloudInstanceClient;
  /** Drop the deleted instance's cached device name (device-link settings). */
  forgetDeviceName(deviceId: string): Promise<boolean>;
  /** Persistently block and clear a deleted device's owner-scoped mirror cache. */
  retireMirrorCacheDevice(deviceId: string, createdAtMs?: number, instanceId?: string): Promise<void>;
  /** Persisted retirement tombstones survive restart until list/presence converge. */
  listMirrorCacheRetiredDevices(): Promise<
    Array<{ deviceId: string; instanceId?: string; createdAtMs: number }>
  >;
  /** Final clear, then remove the target device's retirement tombstone. */
  releaseMirrorCacheRetiredDevice(deviceId: string): Promise<void>;
  captureMirrorCacheOwnerScope(): Promise<{ ownerRoot: string; accountCounter: number }>;
  /** Reconcile cloud session-list cache against a complete successful membership instance list. */
  reconcileMirrorCacheCloudDevices(
    activeDeviceIds: readonly string[],
    expectedOwnerRoot: string,
    expectedAccountCounter: number,
  ): Promise<void>;
  getDevicePresenceState(deviceId: string): DevicePresenceState;
  nowMs(): number;
}

/** Default main-process wiring. */
export function defaultCloudInstanceIpcDeps(): CloudInstanceIpcDeps {
  return {
    getAccessToken: authManager.getAccessToken,
    client: createDefaultCloudInstanceClient(),
    forgetDeviceName: forgetLastKnownDeviceName,
    retireMirrorCacheDevice: (deviceId, createdAtMs, instanceId) =>
      getMirrorCache().retireDevice(deviceId, createdAtMs, instanceId),
    listMirrorCacheRetiredDevices: () => getMirrorCache().listRetiredDevices(),
    releaseMirrorCacheRetiredDevice: (deviceId) =>
      getMirrorCache().releaseRetiredDevice(deviceId),
    captureMirrorCacheOwnerScope: () => getMirrorCache().captureOwnerScope(),
    reconcileMirrorCacheCloudDevices: (
      activeDeviceIds,
      expectedOwnerRoot,
      expectedAccountCounter,
    ) => getMirrorCache().reconcileCloudSessionList(
      activeDeviceIds,
      expectedOwnerRoot,
      expectedAccountCounter,
    ),
    getDevicePresenceState,
    nowMs: Date.now,
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

function customLabel(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throwIpcError('INVALID_PARAMS', 'customLabel must be a non-empty string or null');
  }
  const label = value.trim();
  if (label.length > 64) {
    throwIpcError('INVALID_PARAMS', 'customLabel exceeds 64 characters');
  }
  return label;
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
  // 与网络请求同时绑定 owner root + account generation；list 在途期间切账号时，返回值不得
  // 被发布到新 owner。计数不可读会得到 -1，reconcile 保持 unknown、不会删除任何缓存。
  const ownerScope = await deps.captureMirrorCacheOwnerScope();
  const result = await callClient(() => deps.client.list());
  // GET /instances 的契约是当前 membership 的完整、非分页未删除实例集（client 没有 cursor / page
  // 入参，响应也没有 next token）。只有请求成功才把它发布为 owner-scoped 权威集；失败或首次
  // 成功前保持 unknown，不能把控制面不可达误解成“账号下没有实例”而清掉有效冷缓存。
  try {
    await deps.reconcileMirrorCacheCloudDevices(
      result.instances.map((instance) => instance.deviceId),
      ownerScope.ownerRoot,
      ownerScope.accountCounter,
    );
  } catch (error) {
    // list 本身已经成功；本地缓存是可重建投影，收敛失败留给下一次成功 list 重试，不能反转
    // 用户正在看的控制面结果。read/write 权威闸会在 reconcile 内先安装，减少再次投影窗口。
    log.warn('failed to reconcile cloud device mirror-cache session list', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await reconcileRetiredMirrorCacheDevices(deps, result.instances);
  return result;
}

async function reconcileRetiredMirrorCacheDevices(
  deps: CloudInstanceIpcDeps,
  instances: readonly CloudInstanceView[],
): Promise<void> {
  let retired: Array<{ deviceId: string; instanceId?: string; createdAtMs: number }>;
  try {
    retired = await deps.listMirrorCacheRetiredDevices();
  } catch (error) {
    log.warn('failed to read cloud device mirror-cache retirement tombstones', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  const currentDeviceIds = new Set(instances.map((instance) => instance.deviceId));
  for (const tombstone of retired) {
    const currentInstance = instances.find((instance) => instance.deviceId === tombstone.deviceId);
    const reusedByControlPlane =
      currentInstance !== undefined
      && tombstone.instanceId !== undefined
      && currentInstance.instanceId !== tombstone.instanceId;
    const absentFromControlPlane = !currentDeviceIds.has(tombstone.deviceId);
    const presence = deps.getDevicePresenceState(tombstone.deviceId);
    const absentLongEnough =
      absentFromControlPlane
      && presence === 'unknown'
      && deps.nowMs() - tombstone.createdAtMs >= CLOUD_DEVICE_RETIREMENT_UNKNOWN_PRESENCE_GRACE_MS;
    // 正常解除要求 fresh list 已无旧 deviceId 且 relay 明确 offline。若控制面重新列出同一
    // deviceId，则视为身份复用：最终清掉旧缓存后立即放行新权威数据。presence 永远 online
    // 时不靠超时解除；unknown 仅在 fresh list 持续缺席 24h 后兜底，避免墓碑永久阻塞复用。
    const retiredNormally = absentFromControlPlane && presence === 'offline';
    if (!reusedByControlPlane && !retiredNormally && !absentLongEnough) continue;
    try {
      await deps.releaseMirrorCacheRetiredDevice(tombstone.deviceId);
    } catch (error) {
      log.warn(
        `failed to release retired cloud device mirror cache (${tombstone.deviceId.slice(0, 8)})`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
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
  return callClient(() => deps.client.rename(instanceId, customLabel(payload.customLabel)));
}

/** Patch mutable cloud-instance settings without exposing auth/network to renderer. */
export async function handlePatchCloudInstance(
  deps: CloudInstanceIpcDeps,
  rawInput: unknown,
): Promise<void> {
  requireAuthenticated(deps);
  const payload = objectPayload(rawInput);
  assertOnlyKeys(payload, ['instanceId', 'customLabel', 'autoUpdate']);
  const instanceId = optionalInstanceId(payload.instanceId);
  if (!instanceId) throwIpcError('INVALID_PARAMS', 'instanceId is required');
  const patch: Omit<CloudInstancePatchInput, 'instanceId'> = {};
  if (Object.hasOwn(payload, 'customLabel')) patch.customLabel = customLabel(payload.customLabel);
  if (Object.hasOwn(payload, 'autoUpdate')) {
    if (typeof payload.autoUpdate !== 'boolean') {
      throwIpcError('INVALID_PARAMS', 'autoUpdate must be a boolean');
    }
    patch.autoUpdate = payload.autoUpdate;
  }
  if (!Object.hasOwn(patch, 'customLabel') && !Object.hasOwn(patch, 'autoUpdate')) {
    throwIpcError('INVALID_PARAMS', 'at least one mutable field is required');
  }
  await callClient(() => deps.client.patch(instanceId, patch));
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
  // 设备名与远程会话镜像缓存,防止已删云端以幽灵设备 / 会话再现。
  void deps.forgetDeviceName(result.status.deviceId);
  try {
    await deps.retireMirrorCacheDevice(result.status.deviceId, deps.nowMs(), instanceId);
  } catch (error) {
    // 服务端删除已提交,本地缓存清理失败不能把成功反转成失败；保留诊断，账号
    // 边界的 clearAll 仍会在登出 / 切账号时兜底收敛。
    log.warn(
      `failed to clear deleted cloud instance mirror cache (${result.status.deviceId.slice(0, 8)})`,
      { error: error instanceof Error ? error.message : String(error) },
    );
    if (error instanceof MirrorCachePurgeError) {
      await enqueuePurge(
        error.root,
        error.remaining,
        error.barriers,
        error.tombstones,
        error.retirements,
      ).catch((queueError: unknown) => {
        log.warn('failed to queue deleted cloud instance mirror-cache purge retry', {
          error: queueError instanceof Error ? queueError.message : String(queueError),
        });
      });
    }
  }
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
  registerTrustedHandler(CLOUD_INSTANCE_INVOKE.PATCH, (_event, input) =>
    handlePatchCloudInstance(deps, input),
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

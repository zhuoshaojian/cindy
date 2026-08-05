import { ApiError, type ApiFetchOptions } from '@/api/client';
import { CLOUD_INSTANCE_API_BASE_URL } from '@/config/env';

const CLOUD_INSTANCE_REQUEST_TIMEOUT_MS = 30_000;

/** One account-owned cloud instance returned by the control plane. */
export interface CloudInstanceUpgradeStatus {
  state: 'idle' | 'verifying' | 'rolled-back';
  targetImage: string | null;
  previousImage: string | null;
  deadlineAtMs: number | null;
}

/** Client-facing status fields used by the mobile cloud controls. */
export interface CloudInstanceStatus {
  image: string | null;
  updateAvailable: boolean;
  latestReleaseTag: string | null;
  lastFailedUpgradeImage: string | null;
  upgrade: CloudInstanceUpgradeStatus;
  /** Missing on older control planes; consumers hide the setting in that case. */
  autoUpdate?: boolean;
  [key: string]: unknown;
}

export interface CloudInstanceView {
  instanceId: string;
  deviceId: string;
  nameSequence: number;
  customLabel: string | null;
  status: CloudInstanceStatus;
}

/** Result returned after waking an existing instance or atomically creating the first one. */
export interface CloudInstanceWakeResult extends CloudInstanceView {
  created: boolean;
}

/** Result returned after manually stopping an instance. */
export interface CloudInstanceStopResult {
  status: CloudInstanceStatus;
}

/** Result returned after applying the latest server-selected release. */
export interface CloudInstanceUpgradeResult {
  status: CloudInstanceStatus;
  outcome?: 'no-op' | 'upgraded' | 'verifying';
  targetImage?: string;
}

/** Cleanup result returned after permanently deleting an instance. */
export interface CloudInstanceDeleteResult {
  status: CloudInstanceStatus;
  revocation: unknown;
  archiveCleanup: unknown;
}

/** Authenticated request seam supplied by AuthContext; it owns token injection and 401 refresh. */
export type CloudInstanceApiFetch = <T>(
  path: string,
  options: Omit<ApiFetchOptions, 'token'>,
) => Promise<T>;

export interface CloudInstanceApiDeps {
  apiFetch: CloudInstanceApiFetch;
}

/** All expected outcomes are explicit so an unconfigured capability never attempts a request. */
export type CloudInstanceApiOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'unsupported' }
  | {
      kind: 'error';
      error: {
        code: string;
        message: string;
        status: number | null;
      };
    };

/** Fetch the caller's cloud instances from the standalone control plane. */
export async function listCloudInstances(
  deps: CloudInstanceApiDeps,
): Promise<CloudInstanceApiOutcome<{ instances: CloudInstanceView[] }>> {
  return requestCloudInstances(async (baseUrl) => {
    const payload = await deps.apiFetch<unknown>('/instances', {
      baseUrl,
      method: 'GET',
      timeoutMs: CLOUD_INSTANCE_REQUEST_TIMEOUT_MS,
    });
    if (!isRecord(payload) || !Array.isArray(payload.instances)) {
      throw invalidResponse();
    }
    return { instances: payload.instances.map(parseCloudInstance) };
  });
}

/** Wake one instance; omission preserves the control plane's zero/one-instance convenience path. */
export async function wakeCloudInstance(
  instanceId: string | undefined,
  deps: CloudInstanceApiDeps,
): Promise<CloudInstanceApiOutcome<CloudInstanceWakeResult>> {
  return requestCloudInstances(async (baseUrl) => {
    const payload = await deps.apiFetch<unknown>('/instances/wake', {
      baseUrl,
      method: 'POST',
      timeoutMs: CLOUD_INSTANCE_REQUEST_TIMEOUT_MS,
      body: instanceId ? { instanceId } : {},
    });
    if (!isRecord(payload) || typeof payload.created !== 'boolean') {
      throw invalidResponse();
    }
    return { ...parseCloudInstance(payload), created: payload.created };
  });
}

/** Patch mutable cloud-instance settings. */
export async function patchCloudInstance(
  instanceId: string,
  patch: { customLabel?: string | null; autoUpdate?: boolean },
  deps: CloudInstanceApiDeps,
): Promise<CloudInstanceApiOutcome<true>> {
  return requestCloudInstances(async (baseUrl) => {
    await deps.apiFetch<unknown>(`/instances/${encodeURIComponent(instanceId)}`, {
      baseUrl,
      method: 'PATCH',
      timeoutMs: CLOUD_INSTANCE_REQUEST_TIMEOUT_MS,
      body: patch,
    });
    return true as const;
  });
}

/** Stop one instance while retaining its durable cloud data. */
export async function stopCloudInstance(
  instanceId: string,
  deps: CloudInstanceApiDeps,
): Promise<CloudInstanceApiOutcome<CloudInstanceStopResult>> {
  return requestCloudInstances(async (baseUrl) => {
    const payload = await deps.apiFetch<unknown>(
      `/instances/${encodeURIComponent(instanceId)}/stop`,
      {
        baseUrl,
        method: 'POST',
        timeoutMs: CLOUD_INSTANCE_REQUEST_TIMEOUT_MS,
      },
    );
    if (!isRecord(payload) || !('status' in payload)) {
      throw invalidResponse();
    }
    return { status: parseCloudInstanceStatus(payload.status) };
  });
}

/** Upgrade one instance to the latest formal release selected by the server. */
export async function upgradeCloudInstance(
  instanceId: string,
  deps: CloudInstanceApiDeps,
): Promise<CloudInstanceApiOutcome<CloudInstanceUpgradeResult>> {
  return requestCloudInstances(async (baseUrl) => {
    const payload = await deps.apiFetch<unknown>(
      `/instances/${encodeURIComponent(instanceId)}/upgrade`,
      {
        baseUrl,
        method: 'POST',
        timeoutMs: CLOUD_INSTANCE_REQUEST_TIMEOUT_MS,
      },
    );
    if (!isRecord(payload) || !('status' in payload)) throw invalidResponse();
    const outcome = parseUpgradeOutcome(payload.outcome);
    return {
      status: parseCloudInstanceStatus(payload.status),
      ...(outcome ? { outcome } : {}),
      ...(typeof payload.targetImage === 'string' ? { targetImage: payload.targetImage } : {}),
    };
  });
}

/** Permanently delete one instance and return the control-plane cleanup summary. */
export async function deleteCloudInstance(
  instanceId: string,
  deps: CloudInstanceApiDeps,
): Promise<CloudInstanceApiOutcome<CloudInstanceDeleteResult>> {
  return requestCloudInstances(async (baseUrl) => {
    const payload = await deps.apiFetch<unknown>(
      `/instances/${encodeURIComponent(instanceId)}`,
      {
        baseUrl,
        method: 'DELETE',
        timeoutMs: CLOUD_INSTANCE_REQUEST_TIMEOUT_MS,
      },
    );
    if (
      !isRecord(payload)
      || !('status' in payload)
      || !('revocation' in payload)
      || !('archiveCleanup' in payload)
    ) {
      throw invalidResponse();
    }
    return {
      status: parseCloudInstanceStatus(payload.status),
      revocation: payload.revocation,
      archiveCleanup: payload.archiveCleanup,
    };
  });
}

async function requestCloudInstances<T>(
  request: (baseUrl: string) => Promise<T>,
): Promise<CloudInstanceApiOutcome<T>> {
  const baseUrl = CLOUD_INSTANCE_API_BASE_URL.trim();
  if (!baseUrl) return { kind: 'unsupported' };
  try {
    return { kind: 'ok', value: await request(baseUrl) };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'CLOUD_INSTANCE_DISABLED') {
        return { kind: 'unsupported' };
      }
      return {
        kind: 'error',
        error: {
          code: error.code,
          message: error.message,
          status: error.status,
        },
      };
    }
    return {
      kind: 'error',
      error: {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'Cloud instance request failed',
        status: null,
      },
    };
  }
}

function parseCloudInstance(value: unknown): CloudInstanceView {
  if (
    !isRecord(value) ||
    typeof value.instanceId !== 'string' ||
    value.instanceId.length === 0 ||
    typeof value.deviceId !== 'string' ||
    value.deviceId.length === 0 ||
    !Number.isInteger(value.nameSequence) ||
    (value.nameSequence as number) < 1 ||
    (value.customLabel !== null && typeof value.customLabel !== 'string') ||
    !('status' in value)
  ) {
    throw invalidResponse();
  }
  return {
    instanceId: value.instanceId,
    deviceId: value.deviceId,
    nameSequence: value.nameSequence as number,
    customLabel: value.customLabel,
    status: parseCloudInstanceStatus(value.status),
  };
}

function parseCloudInstanceStatus(value: unknown): CloudInstanceStatus {
  if (!isRecord(value)) throw invalidResponse();
  const rawUpgrade = isRecord(value.upgrade) ? value.upgrade : {};
  const rawState = rawUpgrade.state;
  const state: CloudInstanceUpgradeStatus['state'] =
    rawState === 'verifying' || rawState === 'rolled-back' ? rawState : 'idle';
  return {
    ...value,
    image:
      typeof value.image === 'string' && value.image.trim()
        ? value.image.trim()
        : null,
    updateAvailable: value.updateAvailable === true,
    latestReleaseTag:
      typeof value.latestReleaseTag === 'string' && value.latestReleaseTag.trim()
        ? value.latestReleaseTag.trim()
        : null,
    lastFailedUpgradeImage:
      typeof value.lastFailedUpgradeImage === 'string' && value.lastFailedUpgradeImage.trim()
        ? value.lastFailedUpgradeImage.trim()
        : state === 'rolled-back' && typeof rawUpgrade.targetImage === 'string'
          ? rawUpgrade.targetImage
          : null,
    ...(typeof value.autoUpdate === 'boolean' ? { autoUpdate: value.autoUpdate } : {}),
    upgrade: {
      state,
      targetImage: typeof rawUpgrade.targetImage === 'string' ? rawUpgrade.targetImage : null,
      previousImage: typeof rawUpgrade.previousImage === 'string' ? rawUpgrade.previousImage : null,
      deadlineAtMs:
        typeof rawUpgrade.deadlineAtMs === 'number' && Number.isFinite(rawUpgrade.deadlineAtMs)
          ? rawUpgrade.deadlineAtMs
          : null,
    },
  };
}

function parseUpgradeOutcome(value: unknown): CloudInstanceUpgradeResult['outcome'] {
  return value === 'no-op' || value === 'upgraded' || value === 'verifying'
    ? value
    : undefined;
}

function invalidResponse(): ApiError {
  return new ApiError(
    'INVALID_RESPONSE',
    0,
    'Cloud instance control plane returned an invalid response',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * cloud-instance-server HTTP client.
 *
 * The caller token is intentionally not accepted by this API: the shared
 * serverApiClient reads the current main-process auth token immediately before
 * every request and repeats that lookup after a TOKEN_EXPIRED refresh.
 */

import { createHash } from 'node:crypto';
import type {
  CloudInstanceCreateInput,
  CloudInstanceDeleteResult,
  CloudInstanceEnableResult,
  CloudInstancePatchInput,
  CloudInstanceRenameResult,
  CloudInstanceListResult,
  CloudInstanceRebuildResult,
  CloudInstanceResourceTier,
  CloudInstanceStatus,
  CloudInstanceUpgradeResult,
  CloudInstanceView,
  CloudInstanceWakeInput,
} from '../../shared/cloudInstanceIpc.js';
import { getClientEndpoint } from '../clientEndpointsService.js';
import { serverApiFetch, type ApiFetchOptions } from '../serverApiClient.js';

const CLOUD_INSTANCE_REQUEST_TIMEOUT_MS = 30_000;

/** Narrow request seam used by unit tests; production delegates to serverApiFetch. */
export type CloudInstanceRequest = <T>(path: string, options: ApiFetchOptions) => Promise<T>;

/** Injectable host dependencies for the HTTP client. */
export interface CloudInstanceClientDeps {
  getBaseUrl(): string;
  request: CloudInstanceRequest;
  timeoutMs?: number;
}

/** Configuration failure that the IPC adapter maps to UNSUPPORTED_CAPABILITY. */
export class CloudInstanceClientNotConfiguredError extends Error {
  constructor() {
    super('cloud instance control plane endpoint is not configured');
    this.name = 'CloudInstanceClientNotConfiguredError';
  }
}

/** Main-process cloud control-plane operations exposed through pure IPC handlers. */
export interface CloudInstanceClient {
  list(): Promise<CloudInstanceListResult>;
  wake(input: CloudInstanceWakeInput): Promise<CloudInstanceEnableResult>;
  create(input: CloudInstanceCreateInput): Promise<CloudInstanceEnableResult>;
  rename(instanceId: string, customLabel: string | null): Promise<CloudInstanceRenameResult>;
  patch(instanceId: string, input: Omit<CloudInstancePatchInput, 'instanceId'>): Promise<void>;
  status(instanceId?: string): Promise<{ status: CloudInstanceStatus }>;
  stop(instanceId: string): Promise<{ status: CloudInstanceStatus }>;
  upgrade(instanceId: string): Promise<CloudInstanceUpgradeResult>;
  rebuild(instanceId: string, retryOfOperationId?: string): Promise<CloudInstanceRebuildResult>;
  continueRebuild(
    operationId: string,
    oldInstanceId: string,
    retryOfOperationId?: string,
  ): Promise<CloudInstanceRebuildResult>;
  delete(instanceId: string): Promise<CloudInstanceDeleteResult>;
}

/**
 * Stable for one rebuild attempt across renderer/App restarts. A rejected
 * delete becomes the seed for the next attempt, so retries do not replay the
 * previous terminal operation forever.
 */
export function cloudInstanceRebuildIdempotencyKey(
  oldInstanceId: string,
  retryOfOperationId?: string,
): string {
  const material = `${oldInstanceId}\0${retryOfOperationId ?? ''}`;
  return `cindy-rebuild-v2:${createHash('sha256').update(material).digest('hex')}`;
}

function requestOptions(
  deps: CloudInstanceClientDeps,
  options: Omit<ApiFetchOptions, 'baseUrl' | 'timeoutMs' | 'token' | 'logMetadataOnly'>,
): ApiFetchOptions {
  const baseUrl = deps.getBaseUrl().trim();
  if (!baseUrl) throw new CloudInstanceClientNotConfiguredError();
  return {
    ...options,
    baseUrl,
    timeoutMs: deps.timeoutMs ?? CLOUD_INSTANCE_REQUEST_TIMEOUT_MS,
    logMetadataOnly: true,
    // Deliberately omit `token`: serverApiFetch owns current-token injection
    // and TOKEN_EXPIRED refresh/retry.
  };
}

/** Create a provider-neutral client around the standalone HTTP control plane. */
export function createCloudInstanceClient(deps: CloudInstanceClientDeps): CloudInstanceClient {
  return {
    list: async () =>
      deps.request<CloudInstanceListResult>(
        '/instances',
        requestOptions(deps, { method: 'GET' }),
      ),
    wake: async (input) =>
      deps.request<CloudInstanceEnableResult>(
        '/instances/wake',
        requestOptions(deps, { method: 'POST', body: input }),
      ),
    create: async (input) =>
      deps.request<CloudInstanceEnableResult>(
        '/instances',
        requestOptions(deps, { method: 'POST', body: input }),
      ),
    rename: async (instanceId, customLabel) =>
      deps.request<CloudInstanceRenameResult>(
        `/instances/${encodeURIComponent(instanceId)}`,
        requestOptions(deps, { method: 'PATCH', body: { customLabel } }),
      ),
    patch: async (instanceId, input) => {
      await deps.request<unknown>(
        `/instances/${encodeURIComponent(instanceId)}`,
        requestOptions(deps, { method: 'PATCH', body: input }),
      );
    },
    status: async (instanceId) => {
      const query = instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : '';
      return deps.request<{ status: CloudInstanceStatus }>(
        `/instances/status${query}`,
        requestOptions(deps, { method: 'GET' }),
      );
    },
    stop: async (instanceId) =>
      deps.request<{ status: CloudInstanceStatus }>(
        `/instances/${encodeURIComponent(instanceId)}/stop`,
        requestOptions(deps, { method: 'POST' }),
      ),
    upgrade: async (instanceId) =>
      deps.request<CloudInstanceUpgradeResult>(
        `/instances/${encodeURIComponent(instanceId)}/upgrade`,
        requestOptions(deps, { method: 'POST' }),
      ),
    rebuild: async (instanceId, retryOfOperationId) =>
      deps.request<CloudInstanceRebuildResult>(
        `/instances/${encodeURIComponent(instanceId)}/rebuild`,
        requestOptions(deps, {
          method: 'POST',
          body: {},
          headers: {
            'Idempotency-Key': cloudInstanceRebuildIdempotencyKey(
              instanceId,
              retryOfOperationId,
            ),
          },
        }),
      ),
    continueRebuild: async (operationId, oldInstanceId, retryOfOperationId) =>
      deps.request<CloudInstanceRebuildResult>(
        '/instances',
        requestOptions(deps, {
          method: 'POST',
          body: { rebuildOperationId: operationId },
          headers: {
            'Idempotency-Key': cloudInstanceRebuildIdempotencyKey(
              oldInstanceId,
              retryOfOperationId,
            ),
          },
        }),
      ),
    delete: async (instanceId) =>
      deps.request<CloudInstanceDeleteResult>(
        `/instances/${encodeURIComponent(instanceId)}`,
        requestOptions(deps, { method: 'DELETE' }),
      ),
  };
}

/** Production client: endpoint manifest + shared authenticated request layer. */
export function createDefaultCloudInstanceClient(): CloudInstanceClient {
  return createCloudInstanceClient({
    getBaseUrl: () => getClientEndpoint('cloudInstanceApiBaseUrl'),
    request: serverApiFetch,
  });
}

/** Shared tier guard for IPC payloads. */
export const CLOUD_INSTANCE_RESOURCE_TIERS: readonly CloudInstanceResourceTier[] = [
  'small',
  'medium',
  'large',
];

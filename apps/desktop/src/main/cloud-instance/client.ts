/**
 * cloud-instance-server HTTP client.
 *
 * The caller token is intentionally not accepted by this API: the shared
 * serverApiClient reads the current main-process auth token immediately before
 * every request and repeats that lookup after a TOKEN_EXPIRED refresh.
 */

import type {
  CloudInstanceCreateInput,
  CloudInstanceDeleteResult,
  CloudInstanceEnableResult,
  CloudInstanceRenameResult,
  CloudInstanceResourceTier,
  CloudInstanceStatus,
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
  list(): Promise<{ instances: CloudInstanceView[] }>;
  wake(input: CloudInstanceWakeInput): Promise<CloudInstanceEnableResult>;
  create(input: CloudInstanceCreateInput): Promise<CloudInstanceEnableResult>;
  rename(instanceId: string, customLabel: string | null): Promise<CloudInstanceRenameResult>;
  status(instanceId?: string): Promise<{ status: CloudInstanceStatus }>;
  stop(instanceId: string): Promise<{ status: CloudInstanceStatus }>;
  delete(instanceId: string): Promise<CloudInstanceDeleteResult>;
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
      deps.request<{ instances: CloudInstanceView[] }>(
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

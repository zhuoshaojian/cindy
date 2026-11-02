import { z } from 'zod';

/**
 * Provider management of a managed cloud instance, for the same account's cloud settings
 * page. It is a private DeviceLink channel registered only by the cloud runtime; ordinary
 * desktops answer CHANNEL_NOT_ALLOWED, so an older runtime is detected as unsupported.
 *
 * Reads return the full catalog the local providers page uses (hidden and payment-locked
 * models included); execution routing and credentials never cross. Writes reuse the Host's
 * native provider handlers. Credentials, logins and new connections stay on the CIS
 * management tickets.
 */
export const CLOUD_PROVIDER_SETTINGS_CHANNEL = 'cloud:provider-settings:v1';
export const CLOUD_PROVIDER_SETTINGS_MAX_BYTES = 2 * 1024 * 1024;

export const CLOUD_PROVIDER_SETTINGS_OPS = [
  'list',
  'visibility-set',
  'visibility-reset',
  'model-disable',
  'order',
  'presentation',
  'remote-access',
  'refresh',
  'rediscover',
] as const;
export type CloudProviderSettingsOp = (typeof CLOUD_PROVIDER_SETTINGS_OPS)[number];

const id = z.string().min(1).max(256);
const ownerGeneration = z.number().int().nonnegative();
const targets = z
  .array(z.object({ agent: z.string().min(1).max(64), modelId: id }).strict())
  .min(1)
  .max(512);

export const cloudProviderSettingsRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('list') }).strict(),
  z
    .object({
      op: z.literal('visibility-set'),
      ownerGeneration,
      revision: z.string().min(1).max(256),
      providerId: id,
      targets,
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      op: z.literal('visibility-reset'),
      ownerGeneration,
      revision: z.string().min(1).max(256),
      providerId: id,
      targets,
    })
    .strict(),
  z
    .object({
      op: z.literal('model-disable'),
      ownerGeneration,
      providerId: id,
      kind: z.enum(['model', 'provider', 'reset']),
      disabled: z.boolean().optional(),
      modelIds: z.array(id).min(1).max(512).optional(),
    })
    .strict(),
  z
    .object({ op: z.literal('order'), ownerGeneration, providerIds: z.array(id).min(1).max(256) })
    .strict(),
  z
    .object({
      op: z.literal('presentation'),
      ownerGeneration,
      providerId: id,
      action: z.enum(['rename', 'remove', 'restore']),
      name: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('remote-access'),
      ownerGeneration,
      providerId: id,
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ op: z.literal('refresh'), ownerGeneration, providerId: id }).strict(),
  z.object({ op: z.literal('rediscover'), ownerGeneration, providerId: id }).strict(),
]);
export type CloudProviderSettingsRequest = z.infer<typeof cloudProviderSettingsRequestSchema>;

export interface CloudProviderVisibilityState {
  /** `ready` only; anything else keeps visibility read-only, as on the local page. */
  status: 'ready' | 'pending-migration' | 'unavailable' | 'unreadable';
  revision: string | null;
  overrides: Record<string, boolean>;
}

export interface CloudProviderSettingsList {
  version: 1;
  ownerGeneration: number;
  /** Same shape as the local `maker:provider:list` providers, with routing projected for display. */
  providers: unknown[];
  providerOrder: string[];
  visibility: CloudProviderVisibilityState;
  supportedOps: CloudProviderSettingsOp[];
}

export interface CloudProviderSettingsWriteReceipt {
  ok: true;
  ownerGeneration: number;
  /** Visibility writes return the new state so a toggle need not re-download the catalog. */
  visibility?: CloudProviderVisibilityState;
  /** The write changed the catalog itself; refetch `list`. */
  catalogChanged: boolean;
}

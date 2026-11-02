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
  'model-call',
  'effort',
  'model-edit',
  'cli-scan',
] as const;
export type CloudProviderSettingsOp = (typeof CLOUD_PROVIDER_SETTINGS_OPS)[number];

/** Model panel calls served by the instance's native handlers, with its own owner stamp. */
export const CLOUD_MODEL_CALLS = {
  'context-get': 'maker:model-context-limit:get',
  'context-set': 'maker:model-context-limit:set',
  'context-reset': 'maker:model-context-limit:reset',
  'compaction-set': 'maker:model-compaction:set',
  'price-get': 'maker:model-price-override:get',
  'price-set': 'maker:model-price-override:set',
  'price-reset': 'maker:model-price-override:reset',
} as const;
export type CloudModelCall = keyof typeof CLOUD_MODEL_CALLS;

const id = z.string().min(1).max(256);
const agent = z.enum(['claude-code', 'codex', 'pi']);
const modelTarget = z.object({ providerId: id, agent, modelId: id }).strict();
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
  z
    .object({
      op: z.literal('model-call'),
      ownerGeneration,
      call: z.enum(Object.keys(CLOUD_MODEL_CALLS) as [CloudModelCall, ...CloudModelCall[]]),
      target: modelTarget
        .extend({ relatedTargets: z.array(modelTarget).max(2).optional() })
        .strict(),
      /** Limit or compaction percentage (null resets), or the desired price quote. */
      value: z
        .union([
          z.number().finite().nullable(),
          z
            .object({
              currency: z.enum(['CNY', 'USD']),
              inputPerMtok: z.number().finite(),
              outputPerMtok: z.number().finite(),
              cacheReadPerMtok: z.number().finite().nullable().optional(),
              cacheCreatePerMtok: z.number().finite().nullable().optional(),
            })
            .strict(),
        ])
        .optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('effort'),
      ownerGeneration,
      agent,
      providerId: id,
      modelId: id,
      effort: z.string().min(1).max(32).nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal('model-edit'),
      ownerGeneration,
      providerId: id,
      agent,
      modelId: id,
      edit: z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('interface'),
            api: z.string().min(1).max(128),
            profile: z.boolean(),
          })
          .strict(),
        z
          .object({
            kind: z.literal('capability'),
            media: z.enum(['image', 'video']),
            value: z.enum(['default', 'generate', 'edit']),
          })
          .strict(),
      ]),
    })
    .strict(),
  z.object({ op: z.literal('cli-scan'), ownerGeneration }).strict(),
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
  /** Remembered reasoning effort by memory slot (`agent:providerId`, `agent:*`) and model. */
  efforts?: Record<string, Record<string, string>>;
  supportedOps: CloudProviderSettingsOp[];
}

export interface CloudProviderSettingsWriteReceipt {
  ok: true;
  ownerGeneration: number;
  /** Visibility writes return the new state so a toggle need not re-download the catalog. */
  visibility?: CloudProviderVisibilityState;
  /** The write changed the catalog itself; refetch `list`. */
  catalogChanged: boolean;
  /** Result of a model panel call (context limit or price override view, CLI detections). */
  value?: unknown;
}

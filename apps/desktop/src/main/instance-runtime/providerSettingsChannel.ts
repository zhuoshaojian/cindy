import type { AgentKind } from '@cindy/model-providers';
import {
  CLOUD_MODEL_CALLS,
  CLOUD_PROVIDER_SETTINGS_CHANNEL,
  CLOUD_PROVIDER_SETTINGS_MAX_BYTES,
  CLOUD_PROVIDER_SETTINGS_OPS,
  cloudProviderSettingsRequestSchema,
  type CloudProviderSettingsList,
  type CloudProviderSettingsRequest,
  type CloudProviderSettingsWriteReceipt,
  type CloudProviderVisibilityState,
} from '../../shared/cloudProviderSettings.js';
import type { SettingsOwnerStamp } from '../../shared/hostSettings.js';
import type {
  ModelPresentationPreferencesSnapshot,
  ModelPresentationOperation,
  ModelPresentationReceipt,
  ModelPresentationRequest,
} from '../../shared/modelPresentationPreferences.js';
import type { CustomModelEdit } from '../../shared/customModelEdit.js';
import type { ManagementExecution } from '../host-settings/management.js';

export interface ProviderSettingsChannelDeps {
  /** The managed instance exists and its signed-in member is the instance owner. */
  isInstanceOwner(): boolean;
  owner(): SettingsOwnerStamp | null;
  /** Native provider handlers through the closed cloud management call set. */
  call(channel: string, args: unknown[], execution: ManagementExecution): Promise<unknown>;
  inspectVisibility(): ModelPresentationPreferencesSnapshot;
  mutateVisibility(
    request: ModelPresentationRequest & { operation: ModelPresentationOperation },
    assertCaller: () => void,
  ): Promise<ModelPresentationReceipt>;
  /** Display-only routing (upstream DeviceLink projection); execution details never cross. */
  projectRouting(routing: unknown): unknown;
  resolveLogoKind(providerId: string, routing: unknown): string | null;
  /** Remembered reasoning effort by memory slot and model (Host new-task history). */
  readEfforts(): Record<string, Record<string, string>>;
  applyEffort(pref: {
    agent: AgentKind;
    providerId: string;
    modelId: string;
    effort: string | null;
  }): Promise<void>;
  /** Guest share actions on this instance (received list, credential trust, leave). */
  shareCommand(
    command: Extract<CloudProviderSettingsRequest, { op: 'share' }>['command'],
  ): Promise<unknown>;
  /** Read-modify-write of the saved custom provider config on this instance. */
  editModel(
    request: { providerId: string; agent: AgentKind; modelId: string; edit: CustomModelEdit },
    execution: ManagementExecution,
  ): Promise<void>;
  timeoutMs?: number;
}

const fail = (code: string, message: string): never => {
  throw new Error(`[${code}] ${message}`);
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail('INTERNAL', 'invalid provider list');

function visibilityState(
  snapshot: ModelPresentationPreferencesSnapshot,
): CloudProviderVisibilityState {
  return snapshot.status === 'ready' || snapshot.status === 'pending-migration'
    ? {
        status: snapshot.status,
        revision: snapshot.revision,
        overrides: { ...snapshot.value.visibility.overrides },
      }
    : { status: snapshot.status, revision: null, overrides: {} };
}

/** Same display fields as the upstream DeviceLink list, without dropping hidden models. */
function projectProvider(raw: unknown, deps: ProviderSettingsChannelDeps): unknown {
  const provider = record(raw);
  const out: Record<string, unknown> = { ...provider };
  delete out.routing;
  delete out.logoKind;
  delete out.remoteModelIds;
  delete out.remoteInvocationEnabled;
  if (typeof provider.remoteInvocationEnabled === 'boolean')
    out.remoteInvocationEnabled = provider.remoteInvocationEnabled;
  const routing = deps.projectRouting(provider.routing);
  if (routing !== undefined) out.routing = routing;
  const logoKind =
    typeof provider.id === 'string' ? deps.resolveLogoKind(provider.id, provider.routing) : null;
  if (logoKind) out.logoKind = logoKind;
  return out;
}

export function createProviderSettingsChannel(deps: ProviderSettingsChannelDeps) {
  const ownerAtIngress = (): SettingsOwnerStamp => {
    if (!deps.isInstanceOwner()) fail('PERMISSION_DENIED', 'not the instance owner');
    return deps.owner() ?? fail('OWNER_CHANGED', 'the instance account is changing');
  };
  const execution = (owner: SettingsOwnerStamp): ManagementExecution => {
    const signal = AbortSignal.timeout(deps.timeoutMs ?? 30_000);
    return {
      signal,
      assertCurrent() {
        if (signal.aborted) fail('TIMEOUT', 'request timed out');
        const now = deps.isInstanceOwner() ? deps.owner() : null;
        if (
          !now ||
          now.dataOwnerId !== owner.dataOwnerId ||
          now.ownerGeneration !== owner.ownerGeneration
        )
          fail('OWNER_CHANGED', 'the instance account changed');
      },
      prompt() {
        fail('UNSUPPORTED', 'interactive provider flows use the cloud authorization page');
      },
      onCancel(cancel) {
        signal.addEventListener('abort', cancel, { once: true });
      },
    };
  };

  async function list(owner: SettingsOwnerStamp): Promise<CloudProviderSettingsList> {
    const run = execution(owner);
    const raw = record(await deps.call('maker:provider:list', [], run));
    run.assertCurrent();
    const providers = Array.isArray(raw.providers)
      ? raw.providers
      : fail('INTERNAL', 'invalid list');
    const snapshot = deps.inspectVisibility();
    const visibility = visibilityState(snapshot);
    // Before migration the Host reports its mirror; keep it read-only until a revision exists.
    if (
      visibility.revision === null &&
      raw.modelVisibilityOverrides &&
      typeof raw.modelVisibilityOverrides === 'object'
    )
      visibility.overrides = Object.fromEntries(
        Object.entries(raw.modelVisibilityOverrides as Record<string, unknown>).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
        ),
      );
    const result: CloudProviderSettingsList = {
      version: 1,
      ownerGeneration: owner.ownerGeneration,
      providers: providers.map((provider) => projectProvider(provider, deps)),
      providerOrder: Array.isArray(raw.providerOrder)
        ? raw.providerOrder.filter((id): id is string => typeof id === 'string')
        : [],
      visibility,
      efforts: deps.readEfforts(),
      supportedOps: [...CLOUD_PROVIDER_SETTINGS_OPS],
    };
    if (Buffer.byteLength(JSON.stringify(result)) > CLOUD_PROVIDER_SETTINGS_MAX_BYTES)
      fail('TOO_LARGE', 'provider catalog exceeds the transfer limit');
    return result;
  }

  async function write(
    request: Exclude<CloudProviderSettingsRequest, { op: 'list' }>,
    owner: SettingsOwnerStamp,
  ): Promise<CloudProviderSettingsWriteReceipt> {
    if (request.ownerGeneration !== owner.ownerGeneration)
      fail('OWNER_CHANGED', 'refresh the provider list');
    const run = execution(owner);
    const native = async (channel: string, ...args: unknown[]) => {
      await deps.call(channel, args, run);
      run.assertCurrent();
      return { ok: true as const, ownerGeneration: owner.ownerGeneration, catalogChanged: true };
    };
    switch (request.op) {
      case 'visibility-set':
      case 'visibility-reset': {
        const current = deps.inspectVisibility();
        if (current.revision === null) fail('UNAVAILABLE', 'model preferences are not ready');
        if (current.revision !== request.revision)
          fail('REVISION_CONFLICT', 'model visibility changed; refresh');
        const targets = request.targets as Extract<
          ModelPresentationOperation,
          { kind: 'visibility-set' }
        >['targets'];
        const operation: ModelPresentationOperation =
          request.op === 'visibility-set'
            ? {
                kind: 'visibility-set',
                providerId: request.providerId,
                targets,
                enabled: request.enabled,
              }
            : { kind: 'visibility-reset', providerId: request.providerId, targets };
        const receipt = await deps.mutateVisibility(
          { ownerStamp: owner, expectedRevision: request.revision, operation },
          run.assertCurrent,
        );
        run.assertCurrent();
        return {
          ok: true,
          ownerGeneration: owner.ownerGeneration,
          visibility: visibilityState(receipt.snapshot),
          catalogChanged: false,
        };
      }
      case 'model-disable':
        return native('maker:model-disable:set', {
          providerId: request.providerId,
          kind: request.kind,
          ...(request.disabled === undefined ? {} : { disabled: request.disabled }),
          ...(request.modelIds ? { modelIds: request.modelIds } : {}),
        });
      case 'order':
        return native('maker:provider:order:set', {
          dataOwnerId: owner.dataOwnerId,
          ownerGeneration: owner.ownerGeneration,
          providerIds: request.providerIds,
        });
      case 'presentation':
        return native('maker:provider:presentation:set', {
          dataOwnerId: owner.dataOwnerId,
          ownerGeneration: owner.ownerGeneration,
          providerId: request.providerId,
          action: request.action,
          ...(request.name === undefined ? {} : { name: request.name }),
        });
      case 'remote-access':
        return native('maker:provider:remote-access:set', {
          providerId: request.providerId,
          enabled: request.enabled,
        });
      case 'refresh':
        return native('maker:provider:models-refresh', request.providerId);
      case 'rediscover':
        return native('maker:provider:models-rediscover', request.providerId);
      case 'model-call': {
        // The instance stamps its own owner; a controller stamp never reaches the handler.
        const stamp = { dataOwnerId: owner.dataOwnerId, ownerGeneration: owner.ownerGeneration };
        const quote = typeof request.value === 'object' && request.value !== null;
        const args =
          request.call === 'context-set' || request.call === 'compaction-set'
            ? quote
              ? fail('INVALID_PARAMS', 'expected a number or null')
              : [request.target, request.value ?? null, stamp]
            : request.call === 'context-reset'
              ? [request.target, stamp]
              : request.call === 'price-set'
                ? quote
                  ? [request.target, request.value]
                  : fail('INVALID_PARAMS', 'expected a price quote')
                : [request.target];
        const value = await deps.call(CLOUD_MODEL_CALLS[request.call], args, run);
        run.assertCurrent();
        return {
          ok: true,
          ownerGeneration: owner.ownerGeneration,
          // Overrides change the catalog's limits and prices; reads change nothing.
          catalogChanged: !request.call.endsWith('-get'),
          value,
        };
      }
      case 'effort':
        await deps.applyEffort({
          agent: request.agent,
          providerId: request.providerId,
          modelId: request.modelId,
          effort: request.effort,
        });
        run.assertCurrent();
        return {
          ok: true,
          ownerGeneration: owner.ownerGeneration,
          catalogChanged: false,
          value: deps.readEfforts(),
        };
      case 'model-edit':
        await deps.editModel(
          {
            providerId: request.providerId,
            agent: request.agent,
            modelId: request.modelId,
            edit: request.edit,
          },
          run,
        );
        run.assertCurrent();
        return { ok: true, ownerGeneration: owner.ownerGeneration, catalogChanged: true };
      case 'share': {
        const value = await deps.shareCommand(request.command);
        run.assertCurrent();
        return { ok: true, ownerGeneration: owner.ownerGeneration, catalogChanged: false, value };
      }
      case 'cli-scan': {
        const value = await deps.call('maker:provider:local-cli-scan', [], run);
        run.assertCurrent();
        return { ok: true, ownerGeneration: owner.ownerGeneration, catalogChanged: false, value };
      }
    }
  }

  return {
    channel: CLOUD_PROVIDER_SETTINGS_CHANNEL,
    async handle(_controller: string, raw: unknown): Promise<unknown> {
      const owner = ownerAtIngress();
      const parsed = cloudProviderSettingsRequestSchema.safeParse(raw);
      if (!parsed.success) fail('INVALID_PARAMS', 'invalid provider settings request');
      const request = parsed.data!;
      return request.op === 'list' ? list(owner) : write(request, owner);
    },
  };
}

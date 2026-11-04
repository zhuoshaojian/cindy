import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { BotsGlobalSettingsSectionView } from '@/features/bots/BotsGlobalSettingsSection';
import { SubagentModelSectionView } from '@/components/settings/SubagentModelSection';
import { VisionBridgeSectionView } from '@/components/settings/VisionBridgeSection';
import { AuxiliaryModelSectionView } from '@/components/settings/AuxiliaryModelSection';
import { useDeviceProviders } from '@/hooks/useDeviceProviders';
import { normalizeBotModelChain } from '../../../shared/botModelChain';
import { decodeCatalogModelPin } from '../../../shared/catalogModelPin';
import type { AuxiliaryModelOption } from '../../../shared/auxiliaryModelSettings';
import type { VisionBackendRef } from '../../../shared/visionBridgeSettings';
import type { CloudSettingsDomain, CloudSettingsState } from '../../../shared/cloudSettings';

/** Resolves true once the target confirmed the write; failures are already reported. */
type Attempt = (
  domain: CloudSettingsDomain,
  set: Record<string, unknown>,
  clear?: string[],
) => Promise<boolean>;
type Route = { providerId: string | null; modelId: string };
const isRoute = (value: unknown): value is Route =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as Route).modelId === 'string';

/**
 * Bot default model chain on the target. Model pickers read the target's catalog
 * through `deviceId`; the Host validates every route. Cross-device routes and
 * finer speed tiers have no field in the settings contract, so they are refused
 * rather than silently dropped.
 */
export function CloudBotsSettings({
  state,
  deviceId,
  disabled,
  attempt,
}: {
  state: CloudSettingsState;
  deviceId: string;
  disabled: boolean;
  attempt: Attempt;
}) {
  const { t } = useTranslation();
  const chain = normalizeBotModelChain(state.value?.modelChain);
  return (
    <BotsGlobalSettingsSectionView
      modelChain={chain}
      pending={disabled}
      notice={null}
      deviceId={deviceId}
      onChange={(next) => {
        if (next.some((route) => route.agentDeviceId || route.fastMode === 'ultrafast')) {
          toast.error(t('cloudSettings.settingUnavailable'));
          return;
        }
        void attempt('botModelChain', {
          modelChain: next.map((route) => ({
            harness: route.harness,
            providerId: route.providerId ?? null,
            model: route.model,
            effort: route.effort ?? '',
            fastMode: route.fastMode === true,
          })),
        });
      }}
      onRestoreDefault={
        state.isCustomized ? () => void attempt('botModelChain', {}, ['modelChain']) : undefined
      }
    />
  );
}

export function CloudSubagentSettings({
  state,
  deviceId,
  disabled,
  attempt,
}: {
  state: CloudSettingsState;
  deviceId: string;
  disabled: boolean;
  attempt: Attempt;
}) {
  const route = isRoute(state.value?.claudeCode) ? state.value.claudeCode : null;
  const customized = (key: string) => state.customizedKeys?.includes(key) ?? false;
  // The target's allowlist; a saved source missing from it is shown as disconnected.
  const sources = (state.choices?.claudeCode ?? []).map(({ value }) => value).filter(isRoute);
  return (
    <SubagentModelSectionView
      claudeCode={route?.modelId ?? null}
      claudeCodeProviderId={route?.providerId ?? null}
      codexSmartSubagentRouting={state.value?.codexSmartSubagentRouting === true}
      claudeCustomized={customized('claudeCode')}
      smartRoutingCustomized={customized('codexSmartSubagentRouting')}
      pending={disabled}
      providersLoading={false}
      claudeSourceDisconnected={
        !!route?.providerId &&
        !sources.some((source) => source.providerId === route.providerId)
      }
      deviceId={deviceId}
      setClaudeModel={async (modelId, providerId) => {
        if (modelId === route?.modelId && providerId === (route?.providerId ?? null)) return;
        await attempt('subagentModel', {
          claudeCode: modelId === null ? null : { providerId, modelId },
        });
        return true;
      }}
      resolveClaudeProviderId={(_modelId, providerId) => providerId}
      resetClaude={() => void attempt('subagentModel', {}, ['claudeCode'])}
      resetSmartRouting={() => void attempt('subagentModel', {}, ['codexSmartSubagentRouting'])}
      setSmartRouting={(next) =>
        void attempt('subagentModel', { codexSmartSubagentRouting: next })
      }
    />
  );
}

/**
 * Vision bridge on the target. Rows and backend candidates come from the target
 * catalog. The view's pickers receive that catalog directly rather than a
 * deviceId: the picker ignores its catalog override for remote devices, which
 * would drop the vision-capable filter.
 */
export function CloudVisionBridgeSettings({
  state,
  deviceId,
  disabled,
  attempt,
}: {
  state: CloudSettingsState;
  deviceId: string;
  disabled: boolean;
  attempt: Attempt;
}) {
  const catalog = useDeviceProviders(deviceId);
  const value = state.value ?? {};
  const backend = (raw: unknown) => (isRoute(raw) && raw.providerId ? (raw as VisionBackendRef) : null);
  return (
    <VisionBridgeSectionView
      providers={catalog.providers}
      providersLoading={catalog.loading}
      enabled={value.enabled === true}
      targetModels={Array.isArray(value.targetModels) ? value.targetModels.map(String) : []}
      primary={backend(value.primary)}
      fallback={backend(value.fallback)}
      isCustomized={!!state.isCustomized}
      targetModelsCustomized={state.customizedKeys?.includes('targetModels') ?? false}
      pending={disabled}
      persistPatch={(patch) => attempt('visionBridge', patch)}
      resetTargetModels={async () => {
        await attempt('visionBridge', {}, ['targetModels']);
      }}
    />
  );
}

/** Target auxiliary pins; labels follow the Host format "Agent · Model · Provider". */
function auxiliaryOption(id: string, label: string, available: boolean): AuxiliaryModelOption {
  const route = decodeCatalogModelPin(id);
  const [agentSuffix = '', modelName = route?.model ?? id, group = route?.providerId ?? ''] =
    label.split(' · ');
  return {
    id,
    label,
    group,
    providerId: route?.providerId ?? '',
    agentKind: route?.agentKind ?? 'pi',
    modelId: route?.model ?? id,
    modelName,
    budget: false,
    subscription: false,
    agentSuffix,
    available,
  };
}

export function CloudAuxiliarySettings({
  state,
  disabled,
  attempt,
}: {
  state: CloudSettingsState;
  disabled: boolean;
  attempt: Attempt;
}) {
  const [drafting, setDrafting] = useState(false);
  const models = Array.isArray(state.value?.models) ? state.value.models.map(String) : [];
  const offered = (state.choices?.models ?? []).map(({ value, label }) =>
    auxiliaryOption(String(value), label, true),
  );
  // A saved pin the target no longer offers stays visible as unavailable.
  const options = [
    ...offered,
    ...models.filter((id) => !offered.some((option) => option.id === id)).map((id) => auxiliaryOption(id, id, false)),
  ];
  return (
    <AuxiliaryModelSectionView
      models={models}
      options={options}
      pending={disabled}
      signInHint={false}
      drafting={drafting}
      setDrafting={setDrafting}
      persistModels={async (next) => {
        const saved = await attempt('auxiliaryModel', next.length ? { models: next } : {}, next.length ? undefined : ['models']);
        if (saved && !next.length) setDrafting(false);
        return saved;
      }}
    />
  );
}

import { useTranslation } from 'react-i18next';
import { ModelSelector } from '@/components/new-chat/ModelSelector';
import {
  ImDefaultSettingsSectionFrame,
  ImDefaultSettingsSectionView,
  type ImDefaultSettingsSummary,
} from '@/components/settings/ImDefaultSettingsSection';
import {
  TelegramBehaviorSettingsView,
  TelegramGroupActivationSettingsView,
} from '@/components/settings/TelegramBehaviorSettings';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { additionalSettingsSchemas } from '../../../shared/settingsEditableCatalog';
import {
  isImDefaultEffort,
  isImDefaultPermissionMode,
  type ImDefaultAgentKind,
  type ImDefaultSettingsChannel,
} from '../../../shared/imDefaultSettings';
import type { CloudSettingsDomain, CloudSettingsState } from '../../../shared/cloudSettings';

const channels = {
  feishu: 'imFeishu',
  discord: 'imDiscord',
  wechat: 'imWechat',
  telegram: 'imTelegram',
  dingtalk: 'imDingtalk',
  wecom: 'imWecom',
} as const;
const routeKey = (agent: ImDefaultAgentKind) => (agent === 'claude-code' ? 'claudeCode' : agent);
type Props = {
  itemId: string;
  section?: 'defaults' | 'telegram';
  deviceId: string;
  states: Partial<Record<CloudSettingsDomain, CloudSettingsState>>;
  disabled: boolean;
  loading?: boolean;
  readFailed?: boolean;
  supportedDomains?: readonly CloudSettingsDomain[];
  retry?(): void;
  retryDisabled?: boolean;
  save(
    state: CloudSettingsState,
    set: Record<string, unknown>,
    clear?: string[],
  ): Promise<CloudSettingsState>;
};
/** All reads/writes target the selected cloud Host. Official hooks never use personal bot scopes. */
export function CloudImSettings({
  itemId,
  section = 'defaults',
  deviceId,
  states,
  disabled,
  save,
  loading = false,
  readFailed = false,
  supportedDomains,
  retry,
  retryDisabled = false,
}: Props) {
  const { t } = useTranslation();
  const channel = itemId.replace(/^bot:/, '') as keyof typeof channels;
  const domain = channels[channel];
  if (!domain || (section === 'telegram' && channel !== 'telegram')) return null;
  const state = states[domain];
  const supported = !supportedDomains || supportedDomains.includes(domain);
  const commit = async (s: CloudSettingsState, set: Record<string, unknown>, clear?: string[]) => {
    if (disabled) return false;
    try {
      await save(s, set, clear);
      return true;
    } catch {
      toast.error(t('hostSettings.saveFailed'));
      return false;
    }
  };
  const parsed =
    state?.status === 'ready' ? additionalSettingsSchemas[domain].safeParse(state.value) : null;
  const value = parsed?.success ? parsed.data : null;
  const behavior = states.telegramBehavior;
  const groups = states.telegramGroups;
  const active = value?.[routeKey(value.agentKind)];
  const agents = (state?.choices?.agentKind ?? [])
    .map((choice) => choice.value)
    .filter(
      (agent): agent is ImDefaultAgentKind =>
        agent === 'claude-code' || agent === 'codex' || agent === 'pi',
    );
  const select = (
    agent: ImDefaultAgentKind,
    modelId: string,
    providerId: string | null,
    effort: unknown,
  ) => {
    if (!state || !value || !agents.includes(agent)) return false;
    // The DeviceLink picker uses the target catalog. The settings snapshot is the
    // additional allowlist; a route disappearing between reads is never guessed.
    const options = state.choices?.[routeKey(agent)] ?? [];
    const option = options.find((choice) => {
      const route = choice.value;
      return (
        !!route &&
        !Array.isArray(route) &&
        typeof route === 'object' &&
        route.modelId === modelId &&
        route.providerId === providerId
      );
    });
    if (
      !option ||
      !isImDefaultEffort(effort) ||
      (option.efforts?.length && !option.efforts.includes(effort))
    ) {
      toast.error(t('hostSettings.saveFailed'));
      return false;
    }
    return commit(state, { agentKind: agent, [routeKey(agent)]: { providerId, modelId, effort } });
  };
  const always = Array.isArray(groups?.value?.always)
    ? groups.value.always.filter((id): id is string => typeof id === 'string')
    : [];
  const knownGroups = new Map(
    (groups?.choices?.always ?? [])
      .filter((choice) => typeof choice.value === 'string')
      .map((choice) => [String(choice.value), choice.label]),
  );
  // Retain explicitly configured groups absent from the current discovery page.
  for (const id of always) if (!knownGroups.has(id)) knownGroups.set(id, id);
  const available = !loading && !readFailed && supported && state && value && active;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {section === 'defaults' && !available && (
        <ImDefaultSettingsSectionFrame descriptionChannel={channel} embedded>
          {loading ? (
            <p role="status" className="text-13 text-[var(--text-tertiary)]">
              {t('settings.imBot.defaults.loading')}
            </p>
          ) : (
            <ErrorNotice
              role="alert"
              message={t('cloudSettings.imReadFailed')}
              description={t(
                !readFailed && (!supported || state?.status === 'unavailable')
                  ? 'cloudSettings.imReadUnavailable'
                  : state?.readErrorCode === 'SETTINGS_RESPONSE_TOO_LARGE' ||
                      state?.readErrorCode === 'MODEL_CATALOG_TOO_LARGE'
                    ? 'cloudSettings.imReadTooLarge'
                    : 'cloudSettings.imReadFailedHint',
              )}
              details={state?.readErrorCode}
              actions={
                retry && (
                  <Button size="sm" disabled={retryDisabled} onClick={retry}>
                    {t('cloudSettings.reload')}
                  </Button>
                )
              }
            />
          )}
        </ImDefaultSettingsSectionFrame>
      )}
      {section === 'telegram' && (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="text-13 font-medium text-[var(--settings-section-title)]">
              {t('settings.telegramBot.persona.title')}
            </h3>
            <p className="text-12 text-[var(--settings-section-desc)]">
              {t('cloudSettings.imRemoteControlUnavailable')}
            </p>
          </section>
          {(['telegramBehavior', 'telegramGroups'] as const)
            .filter((domain) => states[domain]?.status !== 'ready')
            .map((domain) => (
              <ErrorNotice
                key={domain}
                role="alert"
                message={t(
                  domain === 'telegramBehavior'
                    ? 'settings.telegramBot.behavior.title'
                    : 'settings.telegramBot.groups.title',
                )}
                description={t(
                  states[domain]?.status === 'unavailable'
                    ? 'cloudSettings.imReadUnavailable'
                    : 'cloudSettings.imReadFailedHint',
                )}
                details={states[domain]?.readErrorCode}
                actions={
                  retry && (
                    <Button size="sm" disabled={retryDisabled} onClick={retry}>
                      {t('cloudSettings.reload')}
                    </Button>
                  )
                }
              />
            ))}
        </>
      )}
      <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        {section === 'defaults' && available && (
          <ImDefaultSettingsSectionView
            deviceId={deviceId}
            embedded
            channel={channel as ImDefaultSettingsChannel}
            pending={disabled}
            settings={{
              agentKind: value.agentKind,
              groupPermissionMode:
                'groupPermissionMode' in value &&
                isImDefaultPermissionMode(value.groupPermissionMode)
                  ? value.groupPermissionMode
                  : 'auto',
              isCustomized: !!state.isCustomized,
            }}
            reset={() => commit(state, {}, Object.keys(state.defaults ?? {}))}
            automaticModel={!active.modelId}
            activeModel={active.modelId}
            showAutomaticUnavailable={false}
            useAutomatic={() =>
              commit(state, {
                agentKind: 'claude-code',
                ...Object.fromEntries(
                  ['claudeCode', 'codex', 'pi'].map((key) => [
                    key,
                    { providerId: null, modelId: '', effort: 'high' },
                  ]),
                ),
              })
            }
            onGroupPermissionChange={(groupPermissionMode) =>
              commit(state, { groupPermissionMode })
            }
            modelPicker={
              <ModelSelector
                deviceId={deviceId}
                modelId={active.modelId}
                effort={active.effort}
                disabled={disabled}
                fastModeConfigurable={false}
                unifiedAgents={agents}
                configurationEnabled={false}
                recordRecentUsage={false}
                currentProviderId={active.providerId}
                vendorKey={value.agentKind === 'claude-code' ? 'cc' : value.agentKind}
                triggerVariant="field"
                popoverSide="bottom"
                onModelChange={(id) =>
                  select(value.agentKind, id, active.providerId, active.effort)
                }
                onEffortChange={(effort) =>
                  select(value.agentKind, active.modelId, active.providerId, effort)
                }
                onProviderChange={(provider, id, effort) =>
                  select(value.agentKind, id ?? active.modelId, provider, effort ?? active.effort)
                }
                onUnifiedSelect={({ engine, modelId, providerId, effort }) =>
                  select(engine === 'cc' ? 'claude-code' : engine, modelId, providerId, effort)
                }
              />
            }
          />
        )}
        {section === 'telegram' && behavior?.status === 'ready' && (
          <TelegramBehaviorSettingsView
            behavior={additionalSettingsSchemas.telegramBehavior.parse(behavior.value)}
            patch={(patch) => void commit(behavior, patch)}
          />
        )}
        {section === 'telegram' && groups?.status === 'ready' && (
          <TelegramGroupActivationSettingsView
            groups={[...knownGroups].map(([chatId, chatName]) => ({
              chatId,
              chatName,
              activation: always.includes(chatId) ? 'always' : 'mention',
            }))}
            setMode={(id, mode) =>
              void commit(groups, {
                always:
                  mode === 'always'
                    ? [...new Set([...always, id])]
                    : always.filter((value) => value !== id),
              })
            }
          />
        )}
      </fieldset>
    </div>
  );
}

/** Collapsed native card summary comes only from the selected Host snapshot. */
export function cloudImSettingsSummary(
  itemId: string,
  states: Props['states'],
  automaticLabel: string,
): ImDefaultSettingsSummary | null {
  const domain = channels[itemId.replace(/^bot:/, '') as keyof typeof channels];
  if (!domain) return null;
  const state = states[domain];
  const parsed =
    state?.status === 'ready' ? additionalSettingsSchemas[domain].safeParse(state.value) : null;
  if (!parsed?.success) return null;
  const value = parsed.data;
  const route = value[routeKey(value.agentKind)];
  const choice = state?.choices?.[routeKey(value.agentKind)]?.find(
    ({ value: option }) =>
      option &&
      typeof option === 'object' &&
      !Array.isArray(option) &&
      option.modelId === route.modelId &&
      option.providerId === route.providerId,
  );
  return {
    agentKind: value.agentKind,
    model: route.modelId ? (choice?.label ?? route.modelId) : automaticLabel,
  };
}

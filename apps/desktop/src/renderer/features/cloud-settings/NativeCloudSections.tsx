import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { NotificationSectionView } from '@/components/settings/NotificationSection';
import { StreamFadeSectionView } from '@/components/settings/StreamFadeSection';
import { AgentResourceSectionView } from '@/components/settings/AgentResourceSection';
import { CollaborationSectionView } from '@/components/settings/CollaborationSection';
import { MemorySectionView } from '@/components/settings/MemorySection';
import { GitSafetySectionView } from '@/components/settings/GitSafetySection';
import { TerminalShellSectionView } from '@/components/settings/TerminalShellSection';
import { SilentEncryptedRetryCellView } from '@/components/settings/SilentEncryptedRetryCell';
import { ChatEmbeddingCellView } from '@/components/settings/ChatEmbeddingCell';
import { TipsSectionView, PromptRecommendationCellView } from '@/components/settings/TipsSection';
import { MessageNavRailCellView } from '@/components/settings/MessageNavRailCell';
import { LinkOpenSectionView } from '@/components/settings/LinkOpenSection';
import { ComposerSendShortcutSectionView } from '@/components/settings/ComposerSendShortcutSection';
import { LanguageSectionView } from '@/components/settings/LanguageSection';
import type { LocalePreference } from '@/i18n';
import { LspBetaCellView } from '@/components/settings/LspBetaCell';
import { BuiltinToolsSectionView } from '@/components/settings/BuiltinToolsSection';
import {
  AndroidAutomationHeader,
  AutomationCard,
  BrowserAutomationHeader,
  ComputerAutomationHeader,
  ComputerUseSectionHeader,
} from '@/components/settings/ComputerUseSection';
import { BrowserBackendSubsection } from '@/components/settings/BrowserBackendSubsection';
import {
  DatabaseWarningSettingsView,
  STORAGE_DATABASE_BODY_CLASS,
  StorageDatabaseSection,
  StorageSectionFrame,
} from '@/components/settings/StorageManagementCard';
import {
  AboutSectionView,
  AnalyticsToggleView,
  CrashAutoUploadToggleView,
  DebugLogToggleView,
  Divider as AboutDivider,
  InfoRow,
} from '@/components/settings/AboutSection';
import { ExperimentalSectionView } from '@/components/settings/ExperimentalSection';
import { ContactsSectionView } from '@/components/settings/contacts/ContactsSection';
import {
  PersonalizationPageTitle,
  UserPromptEditor,
} from '@/components/settings/UserPromptSection';
import { CloudAppearanceSettings } from './CloudAppearanceSettings';
import {
  CloudAuxiliarySettings,
  CloudBotsSettings,
  CloudSubagentSettings,
  CloudVisionBridgeSettings,
} from './CloudModelSettings';
import type { AvailableShell, ShellId } from '../../../shared/terminal-bridge';
import type {
  CloudSettingsDomain,
  CloudSettingsState,
  CloudSettingsTab,
} from '../../../shared/cloudSettings';

type Props = {
  tab: CloudSettingsTab;
  /** Target device; model pickers read its catalog. */
  deviceId: string;
  states: Partial<Record<CloudSettingsDomain, CloudSettingsState>>;
  disabled: boolean;
  cpuCount?: number;
  /** Instance runtime version from CIS; About shows it like the local app version. */
  appVersion?: string;
  trial: boolean;
  save(
    state: CloudSettingsState,
    set: Record<string, unknown>,
    clear?: string[],
  ): Promise<CloudSettingsState>;
  changed(domain: string, dirty: boolean): void;
};
const num = (s: CloudSettingsState, key: string) => Number(s.value?.[key]);
const bool = (s: CloudSettingsState, key: string) => s.value?.[key] === true;
// Section spacing mirrors SettingsView: General sections are py, the rest pb.
const section = (id: string, content: ReactNode, className = 'pb-[18px]') => (
  <section id={id} key={id} className={className}>
    {content}
  </section>
);
const generalSection = (id: string, content: ReactNode) => section(id, content, 'py-[18px]');

function Resource({
  state,
  save,
  changed,
  cpuCount,
  disabled,
}: Pick<Props, 'save' | 'changed' | 'cpuCount' | 'disabled'> & { state: CloudSettingsState }) {
  const { t } = useTranslation();
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  useEffect(() => {
    changed('agentResource', maxDraft !== null);
  }, [maxDraft, changed]);
  const settings = {
    maxConcurrentCommands: num(state, 'maxConcurrentCommands'),
    processPriority: String(state.value?.processPriority) as 'normal' | 'low' | 'lowest',
    capToolchainThreads: bool(state, 'capToolchainThreads'),
    isCustomized: state.isCustomized,
    customizedKeys: state.customizedKeys,
    defaults: state.defaults,
  } as ComponentProps<typeof AgentResourceSectionView>['settings'];
  const presets = {
    full: { maxConcurrentCommands: 0, processPriority: 'normal', capToolchainThreads: false },
    balanced: {
      maxConcurrentCommands: Math.min(64, Math.max(2, Math.ceil((cpuCount ?? 2) / 2))),
      processPriority: 'low',
      capToolchainThreads: true,
    },
    background: { maxConcurrentCommands: 2, processPriority: 'lowest', capToolchainThreads: true },
  } as const;
  const activePreset =
    (Object.keys(presets) as (keyof typeof presets)[]).find((key) =>
      Object.entries(presets[key]).every(([field, value]) => state.value?.[field] === value),
    ) ?? null;
  const commit = async (set: Record<string, unknown>, clear?: string[]) => {
    try {
      await save(state, set, clear);
    } catch {
      toast.error(t('hostSettings.saveFailed'));
    }
  };
  return (
    <AgentResourceSectionView
      settings={settings}
      activePreset={activePreset}
      applyingPreset={disabled}
      maxDraft={maxDraft}
      setMaxDraft={setMaxDraft}
      persist={(key, value) => void commit({ [key]: value })}
      applyPreset={async (id) => {
        if (id === 'balanced' && !cpuCount) {
          toast.error(t('cloudSettings.readFailed'));
          return;
        }
        setMaxDraft(null);
        await commit(presets[id]);
      }}
      reset={() => void commit({}, Object.keys(state.defaults ?? {}))}
    />
  );
}
function Storage({
  state,
  save,
  disabled,
  changed,
}: Pick<Props, 'save' | 'disabled' | 'changed'> & { state: CloudSettingsState }) {
  const [draft, setDraft] = useState(String(state.value?.thresholdGiB));
  const [invalid, setInvalid] = useState(false);
  const dirty = draft !== String(state.value?.thresholdGiB);
  const previous = useRef(state.value?.thresholdGiB);
  useEffect(() => {
    if (draft === String(previous.current)) setDraft(String(state.value?.thresholdGiB));
    previous.current = state.value?.thresholdGiB;
  }, [state]);
  useEffect(() => {
    changed('databaseWarning', dirty);
  }, [dirty, changed]);
  const { t } = useTranslation();
  const persist = async (patch?: { disabled?: boolean; thresholdGiB?: number }) => {
    try {
      const result = await save(
        state,
        patch ?? {},
        patch ? undefined : ['disabled', 'thresholdGiB'],
      );
      setDraft(String(result.value?.thresholdGiB));
    } catch {
      toast.error(t('hostSettings.saveFailed'));
    }
  };
  return (
    <DatabaseWarningSettingsView
      warningThresholdDraft={draft}
      warningThresholdInvalid={invalid}
      warningSaving={disabled}
      warningDisabled={bool(state, 'disabled')}
      warningCustomized={!!state.isCustomized}
      onThresholdChange={(value) => {
        setDraft(value);
        setInvalid(false);
      }}
      saveWarningThreshold={async () => {
        if (!dirty) return;
        const value = Number(draft);
        if (!draft || !Number.isInteger(value) || value < 1 || value > 1024) {
          setInvalid(true);
          return;
        }
        await persist({ thresholdGiB: value });
      }}
      persistWarningSettings={persist}
    />
  );
}

export function NativeCloudSections(props: Props) {
  const { tab, states, save, disabled, changed, trial, deviceId, appVersion } = props;
  const { t } = useTranslation();
  // The three-mode Git control requires the native mode wire field. The legacy
  // boolean cloud field cannot distinguish existing repositories from all projects.
  // The trial can demonstrate the native control; production does not guess a mode.
  const [trialGitMode, setTrialGitMode] = useState<'off' | 'existing-git' | 'all-projects'>(
    'all-projects',
  );
  const ready = (d: CloudSettingsDomain) => (states[d]?.status === 'ready' ? states[d] : undefined);
  const update = async (d: CloudSettingsDomain, set: Record<string, unknown>, clear?: string[]) => {
    const s = ready(d);
    if (!s) throw Error('NOT_READY');
    return save(s, set, clear);
  };
  // Resolves true once the target confirmed the write; failures are reported here.
  const confirmSave = async (
    d: CloudSettingsDomain,
    set: Record<string, unknown>,
    clear?: string[],
  ) => {
    try {
      await update(d, set, clear);
      return true;
    } catch {
      toast.error(t('hostSettings.saveFailed'));
      return false;
    }
  };
  const attempt = async (
    d: CloudSettingsDomain,
    set: Record<string, unknown>,
    clear?: string[],
  ) => {
    await confirmSave(d, set, clear);
  };
  const reset = (d: CloudSettingsDomain) => attempt(d, {}, Object.keys(states[d]?.defaults ?? {}));
  const s = (d: CloudSettingsDomain) => states[d]!;
  const c = (d: CloudSettingsDomain) => !!s(d).isCustomized;
  const chatCustomized = (key: string) => s('desktopChat').customizedKeys?.includes(key) ?? false;
  const linkControl = (key: 'webLinkOpenPreference' | 'localLinkOpenPreference') => ({
    preference: s('desktopChat').value?.[key] as 'external' | 'sidebar',
    isCustomized: chatCustomized(key),
    onChange: (next: 'external' | 'sidebar') => void attempt('desktopChat', { [key]: next }),
    onReset: () => attempt('desktopChat', {}, [key]),
  });
  if (tab === 'appearance')
    return (
      <>
        {ready('desktopGeneral') && ready('appearance') && (
          <section className="pb-[18px]" aria-label={t('settings.sections.appearance')}>
            <CloudAppearanceSettings
              general={s('desktopGeneral')}
              appearance={s('appearance')}
              disabled={disabled}
              attempt={attempt}
              changed={changed}
            />
          </section>
        )}
        {ready('desktopChat') &&
          section(
            'settings-search-target-appearance-stream-fade',
            <StreamFadeSectionView
              enabled={s('desktopChat').value?.streamFadePreference === 'on'}
              isCustomized={chatCustomized('streamFadePreference')}
              onChange={(value) =>
                void attempt('desktopChat', { streamFadePreference: value ? 'on' : 'off' })
              }
              onReset={() => attempt('desktopChat', {}, ['streamFadePreference'])}
            />,
            'pt-[18px] pb-[18px]',
          )}
      </>
    );
  if (tab === 'general')
    return (
      <>
        {ready('desktopGeneral') &&
          generalSection(
            'settings-search-target-general-language',
            <LanguageSectionView
              locale={s('desktopGeneral').value?.locale as LocalePreference}
              disabled={disabled}
              onChange={(locale) => void attempt('desktopGeneral', { locale })}
            />,
          )}
        {ready('desktopNotifications') &&
          generalSection(
            'settings-notifications',
            <NotificationSectionView
              enabled={bool(s('desktopNotifications'), 'notificationsEnabled')}
              onChange={(notificationsEnabled) =>
                void attempt('desktopNotifications', { notificationsEnabled })
              }
            />,
          )}
        {ready('desktopChat') &&
          generalSection(
            'settings-composer',
            <ComposerSendShortcutSectionView
              preference={
                s('desktopChat').value?.composerSendShortcut as 'enter' | 'modifier-enter'
              }
              isCustomized={chatCustomized('composerSendShortcut')}
              shortcut="Ctrl+Enter"
              disabled={disabled}
              onChange={(next) => void attempt('desktopChat', { composerSendShortcut: next })}
              onReset={() => attempt('desktopChat', {}, ['composerSendShortcut'])}
            />,
          )}
        {ready('botModelChain') &&
          generalSection(
            'settings-bots',
            <CloudBotsSettings
              state={s('botModelChain')}
              deviceId={deviceId}
              disabled={disabled}
              attempt={confirmSave}
            />,
          )}
        {ready('collaboration') &&
          generalSection(
            'settings-collaboration',
            <CollaborationSectionView
              settings={{
                workerSoftLimit: num(s('collaboration'), 'workerSoftLimit'),
                workerHardLimit: num(s('collaboration'), 'workerHardLimit'),
                workerIdleReleaseMinutes: num(s('collaboration'), 'workerIdleReleaseMinutes'),
                isCustomized: c('collaboration'),
              }}
              persist={(key, value) => void attempt('collaboration', { [key]: value })}
              reset={() => void reset('collaboration')}
            />,
          )}
        {ready('agentResource') &&
          generalSection('settings-agent-resource', <Resource {...props} state={s('agentResource')} />)}
        {trial &&
          ready('gitSafety') &&
          generalSection(
            'settings-search-target-general-git-safety',
            <GitSafetySectionView
              mode={trialGitMode}
              saving={disabled}
              isCustomized={trialGitMode !== 'all-projects'}
              handleModeChange={setTrialGitMode}
              handleReset={() => setTrialGitMode('all-projects')}
            />,
          )}
        {ready('lsp') &&
          generalSection(
            'settings-search-target-general-experimental',
            // The Beta update channel is not shown: CIS updates the instance image.
            <ExperimentalSectionView
              rows={[
                {
                  key: 'lsp',
                  node: (
                    <LspBetaCellView
                      enabled={bool(s('lsp'), 'enabled')}
                      pending={disabled}
                      handleToggle={(next) => attempt('lsp', { enabled: next })}
                    />
                  ),
                },
              ]}
            />,
          )}
      </>
    );
  if (tab === 'personalization')
    return (
      <>
        {/* The prompt editor carries the page title; keep the title when it is absent. */}
        {!ready('personalization') && (
          <div className="pb-[14px]">
            <PersonalizationPageTitle />
          </div>
        )}
        {ready('personalization') &&
          section(
            'settings-search-target-personalization-user-prompt',
            <UserPromptEditor
              value={String(s('personalization').value?.userPrompt ?? '')}
              ready={!disabled}
              unavailable={false}
              customized={c('personalization')}
              revision={s('personalization').revision}
              ownerKey="cloud-target"
              onDirtyChange={(dirty) => changed('personalization', dirty)}
              setValue={async (value, revision) => {
                if (revision !== s('personalization').revision) throw Error('CONFLICT');
                await update('personalization', { userPrompt: value });
              }}
              resetValue={async (revision) => {
                if (revision !== s('personalization').revision) throw Error('CONFLICT');
                await update('personalization', {}, ['userPrompt']);
              }}
            />,
          )}
        {ready('memory') &&
          section(
            'settings-search-target-personalization-memory',
            <MemorySectionView
              settingsCustomized={c('memory')}
              makerEnabled={bool(s('memory'), 'maker')}
              makerTogglePending={disabled}
              makerResetPending={false}
              slots={{
                'claude-code': { enabled: bool(s('memory'), 'claudeCode'), pending: disabled },
                codex: { enabled: bool(s('memory'), 'codex'), pending: disabled },
                pi: { enabled: bool(s('memory'), 'pi'), pending: disabled },
              }}
              handleResetSettings={() => reset('memory')}
              handleMakerToggle={(next) =>
                attempt(
                  'memory',
                  next ? { maker: true, claudeCode: false, codex: false } : { maker: false },
                )
              }
              handleMakerReset={undefined}
              handleReset={undefined}
              handleToggle={(kind, next) =>
                attempt('memory', { [kind === 'claude-code' ? 'claudeCode' : kind]: next })
              }
            />,
          )}
        {ready('subagentModel') &&
          section(
            'settings-search-target-personalization-subagents',
            <CloudSubagentSettings
              state={s('subagentModel')}
              deviceId={deviceId}
              disabled={disabled}
              attempt={confirmSave}
            />,
          )}
        {ready('auxiliaryModel') &&
          section(
            'settings-search-target-personalization-auxiliary-models',
            <CloudAuxiliarySettings
              state={s('auxiliaryModel')}
              disabled={disabled}
              attempt={confirmSave}
            />,
          )}
        {ready('visionBridge') &&
          section(
            'settings-search-target-personalization-vision-bridge',
            <CloudVisionBridgeSettings
              state={s('visionBridge')}
              deviceId={deviceId}
              disabled={disabled}
              attempt={confirmSave}
            />,
          )}
        {ready('contacts') &&
          section(
            'settings-contacts',
            <ContactsSectionView
              enabled={bool(s('contacts'), 'enabled')}
              togglePending={disabled}
              aiSessionPending={false}
              statsLine=""
              pendingCount={0}
              syncStatus={{
                available: !!ready('contactsSync'),
                enabled: !!ready('contactsSync') && bool(s('contactsSync'), 'deviceSyncEnabled'),
              }}
              syncPending={disabled}
              syncSummary={
                ready('contactsSync')
                  ? ''
                  : t(
                      states.contactsSync?.status === 'unreadable'
                        ? 'cloudSettings.readFailed'
                        : 'cloudSettings.settingUnavailable',
                    )
              }
              handleToggle={(next) => attempt('contacts', { enabled: next })}
              handleSyncToggle={(next) => attempt('contactsSync', { deviceSyncEnabled: next })}
              handleSyncNow={undefined}
              startAiSession={undefined}
              onManage={undefined}
              manager={null}
            />,
          )}
        {ready('terminal') &&
          section(
            'settings-search-target-personalization-terminal-shell',
            <TerminalShellSectionView
              pref={String(s('terminal').value?.defaultShellPref) as ShellId}
              shells={(s('terminal').choices?.defaultShellPref ?? [])
                .filter((x) => x.value !== 'auto')
                .map(
                  (x) =>
                    ({
                      id: x.value,
                      command: x.value,
                      displayName: x.label,
                      isAutoDetectTarget: false,
                    }) as AvailableShell,
                )}
              resetting={disabled}
              isCustomized={c('terminal')}
              onChange={(next) => void attempt('terminal', { defaultShellPref: next })}
              onReset={() => reset('terminal')}
              autoLabel={t('settings.terminalShell.auto')}
              unavailablePref={
                s('terminal').value?.defaultShellPref !== 'auto' &&
                !(s('terminal').choices?.defaultShellPref ?? []).some(
                  (choice) => choice.value === s('terminal').value?.defaultShellPref,
                )
                  ? (s('terminal').value?.defaultShellPref as ShellId)
                  : null
              }
            />,
          )}
        {ready('desktopChat') &&
          section(
            'settings-search-target-personalization-link-open',
            <LinkOpenSectionView
              web={linkControl('webLinkOpenPreference')}
              local={linkControl('localLinkOpenPreference')}
              disabled={disabled}
            />,
          )}
        {(ready('silentEncryptedRetry') || ready('chatEmbedding') || ready('desktopChat')) &&
          section(
            'settings-search-target-personalization-tips',
            <TipsSectionView>
              {ready('desktopChat') && (
                <PromptRecommendationCellView
                  enabled={bool(s('desktopChat'), 'promptRecommendationEnabled')}
                  disabled={disabled}
                  onChange={(next) =>
                    void attempt('desktopChat', { promptRecommendationEnabled: next })
                  }
                />
              )}
              {ready('silentEncryptedRetry') && (
                <SilentEncryptedRetryCellView
                  enabled={bool(s('silentEncryptedRetry'), 'enabled')}
                  isCustomized={c('silentEncryptedRetry')}
                  pending={disabled}
                  handleToggle={(next) => attempt('silentEncryptedRetry', { enabled: next })}
                  handleReset={() => reset('silentEncryptedRetry')}
                />
              )}
              {ready('chatEmbedding') && (
                <ChatEmbeddingCellView
                  enabled={bool(s('chatEmbedding'), 'enabled')}
                  isCustomized={c('chatEmbedding')}
                  pending={disabled}
                  handleToggle={(next) => attempt('chatEmbedding', { enabled: next })}
                  handleReset={() => reset('chatEmbedding')}
                />
              )}
              {ready('desktopChat') && (
                <MessageNavRailCellView
                  enabled={bool(s('desktopChat'), 'messageNavRailEnabled')}
                  isCustomized={chatCustomized('messageNavRailEnabled')}
                  disabled={disabled}
                  onChange={(next) => void attempt('desktopChat', { messageNavRailEnabled: next })}
                  onReset={() => attempt('desktopChat', {}, ['messageNavRailEnabled'])}
                />
              )}
            </TipsSectionView>,
          )}
      </>
    );
  if (tab === 'builtin-tools' && ready('builtinTools'))
    return (
      <BuiltinToolsSectionView
        plugins={[
          // The browser tool is the same switch as browser automation; local lists it first.
          ...(ready('browserTools')
            ? [
                {
                  id: 'browser',
                  value: s('browserTools').value?.browser,
                  customized: s('browserTools').customizedKeys?.includes('browser'),
                },
              ]
            : []),
          ...Object.entries(s('builtinTools').value ?? {}).map(([id, value]) => ({
            id,
            value,
            customized: s('builtinTools').customizedKeys?.includes(id),
          })),
        ].map(({ id, value, customized }) => ({
          id,
          name: id,
          description: '',
          effectiveEnabled: value === true,
          userOverride: customized ? { enabled: value === true } : null,
        }))}
        pendingIds={
          new Set(
            disabled
              ? ['browser', ...Object.keys(s('builtinTools').value ?? {})]
              : [],
          )
        }
        handleToggle={(id, next) =>
          void (id === 'browser'
            ? attempt('browserTools', { browser: next })
            : attempt('builtinTools', { [id]: next }))
        }
        handleClearOverride={(id) =>
          void (id === 'browser'
            ? attempt('browserTools', {}, ['browser'])
            : attempt('builtinTools', {}, [id]))
        }
      />
    );
  if (tab === 'computer-use')
    return (
      <div className="flex flex-col gap-[14px]">
        <ComputerUseSectionHeader />
        {ready('browserTools') && (
          <>
            <AutomationCard id="automation-browser">
              <BrowserAutomationHeader
                checked={bool(s('browserTools'), 'browser')}
                disabled={disabled}
                onChange={(next) => void attempt('browserTools', { browser: next })}
              />
              {/* Real-profile reuse, Chrome detection and the login window act on the
                  target computer's browser; they are not settings and stay local-only. */}
              {ready('browserBackend') && (
                <BrowserBackendSubsection
                  active={String(s('browserBackend').value?.kind) as 'external' | 'rsb-webview'}
                  pending={disabled}
                  recovering={false}
                  health={null}
                  onSelect={(kind) => void attempt('browserBackend', { kind })}
                  onRecover={() => undefined}
                />
              )}
            </AutomationCard>
            <p className="text-12 leading-[1.5] text-[var(--settings-section-desc)]">
              {t('settings.computerUse.browser.toggleHint')}
            </p>
          </>
        )}
        {ready('computerTools') && (
          <>
            <div aria-hidden="true" className="h-px bg-[var(--settings-theme-card-border)]" />
            <AutomationCard id="automation-computer">
              <ComputerAutomationHeader
                checked={bool(s('computerTools'), 'computer')}
                disabled={disabled}
                onChange={(next) => void attempt('computerTools', { computer: next })}
              />
            </AutomationCard>
          </>
        )}
        {ready('androidTools') && (
          <>
            <div aria-hidden="true" className="h-px bg-[var(--settings-theme-card-border)]" />
            {/* ADB and device selection need the target's native setup flow. */}
            <AutomationCard id="automation-android">
              <AndroidAutomationHeader
                checked={bool(s('androidTools'), 'android')}
                disabled={disabled}
                onChange={(next) => void attempt('androidTools', { android: next })}
              />
            </AutomationCard>
            <p className="text-12 leading-[1.5] text-[var(--settings-section-desc)]">
              {t('settings.computerUse.android.toggleHint')}
            </p>
          </>
        )}
      </div>
    );
  if (tab === 'storage' && ready('databaseWarning'))
    return (
      <StorageSectionFrame>
        <StorageDatabaseSection>
          <div className={STORAGE_DATABASE_BODY_CLASS}>
            <Storage {...props} state={s('databaseWarning')} />
          </div>
        </StorageDatabaseSection>
      </StorageSectionFrame>
    );
  if (
    tab === 'about' &&
    (appVersion || ready('privacy') || ready('desktopNotifications') || ready('diagnostics'))
  )
    return (
      <AboutSectionView
        card={
          <>
            {appVersion && (
              <>
                <InfoRow label={t('settings.about.appVersionLabel')} value={appVersion} />
                {(ready('privacy') || ready('desktopNotifications') || ready('diagnostics')) && (
                  <AboutDivider />
                )}
              </>
            )}
            {ready('privacy') && (
              <AnalyticsToggleView
                customized={c('privacy')}
                enabled={bool(s('privacy'), 'analyticsEnabled')}
                disabled={disabled}
                handleReset={() => attempt('privacy', {}, ['analyticsEnabled'])}
                handleToggle={(next) => attempt('privacy', { analyticsEnabled: next })}
              />
            )}
            {ready('desktopNotifications') && (
              <>
                {ready('privacy') && <AboutDivider />}
                <DebugLogToggleView
                  enabled={bool(s('desktopNotifications'), 'networkDebugEnabled')}
                  disabled={disabled}
                  onChange={(next) =>
                    void attempt('desktopNotifications', { networkDebugEnabled: next })
                  }
                />
              </>
            )}
            {(ready('privacy') || ready('desktopNotifications')) && ready('diagnostics') && (
              <AboutDivider />
            )}
            {ready('diagnostics') && (
              <CrashAutoUploadToggleView
                customized={c('diagnostics')}
                enabled={bool(s('diagnostics'), 'crashAutoUploadEnabled')}
                disabled={disabled}
                resetting={disabled}
                handleToggle={(next) => attempt('diagnostics', { crashAutoUploadEnabled: next })}
                handleReset={() => reset('diagnostics')}
              />
            )}
          </>
        }
      />
    );
  return null;
}

import { setModelVisibility, resetModelVisibilities, isModelEnabled, isModelVisibilityCustomized } from '@/state/modelVisibilityPrefs';
import { clearModelEngineOverride, getModelEngineOverride, listModelEngineOverrides, setModelEngineOverride } from '@/state/modelEnginePrefs';
import { setMakerMemoryEnabled } from '@/lib/memorySettingsStore';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { isDataOwnerPushStampCurrent } from '@/contexts/dataOwnerGeneration';
import { appPreferenceSchema, type AppPreferencePatch } from '../../shared/appPreferenceControl';
import { useTheme } from '@/hooks/useTheme';
import { useLocale } from '@/hooks/useLocale';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { useComposerSendShortcutPreference } from '@/hooks/useComposerSendShortcutPreference';
import { useLinkOpenPreference } from '@/hooks/useLinkOpenPreference';
import { useStreamFadePreference } from '@/hooks/useStreamFadePreference';
import { useMessageNavRailPreference } from '@/hooks/useMessageNavRailPreference';
import { useFileBrowserPreference } from '@/hooks/useFileBrowserPreference';
import { useHomeUsageDashboardPreference } from '@/hooks/useHomeUsageDashboardPreference';
import { usePromptRecommendationPreference } from '@/hooks/usePromptRecommendationPreference';
import { useSidebarCardMode, useSidebarMainViewMode } from '@/hooks/useSidebarCardMode';
import { useFeishuNotificationSettings } from '@/hooks/useFeishuNotificationSettings';
import { useSwallowActivationClickSettings } from '@/hooks/useSwallowActivationClickSettings';
import { useExperimentalFlag } from '@/hooks/useExperimentalFeatures';
import { getThemeFamilies, tryGetFamily } from '@/themes/families';

/** Validate persistence separately from hook memory: legacy setters may swallow quota errors. */
const persisted: Record<keyof AppPreferencePatch, { key: string; absent?: unknown }> = {
  theme: { key: 'theme' }, themeFamily: { key: 'theme.familyId' }, language: { key: 'language' },
  notifications: { key: 'notifications.enabled' }, sendShortcut: { key: 'chat.sendShortcutPreference', absent: 'enter' },
  webLinks: { key: 'chat.webLinkOpenPreference', absent: 'external' },
  localLinks: { key: 'chat.localLinkOpenPreference', absent: 'sidebar' },
  streamFade: { key: 'chat.streamFadePreference', absent: 'on' },
  messageNavigation: { key: 'chat.messageNavRail.enabled', absent: true },
  showIgnoredDirectories: { key: 'fileBrowser.showIgnoredDirs', absent: false },
  homeUsageDashboard: { key: 'home.usageDashboard.enabled' },
  promptRecommendations: { key: 'prompt-recommendation-enabled' },
  sidebarPinned: { key: 'sidebar.cardMode' }, sidebarTasks: { key: 'sidebar.mainListMode' },
  feishuNotifications: { key: 'notifications.feishuEnabled' },
  swallowActivationClick: { key: 'input.swallowActivationClick' },
  networkDebug: { key: 'experimental.debug-network' },
};

/** Mounted once in the main App. Reuses the same setters and subscribers as Settings. */
export function AppPreferenceControl() {
  const theme = useTheme(); const locale = useLocale(); const notifications = useNotificationSettings();
  const shortcut = useComposerSendShortcutPreference(); const web = useLinkOpenPreference('web');
  const local = useLinkOpenPreference('local'); const fade = useStreamFadePreference();
  const navigation = useMessageNavRailPreference(); const files = useFileBrowserPreference();
  const home = useHomeUsageDashboardPreference(); const recommendations = usePromptRecommendationPreference();
  const pinned = useSidebarCardMode(); const tasks = useSidebarMainViewMode(); const feishu = useFeishuNotificationSettings();
  const swallow = useSwallowActivationClickSettings(); const networkDebug = useExperimentalFlag('debug-network');
  const state: Required<AppPreferencePatch> = { theme: theme.theme, themeFamily: theme.familyId,
    language: locale.locale, notifications: notifications.enabled, sendShortcut: shortcut.preference,
    webLinks: web.preference, localLinks: local.preference, streamFade: fade.preference,
    messageNavigation: navigation.enabled, showIgnoredDirectories: files.showIgnoredDirs,
    homeUsageDashboard: home.enabled, promptRecommendations: recommendations.enabled,
    sidebarPinned: pinned.mode, sidebarTasks: tasks.mode, feishuNotifications: feishu.enabled,
    swallowActivationClick: swallow.enabled, networkDebug: networkDebug.enabled };
  const current = useRef<{ state: Required<AppPreferencePatch>; apply: (patch: AppPreferencePatch) => void }>({ state, apply: () => {} });
  current.current = { state, apply: patch => {
    if (patch.themeFamily !== undefined && !tryGetFamily(patch.themeFamily)) throw new Error('UNKNOWN_THEME');
    // The shortcut setter can reject a voice-input conflict, before other fields change.
    if (patch.sendShortcut !== undefined && !shortcut.setPreference(patch.sendShortcut).ok) throw new Error('SHORTCUT_CONFLICT');
    if (patch.theme !== undefined) theme.setTheme(patch.theme);
    if (patch.themeFamily !== undefined) theme.setFamily(patch.themeFamily);
    if (patch.language !== undefined) locale.setLocale(patch.language);
    if (patch.notifications !== undefined) notifications.setEnabled(patch.notifications);
    if (patch.webLinks !== undefined) web.setPreference(patch.webLinks);
    if (patch.localLinks !== undefined) local.setPreference(patch.localLinks);
    if (patch.streamFade !== undefined) fade.setPreference(patch.streamFade);
    if (patch.messageNavigation !== undefined) navigation.setEnabled(patch.messageNavigation);
    if (patch.showIgnoredDirectories !== undefined) files.setShowIgnoredDirs(patch.showIgnoredDirectories);
    if (patch.homeUsageDashboard !== undefined) home.setEnabled(patch.homeUsageDashboard);
    if (patch.promptRecommendations !== undefined) recommendations.setEnabled(patch.promptRecommendations);
    if (patch.sidebarPinned !== undefined) pinned.setMode(patch.sidebarPinned);
    if (patch.sidebarTasks !== undefined) tasks.setMode(patch.sidebarTasks);
    if (patch.feishuNotifications !== undefined) feishu.setEnabled(patch.feishuNotifications);
    if (patch.swallowActivationClick !== undefined) swallow.setEnabled(patch.swallowActivationClick);
    if (patch.networkDebug !== undefined) {
      networkDebug.setEnabled(patch.networkDebug);
      // Same main-side switch the About row syncs; development builds keep it on.
      void window.electronAPI?.ccSetDebugNet?.(import.meta.env.DEV ? true : patch.networkDebug);
    }
  } };
  useEffect(() => window.electronAPI?.appPreferenceControl?.onSettingsChanged(event => {
    if (event.section !== 'memory' || !isDataOwnerPushStampCurrent(event.ownerStamp)) return;
    void window.electronAPI.maker.memoryGetSettings().then(settings => {
      if (isDataOwnerPushStampCurrent(event.ownerStamp)) setMakerMemoryEnabled(settings.maker);
    }).catch(() => {});
  }), []);
  useEffect(() => {
    const bridge = window.electronAPI?.appPreferenceControl;
    if (!bridge) return;
    return bridge.onRequest(async request => {
      if (!isDataOwnerPushStampCurrent(request.ownerStamp) || Date.now() > request.expiresAt) {
        bridge.reply({ requestId: request.requestId, ok: false }); return;
      }
      try {
        let modelVisibility: { visible: boolean; customized: boolean } | undefined;
        if (request.operation === 'model-visibility') {
          const change = request.modelVisibility;
          if (!change) throw new Error('MISSING_MODEL');
          const { target, visible, defaultEnabled } = change;
          const saved = visible === null
            ? await resetModelVisibilities(target.providerId, [{ agent: target.agent, modelId: target.modelId }])
            : await setModelVisibility(target.agent, target.providerId, target.modelId, visible);
          if (!saved || !isDataOwnerPushStampCurrent(request.ownerStamp)) throw new Error('MODEL_VISIBILITY_NOT_SAVED');
          modelVisibility = { visible: isModelEnabled(target.agent, target.providerId, { id: target.modelId, defaultEnabled }),
            customized: isModelVisibilityCustomized(target.agent, target.providerId, target.modelId) };
        }
        let modelEngines: Record<string, 'cc' | 'codex' | 'pi'> | undefined;
        if (request.operation === 'model-engine') {
          const change = request.modelEngine;
          if (change) {
            if (change.agent === null) clearModelEngineOverride(change.providerId, change.modelId);
            else setModelEngineOverride(change.providerId, change.modelId, change.agent);
            if (getModelEngineOverride(change.providerId, change.modelId) !== (change.agent ?? undefined)) throw new Error('MODEL_ENGINE_NOT_SAVED');
          }
          modelEngines = listModelEngineOverrides();
        }
        if (request.operation === 'reset') throw new Error('RESET_NOT_SUPPORTED');
        if (request.operation === 'update') {
          const patch = appPreferenceSchema.parse(request.patch);
          flushSync(() => current.current.apply(patch));
          for (const [key, expected] of Object.entries(patch)) {
            const storage = persisted[key as keyof AppPreferencePatch];
            const raw = localStorage.getItem(storage.key);
            const actual = raw === null ? storage.absent : typeof expected === 'boolean' ? raw === 'true' : raw;
            if (actual !== expected) throw new Error('PERSISTENCE_NOT_CONFIRMED');
          }
        }
        bridge.reply({ requestId: request.requestId, ok: true, state: current.current.state,
          themeFamilies: getThemeFamilies().map(family => family.id), ...(modelVisibility ? { modelVisibility } : {}),
          ...(modelEngines ? { modelEngines } : {}) });
      } catch { bridge.reply({ requestId: request.requestId, ok: false }); }
    });
  }, []);
  return null;
}

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installDesktopPreferencesHarness } from './desktopPreferencesHarness';

vi.mock('../lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

type Module = Record<string, unknown>;
/** Exports a cloud instance hands to state/hostDesktop; everything else stays upstream. */
const seams: Record<string, { names: string[]; load: () => Promise<[Module, Module]> }> = {
  useComposerSendShortcutPreference: { names: ['getComposerSendShortcutPreference', 'useComposerSendShortcutPreference'],
    load: () => Promise.all([import('../hooks/useComposerSendShortcutPreference'), import('../state/hostDesktop/useComposerSendShortcutPreference')]) },
  useExperimentalFeatures: { names: ['getExperimentalFlag', 'useExperimentalFlag'],
    load: () => Promise.all([import('../hooks/useExperimentalFeatures'), import('../state/hostDesktop/useExperimentalFeatures')]) },
  useFeishuNotificationSettings: { names: ['getFeishuNotificationsEnabled', 'setFeishuNotificationsEnabled', 'useFeishuNotificationSettings'],
    load: () => Promise.all([import('../hooks/useFeishuNotificationSettings'), import('../state/hostDesktop/useFeishuNotificationSettings')]) },
  useLinkOpenPreference: { names: ['getLinkOpenPreference', 'useLinkOpenPreference'],
    load: () => Promise.all([import('../hooks/useLinkOpenPreference'), import('../state/hostDesktop/useLinkOpenPreference')]) },
  useLocale: { names: ['bootstrapInitialLocale', 'LocaleProvider', 'useLocale'],
    load: () => Promise.all([import('../hooks/useLocale'), import('../state/hostDesktop/useLocale')]) },
  useMessageNavRailPreference: { names: ['getMessageNavRailEnabled', 'useMessageNavRailPreference'],
    load: () => Promise.all([import('../hooks/useMessageNavRailPreference'), import('../state/hostDesktop/useMessageNavRailPreference')]) },
  useNotificationSettings: { names: ['getNotificationsEnabled', 'useNotificationSettings'],
    load: () => Promise.all([import('../hooks/useNotificationSettings'), import('../state/hostDesktop/useNotificationSettings')]) },
  usePromptRecommendationPreference: { names: ['getPromptRecommendationPreference', 'syncPromptRecommendationPreferenceFromStorageValue', 'usePromptRecommendationPreference', 'subscribePromptRecommendationPreference'],
    load: () => Promise.all([import('../hooks/usePromptRecommendationPreference'), import('../state/hostDesktop/usePromptRecommendationPreference')]) },
  useSidebarCardMode: { names: ['getSidebarViewMode', 'getSidebarMainViewMode', 'useSidebarCardMode', 'useSidebarMainViewMode'],
    load: () => Promise.all([import('../hooks/useSidebarCardMode'), import('../state/hostDesktop/useSidebarCardMode')]) },
  useStreamFadePreference: { names: ['getStreamFadePreference', 'useStreamFadeEnabled', 'useStreamFadePreference'],
    load: () => Promise.all([import('../hooks/useStreamFadePreference'), import('../state/hostDesktop/useStreamFadePreference')]) },
  useSwallowActivationClickSettings: { names: ['getSwallowActivationClickEnabled', 'useSwallowActivationClickSettings'],
    load: () => Promise.all([import('../hooks/useSwallowActivationClickSettings'), import('../state/hostDesktop/useSwallowActivationClickSettings')]) },
  useTheme: { names: ['getStoredTheme', 'getStoredFamilyId', 'getInitialThemeVariant', 'loginFirstLaunchLightActive', 'endLoginFirstLaunchLightGate', 'ThemeProvider', 'useTheme'],
    load: () => Promise.all([import('../hooks/useTheme'), import('../state/hostDesktop/useTheme')]) },
};
const shared = (hooks: Module, host: Module) => Object.keys(hooks).filter(name => typeof hooks[name] === 'function' && hooks[name] === host[name]);

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { platform: 'darwin' } });
});

describe('desktop preference hooks choose their store once per window', () => {
  it.each(Object.keys(seams))('keeps every %s export on upstream localStorage without the Host API', async module => {
    const [hooks, host] = await seams[module].load();
    expect(shared(hooks, host)).toEqual([]);
  });
  it.each(Object.keys(seams))('hands only the stateful %s exports to the Host copy on a cloud instance', async module => {
    installDesktopPreferencesHarness({});
    const [hooks, host] = await seams[module].load();
    expect(shared(hooks, host).sort()).toEqual([...seams[module].names].sort());
  });
  it('keeps the remote desktop viewer on upstream localStorage', async () => {
    installDesktopPreferencesHarness({});
    Object.assign(window.electronAPI, { remoteDesktopViewer: true });
    const [hooks, host] = await seams.useTheme.load();
    expect(shared(hooks, host)).toEqual([]);
  });
});

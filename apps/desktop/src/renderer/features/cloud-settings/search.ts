import type { SettingsSearchEntry } from '@/components/settings/settingsSearchTypes';
import {
  CLOUD_SETTINGS_GROUPS,
  type CloudSettingsDomain,
  type CloudSettingsTab,
} from '../../../shared/cloudSettings';
const targetDomain: Record<string, CloudSettingsDomain> = {
  'settings-notifications': 'desktopNotifications',
  'settings-collaboration': 'collaboration',
  'settings-agent-resource': 'agentResource',
  'settings-search-target-general-git-safety': 'gitSafety',
  'settings-search-target-general-experimental': 'lsp',
  'settings-search-target-personalization-user-prompt': 'personalization',
  'settings-search-target-personalization-memory': 'memory',
  'settings-search-target-personalization-subagents': 'subagentModel',
  'settings-search-target-personalization-auxiliary-models': 'auxiliaryModel',
  'settings-search-target-personalization-vision-bridge': 'visionBridge',
  'settings-bots': 'botModelChain',
  'settings-contacts': 'contacts',
  'settings-search-target-personalization-terminal-shell': 'terminal',
  'settings-search-target-personalization-link-open': 'desktopChat',
  'settings-composer': 'desktopChat',
  'settings-search-target-general-language': 'desktopGeneral',
};
export function cloudSearchEntryAllowed(
  entry: SettingsSearchEntry,
  domains: readonly CloudSettingsDomain[],
  trial: boolean,
): boolean {
  if (!(entry.tab in CLOUD_SETTINGS_GROUPS)) return false;
  if (entry.id === 'settings.promptRecommendation.label') return domains.includes('desktopChat');
  if ((entry.fallbackTargetId ?? entry.targetId) === 'settings-search-target-personalization-tips')
    return domains.some(
      (d) => d === 'desktopChat' || d === 'silentEncryptedRetry' || d === 'chatEmbedding',
    );
  if (entry.tab === 'appearance') {
    if (['appearance.streamFade', 'settings.streamFade.label'].includes(entry.id))
      return domains.includes('desktopChat');
    const themed = domains.includes('desktopGeneral') && domains.includes('appearance');
    if (entry.id === 'appearance') return themed || domains.includes('desktopChat');
    // Wallpaper, local theme files and terminal fonts are not part of the target's settings.
    return (
      themed &&
      [
        'appearance.fonts',
        'appearance.sidebar',
        'settings.appearance.modeLabel',
        'settings.appearance.themeLabel',
        'settings.appearance.font.uiFamily.label',
        'settings.appearance.font.uiSize.label',
        'settings.appearance.font.codeFamily.label',
        'settings.appearance.font.codeSize.label',
        'settings.appearance.sidebarCardMode.label',
        'settings.appearance.sidebarMainListMode.label',
      ].includes(entry.id)
    );
  }
  if (entry.tab === 'storage')
    return (
      domains.includes('databaseWarning') &&
      [
        'storage',
        'settings.about.storage.dbSizeWarningThresholdLabel',
        'settings.about.storage.dbSizeWarningDisableLabel',
      ].includes(entry.id)
    );
  if (entry.tab === 'about') {
    if (entry.id === 'settings.about.analyticsLabel') return domains.includes('privacy');
    if (entry.id === 'settings.about.logUpload.crashAutoLabel') return domains.includes('diagnostics');
    return entry.id === 'about' && domains.some((d) => d === 'privacy' || d === 'diagnostics');
  }
  if (entry.tab === 'computer-use') {
    if (entry.id === 'settings.computerUse.browser.title') return domains.includes('browserTools');
    if (entry.id === 'settings.computerUse.directControl.title')
      return domains.includes('computerTools');
    if (entry.id === 'settings.computerUse.android.title') return domains.includes('androidTools');
    return (
      entry.id === 'computerUse' &&
      domains.some((d) => d === 'browserTools' || d === 'computerTools' || d === 'androidTools')
    );
  }
  if (entry.tab === 'builtin-tools') return domains.includes('builtinTools');
  if (entry.id === 'general' || entry.id === 'personalization')
    return CLOUD_SETTINGS_GROUPS[entry.tab as CloudSettingsTab].some((d) => domains.includes(d));
  const domain = targetDomain[entry.fallbackTargetId ?? entry.targetId];
  return !!domain && domains.includes(domain) && (domain !== 'gitSafety' || trial);
}

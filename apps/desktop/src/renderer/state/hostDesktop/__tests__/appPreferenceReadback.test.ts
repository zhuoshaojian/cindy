// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { installDesktopPreferencesHarness } from '../../../__tests__/desktopPreferencesHarness';
import { __resetDesktopPreferencesForTests, connectHostDesktopPreferences, setDesktopPreference } from '../../hostDesktopPreferences';
import { hostedPreferenceReadback, withHostedPreferences } from '../appPreferenceReadback';
import type { AppPreferencePatch } from '../../../../shared/appPreferenceControl';

const storage: Record<keyof AppPreferencePatch, { key: string }> = {
  theme: { key: 'theme' }, themeFamily: { key: 'theme.familyId' }, language: { key: 'language' },
  notifications: { key: 'notifications.enabled' }, sendShortcut: { key: 'chat.sendShortcutPreference' },
  webLinks: { key: 'chat.webLinkOpenPreference' }, localLinks: { key: 'chat.localLinkOpenPreference' },
  streamFade: { key: 'chat.streamFadePreference' }, messageNavigation: { key: 'chat.messageNavRail.enabled' },
  showIgnoredDirectories: { key: 'fileBrowser.showIgnoredDirs' }, homeUsageDashboard: { key: 'home.usageDashboard.enabled' },
  promptRecommendations: { key: 'prompt-recommendation-enabled' },
};
const hookState: Required<AppPreferencePatch> = {
  theme: 'system', themeFamily: 'cindy', language: 'system', notifications: true, sendShortcut: 'enter',
  webLinks: 'external', localLinks: 'sidebar', streamFade: 'on', messageNavigation: true,
  showIgnoredDirectories: true, homeUsageDashboard: false, promptRecommendations: true,
};

beforeEach(() => {
  localStorage.clear();
  __resetDesktopPreferencesForTests();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
});

it('keeps the upstream localStorage check on an ordinary desktop', async () => {
  expect(await hostedPreferenceReadback(storage)).toBeNull();
  expect(withHostedPreferences(hookState, null)).toBe(hookState);
});

it('confirms Host-owned preferences from the Host receipt, not the startup cache', async () => {
  const host = installDesktopPreferencesHarness({});
  connectHostDesktopPreferences();
  void setDesktopPreference('notificationsEnabled', false);
  void setDesktopPreference('streamFadePreference', 'off');
  const readback = await hostedPreferenceReadback(storage);
  expect(host.api.update).toHaveBeenCalled();
  expect(readback?.('notifications')).toEqual({ value: false });
  expect(readback?.('streamFade')).toEqual({ value: 'off' });
  expect(localStorage.getItem('notifications.enabled')).toBeNull();
  // File browser and home dashboard stay renderer-local on cloud instances.
  expect(readback?.('showIgnoredDirectories')).toBeUndefined();
  expect(withHostedPreferences(hookState, readback)).toEqual({ ...hookState, notifications: false, streamFade: 'off' });
});

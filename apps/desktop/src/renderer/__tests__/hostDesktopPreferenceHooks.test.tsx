// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDesktopPreferencesForTests, connectHostDesktopPreferences, getDesktopPreference, updateDesktopPreference } from '../state/hostDesktopPreferences';
import { desktopPreferencesHarness, installDesktopPreferencesHarness, settleDesktopPreferences } from './desktopPreferencesHarness';
import { useNotificationSettings } from '../state/hostDesktop/useNotificationSettings';
import { useSwallowActivationClickSettings } from '../state/hostDesktop/useSwallowActivationClickSettings';
import { useFeishuNotificationSettings } from '../state/hostDesktop/useFeishuNotificationSettings';
import { useExperimentalFlag } from '../state/hostDesktop/useExperimentalFeatures';
import { useSidebarCardMode, useSidebarMainViewMode } from '../state/hostDesktop/useSidebarCardMode';
import { LocaleProvider, bootstrapInitialLocale, useLocale } from '../state/hostDesktop/useLocale';
import { useStreamFadePreference } from '../state/hostDesktop/useStreamFadePreference';
import { useMessageNavRailPreference } from '../state/hostDesktop/useMessageNavRailPreference';
import { useComposerSendShortcutPreference } from '../state/hostDesktop/useComposerSendShortcutPreference';
import { useLinkOpenPreference } from '../state/hostDesktop/useLinkOpenPreference';
import { desktopPreferenceDefaults } from '../../shared/desktopPreferences';
const i18n = vi.hoisted(() => ({ changeLanguage: vi.fn() }));
vi.mock('@/i18n', () => ({ i18n, DEFAULT_LOCALE: 'en', SUPPORTED_LOCALES: ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] }));
vi.mock('../lib/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
let host: ReturnType<typeof installDesktopPreferencesHarness>;
beforeEach(() => {
  localStorage.clear(); __resetDesktopPreferencesForTests(); i18n.changeLanguage.mockClear();
  Object.assign(window, { electronAPI: { preferredSystemLocale: 'ko', notificationSetDesktopEnabled: vi.fn(async () => {}), windowBehavior: { setSwallowActivationClick: vi.fn(async () => {}) } } });
  host = installDesktopPreferencesHarness();
});
afterEach(__resetDesktopPreferencesForTests);
describe('profile hooks use the same acknowledged Host state', () => {
  it('persists notification, Feishu, activation click, network debug and both sidebar modes', async () => {
    const prefs = renderHook(() => ({ notification: useNotificationSettings(), feishu: useFeishuNotificationSettings(), click: useSwallowActivationClickSettings(), debug: useExperimentalFlag('debug-network'), pinned: useSidebarCardMode(), main: useSidebarMainViewMode() }));
    await act(async () => {
      prefs.result.current.notification.setEnabled(false); prefs.result.current.feishu.setEnabled(true);
      prefs.result.current.click.setEnabled(true); prefs.result.current.debug.setEnabled(true);
      prefs.result.current.pinned.setMode('card'); prefs.result.current.main.setMode('text');
      await settleDesktopPreferences();
    });
    expect(host.snapshot()).toMatchObject({ value: { notificationsEnabled: false, feishuNotificationsEnabled: true, swallowActivationClick: true, networkDebugEnabled: true, sidebarPinnedMode: 'card', sidebarMainMode: 'text' } });
    expect(prefs.result.current.debug.enabled).toBe(true);
    expect(prefs.result.current.feishu.enabled).toBe(true);
    expect(prefs.result.current.pinned.mode).toBe('card');
    expect(localStorage.getItem('experimental.debug-network')).toBeNull();
  });
  it('keeps locale first frame and all mounted providers on the committed profile language', async () => {
    __resetDesktopPreferencesForTests();
    host = installDesktopPreferencesHarness({ locale: 'ja' });
    localStorage.setItem('language', 'en');
    expect(bootstrapInitialLocale()).toBe('ja');
    const wrapper = ({ children }: { children: ReactNode }) => createElement(LocaleProvider, null, children);
    const a = renderHook(useLocale, { wrapper }); const b = renderHook(useLocale, { wrapper });
    expect(a.result.current.effectiveLocale).toBe('ja');
    await act(async () => { a.result.current.setLocale('system'); await settleDesktopPreferences(); });
    expect(b.result.current.locale).toBe('system'); expect(b.result.current.effectiveLocale).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
    expect(host.snapshot()).toMatchObject({ customizedKeys: ['locale'] });
  });
  it('does not turn readonly lightweight windows into importers or writers', async () => {
    const h = desktopPreferencesHarness(null);
    const readApi: Partial<typeof h.api> = { ...h.api };
    delete readApi.update;
    Object.assign(window, { electronAPI: { desktopPreferences: readApi } });
    localStorage.setItem('theme', 'dark'); localStorage.setItem('language', 'ja');
    expect(getDesktopPreference('theme')).toBe('dark');
    connectHostDesktopPreferences({ readOnly: true }); await settleDesktopPreferences();
    expect(getDesktopPreference('theme')).toBe('dark'); expect(getDesktopPreference('locale')).toBe('ja');
    expect(h.api.update).not.toHaveBeenCalled();
    expect(await updateDesktopPreference('locale', () => 'en')).toBe(false);
    h.external({ locale: 'ko' }); await settleDesktopPreferences();
    expect(getDesktopPreference('locale')).toBe('ko');
  });
  it('clears the override when the default is chosen again, like the local hooks', async () => {
    __resetDesktopPreferencesForTests();
    const web = desktopPreferenceDefaults().webLinkOpenPreference === 'sidebar' ? 'external' : 'sidebar';
    host = installDesktopPreferencesHarness({ streamFadePreference: 'off', messageNavRailEnabled: false, composerSendShortcut: 'modifier-enter', webLinkOpenPreference: web });
    const prefs = renderHook(() => ({ fade: useStreamFadePreference(), rail: useMessageNavRailPreference(), composer: useComposerSendShortcutPreference(), link: useLinkOpenPreference('web') }));
    await act(async () => { await settleDesktopPreferences(); });
    expect(prefs.result.current.fade.isCustomized).toBe(true);
    await act(async () => {
      prefs.result.current.fade.setPreference('on'); prefs.result.current.rail.setEnabled(true);
      prefs.result.current.composer.setPreference('enter'); prefs.result.current.link.setPreference(desktopPreferenceDefaults().webLinkOpenPreference);
      await settleDesktopPreferences();
    });
    expect(host.snapshot()).toMatchObject({ customizedKeys: [], isCustomized: false });
    expect(prefs.result.current.fade.isCustomized).toBe(false); expect(prefs.result.current.rail.isCustomized).toBe(false);
    expect(prefs.result.current.composer.isCustomized).toBe(false); expect(prefs.result.current.link.isCustomized).toBe(false);
  });
  it('applies consecutive sound leaf edits to the newest acknowledged group', async () => {
    await settleDesktopPreferences();
    const one = updateDesktopPreference('agentIslandSoundSettings', current => ({ ...current, sounds: { ...current.sounds, start: { type: 'builtin', id: 'none' } } }));
    const two = updateDesktopPreference('agentIslandSoundSettings', current => ({ ...current, sounds: { ...current.sounds, error: { type: 'builtin', id: 'none' } } }));
    expect(await one).toBe(true); expect(await two).toBe(true);
    expect(host.snapshot()).toMatchObject({ value: { agentIslandSoundSettings: { sounds: { start: { id: 'none' }, error: { id: 'none' }, complete: { id: 'gem-collect' } } } } });
  });
});

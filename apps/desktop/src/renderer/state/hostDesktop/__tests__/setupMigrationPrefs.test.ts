// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { installDesktopPreferencesHarness } from '../../../__tests__/desktopPreferencesHarness';
import { __resetDesktopPreferencesForTests, connectHostDesktopPreferences, getDesktopPreference } from '../../hostDesktopPreferences';

const prompt = vi.hoisted(() => ({
  hosted: true,
  view: { value: '', ready: true, unavailable: false, customized: false, revision: 'r1', ownerKey: '["owner-a",1]' },
  setUserPrompt: vi.fn(async (_next: string) => {}),
  refreshUserPrompt: vi.fn(async () => {}),
}));
vi.mock('../../hostPersonalization', () => ({
  hasHostPersonalization: () => prompt.hosted,
  getUserPromptView: () => prompt.view,
  setUserPrompt: prompt.setUserPrompt,
  refreshUserPrompt: prompt.refreshUserPrompt,
}));
import { hostedPortablePrefsApplier, hostedPortablePrefsReader } from '../setupMigrationPrefs';

/** Upstream's window-storage implementation stands in for the local half. */
const local = { read: vi.fn((): Record<string, string> => ({})), apply: vi.fn((values: Record<string, string>) => Object.keys(values).length) };
let host: ReturnType<typeof installDesktopPreferencesHarness>;
beforeEach(() => {
  localStorage.clear();
  __resetDesktopPreferencesForTests();
  local.read.mockReset().mockReturnValue({});
  local.apply.mockClear();
  prompt.setUserPrompt.mockClear();
  prompt.view = { ...prompt.view, value: '', customized: false };
});

it('answers another computer with the Host values, not the stale window cache', () => {
  host = installDesktopPreferencesHarness({ theme: 'dark', notificationsEnabled: false, streamFadePreference: 'off' });
  connectHostDesktopPreferences();
  // The window only caches a few startup keys; this one is stale.
  local.read.mockReturnValue({ theme: 'light', language: 'ja', 'theme.darkId': 'midnight', 'userPrompt.value.owner-a': 'old' });
  prompt.view = { ...prompt.view, value: 'host prompt', customized: true };
  expect(hostedPortablePrefsReader(local.read)(undefined, 'owner-a')).toEqual({
    theme: 'dark',
    'notifications.enabled': 'false',
    'chat.streamFadePreference': 'off',
    'theme.darkId': 'midnight',
    'userPrompt.value.owner-a': 'host prompt',
  });
});

it('saves migrated Host preferences and the prompt through the Host, keeping what the instance chose', async () => {
  host = installDesktopPreferencesHarness({ theme: 'light' });
  connectHostDesktopPreferences();
  const changed = await hostedPortablePrefsApplier(local.apply)({
    theme: 'dark',
    language: 'ko',
    'chat.messageNavRail.enabled': 'false',
    'notifications.agentIslandSoundSettings': '{"enabled":true}',
    'theme.darkId': 'midnight',
    'userPrompt.value.owner-a': 'mine',
    'userPrompt.value.owner-b': 'not mine',
  }, undefined, 'owner-a');
  expect(getDesktopPreference('theme')).toBe('light');
  expect(getDesktopPreference('locale')).toBe('ko');
  expect(getDesktopPreference('messageNavRailEnabled')).toBe(false);
  expect(host.snapshot()).toMatchObject({ customizedKeys: expect.arrayContaining(['locale', 'messageNavRailEnabled', 'agentIslandSoundSettings']) });
  expect(local.apply).toHaveBeenCalledWith({ 'theme.darkId': 'midnight' }, undefined, 'owner-a');
  expect(prompt.setUserPrompt).toHaveBeenCalledWith('mine');
  expect(changed).toBe(1 + 3 + 1);
});

it('keeps a prompt the instance already has and skips invalid values', async () => {
  installDesktopPreferencesHarness({});
  connectHostDesktopPreferences();
  prompt.view = { ...prompt.view, value: 'kept', customized: true };
  const changed = await hostedPortablePrefsApplier(local.apply)({ 'notifications.enabled': 'maybe', 'userPrompt.value.owner-a': 'mine' }, undefined, 'owner-a');
  expect(prompt.setUserPrompt).not.toHaveBeenCalled();
  expect(getDesktopPreference('notificationsEnabled')).toBe(true);
  expect(changed).toBe(0);
});

it('switches upstream setup migration to the Host halves only on a hosted window', async () => {
  localStorage.setItem('theme', 'light');
  localStorage.setItem('chat.sendShortcutPreference', 'modifier-enter');
  vi.resetModules();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
  const plain = await import('../../../features/setup-migration/rendererPrefs');
  expect(plain.readPortableRendererPrefs(localStorage, 'owner-a')).toMatchObject({ theme: 'light', 'chat.sendShortcutPreference': 'modifier-enter' });
  vi.resetModules();
  installDesktopPreferencesHarness({ theme: 'dark' });
  const hosted = await import('../../../features/setup-migration/rendererPrefs');
  const prefs = hosted.readPortableRendererPrefs(localStorage, 'owner-a');
  expect(prefs).toMatchObject({ theme: 'dark' });
  // Not customized on the Host, so the stale window value is not reported as this instance's choice.
  expect(prefs).not.toHaveProperty('chat.sendShortcutPreference');
});

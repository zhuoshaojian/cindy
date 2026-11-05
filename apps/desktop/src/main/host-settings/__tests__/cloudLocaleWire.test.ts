import { expect, it, vi } from 'vitest';
import path from 'node:path';
import { desktopPreferenceDefaults } from '../../../shared/desktopPreferences.js';

const context = vi.hoisted(() => ({ locale: 'ja' as string }));
vi.mock('electron', () => ({ app: { getPath: () => path.join('/nonexistent', 'cloud-locale-wire') } }));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('../../maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock('../../appSessionState.js', () => ({
  peekCommittedAppSession: () => ({ mode: 'cloud', dataOwnerId: 'owner', generation: 1 }),
  getActiveAppSession: () => ({ mode: 'cloud', dataOwnerId: 'owner', generation: 1 }),
  activeOwnerScopeKey: () => 'owner:1',
  isAppSessionBoundaryPending: () => false,
  dataOwnerStorageKey: (id: string) => `test-${id}`,
  ownerScopedUserDataPath: (...segments: string[]) => path.join('/nonexistent', ...segments),
}));
vi.mock('../desktop-preferences.js', () => ({
  inspectDesktopPreferences: () => ({
    status: 'ready', profileStamp: 'profile', revision: 'r1',
    value: { ...desktopPreferenceDefaults(), locale: context.locale }, defaults: desktopPreferenceDefaults(),
    customizedKeys: ['locale'], isCustomized: true,
  }),
  commitDesktopPreferences: vi.fn(),
}));
import { inspectAdditionalSettings } from '../additional.js';
import { CLOUD_SETTINGS_LOCALES, normalizeAdditionalSettingsChange } from '../../../shared/settingsEditableCatalog.js';
import { SETTINGS_DISPLAY_LOCALES } from '../../../shared/settingsReadCatalog.js';
import { SUPPORTED_LOCALES } from '../../../shared/locale.js';

it('carries every display language on the cloud wire, and keeps the six every Host accepts', () => {
  // A new upstream language must reach CIS before the instance can report it.
  expect([...SETTINGS_DISPLAY_LOCALES].sort()).toEqual(['system', ...SUPPORTED_LOCALES].sort());
  expect(CLOUD_SETTINGS_LOCALES).toEqual(['system', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko']);
  expect(normalizeAdditionalSettingsChange('desktopGeneral', { locale: 'zh-Hans-x-lzh' }, []).set).toEqual({ locale: 'zh-Hans-x-lzh' });
  expect(() => normalizeAdditionalSettingsChange('desktopGeneral', { locale: 'xx' }, [])).toThrow();
});

it.each(['ja', 'fr', 'pt-BR', 'zh-Hans-x-lzh'])('reads %s and lists every language the instance accepts', (locale) => {
  context.locale = locale;
  const state = inspectAdditionalSettings('desktopGeneral') as { status: string; value: { locale: string }; choices: { locale: Array<{ value: string }> } };
  expect(state).toMatchObject({ status: 'ready', value: { locale }, customizedKeys: ['locale'] });
  expect(state.choices.locale.map((choice) => choice.value)).toEqual([...SETTINGS_DISPLAY_LOCALES]);
});

it('reports a language outside the cloud wire as unavailable, not as a read failure', () => {
  context.locale = 'xx';
  expect(inspectAdditionalSettings('desktopGeneral')).toEqual({ status: 'unavailable', revision: null });
});

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

it('keeps display languages to the frozen cloud wire values', () => {
  expect(CLOUD_SETTINGS_LOCALES).toEqual(['system', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko']);
  expect(() => normalizeAdditionalSettingsChange('desktopGeneral', { locale: 'zh-Hans-x-lzh' }, [])).toThrow();
  expect(normalizeAdditionalSettingsChange('desktopGeneral', { locale: 'ko' }, []).set).toEqual({ locale: 'ko' });
});

it.each(['zh-Hans-x-lzh', 'fr', 'pt-BR'])('reports %s chosen on the instance as unavailable, not as a read failure', (locale) => {
  context.locale = locale;
  expect(inspectAdditionalSettings('desktopGeneral')).toEqual({ status: 'unavailable', revision: null });
});

it('still reads a wire language with its value', () => {
  context.locale = 'ja';
  expect(inspectAdditionalSettings('desktopGeneral')).toMatchObject({ status: 'ready', value: { locale: 'ja' }, customizedKeys: ['locale'] });
});

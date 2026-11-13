import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('tests pass the profile root'); } } }));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
import { retiredDesktopPreferencePatch, returnRetiredDesktopPreferences } from '../retiredDesktopPreferences.js';

let root = '';
const file = () => path.join(root, 'host-desktop-preferences.json');
const returned = () => path.join(root, 'host-desktop-preferences.returned.json');
function windowFake(options: { answers?: boolean; refuse?: string[] } = {}) {
  const saved: Record<string, unknown> = {};
  const manage = vi.fn(async (operation: string, patch?: Record<string, unknown>) => {
    if (options.answers === false) throw new Error('PREFERENCE_WINDOW_NOT_READY');
    if (operation === 'update') {
      const [key] = Object.keys(patch!);
      if (options.refuse?.includes(key!)) throw new Error('PREFERENCE_NOT_SAVED');
      Object.assign(saved, patch);
    }
    return { value: saved, themeFamilies: ['cindy', 'ocean'] };
  });
  return { manage, saved };
}
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-desktop-prefs-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('returning the earlier cloud desktop preferences to the app window', () => {
  it('restores what the earlier build showed: its saved values, and defaults for the rest', () => {
    const patch = retiredDesktopPreferencePatch({ _initialized: true, theme: 'dark', locale: 'ja', sidebarMainMode: 'text',
      feishuNotificationsEnabled: true, agentIslandEnabled: true, ghostPanelRestoreMode: 'sidebar' }, ['cindy']);
    expect(patch).toMatchObject({ theme: 'dark', language: 'ja', sidebarTasks: 'text', feishuNotifications: true,
      themeFamily: 'cindy', sidebarPinned: 'text', notifications: true, sendShortcut: 'enter', networkDebug: false });
    expect(Object.keys(patch!)).toHaveLength(15);
  });

  it('skips a file the earlier build never took over, and values the window no longer offers', () => {
    expect(retiredDesktopPreferencePatch({ theme: 'dark' }, ['cindy'])).toBeNull();
    expect(retiredDesktopPreferencePatch('broken', ['cindy'])).toBeNull();
    const patch = retiredDesktopPreferencePatch({ _initialized: true, themeFamilyId: 'removed-local-theme', theme: 'sepia' }, ['cindy']);
    expect(patch).not.toHaveProperty('themeFamily');
    expect(patch).not.toHaveProperty('theme');
  });

  it('writes each value through the preferences section, then keeps the file aside', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, theme: 'light', streamFadePreference: 'off' }));
    const { manage, saved } = windowFake({ refuse: ['sendShortcut'] });
    expect(await returnRetiredDesktopPreferences(root, manage as never)).toBe('returned');
    expect(saved).toMatchObject({ theme: 'light', streamFade: 'off', language: 'system' });
    expect(saved).not.toHaveProperty('sendShortcut');
    expect(fs.existsSync(file())).toBe(false);
    expect(JSON.parse(fs.readFileSync(returned(), 'utf8'))).toMatchObject({ theme: 'light' });
    expect(await returnRetiredDesktopPreferences(root, manage as never)).toBe('none');
  });

  it('tries again later while the window does not answer, leaving the file in place', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, theme: 'light' }));
    expect(await returnRetiredDesktopPreferences(root, windowFake({ answers: false }).manage as never)).toBe('retry');
    expect(fs.existsSync(file())).toBe(true);
  });

  it('keeps an unreadable file aside without writing anything', async () => {
    fs.writeFileSync(file(), '{not json');
    const { manage, saved } = windowFake();
    expect(await returnRetiredDesktopPreferences(root, manage as never)).toBe('returned');
    expect(saved).toEqual({});
    expect(fs.readFileSync(returned(), 'utf8')).toBe('{not json');
  });
});

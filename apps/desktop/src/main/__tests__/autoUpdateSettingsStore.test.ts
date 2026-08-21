import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userDataDir = '';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? userDataDir : userDataDir),
  },
}));

vi.mock('../maker-host/logger-adapter.js', () => ({
  desktopMakerLogger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

async function importStore() {
  vi.resetModules();
  return import('../auto-update-settings-store');
}

function settingsFile(): string {
  return path.join(userDataDir, 'auto-update-settings.json');
}

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-auto-update-settings-'));
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('auto update settings store', () => {
  it('defaults to auto relaunch disabled without creating an override file', async () => {
    const store = await importStore();

    expect(store.readAutoUpdateSettings()).toEqual({ autoRelaunchOnIdle: false });
    expect(store.readAutoUpdateSettingsState()).toEqual({
      value: { autoRelaunchOnIdle: false },
      isCustomized: false,
      defaults: { autoRelaunchOnIdle: false },
      customizedKeys: [],
    });
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  it('persists an enabled override across a module reload', async () => {
    const store = await importStore();

    store.writeAutoRelaunchOnIdle(true);

    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'))).toEqual({
      autoRelaunchOnIdle: true,
    });
    const reloaded = await importStore();
    expect(reloaded.readAutoUpdateSettings()).toEqual({ autoRelaunchOnIdle: true });
    expect(reloaded.readAutoUpdateSettingsState()).toMatchObject({
      isCustomized: true,
      customizedKeys: ['autoRelaunchOnIdle'],
    });
  });

  it('reset removes the override and restores the default', async () => {
    const store = await importStore();
    store.writeAutoRelaunchOnIdle(true);

    expect(store.resetAutoUpdateSettings()).toEqual({ autoRelaunchOnIdle: false });
    expect(fs.existsSync(settingsFile())).toBe(false);

    const reloaded = await importStore();
    expect(reloaded.readAutoUpdateSettings()).toEqual({ autoRelaunchOnIdle: false });
    expect(reloaded.readAutoUpdateSettingsState().isCustomized).toBe(false);
  });

  it('normalizes malformed persisted values to the safe disabled default', async () => {
    const store = await importStore();

    expect(store.__testing.normalize(null)).toEqual({ autoRelaunchOnIdle: false });
    expect(store.__testing.normalize({ autoRelaunchOnIdle: 'true' })).toEqual({
      autoRelaunchOnIdle: false,
    });
  });
});

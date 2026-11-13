import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewTaskPreferenceHistory } from '../../../shared/newTaskPreferenceHistory.js';

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('tests pass the owner root'); } } }));
vi.mock('../../app-settings/preferences.js', () => ({ manageAppPreferences: vi.fn() }));
vi.mock('../personalization.js', () => ({ currentSettingsOwner: () => null }));
import { retiredNewTaskHistory, returnRetiredNewTaskDefaults } from '../retiredNewTaskDefaults.js';

let root = '';
const file = () => path.join(root, 'host-new-task-defaults.json');
const kept = () => path.join(root, 'host-new-task-defaults.returned.json');
const history = (): NewTaskPreferenceHistory => ({
  vendor: 'codex', modelChosenByVendor: { codex: true }, defaultTupleCustomized: true, defaultTupleSelectionCustomized: true,
  lastByVendor: { codex: { model: 'old-model', providerId: 'xd', effort: 'low', permissionMode: 'acceptEdits', planMode: false } },
  effortByModel: {}, fastModeByModel: {}, worktreeEnabled: false, worktreePreferenceCustomized: false,
  providerModelMemory: { 'codex:xd': { lastModel: 'old-model', effortByModel: { 'old-model': 'low' }, fastByModel: {}, thinkingByModel: {} } },
});
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-new-task-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('the new-task choices an earlier cloud build saved', () => {
  it('lays the explicit overrides over its history', () => {
    const result = retiredNewTaskHistory({ _initialized: true, _history: history(), harness: 'pi', providerId: 'gw', modelId: 'chosen',
      effort: 'high', fast: 'ultrafast', thinking: false, worktree: true, planMode: true });
    expect(result).toMatchObject({
      vendor: 'pi', modelChosenByVendor: { codex: true, pi: true }, defaultTupleCustomized: true, defaultTupleSelectionCustomized: true,
      lastByVendor: { codex: { model: 'old-model' }, pi: { model: 'chosen', providerId: 'gw', effort: 'high', planMode: true } },
      fastModeByModel: { chosen: 'ultrafast' }, worktreeEnabled: true, worktreePreferenceCustomized: true,
      providerModelMemory: { 'pi:gw': { lastModel: 'chosen', fastByModel: { chosen: 'ultrafast' }, thinkingByModel: { chosen: false } } },
    });
  });

  it('leaves fields that followed the recommendation unchosen', () => {
    const result = retiredNewTaskHistory({ _initialized: true, _history: { ...history(), modelChosenByVendor: {}, defaultTupleCustomized: false, defaultTupleSelectionCustomized: false } });
    expect(result).toMatchObject({ vendor: 'codex', modelChosenByVendor: {}, defaultTupleCustomized: false, defaultTupleSelectionCustomized: false });
  });

  it('has nothing to return before the earlier build took the choices over', () => {
    expect(retiredNewTaskHistory({ worktree: true })).toBeNull();
    expect(retiredNewTaskHistory({ _initialized: true, _history: null })).toMatchObject({ vendor: 'cc', lastByVendor: { cc: { model: '' } } });
  });
});

describe('returning the earlier cloud new-task defaults to the app window', () => {
  it('gives the window the saved choices once, then keeps the file aside', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, _history: history(), worktree: true }));
    const window = vi.fn<(value: NewTaskPreferenceHistory) => Promise<void>>(async () => {});
    expect(await returnRetiredNewTaskDefaults(root, window)).toBe('returned');
    expect(window).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'codex', worktreeEnabled: true, worktreePreferenceCustomized: true }));
    expect(fs.existsSync(file())).toBe(false);
    expect(fs.existsSync(kept())).toBe(true);
    expect(await returnRetiredNewTaskDefaults(root, window)).toBe('none');
    expect(window).toHaveBeenCalledOnce();
  });

  it('keeps the file in place and retries while the window does not answer', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, _history: history() }));
    expect(await returnRetiredNewTaskDefaults(root, async () => { throw new Error('PREFERENCE_WINDOW_NOT_READY'); })).toBe('retry');
    expect(fs.existsSync(file())).toBe(true);
    expect(await returnRetiredNewTaskDefaults(null, vi.fn())).toBe('retry');
  });

  it('only keeps aside a file that was never taken over or cannot be read', async () => {
    const window = vi.fn(async () => {});
    fs.writeFileSync(file(), JSON.stringify({ worktree: true }));
    expect(await returnRetiredNewTaskDefaults(root, window)).toBe('returned');
    fs.writeFileSync(file(), '{broken-fixture');
    expect(await returnRetiredNewTaskDefaults(root, window)).toBe('returned');
    expect(fs.readFileSync(kept(), 'utf8')).toBe('{broken-fixture');
    expect(window).not.toHaveBeenCalled();
  });
});

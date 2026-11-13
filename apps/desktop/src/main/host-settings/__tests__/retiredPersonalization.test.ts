import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('tests pass the owner root'); } } }));
vi.mock('../../app-settings/preferences.js', () => ({ manageAppPreferences: vi.fn() }));
vi.mock('../personalization.js', () => ({ currentSettingsOwner: () => null }));
import { returnRetiredPersonalization } from '../retiredPersonalization.js';

let root = '';
const file = () => path.join(root, 'host-personalization.json');
const kept = () => path.join(root, 'host-personalization.returned.json');
function windowFake(initial = '窗口里的旧正文', answers = true) {
  const state = { userPrompt: initial, writes: 0 };
  const window = async (userPrompt?: string) => {
    if (!answers) throw new Error('PREFERENCE_WINDOW_NOT_READY');
    if (userPrompt !== undefined) { state.userPrompt = userPrompt; state.writes += 1; }
    return state.userPrompt;
  };
  return { state, window };
}
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-personalization-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('returning the earlier cloud custom instructions to the app window', () => {
  it('gives the window the text the earlier build held, then keeps the file aside', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, userPrompt: '实例上保存的说明' }));
    const { state, window } = windowFake();
    expect(await returnRetiredPersonalization(root, window)).toBe('returned');
    expect(state.userPrompt).toBe('实例上保存的说明');
    expect(fs.existsSync(file())).toBe(false);
    expect(fs.existsSync(kept())).toBe(true);
    expect(await returnRetiredPersonalization(root, window)).toBe('none');
  });

  it('a cleared earlier text clears the window too', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true }));
    const { state, window } = windowFake();
    expect(await returnRetiredPersonalization(root, window)).toBe('returned');
    expect(state.userPrompt).toBe('');
  });

  it('does not write when the window already holds the same text', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, userPrompt: '相同' }));
    const { state, window } = windowFake('相同');
    expect(await returnRetiredPersonalization(root, window)).toBe('returned');
    expect(state.writes).toBe(0);
  });

  it('a file the earlier build never took over leaves the window as it is', async () => {
    fs.writeFileSync(file(), JSON.stringify({ userPrompt: '未接管' }));
    const { state, window } = windowFake();
    expect(await returnRetiredPersonalization(root, window)).toBe('returned');
    expect(state).toMatchObject({ userPrompt: '窗口里的旧正文', writes: 0 });
    expect(fs.existsSync(kept())).toBe(true);
  });

  it('an unreadable file is kept aside unchanged without touching the window', async () => {
    fs.writeFileSync(file(), '{broken-fixture');
    const { state, window } = windowFake();
    expect(await returnRetiredPersonalization(root, window)).toBe('returned');
    expect(state.writes).toBe(0);
    expect(fs.readFileSync(kept(), 'utf8')).toBe('{broken-fixture');
  });

  it('retries later while the window does not answer, keeping the file in place', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, userPrompt: '稍后再还' }));
    expect(await returnRetiredPersonalization(root, windowFake('', false).window)).toBe('retry');
    expect(fs.existsSync(file())).toBe(true);
    expect(await returnRetiredPersonalization(null, windowFake().window)).toBe('retry');
  });

  it('nothing to return when no earlier file exists', async () => {
    const { state, window } = windowFake();
    expect(await returnRetiredPersonalization(root, window)).toBe('none');
    expect(state.writes).toBe(0);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteModelFavorite } from '@cindy/device-link';

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('tests pass the owner root'); } } }));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
vi.mock('../../app-settings/preferences.js', () => ({ manageAppPreferences: vi.fn() }));
vi.mock('../../maker-ipc/modelFavoritesSync.js', () => ({ requestModelFavorites: vi.fn() }));
vi.mock('../../maker-host/model-visibility-mirror.js', () => ({ waitForModelVisibilityMirror: vi.fn(), getModelVisibilityMirrorSnapshot: vi.fn() }));
vi.mock('../personalization.js', () => ({ currentSettingsOwner: () => null }));
import { returnRetiredModelPresentation, type ModelPresentationTarget } from '../retiredModelPresentation.js';

let root = '';
const file = () => path.join(root, 'host-model-presentation-preferences.json');
function windowFake(answers = true) {
  const state = { visibility: { 'codex:xd:stale': false } as Record<string, boolean>, engines: { 'xd:stale': 'pi' } as Record<string, 'cc' | 'codex' | 'pi'>,
    favorites: [{ uid: 'old', providerId: 'xd', modelId: 'stale', agent: 'pi' }] as RemoteModelFavorite[], uid: 0 };
  const ready = () => { if (!answers) throw new Error('PREFERENCE_WINDOW_NOT_READY'); };
  const target: ModelPresentationTarget = {
    async visibility() { ready(); return { ...state.visibility }; },
    async setVisibility(t, visible) {
      ready();
      const key = `${t.harness}:${t.providerId}:${t.modelId}`;
      if (visible === null) delete state.visibility[key]; else state.visibility[key] = visible;
    },
    async engines(change) {
      ready();
      if (change) { const key = `${change.providerId}:${change.modelId}`; if (change.agent === null) delete state.engines[key]; else state.engines[key] = change.agent; }
      return { ...state.engines };
    },
    async favorites(mutation) {
      ready();
      const m = mutation as { kind: string; item?: Omit<RemoteModelFavorite, 'uid'>; expected?: RemoteModelFavorite } | undefined;
      if (m?.kind === 'add') state.favorites.push({ ...m.item!, uid: `new-${++state.uid}` });
      if (m?.kind === 'remove') state.favorites = state.favorites.filter(item => item.uid !== m.expected!.uid);
      return state.favorites.map(item => ({ ...item }));
    },
  };
  return { state, target };
}
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-model-presentation-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('returning the earlier cloud model preferences to the app window', () => {
  it('makes the window match what the earlier build held, then keeps the file aside', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, preferences: {
      visibility: { overrides: { 'codex:xd:hidden': true }, initialization: { defaults: { 'codex:xd:old': false } } },
      engines: { 'xd:hidden': { agent: 'cc' } },
      favorites: { uidSeq: 3, seeded: true, items: [{ uid: 'fav-1', providerId: 'xd', modelId: 'hidden', agent: 'codex', effort: 'high', fast: 'ultrafast' }] },
    } }));
    const { state, target } = windowFake();
    expect(await returnRetiredModelPresentation(root, target)).toBe('returned');
    expect(state.visibility).toEqual({ 'codex:xd:hidden': true });
    expect(state.engines).toEqual({ 'xd:hidden': 'cc' });
    expect(state.favorites).toEqual([{ uid: 'new-1', providerId: 'xd', modelId: 'hidden', agent: 'codex', effort: 'high', fast: 'ultrafast' }]);
    expect(fs.existsSync(file())).toBe(false);
    expect(fs.existsSync(path.join(root, 'host-model-presentation-preferences.returned.json'))).toBe(true);
    expect(await returnRetiredModelPresentation(root, target)).toBe('none');
  });

  it('leaves the window alone when the earlier build never took the preferences over', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: false, preferences: { visibility: { overrides: { 'codex:xd:hidden': true } } } }));
    const { state, target } = windowFake();
    expect(await returnRetiredModelPresentation(root, target)).toBe('returned');
    expect(state.visibility).toEqual({ 'codex:xd:stale': false });
  });

  it('tries again later while the window does not answer, or before an owner is signed in', async () => {
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, preferences: { visibility: { overrides: {} }, engines: {}, favorites: { items: [] } } }));
    expect(await returnRetiredModelPresentation(root, windowFake(false).target)).toBe('retry');
    expect(fs.existsSync(file())).toBe(true);
    expect(await returnRetiredModelPresentation(null, windowFake().target)).toBe('retry');
  });
});

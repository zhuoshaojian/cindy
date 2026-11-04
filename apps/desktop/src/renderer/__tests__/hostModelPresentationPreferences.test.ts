/** 云实例：renderer 与 Host 偏好文件的连接、导入、CAS 与 owner 栅栏。 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  createModelPresentationTestHost,
  PreferenceMemoryStorage,
} from './modelPresentationTestHost';
import {
  connectHostModelPresentationPreferences,
  ensureHostModelPresentationLoaded,
  commitHostModelPresentation,
  getHostModelPresentationSnapshot,
  __resetHostModelPresentationForTest,
  __settleHostModelPresentationForTest as settle,
} from '../state/hostModelPresentationPreferences';
import {
  addModelFavorite,
  setModelFavoritesOwner,
  listModelFavorites,
  updateModelFavorite,
  removeModelFavorite,
  seedDefaultFavorite,
} from '../state/modelFavorites';
import {
  setModelEngineOverride,
  getModelEngineOverride,
  clearModelEngineOverride,
} from '../state/modelEnginePrefs';
import {
  setModelVisibilities,
  resetModelVisibilities,
  isModelEnabled,
} from '../state/modelVisibilityPrefs';
import { emptyModelPresentationPreferences } from '../../shared/modelPresentationPreferences';
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../state/providerModelMemory', () => ({
  MODEL_PRESET_SLOT_ID: '*',
  hasAnyProviderModelOverride: () => false,
  hasProviderModelHistory: () => false,
}));
let storage: PreferenceMemoryStorage;
let host: ReturnType<typeof createModelPresentationTestHost>;
const config = {
  providerId: 'example',
  modelId: 'model',
  agent: 'pi' as const,
  effort: 'high' as const,
  fast: true as const,
};
beforeEach(() => {
  __resetHostModelPresentationForTest();
  storage = new PreferenceMemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  host = createModelPresentationTestHost(storage);
  host.install();
});
afterEach(() => {
  __resetHostModelPresentationForTest();
  vi.unstubAllGlobals();
});
async function start() {
  connectHostModelPresentationPreferences();
  await ensureHostModelPresentationLoaded();
}

describe('renderer Host model connection', () => {
  it('imports only owner-scoped keys, preserves source and uses Host thereafter', async () => {
    storage.setItem(
      'xdt:modelFavorites:v1:owner-a',
      JSON.stringify({ uidSeq: 8, items: [{ uid: 'fav-7', ...config }], seeded: true }),
    );
    storage.setItem(
      'xdt:modelFavorites:v1',
      JSON.stringify({ uidSeq: 9, items: [{ uid: 'private-global', ...config }] }),
    );
    await start();
    expect(listModelFavorites().map((item) => item.uid)).toEqual(['fav-7']);
    updateModelFavorite('fav-7', { effort: 'low', fast: false });
    await settle();
    expect(listModelFavorites()[0]).toEqual({
      uid: 'fav-7',
      providerId: 'example',
      modelId: 'model',
      agent: 'pi',
      effort: 'low',
    });
    expect(JSON.parse(storage.getItem('xdt:modelFavorites:v1:owner-a')!).items[0].effort).toBe(
      'high',
    );
    __resetHostModelPresentationForTest();
    await start();
    expect(host.api.importLegacy).toHaveBeenCalledTimes(1);
    expect(listModelFavorites()[0]?.effort).toBe('low');
  });
  it('acknowledges no favorite uid/cache/engine/visibility success before durable receipt', async () => {
    host.initialized();
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    // The local-store signature returns the uid the Host assigns; the list waits for it.
    expect(addModelFavorite(config)).toBe('fav-1');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(listModelFavorites()).toEqual([]);
    release();
    await settle();
    expect(listModelFavorites().map((item) => item.uid)).toEqual(['fav-1']);
    host.options.beforeWrite = null;
    host.options.failWrite = true;
    setModelEngineOverride('example', 'model', 'cc');
    await settle();
    expect(getModelEngineOverride('example', 'model')).toBeUndefined();
    expect(await setModelVisibilities('example', [{ agent: 'pi', modelId: 'model' }], false)).toBe(
      false,
    );
    expect(isModelEnabled('pi', 'example', { id: 'model' })).toBe(true);
  });
  it('read/CAS failure discards losing operation and queued stale edits, then reads the winner', async () => {
    host.initialized();
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    setModelEngineOverride('example', 'first', 'pi');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    setModelEngineOverride('example', 'queued', 'cc');
    const winner = host.files.get('owner-a')!;
    winner.value.engines['example:winner'] = { agent: 'codex' };
    winner.revision++;
    release();
    await settle();
    expect(host.api.mutate).toHaveBeenCalledTimes(1);
    expect(getModelEngineOverride('example', 'winner')).toBe('codex');
    expect(getModelEngineOverride('example', 'first')).toBeUndefined();
    expect(getModelEngineOverride('example', 'queued')).toBeUndefined();
  });
  it('generation invalidation during a request cannot publish into or write the next owner', async () => {
    host.initialized();
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    addModelFavorite(config);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    host.select('owner-b');
    host.initialized();
    release();
    await settle();
    expect(listModelFavorites()).toEqual([]);
    host.options.beforeWrite = null;
    await start();
    expect(listModelFavorites()).toEqual([]);
    expect(host.files.get('owner-a')?.value.favorites.items).toEqual([]);
  });
  it('same-owner new generation fences late responses and initial-load queued edits', async () => {
    host.initialized();
    let release!: () => void;
    const originalGet = host.api.get;
    host.api.get = vi.fn(async () => {
      const old = await originalGet();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return old;
    });
    setModelEngineOverride('example', 'model', 'pi');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    host.select('owner-a', 2);
    release();
    await settle();
    expect(host.api.mutate).not.toHaveBeenCalled();
  });
  it.each(['{broken', '', '[]', 'null'])(
    'damaged favorites %s stays pending and cannot create a successful empty migration',
    async (raw) => {
      storage.setItem('xdt:modelFavorites:v1:owner-a', raw);
      await start();
      expect(getHostModelPresentationSnapshot()?.status).toBe('pending-migration');
      expect(host.files.get('owner-a')?.initialized).toBe(false);
      expect(storage.getItem('xdt:modelFavorites:v1:owner-a')).toBe(raw);
      expect(addModelFavorite(config)).toBe('');
      await settle();
      expect(host.api.mutate).not.toHaveBeenCalled();
    },
  );
  it('a failed import conflict only re-reads, never substitutes a new revision to replay input', async () => {
    storage.setItem(
      'xdt:modelEnginePrefs:v1:owner-a',
      JSON.stringify({ 'example:stale': { agent: 'cc' } }),
    );
    host.api.importLegacy = vi.fn(async () => {
      const value = emptyModelPresentationPreferences();
      value.engines['example:winner'] = { agent: 'pi' };
      host.initialized(value);
      throw new Error('conflict');
    });
    await start();
    expect(host.api.importLegacy).toHaveBeenCalledTimes(1);
    expect(getModelEngineOverride('example', 'winner')).toBe('pi');
    expect(getModelEngineOverride('example', 'stale')).toBeUndefined();
  });
  it('reset marker prevents reimport and seed resurrection, including after reconnect', async () => {
    await start();
    seedDefaultFavorite(config);
    await settle();
    const uid = listModelFavorites()[0]!.uid;
    removeModelFavorite(uid);
    await settle();
    seedDefaultFavorite(config);
    await settle();
    expect(listModelFavorites()).toEqual([]);
    await commitHostModelPresentation({ kind: 'reset' });
    storage.setItem(
      'xdt:modelFavorites:v1:owner-a',
      JSON.stringify({ uidSeq: 8, items: [{ uid: 'fav-7', ...config }] }),
    );
    __resetHostModelPresentationForTest();
    await start();
    expect(listModelFavorites()).toEqual([]);
    expect(host.api.importLegacy).toHaveBeenCalledTimes(1);
  });
  it('explicit overrides, restore tombstones and engine default semantics remain distinct', async () => {
    await start();
    expect(isModelEnabled('pi', 'example', { id: 'new', defaultEnabled: true })).toBe(true);
    expect(isModelEnabled('pi', 'example', { id: 'new', defaultEnabled: false })).toBe(false);
    await setModelVisibilities('example', [{ agent: 'pi', modelId: 'new' }], true);
    expect(isModelEnabled('pi', 'example', { id: 'new', defaultEnabled: false })).toBe(true);
    expect(isModelEnabled('codex', 'example', { id: 'new', defaultEnabled: false })).toBe(false);
    await resetModelVisibilities('example', [{ agent: 'pi', modelId: 'new' }]);
    expect(isModelEnabled('pi', 'example', { id: 'new', defaultEnabled: false })).toBe(false);
    setModelEngineOverride('example', 'new', 'cc');
    await settle();
    expect(getModelEngineOverride('example', 'new')).toBe('cc');
    clearModelEngineOverride('example', 'new');
    await settle();
    expect(getModelEngineOverride('example', 'new')).toBeUndefined();
  });
  it('without the Host API (an ordinary desktop) the stores stay local and never connect', async () => {
    delete (window.electronAPI as unknown as Record<string, unknown>).modelPresentationPreferences;
    storage.setItem(
      'xdt:modelFavorites:v1:owner-a',
      JSON.stringify({ uidSeq: 8, items: [{ uid: 'fav-7', ...config }] }),
    );
    await start();
    setModelFavoritesOwner('owner-a');
    expect(listModelFavorites().map((item) => item.uid)).toEqual(['fav-7']);
    expect(getHostModelPresentationSnapshot()).toBeNull();
    expect(host.api.get).not.toHaveBeenCalled();
    expect(host.api.importLegacy).not.toHaveBeenCalled();
    setModelFavoritesOwner(null);
  });
});

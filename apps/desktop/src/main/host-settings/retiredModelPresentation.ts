import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { RemoteModelFavorite } from '@cindy/device-link';
import { manageAppPreferences } from '../app-settings/preferences.js';
import { requestModelFavorites } from '../maker-ipc/modelFavoritesSync.js';
import { getModelVisibilityMirrorSnapshot, waitForModelVisibilityMirror } from '../maker-host/model-visibility-mirror.js';
import { dataOwnerStorageKey } from '../appSessionState.js';
import { createLogger } from '../logger.js';
import { setModelVisibility } from './modelPresentationDomains.js';
import { currentSettingsOwner } from './personalization.js';

const log = createLogger('retired-model-presentation');
const FILE = 'host-model-presentation-preferences.json';
const RETURNED = 'host-model-presentation-preferences.returned.json';
type Harness = 'claude-code' | 'codex' | 'pi';
type Engine = 'cc' | 'codex' | 'pi';
type Favorite = Omit<RemoteModelFavorite, 'uid'>;
interface Retired { visibility: Record<string, boolean>; engines: Record<string, Engine>; favorites: Favorite[] }

export interface ModelPresentationTarget {
  visibility(): Promise<Record<string, boolean>>;
  setVisibility(target: { harness: Harness; providerId: string; modelId: string }, visible: boolean | null): Promise<void>;
  engines(change?: { providerId: string; modelId: string; agent: Engine | null }): Promise<Record<string, Engine>>;
  favorites(mutation?: unknown): Promise<RemoteModelFavorite[]>;
}
const upstream: ModelPresentationTarget = {
  async visibility() { await waitForModelVisibilityMirror(); return getModelVisibilityMirrorSnapshot(); },
  setVisibility: setModelVisibility,
  async engines(change) { return (await manageAppPreferences('model-engine', undefined, undefined, { modelEngine: change })).modelEngines ?? {}; },
  favorites: requestModelFavorites,
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isEngine = (value: unknown): value is Engine => value === 'cc' || value === 'codex' || value === 'pi';
const harnessOf = (agent: string): Harness | null => agent === 'claude-code' || agent === 'codex' || agent === 'pi' ? agent : null;

/** What an earlier cloud build held for the owner; null when it never took them over from the window. */
export function retiredModelPresentation(raw: unknown): Retired | null {
  if (!record(raw) || raw._initialized !== true || !record(raw.preferences)) return null;
  const preferences = raw.preferences;
  const visibility = record(preferences.visibility) && record(preferences.visibility.overrides)
    ? Object.fromEntries(Object.entries(preferences.visibility.overrides).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')) : {};
  const engines = record(preferences.engines) ? Object.fromEntries(Object.entries(preferences.engines).flatMap(([key, value]) =>
    record(value) && isEngine(value.agent) ? [[key, value.agent]] : [])) : {};
  const items = record(preferences.favorites) && Array.isArray(preferences.favorites.items) ? preferences.favorites.items : [];
  const favorites = items.flatMap((item): Favorite[] => record(item) && typeof item.providerId === 'string' && typeof item.modelId === 'string' && isEngine(item.agent)
    ? [{ providerId: item.providerId, modelId: item.modelId, agent: item.agent, ...(typeof item.effort === 'string' ? { effort: item.effort } : {}),
      ...(item.fast === true || item.fast === 'ultrafast' ? { fast: item.fast } : {}) }] : []);
  return { visibility, engines, favorites };
}

const sameFavorite = (a: Favorite, b: Favorite) => a.providerId === b.providerId && a.modelId === b.modelId && a.agent === b.agent
  && (a.effort ?? null) === (b.effort ?? null) && (a.fast ?? null) === (b.fast ?? null);
// The window answered and refused this one value; other errors mean it is not ready yet.
const refused = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  return /PREFERENCE_NOT_SAVED|PREFERENCE_READBACK_MISMATCH|SAVE_FAILED|MODEL_ENGINE_NOT_SAVED|not confirmed; refresh/.test(message)
    || (error as { code?: unknown })?.code === 'SAVE_FAILED';
};
async function each(label: string, work: () => Promise<unknown>): Promise<void> {
  try { await work(); }
  catch (error) { if (!refused(error)) throw error; log.warn('earlier model preference not taken', { kind: label }); }
}

/**
 * Earlier cloud builds kept the owner's model visibility, engines and favorites in a Host file;
 * they now live in the app window as upstream keeps them. The window is made to match that file
 * once, through upstream's own operations, then the file is kept aside for manual recovery.
 */
export async function returnRetiredModelPresentation(
  root: string | null = ownerRoot(), target: ModelPresentationTarget = upstream,
): Promise<'none' | 'returned' | 'retry'> {
  if (!root) return 'retry';
  const file = path.join(root, FILE);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'retry'; }
  let raw: unknown = null;
  try { raw = JSON.parse(text); } catch { /* an unreadable file is kept aside unchanged */ }
  const retired = retiredModelPresentation(raw);
  try {
    if (retired) {
      const visible = await target.visibility();
      for (const key of Object.keys(visible)) {
        if (Object.hasOwn(retired.visibility, key)) continue;
        const [agent = '', providerId = '', ...model] = key.split(':');
        const harness = harnessOf(agent);
        if (harness && providerId && model.length) await each('visibility', () => target.setVisibility({ harness, providerId, modelId: model.join(':') }, null));
      }
      for (const [key, enabled] of Object.entries(retired.visibility)) {
        const [agent = '', providerId = '', ...model] = key.split(':');
        const harness = harnessOf(agent);
        if (harness && providerId && model.length && visible[key] !== enabled) await each('visibility', () => target.setVisibility({ harness, providerId, modelId: model.join(':') }, enabled));
      }
      const engines = await target.engines();
      const split = (key: string) => { const [providerId = '', ...model] = key.split(':'); return { providerId, modelId: model.join(':') }; };
      for (const key of Object.keys(engines)) if (!Object.hasOwn(retired.engines, key)) await each('engine', () => target.engines({ ...split(key), agent: null }));
      for (const [key, agent] of Object.entries(retired.engines)) if (engines[key] !== agent) await each('engine', () => target.engines({ ...split(key), agent }));
      let favorites = await target.favorites();
      for (const item of favorites) {
        if (!retired.favorites.some(wanted => sameFavorite(item, wanted))) await each('favorite', async () => { favorites = await target.favorites({ kind: 'remove', expected: item }); });
      }
      for (const wanted of retired.favorites) {
        if (!favorites.some(item => sameFavorite(item, wanted))) await each('favorite', async () => { favorites = await target.favorites({ kind: 'add', item: wanted }); });
      }
    }
  } catch { return 'retry'; }
  fs.renameSync(file, path.join(root, RETURNED));
  return 'returned';
}

function ownerRoot(): string | null {
  const owner = currentSettingsOwner();
  return owner?.dataOwnerId ? path.join(app.getPath('userData'), 'owners', dataOwnerStorageKey(owner.dataOwnerId)) : null;
}

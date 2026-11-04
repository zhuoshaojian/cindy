/**
 * Model visibility, favorites and engine choices on a managed cloud instance.
 *
 * There the Host file is the source of truth, because the instance settings channel, the web
 * console and the settings tools change these preferences while no window may be open.
 * Preload exposes the Host API only on such an instance, so ordinary desktops keep the
 * localStorage stores in modelVisibilityPrefs, modelFavorites and modelEnginePrefs and
 * never migrate their data. Those stores keep their signatures and delegate here.
 *
 * Visibility writers already await persistence. Favorite and engine writers stay synchronous,
 * like the local stores: an answer that needs the result comes from the shared operation
 * applied to the current Host snapshot, and the commit then checks the Host revision.
 * Subscribers update only from Host receipts; a failed commit reloads the Host state and
 * reports the failure (see hostModelPresentationPreferences).
 */
import {
  EFFORT_VALUES,
  isModelVisible,
  type AgentKind,
  type ProviderView,
} from '@cindy/model-providers';
import {
  parseModelFavoriteMutation,
  sameModelFavorite,
  type ModelFavoriteMutation,
} from '@cindy/device-link';
import {
  applyModelPresentationOperation,
  enginePreferenceKey,
  isModelPresentationEngine,
  normalizeModelFavoriteConfig,
  visibilityPreferenceKey,
  type ModelEngine,
  type ModelPresentationOperation,
} from '../../shared/modelPresentationPreferences';
import { getDataOwnerGeneration } from '../contexts/dataOwnerGeneration';
import {
  commitHostModelPresentation,
  ensureHostModelPresentationLoaded,
  getHostModelPresentationSnapshot,
  getHostModelPresentationValue,
  getHostModelPresentationVersion,
  invalidateHostModelPresentationOwner,
  retryHostModelPresentationMigration,
  subscribeHostModelPresentation,
} from './hostModelPresentationPreferences';
import type { ModelFavoriteConfig, ModelFavoriteItem, ModelFavoritePatch } from './modelFavorites';
import type { ModelVisibilityInitializationFailure } from './modelVisibilityPrefs';

export { hasHostModelPresentation } from './hostModelPresentationPreferences';

type VisibilityTarget = { agent: AgentKind; modelId: string };

export const hostModelVisibility = {
  /** Report only the current owner's Host state; never expose another owner's failure. */
  initializationFailure(
    ownerId: string | null,
    generation: number,
  ): ModelVisibilityInitializationFailure | null {
    const owner = getDataOwnerGeneration();
    if (owner.dataOwnerId !== ownerId || owner.generation !== generation) return null;
    const snapshot = getHostModelPresentationSnapshot();
    if (snapshot?.status === 'ready') return null;
    if (snapshot?.status === 'unreadable') return 'preferences-corrupt';
    if (snapshot?.status === 'pending-migration') {
      const claim = window.electronAPI?.maker?.claimLegacyModelVisibilityOwner?.();
      return claim?.profileOrigin === 'pending' ? 'profile-pending' : 'legacy-busy';
    }
    return snapshot?.status === 'unavailable' ? 'owner-pending' : 'storage-unavailable';
  },
  subscribe: subscribeHostModelPresentation,
  version: getHostModelPresentationVersion,
  async setOwner(
    ownerId: string | null,
    generation: number,
    mode: 'signed-out' | 'local' | 'cloud',
  ): Promise<void> {
    invalidateHostModelPresentationOwner();
    const owner = getDataOwnerGeneration();
    if (owner.dataOwnerId !== ownerId || owner.generation !== generation || mode === 'signed-out')
      return;
    await ensureHostModelPresentationLoaded();
  },
  /** Record catalog scopes and declared aliases; never write catalog defaults as overrides. */
  async migrateDefaults(
    ownerId: string | null,
    generation: number,
    providers: readonly ProviderView[],
    isCurrent: () => boolean,
  ): Promise<boolean> {
    if (!ownerId) return true;
    const current = () => {
      const owner = getDataOwnerGeneration();
      return isCurrent() && owner.dataOwnerId === ownerId && owner.generation === generation;
    };
    if (!current()) return false;
    await ensureHostModelPresentationLoaded();
    if (!current()) return false;
    await retryHostModelPresentationMigration();
    if (!current()) return false;
    return !!(await commitHostModelPresentation(
      {
        kind: 'visibility-catalog',
        scopes: providers.flatMap((provider) =>
          provider.agents.map((agent) => ({
            providerId: provider.id,
            agent,
            models: (provider.models[agent] ?? []).map((model) => ({
              id: model.id,
              ...(model.defaultEnabled === undefined
                ? {}
                : { defaultEnabled: model.defaultEnabled }),
            })),
            modelPrefixes: [...(provider.routing[agent]?.modelPrefixes ?? [])],
          })),
        ),
      },
      current,
    ));
  },
  /** Pending or unreadable preferences fail closed, keeping only committed user choices. */
  isModelEnabled(
    agent: AgentKind,
    providerId: string,
    model: { id: string; defaultEnabled?: boolean },
  ): boolean {
    const snapshot = getHostModelPresentationSnapshot();
    const key = visibilityPreferenceKey(agent, providerId, model.id);
    if (snapshot?.status === 'pending-migration') {
      const visibility = snapshot.value.visibility;
      if (Object.hasOwn(visibility.overrides, key)) return visibility.overrides[key]!;
      return (
        visibility.initialization.followCatalogKeys.includes(key) &&
        isModelVisible(undefined, model.defaultEnabled)
      );
    }
    if (snapshot?.status !== 'ready')
      return !getDataOwnerGeneration().dataOwnerId && isModelVisible(undefined, model.defaultEnabled);
    return isModelVisible(snapshot.value.visibility.overrides[key], model.defaultEnabled);
  },
  isCustomized(agent: AgentKind, providerId: string, modelId: string): boolean {
    const snapshot = getHostModelPresentationSnapshot();
    return (
      !!snapshot &&
      (snapshot.status === 'ready' || snapshot.status === 'pending-migration') &&
      Object.hasOwn(
        snapshot.value.visibility.overrides,
        visibilityPreferenceKey(agent, providerId, modelId),
      )
    );
  },
  async set(providerId: string, targets: readonly VisibilityTarget[], enabled: boolean) {
    return !!(await commitHostModelPresentation({
      kind: 'visibility-set',
      providerId,
      targets: [...targets],
      enabled,
    }));
  },
  async reset(providerId: string, targets: readonly VisibilityTarget[]) {
    if (!providerId || targets.some((target) => !target.modelId)) return false;
    if (!targets.length) return true;
    return !!(await commitHostModelPresentation({
      kind: 'visibility-reset',
      providerId,
      targets: [...targets],
    }));
  },
};

/** Answer from the operation applied to the current Host state, then commit it. */
function commitNow(operation: ModelPresentationOperation, isCurrent?: () => boolean) {
  const snapshot = getHostModelPresentationSnapshot();
  if (snapshot?.status !== 'ready') return null;
  const applied = applyModelPresentationOperation(snapshot.value, operation);
  void commitHostModelPresentation(operation, isCurrent);
  return applied;
}

/** The Host validates effort keys at runtime; its string type stands for the same keys. */
const items = (value: readonly unknown[]) => value as readonly ModelFavoriteItem[];

export const hostModelFavorites = {
  list: (): readonly ModelFavoriteItem[] => items(getHostModelPresentationValue().favorites.items),
  /** The uid the Host assigns when no other window adds a favorite first. */
  add(config: ModelFavoriteConfig): string {
    const normalized = normalizeModelFavoriteConfig(config);
    if (!normalized) return '';
    try {
      return commitNow({ kind: 'favorite-add', config: normalized })?.favoriteUid ?? '';
    } catch {
      return '';
    }
  },
  seed(config: ModelFavoriteConfig): void {
    const normalized = normalizeModelFavoriteConfig(config);
    if (normalized) void commitHostModelPresentation({ kind: 'favorite-seed', config: normalized });
  },
  update(uid: string, patch: ModelFavoritePatch): void {
    if (patch.agent !== undefined && !isModelPresentationEngine(patch.agent)) return;
    // Keep the native editor's semantics: an unknown effort clears the field.
    const normalized = { ...patch };
    if ('effort' in patch && !(EFFORT_VALUES as readonly unknown[]).includes(patch.effort))
      normalized.effort = null;
    void commitHostModelPresentation({ kind: 'favorite-update', uid, patch: normalized });
  },
  remove(uid: string): void {
    void commitHostModelPresentation({ kind: 'favorite-remove', uid });
  },
  subscribe: subscribeHostModelPresentation,
  setOwner: invalidateHostModelPresentationOwner,
  /** Device-link requests reach the Host store in Main; this serves the renderer callers. */
  access(
    ownerId: string | null,
    mutation: ModelFavoriteMutation | undefined,
    providerIdMaxLength: number,
  ): readonly ModelFavoriteItem[] {
    const read = () => {
      const owner = getDataOwnerGeneration();
      if (!ownerId || owner.dataOwnerId !== ownerId) throw new Error('Favorites owner not ready');
      const snapshot = getHostModelPresentationSnapshot();
      if (snapshot?.status !== 'ready') throw new Error('Favorites host not ready');
      return snapshot.value.favorites.items;
    };
    if (!mutation) return items(read());
    const op = parseModelFavoriteMutation(mutation, providerIdMaxLength);
    const unchanged = () => {
      const all = read();
      if (op.kind === 'add') return true;
      const current = all.find((item) => item.uid === op.expected.uid);
      if (!current || !sameModelFavorite(current, op.expected))
        throw new Error('Favorite changed; refresh before retrying');
      return true;
    };
    unchanged();
    let operation: ModelPresentationOperation;
    if (op.kind === 'add') {
      const config = normalizeModelFavoriteConfig(op.item);
      if (!config) throw new Error('Invalid favorite');
      operation = { kind: 'favorite-add', config };
    } else if (op.kind === 'remove') {
      operation = { kind: 'favorite-remove', uid: op.expected.uid };
    } else {
      operation = {
        kind: 'favorite-update',
        uid: op.expected.uid,
        patch: { agent: op.item.agent, effort: op.item.effort ?? null, fast: op.item.fast ?? false },
      };
    }
    const applied = commitNow(operation, () => {
      try {
        return unchanged();
      } catch {
        return false;
      }
    });
    if (!applied) throw new Error('Favorites host not ready');
    return items(applied.value.favorites.items);
  },
};

export const hostModelEngines = {
  get: (providerId: string, modelId: string): ModelEngine | undefined =>
    getHostModelPresentationValue().engines[enginePreferenceKey(providerId, modelId)]?.agent,
  set(providerId: string, modelId: string, agent: ModelEngine): void {
    void commitHostModelPresentation({ kind: 'engine-set', providerId, modelId, agent });
  },
  clear(providerId: string, modelId: string): void {
    void commitHostModelPresentation({ kind: 'engine-clear', providerId, modelId });
  },
  hasAny: (): boolean => Object.keys(getHostModelPresentationValue().engines).length > 0,
  subscribe: subscribeHostModelPresentation,
  version: getHostModelPresentationVersion,
  setOwner: invalidateHostModelPresentationOwner,
};

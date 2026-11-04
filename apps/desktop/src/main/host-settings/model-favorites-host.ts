import {
  MODEL_FAVORITE_TEXT_MAX_LENGTH,
  parseModelFavorites,
  sameModelFavorite,
  type ModelFavoriteMutation,
  type RemoteModelFavorite,
} from '@cindy/device-link';
import {
  modelFavoriteIdentity,
  normalizeModelFavoriteConfig,
  type ModelPresentationOperation,
} from '../../shared/modelPresentationPreferences.js';
import { activeOwnerScopeKey, isAppSessionBoundaryPending } from '../appSessionState.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import {
  inspectModelPresentationPreferences,
  mutateModelPresentationPreferences,
} from './model-presentation-preferences.js';

/** Remote favorite snapshots are limited to this many items on the wire. */
const REMOTE_FAVORITES_MAX = 4096;

function notConfirmed(): never {
  return throwIpcError('PRECONDITION_FAILED', 'Favorites were not confirmed; refresh before retrying');
}

/**
 * Device-link favorites on a managed cloud instance. The Host file is the source of truth
 * there, so Main answers with the same checks the renderer store applies elsewhere.
 */
export async function requestHostModelFavorites(
  mutation?: ModelFavoriteMutation,
): Promise<RemoteModelFavorite[]> {
  const owner = activeOwnerScopeKey();
  const assertCurrent = () => {
    if (isAppSessionBoundaryPending() || activeOwnerScopeKey() !== owner)
      throwIpcError('PRECONDITION_FAILED', 'Favorites were not confirmed: owner changed');
  };
  const snapshot = inspectModelPresentationPreferences();
  if (snapshot.status !== 'ready')
    throwIpcError('DEVICE_LINK_UNAVAILABLE', 'Favorites host not ready');
  let items = snapshot.value.favorites.items;
  if (mutation) {
    let operation: ModelPresentationOperation;
    if (mutation.kind === 'add') {
      const config = normalizeModelFavoriteConfig(mutation.item);
      if (!config) return throwIpcError('INVALID_PARAMS', 'Invalid favorite operation');
      const identity = modelFavoriteIdentity(config);
      if (
        items.length >= REMOTE_FAVORITES_MAX &&
        !items.some((item) => modelFavoriteIdentity(item) === identity)
      )
        notConfirmed();
      operation = { kind: 'favorite-add', config };
    } else {
      const current = items.find((item) => item.uid === mutation.expected.uid);
      if (!current || !sameModelFavorite(current, mutation.expected)) notConfirmed();
      operation =
        mutation.kind === 'remove'
          ? { kind: 'favorite-remove', uid: mutation.expected.uid }
          : {
              kind: 'favorite-update',
              uid: mutation.expected.uid,
              patch: {
                agent: mutation.item.agent,
                effort: mutation.item.effort ?? null,
                fast: mutation.item.fast ?? false,
              },
            };
    }
    let receipt;
    try {
      receipt = await mutateModelPresentationPreferences(
        { ownerStamp: snapshot.ownerStamp, expectedRevision: snapshot.revision, operation },
        assertCurrent,
      );
    } catch {
      return notConfirmed();
    }
    assertCurrent();
    if (receipt.snapshot.status !== 'ready') notConfirmed();
    items = receipt.snapshot.value.favorites.items;
  }
  // Long local composite sources do not fit the wire protocol; keep them on disk only.
  return parseModelFavorites(
    items.filter((item) => item.providerId.length <= MODEL_FAVORITE_TEXT_MAX_LENGTH),
  );
}

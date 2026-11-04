/** 云实例的收藏正本在 Host 文件：device-link 请求由 Main 应答，不再派给 renderer 窗口。 */
import { expect, it, vi } from 'vitest';
import { MODEL_FAVORITES_APPLY, MODEL_FAVORITES_GET } from '@cindy/device-link';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const h = vi.hoisted(() => ({
  handle: new Map<string, Handler>(),
  request: vi.fn(async () => [{ uid: 'fav-1', providerId: 'account', modelId: 'model', agent: 'codex' }]),
}));
vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), handle: (key: string, fn: Handler) => h.handle.set(key, fn) },
}));
vi.mock('../../security/trustedAppRenderer.js', () => ({ assertTrustedAppRendererEvent: () => {} }));
vi.mock('../../appSessionState.js', () => ({
  activeOwnerScopeKey: () => 'owner',
  getActiveDataOwnerPushStamp: () => ({ dataOwnerId: 'owner', ownerGeneration: 1 }),
  isAppSessionBoundaryPending: () => false,
}));
vi.mock('../../device-link/invoke-context.js', () => ({ isDeviceLinkInvoke: () => true }));
vi.mock('../../host-settings/model-presentation-preferences.js', () => ({
  hostOwnsModelPresentation: () => true,
}));
vi.mock('../../host-settings/model-favorites-host.js', () => ({ requestHostModelFavorites: h.request }));
import { registerModelFavoritesSync } from '../modelFavoritesSync';

it('answers reads and edits from the Host store without a renderer window', async () => {
  registerModelFavoritesSync(vi.fn());
  await expect(h.handle.get(MODEL_FAVORITES_GET)!({})).resolves.toHaveLength(1);
  expect(h.request).toHaveBeenLastCalledWith(undefined);
  const item = { providerId: 'account', modelId: 'b', agent: 'codex' };
  await h.handle.get(MODEL_FAVORITES_APPLY)!({}, { kind: 'add', item });
  expect(h.request).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: 'add', item: expect.objectContaining(item) }),
  );
});

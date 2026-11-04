/** 云实例：device-link 收藏请求直接由 Main 读写 Host 文件，校验与本机 renderer 一致。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyModelPresentationPreferences,
  type ModelPresentationPreferencesSnapshot,
} from '../../../shared/modelPresentationPreferences';

const h = vi.hoisted(() => ({
  owner: 'owner-a:1',
  snapshot: null as unknown as ModelPresentationPreferencesSnapshot,
  mutate: vi.fn(),
}));
vi.mock('../model-presentation-preferences.js', () => ({
  inspectModelPresentationPreferences: () => structuredClone(h.snapshot),
  mutateModelPresentationPreferences: h.mutate,
}));
vi.mock('../../appSessionState.js', () => ({
  activeOwnerScopeKey: () => h.owner,
  isAppSessionBoundaryPending: () => false,
}));
import { requestHostModelFavorites } from '../model-favorites-host';

const stamp = { dataOwnerId: 'owner-a', ownerGeneration: 1 };
const item = { uid: 'fav-1', providerId: 'account', modelId: 'model', agent: 'codex' as const };
function ready(items = [item], status: 'ready' | 'pending-migration' = 'ready'): ModelPresentationPreferencesSnapshot {
  const value = emptyModelPresentationPreferences();
  value.favorites = { uidSeq: items.length + 1, items: structuredClone(items) };
  return { status, initialized: status === 'ready', ownerStamp: stamp, revision: 'r1', value };
}

beforeEach(() => {
  h.owner = 'owner-a:1';
  h.snapshot = ready();
  h.mutate.mockReset().mockImplementation(async () => ({ snapshot: ready([item, { ...item, uid: 'fav-2', modelId: 'b' }]) }));
});

describe('requestHostModelFavorites', () => {
  it('reads the Host list without writing and leaves long local sources on disk', async () => {
    h.snapshot = ready([item, { ...item, uid: 'fav-2', providerId: 'x'.repeat(600) }]);
    await expect(requestHostModelFavorites()).resolves.toEqual([item]);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('commits an add against the revision it read and returns the saved list', async () => {
    const added = { providerId: 'account', modelId: 'b', agent: 'codex' as const };
    await expect(requestHostModelFavorites({ kind: 'add', item: added })).resolves.toHaveLength(2);
    expect(h.mutate).toHaveBeenCalledWith(
      { ownerStamp: stamp, expectedRevision: 'r1', operation: { kind: 'favorite-add', config: added } },
      expect.any(Function),
    );
  });

  it('maps an edit to the Host update with the native patch semantics', async () => {
    await requestHostModelFavorites({ kind: 'update', expected: item, item: { ...item, effort: 'high' } });
    expect(h.mutate.mock.calls[0]![0].operation).toEqual({
      kind: 'favorite-update', uid: 'fav-1', patch: { agent: 'codex', effort: 'high', fast: false },
    });
  });

  it('rejects a stale expectation before writing', async () => {
    await expect(requestHostModelFavorites({ kind: 'remove', expected: { ...item, effort: 'low' } }))
      .rejects.toThrow('PRECONDITION_FAILED');
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('reports a Host conflict as not confirmed', async () => {
    h.mutate.mockRejectedValue(new Error('Settings conflict'));
    await expect(requestHostModelFavorites({ kind: 'remove', expected: item }))
      .rejects.toThrow('PRECONDITION_FAILED');
  });

  it('rejects when the owner changes during the commit', async () => {
    h.mutate.mockImplementation(async (_request, assertCurrent: () => void) => {
      h.owner = 'owner-b:2';
      assertCurrent();
    });
    await expect(requestHostModelFavorites({ kind: 'remove', expected: item }))
      .rejects.toThrow('PRECONDITION_FAILED');
  });

  it('does not answer before the Host file is ready', async () => {
    h.snapshot = ready([item], 'pending-migration');
    await expect(requestHostModelFavorites()).rejects.toThrow('DEVICE_LINK_UNAVAILABLE');
  });
});

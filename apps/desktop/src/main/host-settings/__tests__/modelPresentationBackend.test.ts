/** 只有托管云实例由 Host 文件保存模型偏好；普通桌面不读不写，也不接管 Main 镜像。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ instance: null as object | null }));
vi.mock('../../instance-runtime/config.js', () => ({ getInstanceConfig: () => h.instance }));
vi.mock('../personalization.js', () => ({ currentSettingsOwner: () => null }));
import {
  commitHostModelPresentationPreferences,
  hostModelVisibilityMirror,
  hostOwnsModelPresentation,
  inspectModelPresentationPreferences,
  mutateModelPresentationPreferences,
} from '../model-presentation-preferences';

beforeEach(() => {
  h.instance = null;
});

describe('model presentation backend', () => {
  it('leaves an ordinary desktop with the renderer stores', async () => {
    expect(hostOwnsModelPresentation()).toBe(false);
    expect(hostModelVisibilityMirror()).toBeNull();
    expect(inspectModelPresentationPreferences()).toEqual({
      status: 'unavailable', revision: null, ownerStamp: null,
    });
    const request = {
      ownerStamp: { dataOwnerId: 'owner', ownerGeneration: 1 },
      expectedRevision: 'r1',
      operation: { kind: 'reset' as const },
    };
    await expect(mutateModelPresentationPreferences(request)).rejects.toThrow('scope_changed');
    await expect(commitHostModelPresentationPreferences((value) => value, {}))
      .rejects.toThrow('scope_changed');
  });

  it('serves the Main visibility table from the Host file on a cloud instance', () => {
    h.instance = {};
    expect(hostOwnsModelPresentation()).toBe(true);
    const mirror = hostModelVisibilityMirror();
    expect(mirror).not.toBeNull();
    expect(hostModelVisibilityMirror()).toBe(mirror);
    expect(() => mirror!.getModelVisibilityOverride('codex', 'p', 'm'))
      .toThrow('MODEL_VISIBILITY_NOT_READY');
  });
});

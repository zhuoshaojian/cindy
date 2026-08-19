import { describe, expect, it } from 'vitest';

import {
  cloudInstanceLifecycleAction,
  cloudInstanceLifecycleActionForTarget,
  cloudInstanceLifecycleProgressKey,
} from '../cloudLifecyclePresentation';

describe('cloud lifecycle progress presentation', () => {
  it.each([
    ['wake', 'settings.devices.cloudInstance.waking'],
    ['stop', 'settings.devices.cloudInstance.stopping'],
    ['rebuild', 'settings.devices.cloudInstance.rebuilding'],
    ['delete', 'settings.devices.cloudInstance.deleting'],
  ] as const)('maps %s to its own progress wording', (action, key) => {
    expect(cloudInstanceLifecycleAction({ action, target: 'instance-a' })).toBe(action);
    expect(cloudInstanceLifecycleProgressKey(action)).toBe(key);
  });

  it('does not present short actions as lifecycle progress', () => {
    expect(cloudInstanceLifecycleAction({ action: 'upgrade', target: 'instance-a' })).toBeNull();
    expect(cloudInstanceLifecycleAction({ action: 'autoUpdate', target: 'instance-a' })).toBeNull();
  });

  it('transfers rebuild progress to a unique replacement after the old row disappears', () => {
    expect(
      cloudInstanceLifecycleActionForTarget(
        { action: 'rebuild', target: 'instance-old' },
        'instance-new',
        ['instance-new'],
      ),
    ).toBe('rebuild');
  });

  it('does not guess a rebuild target when multiple replacement candidates exist', () => {
    expect(
      cloudInstanceLifecycleActionForTarget(
        { action: 'rebuild', target: 'instance-old' },
        'instance-new-a',
        ['instance-new-a', 'instance-new-b'],
      ),
    ).toBeNull();
  });
});

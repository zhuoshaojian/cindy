import { describe, expect, it, vi } from 'vitest';
import { quiesceCloudSessions } from '../cloud-runtime/quiesce.js';

describe('cloud runtime quiesce', () => {
  it('closes every idle session', async () => {
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => true);

    await expect(
      quiesceCloudSessions([{ closeIfIdle: first }, { closeIfIdle: second }]),
    ).resolves.toEqual({
      quiesced: true,
      attempted: 2,
      closed: 2,
      reason: 'quiesced',
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('fails closed and stops draining when a session is busy', async () => {
    const afterBusy = vi.fn(async () => true);

    await expect(
      quiesceCloudSessions([
        { closeIfIdle: async () => true },
        { closeIfIdle: async () => false },
        { closeIfIdle: afterBusy },
      ]),
    ).resolves.toEqual({
      quiesced: false,
      attempted: 2,
      closed: 1,
      reason: 'session-busy',
    });
    expect(afterBusy).not.toHaveBeenCalled();
  });

  it('turns close failures into a fail-closed result', async () => {
    await expect(
      quiesceCloudSessions([
        {
          closeIfIdle: async () => {
            throw new Error('close failed');
          },
        },
      ]),
    ).resolves.toEqual({
      quiesced: false,
      attempted: 1,
      closed: 0,
      reason: 'close-failed',
    });
  });
});

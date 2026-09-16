import { describe, it, expect, vi } from 'vitest';
import { HostLoginAdapters } from '../hostLoginAdapters.js';
import type { InstalledGhost } from '../../../shared/ghost.js';

const ghost = { manifest: { id: 'fixture' } } as InstalledGhost;
describe('Host credential source adapter registry', () => {
  it('uses a registered source and leaves declarative setup to its original engine', async () => {
    const connect = vi.fn(async () => ({ ok: true }));
    const registry = new HostLoginAdapters([
      { id: 'fixture-driver', supports: (g) => g.manifest.id === 'fixture', connect },
    ]);
    const input = { sessionId: 'task', assertCurrent: vi.fn() };
    await expect(registry.connect(ghost, input)).resolves.toEqual({ ok: true });
    expect(input.assertCurrent).toHaveBeenCalledTimes(2);
    await expect(
      registry.connect({ manifest: { id: 'other' } } as InstalledGhost, input),
    ).resolves.toBeNull();
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it('rejects ambiguity, cancellation and stale success without falling back', async () => {
    const connect = vi.fn(async () => ({ ok: true }));
    const a = { id: 'a', supports: () => true, connect },
      b = { ...a, id: 'b' };
    expect(() => new HostLoginAdapters([a, a])).toThrow();
    await expect(
      new HostLoginAdapters([a, b]).connect(ghost, { sessionId: 'task', assertCurrent() {} }),
    ).rejects.toThrow('AMBIGUOUS');
    const abort = new AbortController();
    abort.abort();
    await expect(
      new HostLoginAdapters([a]).connect(ghost, {
        sessionId: 'task',
        assertCurrent() {},
        signal: abort.signal,
      }),
    ).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    let current = true;
    const registry = new HostLoginAdapters([
      {
        ...a,
        connect: async () => {
          current = false;
          return { ok: true };
        },
      },
    ]);
    await expect(
      registry.connect(ghost, {
        sessionId: 'task',
        assertCurrent() {
          if (!current) throw new Error('stale');
        },
      }),
    ).rejects.toThrow();
  });
});

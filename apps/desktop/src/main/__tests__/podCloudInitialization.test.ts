import { describe, expect, it, vi } from 'vitest';
import { initializePodUserServices } from '../cloud-runtime/pod-initialization.js';

describe('Pod user services initialization', () => {
  it('refreshes account-scoped providers, starts embedding, and triggers pricing prewarm', async () => {
    const calls: string[] = [];
    await initializePodUserServices({
      refreshCustomProviders: async () => {
        calls.push('providers');
      },
      startEmbeddingHost: () => {
        calls.push('embedding');
      },
      prewarmModelPricing: async () => {
        calls.push('pricing');
      },
      logger: { warn: vi.fn() },
    });
    await vi.waitFor(() => expect(calls).toEqual(['providers', 'embedding', 'pricing']));
  });

  it('keeps optional initialization best-effort and logs each failure', async () => {
    const warn = vi.fn();
    await initializePodUserServices({
      refreshCustomProviders: async () => {
        throw new Error('providers unavailable');
      },
      startEmbeddingHost: () => {
        throw new Error('embedding unavailable');
      },
      prewarmModelPricing: async () => {
        throw new Error('pricing unavailable');
      },
      logger: { warn },
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(3));
  });
});

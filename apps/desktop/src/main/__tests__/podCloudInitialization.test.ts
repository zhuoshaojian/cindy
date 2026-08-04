import { describe, expect, it, vi } from 'vitest';
import {
  initializePodUserServices,
  startPodAccountProviderReadiness,
} from '../cloud-runtime/pod-initialization.js';
import {
  createAccountProviderReadinessBarrier,
  startAccountProviderReadiness,
} from '../maker-host/account-provider-readiness-barrier.js';

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

  it('arms the real provider barrier without blocking Pod startup', async () => {
    const calls: string[] = [];
    let finishRefresh: () => void = () => {
      throw new Error('refresh resolver was not installed');
    };
    const refreshPending = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const barrier = createAccountProviderReadinessBarrier();

    startPodAccountProviderReadiness({
      scopeKey: 'owner:membership-1',
      refreshModels: async () => {
        calls.push('models');
        await refreshPending;
      },
      startReadiness: (scopeKey, task, onError) =>
        startAccountProviderReadiness({
          scopeKey,
          task,
          onError,
          barrier,
        }),
      logger: { warn: vi.fn() },
    });

    const readiness = barrier.waitForScope('owner:membership-1');
    await Promise.resolve();
    expect(calls).toEqual(['models']);
    expect(await Promise.race([readiness.then(() => 'settled'), Promise.resolve('startup-free')]))
      .toBe('startup-free');
    finishRefresh();
    await expect(readiness).resolves.toBe(true);
  });
});

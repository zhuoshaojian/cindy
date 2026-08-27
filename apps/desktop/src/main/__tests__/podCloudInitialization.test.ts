import { describe, expect, it, vi } from 'vitest';
import {
  initializePodUserServices,
  startPodAccountProviderReadiness,
} from '../cloud-runtime/pod-initialization.js';
import {
  createAccountProviderReadinessBarrier,
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
      // 与生产适配器同形:直传 barrier.start 才能把 handle 交到 task 手里。
      startReadiness: (scopeKey, task, onError) => barrier.start(scopeKey, task, onError),
      startReadinessConsumers: () => calls.push('consumers'),
      logger: { warn: vi.fn() },
    });

    const readiness = barrier.waitForScope('owner:membership-1');
    await Promise.resolve();
    expect(calls).toEqual(['models']);
    expect(await Promise.race([readiness.then(() => 'settled'), Promise.resolve('startup-free')]))
      .toBe('startup-free');
    finishRefresh();
    await expect(readiness).resolves.toBe(true);
    // Opening the gate is not enough: without this the cloud has no scheduler,
    // so automations fail with SCHEDULER_NOT_READY and the instance can never
    // read its own scheduler counters to be judged idle.
    expect(calls).toEqual(['models', 'consumers']);
  });

  it('does not arm the consumers when discovery did not complete', async () => {
    const calls: string[] = [];
    const barrier = createAccountProviderReadinessBarrier();

    startPodAccountProviderReadiness({
      scopeKey: 'owner:membership-1',
      refreshModels: async () => {
        calls.push('models');
      },
      startReadiness: (scopeKey, task, onError) =>
        // A replaced entry reports the mark as rejected; the consumers belong to
        // whichever incarnation actually owns discovery.
        barrier.start(scopeKey, () => task({ markDiscoveryComplete: () => false }), onError),
      startReadinessConsumers: () => calls.push('consumers'),
      logger: { warn: vi.fn() },
    });

    await barrier.waitForScope('owner:membership-1');
    expect(calls).toEqual(['models']);
  });
});

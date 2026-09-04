import { describe, expect, it, vi } from 'vitest';

import { HEADLESS_POD_RUNTIME_ENV } from '../../headless-startup.js';
import {
  HEADLESS_MODEL_ACCESS_MAX_RETRY_DELAY_MS,
  HEADLESS_MODEL_ACCESS_TIMEOUT_MS,
  createHeadlessModelCatalogRecovery,
  headlessModelAccessRetryDelayMs,
  resolveModelAccessTransport,
} from '../headlessPolicy.js';

describe('headless model-access policy', () => {
  it('keeps fast retries then continues with a five-minute cap', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(headlessModelAccessRetryDelayMs)).toEqual([
      2_000,
      8_000,
      30_000,
      60_000,
      120_000,
      240_000,
      HEADLESS_MODEL_ACCESS_MAX_RETRY_DELAY_MS,
    ]);
  });

  it('uses Node fetch and a deadline only for the strict Pod runtime', () => {
    const nodeFetch = vi.fn() as unknown as typeof globalThis.fetch;
    expect(resolveModelAccessTransport({}, nodeFetch)).toEqual({});
    expect(resolveModelAccessTransport({ [HEADLESS_POD_RUNTIME_ENV]: '1' }, nodeFetch)).toEqual({
      fetchImpl: nodeFetch,
      timeoutMs: HEADLESS_MODEL_ACCESS_TIMEOUT_MS,
    });
  });

  it('retries a failed model catalog until success and cancels stale generations', async () => {
    vi.useFakeTimers();
    try {
      let generation = 3;
      const retry = vi.fn();
      const recovery = createHeadlessModelCatalogRecovery({
        isGenerationCurrent: (candidate) => candidate === generation,
        retry,
        retryDelayMs: () => 10,
      });

      recovery.recordFailure(3);
      await vi.advanceTimersByTimeAsync(10);
      expect(retry).toHaveBeenCalledTimes(1);

      recovery.recordFailure(3);
      recovery.recordSuccess();
      await vi.advanceTimersByTimeAsync(10);
      expect(retry).toHaveBeenCalledTimes(1);

      recovery.recordFailure(3);
      generation = 4;
      await vi.advanceTimersByTimeAsync(10);
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

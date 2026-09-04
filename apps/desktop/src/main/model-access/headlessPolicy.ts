import type { ApiFetchOptions } from '../serverApiClient.js';
import { HEADLESS_POD_RUNTIME_ENV } from '../headless-startup.js';

export const HEADLESS_MODEL_ACCESS_TIMEOUT_MS = 15_000;
export const HEADLESS_MODEL_ACCESS_MAX_RETRY_DELAY_MS = 5 * 60_000;

/**
 * Keep the two fast retries used by Desktop, then continue recovering with a
 * capped backoff. A Pod has no user present to press Retry after a transient
 * tunnel or control-plane outage.
 */
export function headlessModelAccessRetryDelayMs(attempt: number): number {
  if (attempt <= 0) return 2_000;
  if (attempt === 1) return 8_000;
  return Math.min(
    30_000 * 2 ** Math.min(attempt - 2, 10),
    HEADLESS_MODEL_ACCESS_MAX_RETRY_DELAY_MS,
  );
}

export interface HeadlessModelCatalogRecovery {
  recordFailure(generation: number): void;
  recordSuccess(): void;
  cancel(): void;
}

/**
 * Keeps `/models` recovery independent from credential recovery. Credentials
 * can already be valid when a transient catalog request fails, so relying on a
 * later auth event would otherwise leave a headless Pod without routes forever.
 */
export function createHeadlessModelCatalogRecovery(input: {
  isGenerationCurrent(generation: number): boolean;
  retry(): void;
  retryDelayMs?(attempt: number): number;
}): HeadlessModelCatalogRecovery {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  const retryDelayMs = input.retryDelayMs ?? headlessModelAccessRetryDelayMs;

  const cancelTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    recordFailure(generation) {
      if (timer !== null || !input.isGenerationCurrent(generation)) return;
      const delayMs = retryDelayMs(attempt++);
      timer = setTimeout(() => {
        timer = null;
        if (input.isGenerationCurrent(generation)) input.retry();
      }, delayMs);
      timer.unref?.();
    },
    recordSuccess() {
      attempt = 0;
      cancelTimer();
    },
    cancel() {
      attempt = 0;
      cancelTimer();
    },
  };
}

/** Ordinary Desktop keeps Electron net.fetch and its existing no-deadline behavior. */
export function resolveModelAccessTransport(
  env: NodeJS.ProcessEnv,
  nodeFetch: typeof globalThis.fetch = globalThis.fetch,
): Pick<ApiFetchOptions, 'fetchImpl' | 'timeoutMs'> {
  if (env[HEADLESS_POD_RUNTIME_ENV] !== '1') return {};
  return {
    fetchImpl: nodeFetch,
    timeoutMs: HEADLESS_MODEL_ACCESS_TIMEOUT_MS,
  };
}

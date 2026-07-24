import type { CloudRuntimeLogger } from './controller.js';

export interface PodUserServicesInitializationDeps {
  refreshCustomProviders(): Promise<void>;
  startEmbeddingHost(): void;
  prewarmModelPricing(): Promise<void>;
  logger: Pick<CloudRuntimeLogger, 'warn'>;
}

/**
 * Runs renderer-independent, account-scoped initialization that the GUI
 * normally receives from localDb's renderer-driven onReady callback. Each
 * operation is best-effort so an optional service cannot make Pod bootstrap
 * fail after auth/database/Maker readiness has already succeeded.
 */
export async function initializePodUserServices(
  deps: PodUserServicesInitializationDeps,
): Promise<void> {
  try {
    await deps.refreshCustomProviders();
  } catch (error) {
    deps.logger.warn('Pod custom provider refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    deps.startEmbeddingHost();
  } catch (error) {
    deps.logger.warn('Pod embedding host initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  void deps.prewarmModelPricing().catch((error) => {
    deps.logger.warn('Pod model pricing prewarm failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

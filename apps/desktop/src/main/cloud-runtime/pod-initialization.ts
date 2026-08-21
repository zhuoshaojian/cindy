import type { CloudRuntimeLogger } from './controller.js';

export interface PodUserServicesInitializationDeps {
  refreshCustomProviders(): Promise<void>;
  startEmbeddingHost(): void;
  prewarmModelPricing(): Promise<void>;
  logger: Pick<CloudRuntimeLogger, 'warn'>;
}

/** barrier 交给 task 的句柄:发现完成后必须标记,否则下游消费者永不武装。 */
export interface PodReadinessHandle {
  markDiscoveryComplete(): boolean;
}

export interface PodAccountProviderReadinessDeps {
  scopeKey: string;
  refreshModels(): Promise<void>;
  startReadiness(
    scopeKey: string,
    task: (handle: PodReadinessHandle) => Promise<void>,
    onError: (error: unknown) => void,
  ): Promise<void>;
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

/**
 * Arm the same account-provider readiness barrier used by renderer-driven
 * Desktop startup. Headless startup opens the DB directly, so without this
 * bridge every remote create/send request remains fail-closed even after the
 * model-access catalog has already synchronized successfully.
 */
export function startPodAccountProviderReadiness(
  deps: PodAccountProviderReadinessDeps,
): void {
  // `startReadiness` installs the scope synchronously, then runs the network task
  // asynchronously. Remote Maker entry points await that barrier themselves;
  // Pod boot must continue so device-link can come online while model access is
  // temporarily unavailable.
  void deps.startReadiness(
    deps.scopeKey,
    async (handle) => {
      await deps.refreshModels();
      // 目录同步成功才算「发现完成」。不标记的话 barrier 的 waitForScope 恒为 false,
      // hook / IM / scheduler 这些下游消费者在 Pod 里永远不会武装 —— 表现就是远程
      // create/send 一直 fail-closed,而模型目录其实早就同步好了。
      handle.markDiscoveryComplete();
    },
    (error) => {
      deps.logger.warn('Pod account provider readiness refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

export const CLOUD_INSTANCES_REFRESH_INTERVAL_MS = 90_000;
export const CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS = 5_000;

interface CloudInstanceRefreshLoopDeps {
  isVisible(): boolean;
  isVerifying(): boolean;
  refresh(): Promise<void>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export interface CloudInstanceRefreshLoop {
  start(): void;
  stop(): void;
  visibilityChanged(): void;
  instancesChanged(): void;
}

/** One adaptive timer per mounted device screen; HTTP de-duplication stays in the hook. */
export function createCloudInstanceRefreshLoop(
  deps: CloudInstanceRefreshLoopDeps,
): CloudInstanceRefreshLoop {
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const schedule = (): void => {
    clear();
    if (!active) return;
    const delay = deps.isVisible() && deps.isVerifying()
      ? CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS
      : CLOUD_INSTANCES_REFRESH_INTERVAL_MS;
    timer = setTimer(() => {
      timer = null;
      void (async () => {
        if (deps.isVisible()) await deps.refresh();
        schedule();
      })();
    }, delay);
  };

  return {
    start() {
      if (active) return;
      active = true;
      schedule();
    },
    stop() {
      active = false;
      clear();
    },
    visibilityChanged() {
      if (!active) return;
      if (!deps.isVisible()) {
        schedule();
        return;
      }
      clear();
      void deps.refresh().finally(schedule);
    },
    instancesChanged() {
      schedule();
    },
  };
}

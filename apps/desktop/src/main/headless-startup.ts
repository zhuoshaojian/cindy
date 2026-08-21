import type { AgentBinaryReadiness } from './agent-binaries/ensure-ready.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV = 'XDT_POD_ACCOUNT_REFRESH_TOKEN_FILE';
export const POD_DEVICE_ID_ENV = 'XDT_POD_DEVICE_ID';
export const POD_USER_DATA_DIR_ENV = 'XDT_USER_DATA_DIR';
export const POD_WORKSPACES_DIR_ENV = 'XDT_POD_WORKSPACES_DIR';
export const DEFAULT_POD_WORKSPACES_DIR = '/var/lib/cindy/workspaces';
export const HEADLESS_POD_RUNTIME_ENV = 'CINDY_INTERNAL_HEADLESS_POD_RUNTIME';

export function isHeadlessMode(argv: readonly string[]): boolean {
  return argv.includes('--headless');
}

/**
 * A strict Pod launch inherits an image-owned PATH containing the pre-baked
 * agent binaries. Shell discovery is for interactive Desktop launches and can
 * erase that PATH when the container account intentionally uses `nologin`.
 */
export function shouldRefreshShellPath(headlessPodRuntime: boolean): boolean {
  return !headlessPodRuntime;
}

/**
 * Strict trust boundary for packaged Pod-only overrides. Ambient Desktop env
 * cannot opt a normal GUI launch into container credentials or storage.
 */
export function hasHeadlessPodRuntimeInput(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    isHeadlessMode(argv) &&
    Boolean(env[POD_DEVICE_ID_ENV]?.trim()) &&
    Boolean(env[POD_ACCOUNT_REFRESH_TOKEN_FILE_ENV]?.trim())
  );
}

export function resolvePodUserDataDir(
  headlessPodRuntime: boolean,
  env: NodeJS.ProcessEnv,
): string | null {
  if (!headlessPodRuntime) return null;
  const userDataDir = env[POD_USER_DATA_DIR_ENV]?.trim() ?? '';
  return userDataDir && path.isAbsolute(userDataDir) ? userDataDir : null;
}

export function resolvePodWorkspacesDir(
  headlessPodRuntime: boolean,
  env: NodeJS.ProcessEnv,
): string | null {
  if (!headlessPodRuntime) return null;
  const workspacesDir =
    env[POD_WORKSPACES_DIR_ENV]?.trim() || DEFAULT_POD_WORKSPACES_DIR;
  return path.isAbsolute(workspacesDir) ? workspacesDir : null;
}

/**
 * Normalize and create the persistent Pod project root before any remote
 * browse or session handler can observe it. The entrypoint performs the same
 * mkdir for image launches; this is the client-side guard for alternate Pod
 * launchers and keeps the exported environment canonical.
 */
export function ensurePodWorkspacesDir(
  headlessPodRuntime: boolean,
  env: NodeJS.ProcessEnv,
  ensureDirectory: (dir: string) => void = (dir) => {
    mkdirSync(dir, { recursive: true });
  },
): string | null {
  if (!headlessPodRuntime) return null;
  const workspacesDir = resolvePodWorkspacesDir(true, env);
  if (!workspacesDir) {
    throw new Error(`${POD_WORKSPACES_DIR_ENV} must be an absolute path`);
  }
  ensureDirectory(workspacesDir);
  env[POD_WORKSPACES_DIR_ENV] = workspacesDir;
  return workspacesDir;
}

export function resolvePodDeviceIdOverride(env: NodeJS.ProcessEnv): string | null {
  const deviceId = env[POD_DEVICE_ID_ENV]?.trim() ?? '';
  if (!deviceId) return null;
  if (deviceId.length > 128) {
    throw new Error(`${POD_DEVICE_ID_ENV} must be at most 128 characters`);
  }
  return deviceId;
}

export function shouldQuitWhenAllWindowsClosed(
  headless: boolean,
  platform: NodeJS.Platform,
): boolean {
  return !headless && platform !== 'darwin';
}

export function shouldCreateMainWindow(headless: boolean): boolean {
  return !headless;
}

export interface HeadlessStartupLogger {
  info: (message: string, context?: unknown) => void;
  error: (message: string, context?: unknown) => void;
}

export interface HeadlessStartupRetryPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  wait?: (delayMs: number) => Promise<void>;
  onFailure?: (
    error: unknown,
    context: { attempt: number; nextRetryMs: number },
  ) => void | Promise<void>;
}

export interface HeadlessStartupDeps {
  provisionSession?: () => Promise<boolean>;
  provisionRetry?: HeadlessStartupRetryPolicy;
  ensureBinariesReady: (
    linuxInstallSignal: AbortSignal | undefined,
  ) => Promise<AgentBinaryReadiness>;
  binaryRetry?: HeadlessStartupRetryPolicy;
  linuxInstallSignal?: AbortSignal;
  ensureMakerReady: () => Promise<void>;
  logger: HeadlessStartupLogger;
  exit: (code: number) => void;
}

function retryWait(
  policy: HeadlessStartupRetryPolicy,
  delayMs: number,
): Promise<void> {
  return policy.wait
    ? policy.wait(delayMs)
    : new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
}

function nextRetryDelay(
  policy: HeadlessStartupRetryPolicy,
  currentDelayMs: number,
): number {
  return Math.min(
    Math.max(currentDelayMs * 2, policy.initialDelayMs),
    policy.maxDelayMs,
  );
}

async function notifyRetryFailure(
  policy: HeadlessStartupRetryPolicy,
  error: unknown,
  context: { attempt: number; nextRetryMs: number },
  logger: HeadlessStartupLogger,
  step: 'provisioning' | 'binary preparation',
): Promise<void> {
  try {
    await policy.onFailure?.(error, context);
  } catch (observerError) {
    // Status sampling is observability, not part of the recovery operation.
    // A transient status-file failure must not terminate the Pod retry loop.
    logger.error(`headless ${step} retry observer failed; continuing`, {
      error:
        observerError instanceof Error
          ? observerError.message
          : String(observerError),
    });
  }
}

/**
 * Main-process headless bootstrap seam. The caller installs the Maker
 * readiness implementation before entering this function; binary preparation
 * then runs without a renderer, followed by Maker registration.
 */
export async function runHeadlessStartup(deps: HeadlessStartupDeps): Promise<boolean> {
  deps.logger.info('headless startup entered');
  const fail = (message: string, context?: unknown): false => {
    if (context === undefined) deps.logger.error(message);
    else deps.logger.error(message, context);
    deps.exit(1);
    return false;
  };

  if (deps.provisionSession) {
    let attempt = 0;
    let retryDelayMs = deps.provisionRetry?.initialDelayMs ?? 0;
    for (;;) {
      try {
        if (await deps.provisionSession()) {
          deps.logger.info('headless provisioned session ready');
        }
        break;
      } catch (err) {
        if (!deps.provisionRetry) {
          return fail('headless Pod provisioning failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        attempt += 1;
        const nextRetryMs = Math.min(retryDelayMs, deps.provisionRetry.maxDelayMs);
        deps.logger.error('headless Pod provisioning failed; retry scheduled', {
          attempt,
          nextRetryMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await notifyRetryFailure(
          deps.provisionRetry,
          err,
          { attempt, nextRetryMs },
          deps.logger,
          'provisioning',
        );
        await retryWait(deps.provisionRetry, nextRetryMs);
        retryDelayMs = nextRetryDelay(deps.provisionRetry, nextRetryMs);
      }
    }
  }

  let binaries: AgentBinaryReadiness;
  let binaryAttempt = 0;
  let binaryRetryDelayMs = deps.binaryRetry?.initialDelayMs ?? 0;
  for (;;) {
    let binaryFailure: unknown;
    try {
      binaries = await deps.ensureBinariesReady(deps.linuxInstallSignal);
      if (binaries.allPassed) break;
      binaryFailure = binaries;
    } catch (err) {
      if (!deps.binaryRetry) {
        return fail('headless agent binary preparation threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      binaryFailure = err;
    }
    if (!deps.binaryRetry) {
      return fail('headless agent binary preparation failed', binaryFailure);
    }
    binaryAttempt += 1;
    const nextRetryMs = Math.min(
      binaryRetryDelayMs,
      deps.binaryRetry.maxDelayMs,
    );
    deps.logger.error('headless agent binary preparation failed; retry scheduled', {
      attempt: binaryAttempt,
      nextRetryMs,
      error:
        binaryFailure instanceof Error
          ? binaryFailure.message
          : binaryFailure,
    });
    await notifyRetryFailure(
      deps.binaryRetry,
      binaryFailure,
      { attempt: binaryAttempt, nextRetryMs },
      deps.logger,
      'binary preparation',
    );
    await retryWait(deps.binaryRetry, nextRetryMs);
    binaryRetryDelayMs = nextRetryDelay(deps.binaryRetry, nextRetryMs);
  }
  deps.logger.info('headless agent binaries ready', binaries);

  try {
    await deps.ensureMakerReady();
  } catch (err) {
    return fail('headless Maker readiness failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  deps.logger.info('headless Maker ready');
  return true;
}

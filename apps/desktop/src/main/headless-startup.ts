import type { AgentBinaryReadiness } from './agent-binaries/ensure-ready.js';

export function isHeadlessMode(argv: readonly string[]): boolean {
  return argv.includes('--headless');
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

export interface HeadlessStartupDeps {
  provisionSession?: () => Promise<boolean>;
  ensureBinariesReady: (
    linuxInstallSignal: AbortSignal | undefined,
  ) => Promise<AgentBinaryReadiness>;
  linuxInstallSignal?: AbortSignal;
  ensureMakerReady: () => Promise<void>;
  logger: HeadlessStartupLogger;
  exit: (code: number) => void;
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
    try {
      if (await deps.provisionSession()) {
        deps.logger.info('headless provisioned session ready');
      }
    } catch (err) {
      return fail('headless Pod provisioning failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let binaries: AgentBinaryReadiness;
  try {
    binaries = await deps.ensureBinariesReady(deps.linuxInstallSignal);
  } catch (err) {
    return fail('headless agent binary preparation threw', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!binaries.allPassed) {
    return fail('headless agent binary preparation failed', binaries);
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

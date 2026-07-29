import type { AgentBinaryKind, PrepareResult } from './index.js';
import type { PrepareOpts } from './types.js';

export interface AgentBinaryReadiness {
  claudeCode:
    | { status: 'passed'; path: string }
    | { status: 'failed'; error: string }
    | { status: 'skipped' };
  codex:
    | { status: 'passed'; path: string }
    | { status: 'failed'; error: string }
    | { status: 'skipped' };
  pi:
    | { status: 'passed'; path: string }
    | { status: 'failed'; error: string }
    | { status: 'skipped' };
  allPassed: boolean;
  platform: 'darwin' | 'win32' | 'linux';
}

export interface EnsureAgentBinariesReadyDeps {
  platform: AgentBinaryReadiness['platform'];
  linuxInstallSignal?: AbortSignal;
  peekNeedsDownload: (kind: AgentBinaryKind) => Promise<boolean>;
  prepare: (kind: AgentBinaryKind, opts?: PrepareOpts) => Promise<PrepareResult>;
  broadcastResetForStep: (
    kind: AgentBinaryKind,
    step: 1 | 2 | 3,
    totalSteps: 2 | 3,
  ) => void;
  getPiInstallSignal?: () => AbortSignal | undefined;
  isPiDisabledForLaunch?: () => boolean;
  onPiPrepareFailed?: (error: string) => void;
}

export interface EnsureBinariesReadyProviderDeps {
  peekNeedsDownload: (kind: AgentBinaryKind) => Promise<boolean>;
  prepare: (kind: AgentBinaryKind, opts?: PrepareOpts) => Promise<PrepareResult>;
  broadcastResetForStep: EnsureAgentBinariesReadyDeps['broadcastResetForStep'];
  getPiInstallSignal?: () => AbortSignal | undefined;
  isPiDisabledForLaunch?: () => boolean;
  onPiPrepareFailed?: (error: string) => void;
}

/** Share one startup deadline across sequential packaged-Linux installs. */
export function getLinuxInstallSignal(
  platform: AgentBinaryReadiness['platform'],
  isPackaged: boolean,
  deadlineMs: number,
): AbortSignal | undefined {
  return platform === 'linux' && isPackaged
    ? AbortSignal.timeout(deadlineMs)
    : undefined;
}

/** Bind the stable platform and binary operations for GUI/headless callers. */
export function createEnsureBinariesReady(
  platform: AgentBinaryReadiness['platform'],
  deps: EnsureBinariesReadyProviderDeps,
): (linuxInstallSignal: AbortSignal | undefined) => Promise<AgentBinaryReadiness> {
  return (linuxInstallSignal) =>
    ensureAgentBinariesReady({
      platform,
      linuxInstallSignal,
      ...deps,
    });
}

export interface CheckEnvironmentHandlerDeps {
  markRendererAlive: () => void;
  getLinuxInstallSignal: () => AbortSignal | undefined;
  ensureBinariesReady: (
    linuxInstallSignal: AbortSignal | undefined,
  ) => Promise<AgentBinaryReadiness>;
  ensureMakerReady: () => Promise<void>;
}

/**
 * Build the renderer-facing environment check from independently callable
 * main-process readiness steps.
 */
export function createCheckEnvironmentHandler(
  deps: CheckEnvironmentHandlerDeps,
): () => Promise<AgentBinaryReadiness> {
  return async () => {
    deps.markRendererAlive();
    const binaries = await deps.ensureBinariesReady(deps.getLinuxInstallSignal());
    if (!binaries.allPassed) return binaries;
    await deps.ensureMakerReady();
    return binaries;
  };
}

/**
 * Provision the required Claude/Codex binaries and optional Pi binary in the
 * same order and with the same progress semantics as the renderer splash check.
 * The dependencies are injected so
 * main-side callers (including a future headless bootstrap) can invoke this
 * step without an IPC event or Electron renderer.
 */
export async function ensureAgentBinariesReady(
  deps: EnsureAgentBinariesReadyDeps,
): Promise<AgentBinaryReadiness> {
  const {
    platform,
    linuxInstallSignal,
    peekNeedsDownload,
    prepare,
    broadcastResetForStep,
    getPiInstallSignal,
    isPiDisabledForLaunch,
    onPiPrepareFailed,
  } = deps;

  const needySteps: AgentBinaryKind[] = [];
  for (const kind of ['claude-code', 'codex', 'pi'] as const) {
    try {
      if (await peekNeedsDownload(kind)) needySteps.push(kind);
    } catch {
      // prepare() below owns the real error path; failed peeks do not invent a
      // progress segment that may never download.
    }
  }
  const isMultiDownload = needySteps.length >= 2;
  const totalSteps = Math.min(needySteps.length, 3) as 2 | 3;
  const stepOptsFor = (
    kind: AgentBinaryKind,
  ): { step?: 1 | 2 | 3; totalSteps?: 2 | 3 } =>
    isMultiDownload && needySteps.includes(kind)
      ? {
          step: (needySteps.indexOf(kind) + 1) as 1 | 2 | 3,
          totalSteps,
        }
      : {};
  const resetBeforeSegment = (
    kind: AgentBinaryKind,
    anyPreviousDownloaded: boolean,
  ): void => {
    const stepOpts = stepOptsFor(kind);
    if (anyPreviousDownloaded && stepOpts.step && stepOpts.totalSteps) {
      broadcastResetForStep(kind, stepOpts.step, stepOpts.totalSteps);
    }
  };

  let claudeRes: PrepareResult;
  try {
    claudeRes = await prepare(
      'claude-code',
      { ...stepOptsFor('claude-code'), signal: linuxInstallSignal },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      claudeCode: { status: 'failed', error: message },
      codex: { status: 'skipped' },
      pi: { status: 'skipped' },
      allPassed: false,
      platform,
    };
  }

  if (!claudeRes.ready || !claudeRes.path) {
    return {
      claudeCode: {
        status: 'failed',
        error: claudeRes.error ?? 'Claude Code binary not available',
      },
      codex: { status: 'skipped' },
      pi: { status: 'skipped' },
      allPassed: false,
      platform,
    };
  }

  resetBeforeSegment('codex', claudeRes.downloaded === true);

  let codexRes: PrepareResult;
  try {
    codexRes = await prepare(
      'codex',
      { ...stepOptsFor('codex'), signal: linuxInstallSignal },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      claudeCode: { status: 'passed', path: claudeRes.path },
      codex: { status: 'failed', error: message },
      pi: { status: 'skipped' },
      allPassed: false,
      platform,
    };
  }

  if (!codexRes.ready || !codexRes.path) {
    return {
      claudeCode: { status: 'passed', path: claudeRes.path },
      codex: {
        status: 'failed',
        error: codexRes.error ?? 'Codex binary not available',
      },
      pi: { status: 'skipped' },
      allPassed: false,
      platform,
    };
  }

  resetBeforeSegment(
    'pi',
    claudeRes.downloaded === true || codexRes.downloaded === true,
  );

  let piInfo: AgentBinaryReadiness['pi'];
  if (isPiDisabledForLaunch?.() === true) {
    piInfo = {
      status: 'failed',
      error: 'pi disabled for this launch after an earlier prepare failure',
    };
  } else {
    try {
      const piRes = await prepare('pi', {
        ...stepOptsFor('pi'),
        broadcastFailure: false,
        signal: getPiInstallSignal?.(),
      });
      piInfo =
        piRes.ready && piRes.path
          ? { status: 'passed', path: piRes.path }
          : {
              status: 'failed',
              error: piRes.error ?? 'pi binary not available',
            };
    } catch (err: unknown) {
      piInfo = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  if (piInfo.status === 'failed') onPiPrepareFailed?.(piInfo.error);

  return {
    claudeCode: { status: 'passed', path: claudeRes.path },
    codex: { status: 'passed', path: codexRes.path },
    pi: piInfo,
    allPassed: true,
    platform,
  };
}

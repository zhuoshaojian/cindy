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
  allPassed: boolean;
  platform: 'darwin' | 'win32' | 'linux';
}

export interface EnsureAgentBinariesReadyDeps {
  platform: AgentBinaryReadiness['platform'];
  linuxInstallSignal?: AbortSignal;
  peekNeedsDownload: (kind: AgentBinaryKind) => Promise<boolean>;
  prepare: (kind: AgentBinaryKind, opts?: PrepareOpts) => Promise<PrepareResult>;
  broadcastResetForStep2: (kind: AgentBinaryKind) => void;
}

export interface EnsureBinariesReadyProviderDeps {
  peekNeedsDownload: (kind: AgentBinaryKind) => Promise<boolean>;
  prepare: (kind: AgentBinaryKind, opts?: PrepareOpts) => Promise<PrepareResult>;
  broadcastResetForStep2: (kind: AgentBinaryKind) => void;
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
 * Provision both agent binaries in the same order and with the same progress
 * semantics as the renderer splash check. The dependencies are injected so
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
    broadcastResetForStep2,
  } = deps;

  // Peek both vendors first so the splash can show a two-step progress label
  // only when both downloads are actually needed.
  let claudeNeeds = false;
  let codexNeeds = false;
  try {
    claudeNeeds = await peekNeedsDownload('claude-code');
  } catch {
    // A failed peek is handled by prepare() below; conservatively avoid the
    // two-step label when we cannot prove that both downloads are needed.
  }
  try {
    codexNeeds = await peekNeedsDownload('codex');
  } catch {
    // Same fallback as the Claude peek.
  }
  const isMultiDownload = claudeNeeds && codexNeeds;

  let claudeRes: PrepareResult;
  try {
    claudeRes = await prepare(
      'claude-code',
      isMultiDownload
        ? { step: 1, totalSteps: 2, signal: linuxInstallSignal }
        : { signal: linuxInstallSignal },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      claudeCode: { status: 'failed', error: message },
      codex: { status: 'skipped' },
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
      allPassed: false,
      platform,
    };
  }

  // Reset the splash progress before beginning codex when both downloads are
  // active, preserving the existing two-stage visual behavior.
  if (isMultiDownload && claudeRes.downloaded) {
    broadcastResetForStep2('codex');
  }

  let codexRes: PrepareResult;
  try {
    codexRes = await prepare(
      'codex',
      isMultiDownload
        ? { step: 2, totalSteps: 2, signal: linuxInstallSignal }
        : { signal: linuxInstallSignal },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      claudeCode: { status: 'passed', path: claudeRes.path },
      codex: { status: 'failed', error: message },
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
      allPassed: false,
      platform,
    };
  }

  return {
    claudeCode: { status: 'passed', path: claudeRes.path },
    codex: { status: 'passed', path: codexRes.path },
    allPassed: true,
    platform,
  };
}

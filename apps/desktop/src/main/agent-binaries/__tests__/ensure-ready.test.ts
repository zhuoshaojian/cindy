import { describe, expect, it, vi } from 'vitest';

import {
  createCheckEnvironmentHandler,
  createEnsureBinariesReady,
  ensureAgentBinariesReady,
  getLinuxInstallSignal,
  type AgentBinaryReadiness,
} from '../ensure-ready.js';
import type { AgentBinaryKind } from '../index.js';

class MemoryIpcHarness {
  private readonly handlers = new Map<string, () => Promise<unknown>>();

  handle(channel: string, handler: () => Promise<unknown>): void {
    this.handlers.set(channel, handler);
  }

  async invoke<T>(channel: string): Promise<T> {
    const handler = this.handlers.get(channel);
    if (handler == null) throw new Error(`No handler registered for ${channel}`);
    return handler() as Promise<T>;
  }
}

function deps(overrides: Partial<Parameters<typeof ensureAgentBinariesReady>[0]> = {}) {
  return {
    platform: 'linux' as const,
    peekNeedsDownload: vi.fn(async () => false),
    prepare: vi.fn(async (kind: AgentBinaryKind) => ({
      ready: true,
      path: `/tmp/${kind}`,
      downloaded: false,
    })),
    broadcastResetForStep: vi.fn(),
    ...overrides,
  };
}

describe('ensureAgentBinariesReady', () => {
  it('provisions Claude, Codex, then optional Pi and returns their paths', async () => {
    const callOrder: string[] = [];
    const d = deps({
      peekNeedsDownload: vi.fn(async (kind) => {
        callOrder.push(`peek:${kind}`);
        return false;
      }),
      prepare: vi.fn(async (kind) => {
        callOrder.push(`prepare:${kind}`);
        return { ready: true, path: `/tmp/${kind}`, downloaded: false };
      }),
    });

    await expect(ensureAgentBinariesReady(d)).resolves.toEqual({
      claudeCode: { status: 'passed', path: '/tmp/claude-code' },
      codex: { status: 'passed', path: '/tmp/codex' },
      pi: { status: 'passed', path: '/tmp/pi' },
      allPassed: true,
      platform: 'linux',
    });
    expect(callOrder).toEqual([
      'peek:claude-code',
      'peek:codex',
      'peek:pi',
      'prepare:claude-code',
      'prepare:codex',
      'prepare:pi',
    ]);
  });

  it('returns a Claude failure and skips Codex when prepare throws', async () => {
    const d = deps({
      prepare: vi.fn(async () => {
        throw new Error('install failed');
      }),
    });

    await expect(ensureAgentBinariesReady(d)).resolves.toMatchObject({
      claudeCode: { status: 'failed', error: 'install failed' },
      codex: { status: 'skipped' },
      pi: { status: 'skipped' },
      allPassed: false,
    });
    expect(d.prepare).toHaveBeenCalledTimes(1);
  });

  it('resets progress between three downloads and forwards step options', async () => {
    const signal = new AbortController().signal;
    const d = deps({
      linuxInstallSignal: signal,
      peekNeedsDownload: vi.fn(async () => true),
      prepare: vi
        .fn()
        .mockResolvedValueOnce({ ready: true, path: '/tmp/claude', downloaded: true })
        .mockResolvedValueOnce({ ready: true, path: '/tmp/codex', downloaded: true })
        .mockResolvedValueOnce({ ready: true, path: '/tmp/pi', downloaded: true }),
    });

    await expect(ensureAgentBinariesReady(d)).resolves.toMatchObject({ allPassed: true });
    expect(d.broadcastResetForStep).toHaveBeenNthCalledWith(1, 'codex', 2, 3);
    expect(d.broadcastResetForStep).toHaveBeenNthCalledWith(2, 'pi', 3, 3);
    expect(d.prepare).toHaveBeenNthCalledWith(1, 'claude-code', {
      step: 1,
      totalSteps: 3,
      signal,
    });
    expect(d.prepare).toHaveBeenNthCalledWith(2, 'codex', {
      step: 2,
      totalSteps: 3,
      signal,
    });
    expect(d.prepare).toHaveBeenNthCalledWith(3, 'pi', {
      step: 3,
      totalSteps: 3,
      broadcastFailure: false,
      signal: undefined,
    });
  });

  it('keeps Pi failure non-fatal and disables it through the launch callback', async () => {
    const onPiPrepareFailed = vi.fn();
    const d = deps({
      prepare: vi.fn(async (kind: AgentBinaryKind) =>
        kind === 'pi'
          ? { ready: false, error: 'asset missing' }
          : { ready: true, path: `/tmp/${kind}`, downloaded: false },
      ),
      onPiPrepareFailed,
    });

    await expect(ensureAgentBinariesReady(d)).resolves.toMatchObject({
      pi: { status: 'failed', error: 'asset missing' },
      allPassed: true,
    });
    expect(onPiPrepareFailed).toHaveBeenCalledWith('asset missing');
  });

  /**
   * A cloud instance loses the manifest race against its own egress at boot,
   * and one such failure used to disable pi for a launch lasting days.
   */
  it('retries a transient Pi manifest failure and reports the later success', async () => {
    let piAttempts = 0;
    const onRetry = vi.fn();
    const onPiPrepareFailed = vi.fn();
    const d = deps({
      prepare: vi.fn(async (kind: AgentBinaryKind) => {
        if (kind !== 'pi') return { ready: true, path: `/tmp/${kind}`, downloaded: false };
        piAttempts += 1;
        return piAttempts === 1
          ? { ready: false, error: 'manifest_failed' }
          : { ready: true, path: '/data/pi/0.83.0/pi', downloaded: true };
      }),
      onPiPrepareFailed,
      piPrepareRetry: {
        attempts: 3,
        delayMs: () => 0,
        shouldRetry: (error: string) => error.includes('manifest'),
        onRetry,
      },
    });

    await expect(ensureAgentBinariesReady(d)).resolves.toMatchObject({
      pi: { status: 'passed', path: '/data/pi/0.83.0/pi' },
    });
    expect(piAttempts).toBe(2);
    expect(onRetry).toHaveBeenCalledWith('manifest_failed', 1);
    // The launch must not be marked pi-disabled by an attempt that later won.
    expect(onPiPrepareFailed).not.toHaveBeenCalled();
  });

  /**
   * Each attempt carries its own install deadline, so replaying a download that
   * already timed out would multiply startup by the retry count.
   */
  it('does not retry a Pi failure the caller judged non-transient', async () => {
    let piAttempts = 0;
    const d = deps({
      prepare: vi.fn(async (kind: AgentBinaryKind) => {
        if (kind !== 'pi') return { ready: true, path: `/tmp/${kind}`, downloaded: false };
        piAttempts += 1;
        return { ready: false, error: 'download timed out' };
      }),
      piPrepareRetry: {
        attempts: 3,
        delayMs: () => 0,
        shouldRetry: (error: string) => error.includes('manifest'),
      },
    });

    await expect(ensureAgentBinariesReady(d)).resolves.toMatchObject({
      pi: { status: 'failed', error: 'download timed out' },
    });
    expect(piAttempts).toBe(1);
  });

  it('gives up after the retry budget and still keeps the launch alive', async () => {
    let piAttempts = 0;
    const onPiPrepareFailed = vi.fn();
    const d = deps({
      prepare: vi.fn(async (kind: AgentBinaryKind) => {
        if (kind !== 'pi') return { ready: true, path: `/tmp/${kind}`, downloaded: false };
        piAttempts += 1;
        return { ready: false, error: 'manifest_failed' };
      }),
      onPiPrepareFailed,
      piPrepareRetry: {
        attempts: 3,
        delayMs: () => 0,
        shouldRetry: () => true,
      },
    });

    await expect(ensureAgentBinariesReady(d)).resolves.toMatchObject({
      pi: { status: 'failed', error: 'manifest_failed' },
      allPassed: true,
    });
    expect(piAttempts).toBe(3);
    expect(onPiPrepareFailed).toHaveBeenCalledWith('manifest_failed');
  });
});

describe('binary readiness dependency helpers', () => {
  it('creates a shared startup deadline only for packaged Linux', () => {
    expect(getLinuxInstallSignal('darwin', true, 10_000)).toBeUndefined();
    expect(getLinuxInstallSignal('linux', false, 10_000)).toBeUndefined();
    expect(getLinuxInstallSignal('linux', true, 10_000)).toBeInstanceOf(AbortSignal);
  });

  it('binds platform and binary dependencies into a reusable provider', async () => {
    const signal = new AbortController().signal;
    const d = deps();
    const ensureReady = createEnsureBinariesReady('linux', {
      peekNeedsDownload: d.peekNeedsDownload,
      prepare: d.prepare,
      broadcastResetForStep: d.broadcastResetForStep,
    });

    await expect(ensureReady(signal)).resolves.toMatchObject({
      allPassed: true,
      platform: 'linux',
    });
    expect(d.prepare).toHaveBeenNthCalledWith(1, 'claude-code', { signal });
    expect(d.prepare).toHaveBeenNthCalledWith(2, 'codex', { signal });
    expect(d.prepare).toHaveBeenNthCalledWith(3, 'pi', {
      broadcastFailure: false,
      signal: undefined,
    });
  });
});

describe('createCheckEnvironmentHandler', () => {
  const passed: AgentBinaryReadiness = {
    claudeCode: { status: 'passed', path: '/tmp/claude' },
    codex: { status: 'passed', path: '/tmp/codex' },
    pi: { status: 'passed', path: '/tmp/pi' },
    allPassed: true,
    platform: 'linux',
  };

  it('preserves renderer invocation order before returning the binary result', async () => {
    const calls: string[] = [];
    const signal = new AbortController().signal;
    const harness = new MemoryIpcHarness();
    harness.handle(
      'check-environment',
      createCheckEnvironmentHandler({
        markRendererAlive: () => calls.push('renderer-alive'),
        getLinuxInstallSignal: () => {
          calls.push('install-signal');
          return signal;
        },
        ensureBinariesReady: async (receivedSignal) => {
          calls.push('binaries-ready');
          expect(receivedSignal).toBe(signal);
          return passed;
        },
        ensureMakerReady: async () => {
          calls.push('maker-ready');
        },
      }),
    );

    await expect(
      harness.invoke<AgentBinaryReadiness>('check-environment'),
    ).resolves.toBe(passed);
    expect(calls).toEqual([
      'renderer-alive',
      'install-signal',
      'binaries-ready',
      'maker-ready',
    ]);
  });

  it('does not construct Maker when binary preparation fails', async () => {
    const failed: AgentBinaryReadiness = {
      claudeCode: { status: 'failed', error: 'missing' },
      codex: { status: 'skipped' },
      pi: { status: 'skipped' },
      allPassed: false,
      platform: 'darwin',
    };
    const ensureMaker = vi.fn(async () => {});
    const harness = new MemoryIpcHarness();
    harness.handle(
      'check-environment',
      createCheckEnvironmentHandler({
        markRendererAlive: vi.fn(),
        getLinuxInstallSignal: () => undefined,
        ensureBinariesReady: async () => failed,
        ensureMakerReady: ensureMaker,
      }),
    );

    await expect(
      harness.invoke<AgentBinaryReadiness>('check-environment'),
    ).resolves.toBe(failed);
    expect(ensureMaker).not.toHaveBeenCalled();
  });
});

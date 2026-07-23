import { describe, expect, it, vi } from 'vitest';

import {
  createCheckEnvironmentHandler,
  createEnsureBinariesReady,
  ensureAgentBinariesReady,
  getLinuxInstallSignal,
  type AgentBinaryReadiness,
} from '../ensure-ready.js';

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
    prepare: vi.fn(async (kind: 'claude-code' | 'codex') => ({
      ready: true,
      path: `/tmp/${kind}`,
      downloaded: false,
    })),
    broadcastResetForStep2: vi.fn(),
    ...overrides,
  };
}

describe('ensureAgentBinariesReady', () => {
  it('provisions Claude before Codex and returns both paths', async () => {
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
      allPassed: true,
      platform: 'linux',
    });
    expect(callOrder).toEqual([
      'peek:claude-code',
      'peek:codex',
      'prepare:claude-code',
      'prepare:codex',
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
      allPassed: false,
    });
    expect(d.prepare).toHaveBeenCalledTimes(1);
  });

  it('resets progress between two downloads and forwards step options', async () => {
    const signal = new AbortController().signal;
    const d = deps({
      linuxInstallSignal: signal,
      peekNeedsDownload: vi.fn(async () => true),
      prepare: vi
        .fn()
        .mockResolvedValueOnce({ ready: true, path: '/tmp/claude', downloaded: true })
        .mockResolvedValueOnce({ ready: true, path: '/tmp/codex', downloaded: true }),
    });

    await expect(ensureAgentBinariesReady(d)).resolves.toMatchObject({ allPassed: true });
    expect(d.broadcastResetForStep2).toHaveBeenCalledWith('codex');
    expect(d.prepare).toHaveBeenNthCalledWith(1, 'claude-code', {
      step: 1,
      totalSteps: 2,
      signal,
    });
    expect(d.prepare).toHaveBeenNthCalledWith(2, 'codex', {
      step: 2,
      totalSteps: 2,
      signal,
    });
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
      broadcastResetForStep2: d.broadcastResetForStep2,
    });

    await expect(ensureReady(signal)).resolves.toMatchObject({
      allPassed: true,
      platform: 'linux',
    });
    expect(d.prepare).toHaveBeenNthCalledWith(1, 'claude-code', { signal });
    expect(d.prepare).toHaveBeenNthCalledWith(2, 'codex', { signal });
  });
});

describe('createCheckEnvironmentHandler', () => {
  const passed: AgentBinaryReadiness = {
    claudeCode: { status: 'passed', path: '/tmp/claude' },
    codex: { status: 'passed', path: '/tmp/codex' },
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

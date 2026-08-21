import { describe, expect, it, vi } from 'vitest';

import {
  isHeadlessMode,
  runHeadlessStartup,
  shouldCreateMainWindow,
  shouldQuitWhenAllWindowsClosed,
  shouldRefreshShellPath,
  type HeadlessStartupDeps,
} from '../headless-startup.js';
import type { AgentBinaryReadiness } from '../agent-binaries/ensure-ready.js';

const ready: AgentBinaryReadiness = {
  claudeCode: { status: 'passed', path: '/tmp/claude' },
  codex: { status: 'passed', path: '/tmp/codex' },
  pi: { status: 'passed', path: '/tmp/pi' },
  allPassed: true,
  platform: 'darwin',
};

function deps(overrides: Partial<HeadlessStartupDeps> = {}): HeadlessStartupDeps {
  return {
    ensureBinariesReady: vi.fn(async () => ready),
    linuxInstallSignal: undefined,
    ensureMakerReady: vi.fn(async () => {}),
    logger: { info: vi.fn(), error: vi.fn() },
    exit: vi.fn(),
    ...overrides,
  };
}

describe('isHeadlessMode', () => {
  it('recognizes the exact --headless flag', () => {
    expect(isHeadlessMode(['electron', '--headless'])).toBe(true);
    expect(isHeadlessMode(['electron', '--headless=true'])).toBe(false);
    expect(isHeadlessMode(['electron'])).toBe(false);
  });
});

describe('shouldQuitWhenAllWindowsClosed', () => {
  it('keeps headless processes alive on both desktop platforms', () => {
    expect(shouldQuitWhenAllWindowsClosed(true, 'darwin')).toBe(false);
    expect(shouldQuitWhenAllWindowsClosed(true, 'win32')).toBe(false);
  });

  it('preserves GUI platform behavior', () => {
    expect(shouldQuitWhenAllWindowsClosed(false, 'darwin')).toBe(false);
    expect(shouldQuitWhenAllWindowsClosed(false, 'win32')).toBe(true);
  });
});

describe('shouldCreateMainWindow', () => {
  it('keeps the existing GUI branch and skips only headless windows', () => {
    expect(shouldCreateMainWindow(false)).toBe(true);
    expect(shouldCreateMainWindow(true)).toBe(false);
  });
});

describe('shouldRefreshShellPath', () => {
  it('preserves the image-owned binary PATH only for strict Pod runtime launches', () => {
    expect(shouldRefreshShellPath(true)).toBe(false);
    expect(shouldRefreshShellPath(false)).toBe(true);
  });
});

describe('runHeadlessStartup', () => {
  it('prepares binaries before Maker, without creating a window', async () => {
    const calls: string[] = [];
    const d = deps({
      ensureBinariesReady: async () => {
        calls.push('binaries');
        return ready;
      },
      ensureMakerReady: async () => {
        calls.push('maker');
      },
    });

    await expect(runHeadlessStartup(d)).resolves.toBe(true);
    expect(calls).toEqual(['binaries', 'maker']);
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('provisions the session before binaries and Maker', async () => {
    const calls: string[] = [];
    const d = deps({
      provisionSession: async () => {
        calls.push('provision');
        return true;
      },
      ensureBinariesReady: async () => {
        calls.push('binaries');
        return ready;
      },
      ensureMakerReady: async () => {
        calls.push('maker');
      },
    });

    await expect(runHeadlessStartup(d)).resolves.toBe(true);
    expect(calls).toEqual(['provision', 'binaries', 'maker']);
  });

  it('exits on provisioning failure without preparing binaries or Maker', async () => {
    const ensureBinariesReady = vi.fn(async () => ready);
    const ensureMakerReady = vi.fn(async () => {});
    const d = deps({
      provisionSession: async () => {
        throw new Error('invalid provision token');
      },
      ensureBinariesReady,
      ensureMakerReady,
    });

    await expect(runHeadlessStartup(d)).resolves.toBe(false);
    expect(ensureBinariesReady).not.toHaveBeenCalled();
    expect(ensureMakerReady).not.toHaveBeenCalled();
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('keeps a Pod process alive and retries provisioning with capped exponential backoff', async () => {
    const waits: number[] = [];
    const failures: Array<{ attempt: number; nextRetryMs: number }> = [];
    const provisionSession = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('mounted token is stale'))
      .mockRejectedValueOnce(new Error('secret has not synced yet'))
      .mockResolvedValue(true);
    const d = deps({
      provisionSession,
      provisionRetry: {
        initialDelayMs: 1_000,
        maxDelayMs: 5_000,
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
        onFailure: async (_error, context) => {
          failures.push(context);
        },
      },
    });

    await expect(runHeadlessStartup(d)).resolves.toBe(true);
    expect(provisionSession).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1_000, 2_000]);
    expect(failures).toEqual([
      { attempt: 1, nextRetryMs: 1_000 },
      { attempt: 2, nextRetryMs: 2_000 },
    ]);
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('caps Pod provisioning retry delay', async () => {
    const waits: number[] = [];
    let attempts = 0;
    const d = deps({
      provisionSession: async () => {
        attempts += 1;
        if (attempts <= 4) throw new Error('still unavailable');
        return true;
      },
      provisionRetry: {
        initialDelayMs: 2_000,
        maxDelayMs: 5_000,
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      },
    });

    await expect(runHeadlessStartup(d)).resolves.toBe(true);
    expect(waits).toEqual([2_000, 4_000, 5_000, 5_000]);
  });

  it('exits without constructing Maker when binaries fail', async () => {
    const ensureMakerReady = vi.fn(async () => {});
    const d = deps({
      ensureBinariesReady: async () => ({
        ...ready,
        allPassed: false,
        claudeCode: { status: 'failed', error: 'missing' },
      }),
      ensureMakerReady,
    });

    await expect(runHeadlessStartup(d)).resolves.toBe(false);
    expect(ensureMakerReady).not.toHaveBeenCalled();
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('keeps a Pod process alive and retries failed binary readiness with capped backoff', async () => {
    const waits: number[] = [];
    const failures: Array<{ attempt: number; nextRetryMs: number }> = [];
    const failed: AgentBinaryReadiness = {
      ...ready,
      allPassed: false,
      claudeCode: { status: 'failed', error: 'agent runtime offline' },
      codex: { status: 'skipped' },
    };
    const ensureBinariesReady = vi
      .fn<(signal: AbortSignal | undefined) => Promise<AgentBinaryReadiness>>()
      .mockResolvedValueOnce(failed)
      .mockRejectedValueOnce(new Error('temporary probe failure'))
      .mockResolvedValue(ready);
    const d = deps({
      ensureBinariesReady,
      binaryRetry: {
        initialDelayMs: 2_000,
        maxDelayMs: 3_000,
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
        onFailure: async (_error, context) => {
          failures.push(context);
        },
      },
    });

    await expect(runHeadlessStartup(d)).resolves.toBe(true);
    expect(ensureBinariesReady).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2_000, 3_000]);
    expect(failures).toEqual([
      { attempt: 1, nextRetryMs: 2_000 },
      { attempt: 2, nextRetryMs: 3_000 },
    ]);
    expect(d.ensureMakerReady).toHaveBeenCalledOnce();
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('keeps binary recovery alive when readiness status sampling also fails', async () => {
    const d = deps({
      ensureBinariesReady: vi
        .fn<(signal: AbortSignal | undefined) => Promise<AgentBinaryReadiness>>()
        .mockRejectedValueOnce(new Error('binary probe failed'))
        .mockResolvedValue(ready),
      binaryRetry: {
        initialDelayMs: 1,
        maxDelayMs: 1,
        wait: async () => {},
        onFailure: async () => {
          throw new Error('status file temporarily unavailable');
        },
      },
    });

    await expect(runHeadlessStartup(d)).resolves.toBe(true);
    expect(d.logger.error).toHaveBeenCalledWith(
      'headless binary preparation retry observer failed; continuing',
      { error: 'status file temporarily unavailable' },
    );
    expect(d.exit).not.toHaveBeenCalled();
  });
});

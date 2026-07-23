import { describe, expect, it, vi } from 'vitest';

import {
  isHeadlessMode,
  runHeadlessStartup,
  shouldCreateMainWindow,
  shouldQuitWhenAllWindowsClosed,
  type HeadlessStartupDeps,
} from '../headless-startup.js';
import type { AgentBinaryReadiness } from '../agent-binaries/ensure-ready.js';

const ready: AgentBinaryReadiness = {
  claudeCode: { status: 'passed', path: '/tmp/claude' },
  codex: { status: 'passed', path: '/tmp/codex' },
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

});

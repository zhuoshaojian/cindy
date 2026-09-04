import { describe, expect, it, vi } from 'vitest';

import {
  startAccountReadinessConsumers,
  type AccountIntegrationStartupDeps,
} from '../accountIntegrationStartup';

function createDeps(
  overrides: Partial<AccountIntegrationStartupDeps> = {},
): AccountIntegrationStartupDeps {
  return {
    isOwnerCurrent: vi.fn(() => true),
    startHookControlAccount: vi.fn(),
    startImConnection: vi.fn(),
    startScheduler: vi.fn(),
    startEmbeddingHost: vi.fn(),
    log: { warn: vi.fn() },
    ...overrides,
  };
}

describe('startAccountReadinessConsumers', () => {
  it('starts Feishu IM from the authoritative owner DB-ready boundary', () => {
    const deps = createDeps();

    expect(startAccountReadinessConsumers('owner-a', deps)).toBe(true);

    expect(deps.startHookControlAccount).toHaveBeenCalledOnce();
    expect(deps.startImConnection).toHaveBeenCalledOnce();
    expect(deps.log.warn).not.toHaveBeenCalled();
  });

  /**
   * The cloud regression this list exists to prevent: a caller that starts the
   * ingress transports but forgets the hosts leaves automations dead, and a
   * scheduler that never starts also makes its activity counters unreadable,
   * so the instance stays `activity-unknown` and never auto-updates.
   */
  it('starts the scheduler and embedding hosts, not just the ingress transports', () => {
    const deps = createDeps();

    startAccountReadinessConsumers('owner-a', deps);

    expect(deps.startScheduler).toHaveBeenCalledOnce();
    expect(deps.startEmbeddingHost).toHaveBeenCalledOnce();
  });

  it('still starts Feishu IM when Hook activation throws', () => {
    const deps = createDeps({
      startHookControlAccount: vi.fn(() => {
        throw new Error('invalid hook endpoint');
      }),
    });

    startAccountReadinessConsumers('owner-a', deps);

    expect(deps.startImConnection).toHaveBeenCalledOnce();
    expect(deps.log.warn).toHaveBeenCalledWith(
      'hook-control activation after owner DB ready failed (non-fatal)',
      { error: 'invalid hook endpoint' },
    );
  });

  it('contains Feishu IM activation failures so DB readiness can complete', () => {
    const deps = createDeps({
      startImConnection: vi.fn(() => {
        throw new Error('invalid bot credentials');
      }),
    });

    expect(() => startAccountReadinessConsumers('owner-a', deps)).not.toThrow();
    expect(deps.log.warn).toHaveBeenCalledWith(
      'feishu-im activation after owner DB ready failed (non-fatal)',
      { error: 'invalid bot credentials' },
    );
  });

  it('keeps a failing host from taking the rest of the list down', () => {
    const deps = createDeps({
      startScheduler: vi.fn(() => {
        throw new Error('scheduler storage unavailable');
      }),
    });

    expect(() => startAccountReadinessConsumers('owner-a', deps)).not.toThrow();
    expect(deps.startEmbeddingHost).toHaveBeenCalledOnce();
    expect(deps.log.warn).toHaveBeenCalledWith(
      'scheduler activation after owner DB ready failed (non-fatal)',
      { error: 'scheduler storage unavailable' },
    );
  });

  it('does not restart ingress for a stale owner and permits the next owner', () => {
    let activeOwner = 'owner-a';
    const deps = createDeps({
      isOwnerCurrent: vi.fn((ownerId) => ownerId === activeOwner),
    });

    // Model logout/account replacement completing while the old readiness
    // callback is awaiting another account startup hook.
    activeOwner = 'owner-b';

    expect(startAccountReadinessConsumers('owner-a', deps)).toBe(false);
    expect(deps.startHookControlAccount).not.toHaveBeenCalled();
    expect(deps.startImConnection).not.toHaveBeenCalled();

    expect(startAccountReadinessConsumers('owner-b', deps)).toBe(true);
    expect(deps.startHookControlAccount).toHaveBeenCalledOnce();
    expect(deps.startImConnection).toHaveBeenCalledOnce();
  });

  /**
   * Deliberate asymmetry, preserved from the call sites this list replaced: the
   * hosts re-read live state and carry their own generation fences, so gating
   * them on a lost owner race would drop a start a same-owner rollover needs.
   */
  it('still starts the self-fencing hosts when the owner race was lost', () => {
    const deps = createDeps({ isOwnerCurrent: vi.fn(() => false) });

    expect(startAccountReadinessConsumers('owner-a', deps)).toBe(false);

    expect(deps.startHookControlAccount).not.toHaveBeenCalled();
    expect(deps.startScheduler).toHaveBeenCalledOnce();
    expect(deps.startEmbeddingHost).toHaveBeenCalledOnce();
  });
});

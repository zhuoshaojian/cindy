import { describe, expect, it, vi } from 'vitest';
import type { Envelope } from '@cindy/device-link';
import {
  handlePeerLinkCloseFrame,
  invalidatePeerLinkState,
  liftConnectionSuppressionForNewConnection,
  liftConnectionSuppressionForPeer,
  liftRehydrateSuppressionOnExplicitOpen,
  RehydrateSuppressionState,
  updateRehydrateSuppressionOnLinkClose,
} from '@/device-link/linkClose';

describe('handlePeerLinkCloseFrame', () => {
  it.each(['user', 'toggle-off', 'shutdown', 'revoked', 'transport-timeout'] as const)(
    'invalidates retained links on peer link-close (%s)',
    (reason) => {
      const onLinkClosed = vi.fn();
      const handled = handlePeerLinkCloseFrame({
        v: 1,
        kind: 'link-close',
        src: 'desktop-a',
        payload: { reason },
      } as Envelope, onLinkClosed);

      expect(handled).toBe(true);
      // reason 透传:transport-timeout 需要上层立即 rehydrate 重建,其它 reason
      // 维持只失效不重建的既有语义。
      expect(onLinkClosed).toHaveBeenCalledWith('desktop-a', reason);
    },
  );

  it('passes undefined reason for legacy frames without payload', () => {
    const onLinkClosed = vi.fn();
    const handled = handlePeerLinkCloseFrame({
      v: 1,
      kind: 'link-close',
      src: 'desktop-a',
    } as Envelope, onLinkClosed);
    expect(handled).toBe(true);
    expect(onLinkClosed).toHaveBeenCalledWith('desktop-a', undefined);
  });

  it('ignores unrelated frames', () => {
    const onLinkClosed = vi.fn();
    expect(handlePeerLinkCloseFrame({
      v: 1,
      kind: 'push',
      src: 'desktop-a',
    } as Envelope, onLinkClosed)).toBe(false);
    expect(onLinkClosed).not.toHaveBeenCalled();
  });
});

describe('updateRehydrateSuppressionOnLinkClose', () => {
  it.each(['user', 'toggle-off', 'revoked', 'future-unknown', undefined])(
    'durable close reason(%s) survives a shared socket reconnect',
    (reason) => {
      const suppressed = new RehydrateSuppressionState();
      suppressed.resetForOwner('account-a');
      updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-a', reason as string | undefined);
      expect(suppressed.has('desktop-a')).toBe(true);
      liftConnectionSuppressionForNewConnection(suppressed);
      expect(suppressed.has('desktop-a')).toBe(true);
    },
  );

  it('transport-timeout 解除抑制:只有它能继续恢复', () => {
    const suppressed = new RehydrateSuppressionState();
    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-a', 'user');
    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-a', 'transport-timeout');
    expect(suppressed.has('desktop-a')).toBe(false);
  });

  it('shutdown only suppresses the current connection/peer generation', () => {
    const suppressed = new RehydrateSuppressionState();
    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-a', 'shutdown');
    expect(suppressed.has('desktop-a')).toBe(true);
    liftConnectionSuppressionForNewConnection(suppressed);
    expect(suppressed.has('desktop-a')).toBe(false);

    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-a', 'shutdown');
    expect(suppressed.has('desktop-a')).toBe(true);
    liftConnectionSuppressionForPeer(suppressed, 'desktop-a');
    expect(suppressed.has('desktop-a')).toBe(false);
  });

  it('explicit user open only lifts its target durable suppression', () => {
    const suppressed = new RehydrateSuppressionState();
    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-a', 'user');
    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-b', 'revoked');
    liftRehydrateSuppressionOnExplicitOpen(suppressed, 'desktop-a');
    expect(suppressed.has('desktop-a')).toBe(false);
    expect(suppressed.has('desktop-b')).toBe(true);
  });

  it('logout/account switch clears every suppression from the previous owner', () => {
    const suppressed = new RehydrateSuppressionState();
    suppressed.resetForOwner('account-a');
    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-user', 'user');
    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-shutdown', 'shutdown');

    expect(suppressed.resetForOwner('account-b')).toBe(true);
    expect(suppressed.has('desktop-user')).toBe(false);
    expect(suppressed.has('desktop-shutdown')).toBe(false);

    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-b', 'user');
    expect(suppressed.resetForOwner(null)).toBe(true);
    expect(suppressed.has('desktop-b')).toBe(false);
  });

  it('failed explicit open can restore the prior durable suppression', () => {
    const suppressed = new RehydrateSuppressionState();
    updateRehydrateSuppressionOnLinkClose(suppressed, 'desktop-a', 'user');
    const previous = suppressed.take('desktop-a');
    expect(suppressed.has('desktop-a')).toBe(false);
    suppressed.restore('desktop-a', previous);
    expect(suppressed.has('desktop-a')).toBe(true);
  });
});

describe('invalidatePeerLinkState', () => {
  it('clears retained link state and reports invalidated session topic ACKs', () => {
    const openLinks = new Map<string, unknown>([
      ['desktop-a', Promise.resolve()],
      ['desktop-b', Promise.resolve()],
    ]);
    const remoteTopicAcks = new Map<string, Set<string>>([
      ['desktop-a', new Set(['sessions', 'session:s1', 'session:s2'])],
      ['desktop-b', new Set(['sessions'])],
    ]);
    const onTopicsInterrupted = vi.fn();

    invalidatePeerLinkState(
      'desktop-a',
      openLinks,
      remoteTopicAcks,
      onTopicsInterrupted,
    );

    expect(openLinks.has('desktop-a')).toBe(false);
    expect(remoteTopicAcks.has('desktop-a')).toBe(false);
    expect(openLinks.has('desktop-b')).toBe(true);
    expect(remoteTopicAcks.has('desktop-b')).toBe(true);
    expect(onTopicsInterrupted).toHaveBeenCalledWith([
      'sessions',
      'session:s1',
      'session:s2',
    ]);
  });
});

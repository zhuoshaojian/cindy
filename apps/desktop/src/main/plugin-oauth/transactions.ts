import { randomUUID } from 'node:crypto';
import {
  PLUGIN_OAUTH_TTL_MS,
  parsePluginOauthCallback,
  parsePluginDeviceOpened,
  parsePluginDeviceOffer,
  type PluginDeviceOpened,
  parsePluginOauthRequest,
  type PluginOauthAction,
  type PluginOauthPhase,
} from '@cindy/device-link';
import { OauthBox } from './box.js';
import { withRemoteOauthContext, type RemoteOauthContext } from './context.js';

export interface OauthCardBinding {
  ghostId: string;
  /** Must become false on card cancellation, session close/rewind or replacement. */
  current(): boolean;
}
export interface OauthTransactionDeps {
  owner(): string | null;
  available(peer: string): boolean;
  bind(action: PluginOauthAction): Promise<OauthCardBinding | null>;
  run(action: PluginOauthAction): Promise<boolean> | boolean;
  now?: () => number;
}
interface Transaction {
  id: string;
  peer: string;
  owner: string;
  action: PluginOauthAction;
  binding: OauthCardBinding;
  expiresAt: number;
  phase: PluginOauthPhase;
  key?: OauthBox;
  publicKey: string;
  offer?: string;
  state?: string;
  mode?: 'loopback' | 'device';
  lifetime: AbortController;
  resolve?: (value: ReturnType<typeof parsePluginOauthCallback> | PluginDeviceOpened) => void;
  reject?: (error: Error) => void;
  callbackBox?: string;
  cleanup?: () => void;
}
const terminal = (phase: PluginOauthPhase) => ['succeeded', 'failed', 'cancelled'].includes(phase);
const failure = () => new Error('OAUTH_BRIDGE_UNAVAILABLE');

/** Process-local, peer/owner/card-bound transactions. Restart requires a fresh human action. */
export class OauthTransactions {
  private readonly entries = new Map<string, Transaction>();
  private readonly starts = new Set<string>();
  private readonly peerEpochs = new Map<string, number>();
  private epoch = 0;
  constructor(private readonly deps: OauthTransactionDeps) {}
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  private current(t: Transaction): boolean {
    return (
      t.owner === this.deps.owner() &&
      this.deps.available(t.peer) &&
      this.now() < t.expiresAt &&
      t.binding.current()
    );
  }
  private assertCurrent(t: Transaction) {
    if (terminal(t.phase) || !this.current(t)) {
      if (!terminal(t.phase)) this.finish(t, 'cancelled');
      throw failure();
    }
  }
  private finish(t: Transaction, phase: PluginOauthPhase) {
    if (terminal(t.phase)) return;
    t.phase = phase;
    if (phase !== 'succeeded') t.lifetime.abort();
    t.reject?.(failure());
    t.cleanup?.();
    delete t.resolve;
    delete t.reject;
    delete t.cleanup;
    delete t.offer;
    delete t.state;
    delete t.key;
    delete t.callbackBox;
  }
  /** Called by link/owner teardown; one peer failing does not cancel other peers. */
  cancelPeer(peer?: string) {
    if (peer) this.peerEpochs.set(peer, (this.peerEpochs.get(peer) ?? 0) + 1);
    else {
      this.epoch++;
      this.peerEpochs.clear();
    }
    for (const t of this.entries.values())
      if (!peer || t.peer === peer) this.finish(t, 'cancelled');
  }
  cancelRequest(requestId: string) {
    for (const t of this.entries.values())
      if (t.action.requestId === requestId) this.finish(t, 'cancelled');
  }
  async request(peer: string, raw: unknown): Promise<unknown> {
    const request = parsePluginOauthRequest(raw);
    if (!request || !this.deps.owner() || !this.deps.available(peer)) throw failure();
    for (const t of this.entries.values()) {
      if (!terminal(t.phase) && !this.current(t)) this.finish(t, 'cancelled');
      if (this.now() >= t.expiresAt) this.entries.delete(t.id);
    }
    if (request.op === 'capabilities')
      return {
        version: 1,
        callback: 'desktop-loopback',
        encrypted: true,
        deviceAuthorization: true,
        deviceUserCode: true,
      };
    if (request.op === 'start') {
      const owner = this.deps.owner()!;
      const epoch = this.epoch;
      const peerEpoch = this.peerEpochs.get(peer) ?? 0;
      if (
        this.starts.has(request.requestId) ||
        this.starts.size >= 16 ||
        this.entries.size >= 64 ||
        [...this.entries.values()].some(
          (t) => !terminal(t.phase) && t.action.requestId === request.requestId,
        )
      )
        throw failure();
      this.starts.add(request.requestId);
      try {
        const binding = await this.deps.bind(request);
        if (
          !binding ||
          !binding.current() ||
          owner !== this.deps.owner() ||
          !this.deps.available(peer) ||
          epoch !== this.epoch ||
          peerEpoch !== (this.peerEpochs.get(peer) ?? 0)
        )
          throw failure();
        const key = new OauthBox();
        const id = randomUUID();
        // Validate the offered public key before starting any OAuth side effects.
        key.seal(request.publicKey, id, 'offer', {});
        const t: Transaction = {
          id,
          peer,
          owner,
          action: request,
          binding,
          key,
          publicKey: request.publicKey,
          expiresAt: this.now() + PLUGIN_OAUTH_TTL_MS,
          phase: 'starting',
          lifetime: new AbortController(),
        };
        this.entries.set(id, t);
        const timer = setTimeout(() => this.finish(t, 'cancelled'), PLUGIN_OAUTH_TTL_MS);
        timer.unref?.();
        t.cleanup = () => clearTimeout(timer);
        const context: RemoteOauthContext = {
          scope: id,
          cancelled: t.lifetime.signal,
          assertCurrent: () => this.assertCurrent(t),
          authorize: (offer, signal) => {
            this.assertCurrent(t);
            if (t.phase !== 'starting' || signal.aborted) throw failure();
            t.mode = 'loopback';
            t.state = offer.state;
            t.offer = key.seal(t.publicKey, id, 'offer', offer);
            t.phase = 'authorizing';
            return new Promise((resolve, reject) => {
              t.resolve = (value) => {
                const callback = parsePluginOauthCallback(value);
                callback ? resolve(callback) : reject(failure());
              };
              t.reject = reject;
              const abort = () => this.finish(t, 'cancelled');
              signal.addEventListener('abort', abort, { once: true });
              const cleanup = t.cleanup;
              t.cleanup = () => {
                cleanup?.();
                signal.removeEventListener('abort', abort);
              };
            });
          },
          authorizeDevice: (rawOffer, signal) => {
            this.assertCurrent(t);
            if (t.phase !== 'starting' || signal.aborted) throw failure();
            const offer = parsePluginDeviceOffer(rawOffer);
            if (offer.userCode !== undefined && request.deviceUserCode !== true) throw failure();
            t.mode = 'device';
            t.state = offer.state;
            t.offer = key.seal(t.publicKey, id, 'offer', offer);
            t.phase = 'authorizing';
            return new Promise<void>((resolve, reject) => {
              t.resolve = (value) =>
                parsePluginDeviceOpened(value) ? resolve() : reject(failure());
              t.reject = reject;
              const abort = () => this.finish(t, 'cancelled');
              signal.addEventListener('abort', abort, { once: true });
              const cleanup = t.cleanup;
              t.cleanup = () => {
                cleanup?.();
                signal.removeEventListener('abort', abort);
              };
            });
          },
          finish: (ok) => {
            if (!terminal(t.phase)) this.finish(t, ok && this.current(t) ? 'succeeded' : 'failed');
          },
        };
        try {
          const accepted = await withRemoteOauthContext(context, () => this.deps.run(request));
          if (!accepted) throw failure();
        } catch {
          this.finish(t, 'failed');
          throw failure();
        }
        return { id, publicKey: key.publicKey, expiresAt: t.expiresAt };
      } finally {
        this.starts.delete(request.requestId);
      }
    }
    const t = this.entries.get(request.id);
    if (!t || t.peer !== peer || t.owner !== this.deps.owner()) throw failure();
    if (request.op === 'cancel') {
      this.finish(t, 'cancelled');
      return { accepted: true };
    }
    if (request.op === 'status') return { phase: t.phase, ...(t.offer ? { offer: t.offer } : {}) };
    this.assertCurrent(t);
    // An identical retry can acknowledge an in-flight exchange, never exchange again.
    if (t.phase === 'exchanging' && request.box === t.callbackBox) return { accepted: true };
    if (t.phase !== 'authorizing' || !t.key) throw failure();
    const rawCallback = t.key.open(t.publicKey, t.id, 'callback', request.box);
    const callback =
      t.mode === 'device'
        ? parsePluginDeviceOpened(rawCallback)
        : parsePluginOauthCallback(rawCallback);
    if (!callback || callback.state !== t.state) throw failure();
    t.phase = 'exchanging';
    t.callbackBox = request.box;
    delete t.offer;
    delete t.state;
    t.resolve?.(callback);
    delete t.resolve;
    delete t.reject;
    return { accepted: true };
  }
}

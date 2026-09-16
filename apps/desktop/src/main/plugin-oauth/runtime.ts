import { OauthTransactions, type OauthTransactionDeps } from './transactions.js';
import { onOauthCardClosed } from './context.js';
import { AuthenticatedOauthHost, OauthHostIdentity } from './authentication.js';

let host: OauthTransactions | undefined;
let authenticated: AuthenticatedOauthHost | undefined;
let identity: {key: OauthHostIdentity; deviceId: string; membershipId: string} | null = null;
let identityTarget: () => {deviceId: string; membershipId: string} | null = () => null;
function currentIdentity() {
  const target = currentOwner?.() ? identityTarget() : null;
  if (!target) return null;
  if (!identity || identity.deviceId !== target.deviceId || identity.membershipId !== target.membershipId)
    identity = {...target, key: new OauthHostIdentity()};
  return identity;
}
let currentOwner: (() => string | null) | undefined;
let unsubscribe: (() => void) | undefined;
let epoch = 0;
const peers = new Map<string, number>();
export function initializePluginOauthHost(deps: OauthTransactionDeps,
  target: () => {deviceId: string; membershipId: string} | null = () => null): void {
  host?.cancelPeer();
  authenticated?.invalidate();
  unsubscribe?.();
  host = new OauthTransactions(deps);
  identity = null;
  identityTarget = target;
  const transactions = host;
  authenticated = new AuthenticatedOauthHost({...deps, identity: currentIdentity,
    request: (peer, raw) => transactions.request(peer, raw)});
  currentOwner = deps.owner;
  unsubscribe = onOauthCardClosed((id) => host?.cancelRequest(id));
}
export function supportsRemotePluginOauth(): boolean {
  return !!currentIdentity();
}
export function publishedPluginOauthIdentity() {
  return currentIdentity()?.key.descriptor;
}
export function requestPluginOauth(peer: string, raw: unknown): Promise<unknown> {
  if (!authenticated) return Promise.reject(new Error('OAUTH_BRIDGE_UNAVAILABLE'));
  return authenticated.request(peer, raw);
}
/** Link teardown is also a credential-transaction boundary, not a retry opportunity. */
export function invalidatePluginOauth(peer?: string): void {
  host?.cancelPeer(peer);
  authenticated?.invalidate(peer);
  if (peer) peers.set(peer, (peers.get(peer) ?? 0) + 1);
  else {
    epoch++;
    peers.clear();
  }
}
export function capturePluginOauthPeer(peer: string): () => void {
  const startEpoch = epoch;
  const peerEpoch = peers.get(peer) ?? 0;
  return () => {
    if (startEpoch !== epoch || peerEpoch !== (peers.get(peer) ?? 0))
      throw new Error('OAUTH_BRIDGE_UNAVAILABLE');
  };
}

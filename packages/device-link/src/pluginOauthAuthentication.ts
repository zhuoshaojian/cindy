import { oauthId, parsePluginOauthAction, type PluginOauthAction } from './pluginOauth.js';

/** Host-only protocol. Public keys must be resolved over the independently trusted CIS HTTPS origin. */
export interface PluginOauthPublicIdentity { version: 1; publicKey: string; bootId: string }
export interface PluginOauthTrustedIdentity extends PluginOauthPublicIdentity {
  instanceId: string; deviceId: string; membershipId: string; observedAtMs: number; expiresAtMs: number;
}
export interface PluginOauthHello {
  op: 'hello'; version: 2; nonce: string; publicKey: string; action: PluginOauthAction;
}
export interface PluginOauthHelloReply {
  version: 2; id: string; publicKey: string; bootId: string; ghostId: string; expiresAtMs: number; signature: string;
}
export function oauthExact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error('OAUTH_BRIDGE_UNAVAILABLE');
  return value as Record<string, unknown>;
}
export const oauthNonce = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
export const oauthPublicKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{59}$/.test(v);
export function parsePluginOauthPublicIdentity(value: unknown): PluginOauthPublicIdentity {
  const v = oauthExact(value, ['version', 'publicKey', 'bootId']);
  if (v.version !== 1 || !oauthPublicKey(v.publicKey) || !oauthId(v.bootId)) throw new Error('OAUTH_BRIDGE_UNAVAILABLE');
  return v as unknown as PluginOauthPublicIdentity;
}
export function parsePluginOauthTrustedIdentity(value: unknown): PluginOauthTrustedIdentity {
  const v = oauthExact(value, ['version', 'publicKey', 'bootId', 'instanceId', 'deviceId', 'membershipId', 'observedAtMs', 'expiresAtMs']);
  parsePluginOauthPublicIdentity({version: v.version, publicKey: v.publicKey, bootId: v.bootId});
  if (![v.instanceId, v.deviceId, v.membershipId].every(oauthId)
    || !Number.isSafeInteger(v.observedAtMs) || !Number.isSafeInteger(v.expiresAtMs)) throw new Error('OAUTH_BRIDGE_UNAVAILABLE');
  return v as unknown as PluginOauthTrustedIdentity;
}
export function parsePluginOauthHello(value: unknown): PluginOauthHello {
  const v = oauthExact(value, ['op', 'version', 'nonce', 'publicKey', 'action']);
  const action = parsePluginOauthAction(v.action);
  if (v.op !== 'hello' || v.version !== 2 || !oauthNonce(v.nonce) || !oauthPublicKey(v.publicKey) || !action)
    throw new Error('OAUTH_BRIDGE_UNAVAILABLE');
  return {...v, action} as unknown as PluginOauthHello;
}
export function parsePluginOauthHelloReply(value: unknown): PluginOauthHelloReply {
  const v = oauthExact(value, ['version', 'id', 'publicKey', 'bootId', 'ghostId', 'expiresAtMs', 'signature']);
  if (v.version !== 2 || ![v.id, v.bootId, v.ghostId].every(oauthId) || !oauthPublicKey(v.publicKey)
    || !Number.isSafeInteger(v.expiresAtMs) || typeof v.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(v.signature))
    throw new Error('OAUTH_BRIDGE_UNAVAILABLE');
  return v as unknown as PluginOauthHelloReply;
}

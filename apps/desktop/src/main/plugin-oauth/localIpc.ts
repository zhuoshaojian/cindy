import {
  PLUGIN_OAUTH_CHANNEL,
  oauthId,
  parsePluginOauthAction,
  type InvokeResultPayload,
  type PluginOauthTrustedIdentity,
} from '@cindy/device-link';
import { assistPluginOauth } from './controller.js';
import { capturePluginOauthPeer } from './runtime.js';
import { authenticateOauthController } from './authentication.js';
import type { PluginOauthDeviceCodePrompt, PluginOauthDeviceCodeClose, PluginOauthDeviceCodeTarget } from '../../shared/pluginOauthDeviceCode.js';

const active = new Set<string>();
export interface LocalOauthDeps {
  owner(): string | null;
  assertTarget(deviceId: string): void;
  invoke(deviceId: string, channel: string, args: unknown[]): Promise<InvokeResultPayload>;
  openExternal(url: string): Promise<void>;
  copyDeviceCode?(code: string): () => void;
  presentDeviceCode?(target: PluginOauthDeviceCodeTarget, prompt: PluginOauthDeviceCodePrompt, assertCurrent: () => void, clearClipboard: () => void): PluginOauthDeviceCodeClose;
  localDeviceId(): string;
  identity(deviceId: string, assertCurrent: () => void): Promise<PluginOauthTrustedIdentity>;
}
/** Renderer supplies only an opaque card action and its target. No caller-supplied URL/key. */
export async function handleAssistPluginOauth(
  deps: LocalOauthDeps,
  raw: unknown,
): Promise<{ accepted: true }> {
  const fail = () => new Error('OAUTH_BRIDGE_UNAVAILABLE');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail();
  const { deviceId, ghostId, ...rest } = raw as Record<string, unknown>;
  const action = parsePluginOauthAction(rest);
  const owner = deps.owner();
  if (!oauthId(deviceId) || !oauthId(ghostId) || !action || !owner) throw fail();
  const slot = `${deviceId}:${action.requestId}`;
  if (active.has(slot) || active.size >= 8) throw fail();
  const peerCurrent = capturePluginOauthPeer(deviceId);
  const assertCurrent = () => {
    peerCurrent();
    if (owner !== deps.owner()) throw fail();
    deps.assertTarget(deviceId);
  };
  assertCurrent();
  active.add(slot);
  try {
    const target = await deps.identity(deviceId, assertCurrent);
    assertCurrent();
    if (target.deviceId !== deviceId) throw fail();
    const exchange = await authenticateOauthController({target, peer: deps.localDeviceId(), action, ghostId, assertCurrent,
      invoke: async raw => {
        // A vanished window may send an encrypted cancellation, but never under a new owner/peer generation.
        peerCurrent();
        if (owner !== deps.owner()) throw fail();
        const result = await deps.invoke(deviceId, PLUGIN_OAUTH_CHANNEL, [raw]);
        peerCurrent();
        if (owner !== deps.owner() || !result.ok) throw fail();
        return result.result;
      }});
    return await assistPluginOauth(
      {
        assertCurrent,
        openExternal: deps.openExternal,
        copyDeviceCode: deps.copyDeviceCode,
        presentDeviceCode: (prompt, clearClipboard) => deps.presentDeviceCode?.(
          { deviceId, ghostId, requestId: action.requestId, actionId: action.actionId }, prompt, assertCurrent, clearClipboard,
        ) ?? (() => {}),
        invoke: async (request) => {
          // A closed/navigated window must still cancel its existing transaction.
          // Never send cancellation under a new owner or re-established peer.
          if (request.op === 'cancel') {
            peerCurrent();
            if (owner !== deps.owner()) throw fail();
          } else assertCurrent();
          const result = await exchange(request);
          if (request.op !== 'cancel') assertCurrent();
          return result;
        },
      },
      action,
    );
  } finally {
    active.delete(slot);
  }
}

import type { PluginOauthAction } from '@cindy/device-link';
import type { GhostSetupInteractionBridge } from '../cindy-brain/ghostSetupInteractionBridge.js';
import type { BotAuthorizationService } from '../maker-ipc/botAuthorizationService.js';
import { initializePluginOauthHost } from './runtime.js';
import type { OauthCardBinding } from './transactions.js';

/** Bind existing Host cards; no new plugin manifest or generic setup permission. */
export function initializePluginOauthCards(deps: {
  bridge: GhostSetupInteractionBridge;
  bots(): BotAuthorizationService | null;
  owner(): string | null;
  available(peer: string): boolean;
  identity?: () => {deviceId: string; membershipId: string} | null;
}): void {
  const normal = (action: PluginOauthAction): OauthCardBinding | null => {
    const found = deps.bridge
      .pendingSnapshots()
      .find((e) => e.request.requestId === action.requestId);
    if (
      !found ||
      found.request.terminal ||
      found.request.revision !== action.expectedRevision ||
      !found.request.steps.some(
        (s) =>
          s.action?.id === action.actionId &&
          s.action.kind === 'oauth_connect' &&
          (s.phase === 'pending' || s.phase === 'failed'),
      )
    )
      return null;
    return {
      ghostId: found.request.ghost.id,
      current: () =>
        deps.bridge
          .pendingSnapshots(found.sessionId)
          .some((e) => e.request.requestId === action.requestId && !e.request.terminal),
    };
  };
  initializePluginOauthHost({
    owner: deps.owner,
    available: deps.available,
    bind: async (action) => normal(action) ?? (await deps.bots()?.bindRemoteOauth(action)) ?? null,
    run: async (action) => {
      if (normal(action))
        return deps.bridge.resolve(action.requestId, {
          kind: 'plugin_setup',
          action: 'run_action',
          actionId: action.actionId,
          expectedRevision: action.expectedRevision,
        });
      return (await deps.bots()?.resolveRemoteOauth(action)) ?? false;
    },
  }, deps.identity);
}

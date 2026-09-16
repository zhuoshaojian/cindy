import { randomBytes, randomUUID } from 'node:crypto';
import { PLUGIN_OAUTH_TTL_MS, parseDeviceAuthorizationUrl } from '@cindy/device-link';
import type {
  GhostSetupInteractionBridge,
  GhostSetupInteractionSnapshot,
} from '../cindy-brain/ghostSetupInteractionBridge.js';
import { getRemoteOauthContext, type RemoteOauthContext } from './context.js';

export interface DeviceAuthorizationHandle {
  opened: Promise<void>;
  finish(ok: boolean): void;
  dispose(): void;
}
export interface DeviceAuthorizationInput {
  ghost: { id: string; name: string };
  sessionId: string;
  url: string;
  userCode?: string;
  signal: AbortSignal;
  assertCurrent(): void;
  cancel(): void;
}

/** A private CLI operation card, not a declaration of Host network-slot setup readiness. */
export function openDeviceAuthorizationCard(
  input: DeviceAuthorizationInput,
  deps: {
    bridge: GhostSetupInteractionBridge;
    openExternal(url: string): Promise<void>;
    copyDeviceCode?(code: string): () => void;
    copy: { title: string; description: string };
  },
): DeviceAuthorizationHandle {
  input.assertCurrent();
  const url = parseDeviceAuthorizationUrl(input.url);
  const requestId = randomUUID();
  const actionId = 'device-authorization';
  const lifetime = new AbortController();
  let context: RemoteOauthContext | undefined;
  let begun = false;
  let opened = false;
  let settled = false;
  let clearDeviceCode: (() => void) | undefined;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const openedPromise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let snapshot: GhostSetupInteractionSnapshot = {
    kind: 'plugin_setup',
    requestId,
    revision: 0,
    ghost: input.ghost,
    steps: [
      {
        id: actionId,
        groupId: actionId,
        groupMode: 'any_of',
        title: deps.copy.title,
        description: deps.copy.description.replace('{{host}}', new URL(url).hostname),
        phase: 'pending',
        action: { id: actionId, kind: 'oauth_connect' },
      },
    ],
  };
  const assertCurrent = () => {
    if (settled || input.signal.aborted || lifetime.signal.aborted)
      throw new Error('DEVICE_AUTHORIZATION_UNAVAILABLE');
    input.assertCurrent();
    context?.assertCurrent();
  };
  const update = (phase: 'waiting_external' | 'satisfied' | 'failed', terminal = false) => {
    snapshot = {
      ...snapshot,
      revision: snapshot.revision + 1,
      ...(terminal ? { terminal: true } : {}),
      steps: snapshot.steps.map((step) => ({
        ...step,
        phase,
        ...(phase === 'failed' ? { errorCode: 'AUTH_FAILED' as const } : {}),
      })),
    };
    deps.bridge.update(snapshot);
  };
  const finish = (ok: boolean) => {
    if (settled) return;
    let valid = false;
    try {
      assertCurrent();
      valid = true;
    } catch {
      /* Stale completions cannot become success. */
    }
    const success = ok && opened && valid;
    settled = true;
    // Finish the transaction before the card becomes terminal and closes its binding.
    context?.cancelled?.removeEventListener('abort', cancel);
    context?.finish(success);
    lifetime.abort();
    input.signal.removeEventListener('abort', cancel);
    clearTimeout(timer);
    clearDeviceCode?.();
    if (!opened) reject(new Error('DEVICE_AUTHORIZATION_UNAVAILABLE'));
    update(success ? 'satisfied' : 'failed', true);
    deps.bridge.complete(requestId);
    const dismiss = setTimeout(
      () => deps.bridge.close(requestId, success ? 'completed' : 'cancelled'),
      1500,
    );
    dismiss.unref?.();
  };
  const cancel = () => {
    finish(false);
    input.cancel();
  };
  const timer = setTimeout(cancel, PLUGIN_OAUTH_TTL_MS);
  timer.unref?.();
  input.signal.addEventListener('abort', cancel, { once: true });
  try {
    deps.bridge.open(input.sessionId, snapshot, (command, responseTarget) => {
      if (command.action === 'cancel') {
        if (command.cleanupReason || command.expectedRevision === snapshot.revision) cancel();
        return;
      }
      if (begun || command.expectedRevision !== snapshot.revision || command.actionId !== actionId)
        return;
      assertCurrent();
      const remote = getRemoteOauthContext();
      // Generic remote run_action cannot fall through to opening a cloud browser.
      if (!remote && (!responseTarget || responseTarget.isDestroyed())) return;
      begun = true;
      context = remote;
      context?.cancelled?.addEventListener('abort', cancel, { once: true });
      update('waiting_external');
      void (async () => {
        assertCurrent();
        if (remote) {
          if (!remote.authorizeDevice || !remote.cancelled)
            throw new Error('DEVICE_AUTHORIZATION_UNAVAILABLE');
          await remote.authorizeDevice(
            {
              kind: 'device',
              authorizeUrl: url,
              state: randomBytes(32).toString('base64url'),
              ...(input.userCode !== undefined ? { userCode: input.userCode } : {}),
            },
            lifetime.signal,
          );
        } else {
          if (input.userCode !== undefined) {
            if (!deps.copyDeviceCode) throw new Error('DEVICE_AUTHORIZATION_UNAVAILABLE');
            clearDeviceCode = deps.copyDeviceCode(input.userCode);
          }
          await deps.openExternal(url);
          if (responseTarget!.isDestroyed()) throw new Error('DEVICE_AUTHORIZATION_UNAVAILABLE');
        }
        assertCurrent();
        opened = true;
        resolve();
      })().catch(cancel);
    });
    if (input.signal.aborted) cancel();
  } catch {
    cancel();
  }
  return { opened: openedPromise, finish, dispose: () => finish(false) };
}

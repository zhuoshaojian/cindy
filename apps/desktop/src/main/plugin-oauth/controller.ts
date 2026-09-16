import http from 'node:http';
import {
  PLUGIN_OAUTH_TTL_MS,
  parsePluginOauthCallback,
  parsePluginDeviceOffer,
  oauthId,
  type PluginOauthAction,
  type PluginOauthOffer,
  type PluginOauthRequest,
  type PluginOauthCallback,
} from '@cindy/device-link';
import { OauthBox } from './box.js';
import type { PluginOauthDeviceCodePrompt, PluginOauthDeviceCodeClose } from '../../shared/pluginOauthDeviceCode.js';
import { ghostNetworkHostMatches } from '../../shared/ghost.js';
import {
  getGhostOAuthResultCopy,
  getRemoteOAuthCallbackCopy,
  OAUTH_RESULT_HTML_LANG,
  pickOAuthResultPageLang,
  renderOAuthResultPage,
} from '../oauthResultPage.js';

const fail = () => new Error('OAUTH_BRIDGE_UNAVAILABLE');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  return value as Record<string, unknown>;
}
/** These URLs come only from the encrypted, registered Host transaction. */
export function parseOauthOffer(raw: unknown): PluginOauthOffer {
  const v = object(raw);
  if (
    Object.keys(v).sort().join(',') !== 'authorizeUrl,callbackUrl,corsHosts,corsOrigins,state' ||
    typeof v.authorizeUrl !== 'string' ||
    v.authorizeUrl.length > 16_384 ||
    typeof v.callbackUrl !== 'string' ||
    v.callbackUrl.length > 2048 ||
    typeof v.state !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(v.state) ||
    !Array.isArray(v.corsOrigins) ||
    v.corsOrigins.length > 64 ||
    !Array.isArray(v.corsHosts) ||
    v.corsHosts.length > 128 ||
    v.corsHosts.some((h) => typeof h !== 'string' || !/^(?:\*\.)?[A-Za-z0-9.-]{1,253}$/.test(h))
  )
    throw fail();
  const authorize = new URL(v.authorizeUrl);
  const callback = new URL(v.callbackUrl);
  if (
    authorize.protocol !== 'https:' ||
    authorize.username ||
    authorize.password ||
    authorize.hash ||
    authorize.searchParams.getAll('state').length !== 1 ||
    authorize.searchParams.get('state') !== v.state ||
    authorize.searchParams.get('response_type') !== 'code' ||
    callback.protocol !== 'http:' ||
    callback.hostname !== '127.0.0.1' ||
    !callback.port ||
    Number(callback.port) < 1 ||
    callback.username ||
    callback.password ||
    callback.hash ||
    callback.search ||
    /[\x00-\x20]/.test(v.callbackUrl)
  )
    throw fail();
  const corsOrigins = v.corsOrigins.map((origin) => {
    if (typeof origin !== 'string' || origin.length > 1024) throw fail();
    const parsed = new URL(origin);
    if (
      parsed.protocol !== 'https:' ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password
    )
      throw fail();
    return origin;
  });
  return {
    authorizeUrl: authorize.toString(),
    callbackUrl: callback.toString(),
    state: v.state,
    corsOrigins,
    corsHosts: v.corsHosts as string[],
  };
}

/** Fixed listener, no arbitrary URL fetch/port tunnelling or port-owner termination. */
export async function listenForOauthCallback(
  offer: PluginOauthOffer,
  deliver: (value: PluginOauthCallback) => Promise<void>,
  assertCurrent: () => void,
): Promise<{ close(): void }> {
  const endpoint = new URL(offer.callbackUrl);
  let consumed = false;
  let closed = false;
  const server = http.createServer(
    { maxHeaderSize: 16_384, requestTimeout: 10_000, headersTimeout: 10_000 },
    (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const reply = (status: number) => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        // No provider text, URL or code in the browser result.
        const lang = pickOAuthResultPageLang(req.headers['accept-language']);
        const copy = getRemoteOAuthCallbackCopy(lang);
        const errors = getGhostOAuthResultCopy(lang);
        res.end(
          renderOAuthResultPage({
            htmlLang: OAUTH_RESULT_HTML_LANG[lang],
            variant: status === 200 ? 'warning' : 'error',
            title: status === 200 ? copy.title : errors.errorTitle,
            body:
              status === 200
                ? copy.body
                : errors.errors['invalid-callback'].replace('{brand}', 'Cindy'),
            pageKind: 'ghost-oauth',
          }),
        );
      };
      try {
        assertCurrent();
        if (
          closed ||
          req.headers.host !== endpoint.host ||
          !req.url?.startsWith('/') ||
          req.url.startsWith('//') ||
          req.url.length > 12_288
        ) {
          reply(400);
          return;
        }
        const url = new URL(req.url, endpoint.origin);
        if (url.pathname !== endpoint.pathname) {
          reply(404);
          return;
        }
        const origin = req.headers.origin;
        if (typeof origin === 'string') {
          const parsed = new URL(origin);
          if (
            parsed.origin !== origin ||
            parsed.protocol !== 'https:' ||
            (!offer.corsOrigins.includes(origin) &&
              !offer.corsHosts.some((h) => ghostNetworkHostMatches(h, parsed.hostname)))
          ) {
            reply(403);
            return;
          }
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          reply(405);
          return;
        }
        if (consumed) {
          reply(409);
          return;
        }
        if (
          url.searchParams.getAll('state').length !== 1 ||
          url.searchParams.get('state') !== offer.state ||
          url.searchParams.getAll('code').length + url.searchParams.getAll('error').length !== 1
        ) {
          reply(400);
          return;
        }
        const callback = parsePluginOauthCallback({
          state: offer.state,
          ...(url.searchParams.has('error')
            ? { error: url.searchParams.get('error') }
            : { code: url.searchParams.get('code') }),
        });
        if (!callback) {
          reply(400);
          return;
        }
        consumed = true;
        void deliver(callback).then(
          () => reply(200),
          () => reply(502),
        );
      } catch {
        reply(410);
      }
    },
  );
  server.maxConnections = 8;
  const close = () => {
    closed = true;
    server.close();
    server.closeAllConnections();
  };
  server.on('error', close);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(endpoint.port), '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    assertCurrent();
    return { close };
  } catch {
    close();
    throw fail();
  }
}

export interface OauthControllerDeps {
  invoke(request: PluginOauthRequest): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  copyDeviceCode?(code: string): () => void;
  presentDeviceCode?(prompt: PluginOauthDeviceCodePrompt, clearClipboard: () => void): PluginOauthDeviceCodeClose;
  assertCurrent(): void;
  now?: () => number;
  pause?: () => Promise<void>;
}
/** Runs only behind the trusted Desktop click IPC. Returns status, never URL/code/token. */
export async function assistPluginOauth(
  deps: OauthControllerDeps,
  action: PluginOauthAction,
): Promise<{ accepted: true }> {
  const now = deps.now ?? Date.now;
  const deadline = now() + PLUGIN_OAUTH_TTL_MS;
  deps.assertCurrent();
  const caps = object(await deps.invoke({ op: 'capabilities' }));
  if (caps.version !== 1 || caps.callback !== 'desktop-loopback' || caps.encrypted !== true)
    throw fail();
  deps.assertCurrent();
  const key = new OauthBox();
  const deviceUserCode = caps.deviceUserCode === true && !!deps.copyDeviceCode;
  const start = object(
    await deps.invoke({
      op: 'start',
      ...action,
      publicKey: key.publicKey,
      ...(deviceUserCode ? { deviceUserCode: true } : {}),
    }),
  );
  if (
    !oauthId(start.id) ||
    typeof start.publicKey !== 'string' ||
    !/^[A-Za-z0-9_-]{59}$/.test(start.publicKey)
  )
    throw fail();
  const id = start.id;
  const peerKey = start.publicKey;
  let listener: { close(): void } | undefined;
  let opened = false;
  let finished = false;
  let callbackFailed = false;
  let clearDeviceCode: (() => void) | undefined;
  let closeDeviceCode: PluginOauthDeviceCodeClose | undefined;
  try {
    while (now() < deadline) {
      deps.assertCurrent();
      if (callbackFailed) throw fail();
      const status = object(await deps.invoke({ op: 'status', id }));
      deps.assertCurrent();
      if (status.phase === 'succeeded') {
        finished = true;
        return { accepted: true };
      }
      if (status.phase === 'failed' || status.phase === 'cancelled') throw fail();
      if (!['starting', 'authorizing', 'exchanging'].includes(String(status.phase))) throw fail();
      if (status.phase === 'authorizing' && !opened) {
        if (typeof status.offer !== 'string') throw fail();
        const rawOffer = key.open(peerKey, id, 'offer', status.offer);
        if (object(rawOffer).kind === 'device') {
          if (caps.deviceAuthorization !== true) throw fail();
          const offer = parsePluginDeviceOffer(rawOffer);
          deps.assertCurrent();
          if (offer.userCode !== undefined) {
            if (!deviceUserCode || !deps.copyDeviceCode) throw fail();
            clearDeviceCode = deps.copyDeviceCode(offer.userCode);
            closeDeviceCode = deps.presentDeviceCode?.({ userCode: offer.userCode,
              authorizeUrl: offer.authorizeUrl, expiresAt: deadline }, clearDeviceCode);
          }
          await deps.openExternal(offer.authorizeUrl);
          deps.assertCurrent();
          const ack = object(
            await deps.invoke({
              op: 'callback',
              id,
              box: key.seal(peerKey, id, 'callback', { kind: 'device-opened', state: offer.state }),
            }),
          );
          if (ack.accepted !== true) throw fail();
          opened = true;
          continue; // Browser open is not authorization completion. Keep observing the cloud operation.
        }
        const offer = parseOauthOffer(rawOffer);
        listener = await listenForOauthCallback(
          offer,
          async (callback) => {
            try {
              deps.assertCurrent();
              const result = object(
                await deps.invoke({
                  op: 'callback',
                  id,
                  box: key.seal(peerKey, id, 'callback', callback),
                }),
              );
              if (result.accepted !== true) throw fail();
            } catch {
              callbackFailed = true;
              throw fail();
            }
          },
          deps.assertCurrent,
        );
        deps.assertCurrent();
        await deps.openExternal(offer.authorizeUrl);
        opened = true;
      }
      await (deps.pause?.() ?? new Promise((resolve) => setTimeout(resolve, 500)));
    }
    throw fail();
  } finally {
    listener?.close();
    clearDeviceCode?.();
    closeDeviceCode?.(finished ? 'completed' : now() >= deadline ? 'expired' : 'ended');
    if (!finished) await deps.invoke({ op: 'cancel', id }).catch(() => {});
  }
}

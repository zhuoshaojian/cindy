import { oauthId, PLUGIN_OAUTH_TTL_MS, parseDeviceAuthorizationUrl } from '@cindy/device-link';
import type {
  PluginOauthDeviceCodeTarget,
  PluginOauthDeviceCodePrompt,
  PluginOauthDeviceCodeView,
  PluginOauthDeviceCodeRequest,
  PluginOauthDeviceCodeClose,
} from '../../shared/pluginOauthDeviceCode.js';

interface Entry {
  view: PluginOauthDeviceCodeView;
  assertCurrent(): void;
  copy(): void;
  reopen(): Promise<void>;
  close: PluginOauthDeviceCodeClose;
}

const fail = () => new Error('OAUTH_BRIDGE_UNAVAILABLE');
function parseRequest(raw: unknown): PluginOauthDeviceCodeRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail();
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'actionId,deviceId,ghostId,operation,requestId' ||
      !oauthId(v.deviceId) || !oauthId(v.ghostId) || !oauthId(v.requestId) ||
      typeof v.actionId !== 'string' || !v.actionId || v.actionId.length > 256 || /[\x00-\x1f]/.test(v.actionId) ||
      typeof v.operation !== 'string' || !['read', 'copy', 'reopen'].includes(v.operation)) throw fail();
  return v as unknown as PluginOauthDeviceCodeRequest;
}

/** Bounded, in-memory display leases belonging to the exact initiating owner and renderer frame. */
export class LocalDeviceCodeSessions {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now) {}

  private key(scope: string, target: PluginOauthDeviceCodeTarget): string {
    return JSON.stringify([scope, target.deviceId, target.ghostId, target.requestId, target.actionId]);
  }

  present(scope: string, target: PluginOauthDeviceCodeTarget, prompt: PluginOauthDeviceCodePrompt, deps: {
    assertCurrent(): void;
    copy(code: string): void;
    openExternal(url: string): Promise<void>;
    clearClipboard(): void;
  }): PluginOauthDeviceCodeClose {
    deps.assertCurrent();
    const authorizeUrl = parseDeviceAuthorizationUrl(prompt.authorizeUrl);
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(prompt.userCode) ||
        !Number.isSafeInteger(prompt.expiresAt) || prompt.expiresAt <= this.now() ||
        prompt.expiresAt - this.now() > PLUGIN_OAUTH_TTL_MS) throw fail();
    const key = this.key(scope, target);
    this.entries.get(key)?.close('ended');
    if (this.entries.size >= 64) {
      for (const [oldKey, entry] of this.entries) {
        if (entry.view.phase !== 'ready') this.entries.delete(oldKey);
      }
      if (this.entries.size >= 64) throw fail();
    }
    let expiry: ReturnType<typeof setTimeout>;
    const close: PluginOauthDeviceCodeClose = phase => {
      if (entry.view.phase !== 'ready') return;
      clearTimeout(expiry);
      deps.clearClipboard();
      // Remove all closures that capture authorization material, retaining only a brief status.
      entry.view = { phase };
      entry.copy = () => { throw fail(); };
      entry.reopen = async () => { throw fail(); };
      const forget = setTimeout(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      }, 60_000);
      forget.unref?.();
    };
    const entry: Entry = {
      view: { phase: 'ready', userCode: prompt.userCode, verificationHost: new URL(authorizeUrl).hostname,
        expiresAt: prompt.expiresAt, copiedAt: this.now() },
      assertCurrent: deps.assertCurrent,
      copy: () => {
        if (entry.view.phase !== 'ready') throw fail();
        deps.copy(entry.view.userCode);
        entry.view = { ...entry.view, copiedAt: this.now() };
      },
      reopen: () => deps.openExternal(authorizeUrl),
      close,
    };
    this.entries.set(key, entry);
    expiry = setTimeout(() => close('expired'), prompt.expiresAt - this.now());
    expiry.unref?.();
    return close;
  }

  async handle(scope: string, raw: unknown): Promise<PluginOauthDeviceCodeView | null> {
    const request = parseRequest(raw);
    const entry = this.entries.get(this.key(scope, request));
    if (!entry) {
      if (request.operation === 'read') return null;
      throw fail();
    }
    try { entry.assertCurrent(); } catch {
      entry.close('ended');
      throw fail();
    }
    if (entry.view.phase === 'ready' && this.now() >= entry.view.expiresAt) entry.close('expired');
    if (request.operation !== 'read') {
      if (entry.view.phase !== 'ready') throw fail();
      if (request.operation === 'copy') entry.copy();
      else await entry.reopen();
      try { entry.assertCurrent(); } catch { entry.close('ended'); throw fail(); }
      if (entry.view.phase !== 'ready' || this.now() >= entry.view.expiresAt) {
        entry.close('expired');
        throw fail();
      }
    }
    return { ...entry.view };
  }
}

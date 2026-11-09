import { CloudClientError, type CloudClientHttp } from '../../main/cloud-settings-client/transport';
import { SETTINGS_WEB_LARGE_RESULT_MAX_BYTES } from '../../shared/settingsWeb';

/**
 * The CIS browser session for the shared cloud client modules. They were written for the
 * native caller (Bearer token, `/client/*` sessions); here the same calls use the page's
 * HttpOnly session cookie and the routes CIS already serves to its own web page.
 */
const MANAGE = '/instance-login/api/manage/instances';
const SESSION_PATH = /^\/client\/instances\/([^/]+)\/settings\/sessions(?:\/[^/]+(\/.*)?)?$/u;
const MAINTENANCE_PATH = /^\/instances\/([^/]+)\/maintenance(\/.*)?$/u;

/** Thrown once the CIS session has ended, so the page can return to sign-in. */
export class CisSignedOutError extends Error {
  constructor() {
    super('CIS_SIGNED_OUT');
  }
}

export interface CisFetch {
  (path: string, method: string, body: unknown, signal: AbortSignal, limit?: number): Promise<unknown>;
}

function failure(status: number, path: string, method: string): CloudClientError {
  return new CloudClientError(
    status === 404 || status === 501
      ? 'CLOUD_SETTINGS_UNSUPPORTED'
      : status === 409 && (method === 'PATCH' || /\/maintenance\/upgrade$/u.test(path))
        ? 'CLOUD_SETTINGS_CONFLICT'
        : status === 401 || status === 403 || status === 409
          ? 'CLOUD_SETTINGS_SCOPE_CHANGED'
          : status === 429
            ? 'CLOUD_SETTINGS_BUSY'
            : 'CLOUD_SETTINGS_UNAVAILABLE',
  );
}

/** Same-origin JSON over the session cookie, bounded like the native transport. */
export function createCisFetch(onSignedOut: () => void): CisFetch {
  return async (path, method, body, signal, limit = 512 * 1024) => {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
    } catch {
      throw new CloudClientError('CLOUD_SETTINGS_UNAVAILABLE');
    }
    if (!response.ok) {
      let code: unknown;
      try {
        code = ((await response.json()) as { error?: { code?: unknown } })?.error?.code;
      } catch {
        /* Only the status and a known code are used. */
      }
      if (response.status === 401 || code === 'WEB_SESSION_REQUIRED') {
        onSignedOut();
        throw new CisSignedOutError();
      }
      const error = failure(response.status, path, method);
      (error as CloudClientError & { remoteCode?: unknown }).remoteCode = code;
      throw error;
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit)
      throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
    try {
      return JSON.parse(text);
    } catch {
      throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
    }
  };
}

/**
 * Native caller paths mapped onto the browser routes. A settings "session" is the browser
 * session itself: opening one reads the Host capabilities; heartbeats and close are local.
 */
export function createCisClientHttp(request: CisFetch): CloudClientHttp {
  const devices = new Map<string, string>();
  return {
    async request(_identity, path, method, body, signal, assertCurrent) {
      assertCurrent();
      if (path === '/client/access') {
        try {
          await request('/instance-login/api/session', 'GET', undefined, signal);
          return { schemaVersion: 1, allowed: true };
        } catch (error) {
          if ((error as { remoteCode?: unknown }).remoteCode === 'MANAGEMENT_ACCESS_DENIED')
            return { schemaVersion: 1, allowed: false };
          throw error;
        }
      }
      const maintenance = MAINTENANCE_PATH.exec(path);
      if (maintenance)
        return request(`${MANAGE}/${maintenance[1]}/maintenance${maintenance[2] ?? ''}`, method, body, signal);
      const session = SESSION_PATH.exec(path);
      if (!session) {
        const result = await request(path, method, body, signal);
        if (path === MANAGE && method === 'GET') {
          const instances = (result as { instances?: Array<{ instanceId?: unknown; deviceId?: unknown }> })?.instances;
          for (const item of Array.isArray(instances) ? instances : [])
            if (typeof item.instanceId === 'string' && typeof item.deviceId === 'string')
              devices.set(item.instanceId, item.deviceId);
        }
        return result;
      }
      const instanceId = decodeURIComponent(session[1]!);
      const base = `${MANAGE}/${encodeURIComponent(instanceId)}/settings`;
      const suffix = session[2] ?? '';
      if (!path.includes('/sessions/')) {
        // Open: the browser session is already the caller; read what the Host offers.
        const capabilities = (await request(base, 'GET', undefined, signal)) as Record<string, unknown>;
        const deviceId = devices.get(instanceId);
        if (!deviceId) throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
        return {
          sessionId: crypto.randomUUID(),
          instanceId,
          deviceId,
          runtimeId: capabilities.runtimeId,
          domains: capabilities.domains,
          ...(capabilities.readBatch === true ? { readBatch: true } : {}),
          ...(capabilities.managementV1 === true ? { managementV1: true } : {}),
          ...(capabilities.resultWait === true ? { resultWait: true } : {}),
          ...(typeof capabilities.resourceCpuCores === 'number'
            ? { resourceCpuCores: capabilities.resourceCpuCores }
            : {}),
        };
      }
      if (suffix === '' && method === 'DELETE') return undefined;
      if (suffix === '/heartbeat') return { ok: true };
      if (suffix.startsWith('/requests')) return request(`${base}${suffix}`, method, body, signal);
      throw new CloudClientError('CLOUD_SETTINGS_UNSUPPORTED');
    },
  };
}

export const CIS_LARGE_RESULT_BYTES = SETTINGS_WEB_LARGE_RESULT_MAX_BYTES + 4096;

import { parseDeviceAuthorizationUrl } from '@cindy/device-link';
import { ghostNetworkHostMatches, type GhostManifest } from '../../shared/ghost.js';

/** Narrow only browser authorization delegation; ordinary in-flight plugin network capabilities are unchanged. */
export function bindDeviceAuthorizationTarget(manifest: GhostManifest, raw: string): (current: GhostManifest) => void {
  const url = new URL(parseDeviceAuthorizationUrl(raw));
  const snapshot = JSON.stringify({id: manifest.id, version: manifest.version, network: manifest.network ?? null});
  const allowed = (m: GhostManifest) => {
    if (url.port) return false; // HTTPS default only; no alternate local/private service on a permitted hostname.
    // Existing packaged CLI adapters: bind the provider endpoint, never infer trust from CLI text.
    // GitHub supplies the private user code separately; TapTap's reviewed adapter uses only ?code=.
    if (m.id === 'cindy-github') return url.origin === 'https://github.com'
      && url.pathname === '/login/device' && !url.search && !url.hash;
    if (m.id === 'taptap-maker') return url.origin === 'https://maker.taptap.cn'
      && url.pathname === '/pat-tokens' && !url.hash
      && [...url.searchParams.keys()].join(',') === 'code'
      && /^[A-Za-z0-9_-]{32}$/.test(url.searchParams.get('code') ?? '');
    const declaration = m.network;
    const oauthOrigins = (declaration?.secrets ?? []).flatMap(s => s.oauth ? [new URL(s.oauth.authorizeUrl).origin] : []);
    const hosts = declaration?.hosts ?? [];
    // Undeclared targets fail closed. An extra confirmation is not a substitute for a trusted target.
    return oauthOrigins.includes(url.origin)
      || hosts.some(h => ghostNetworkHostMatches(h, url.hostname));
  };
  if (!allowed(manifest)) throw new Error('DEVICE_AUTHORIZATION_TARGET_REJECTED');
  return current => {
    if (snapshot !== JSON.stringify({id: current.id, version: current.version, network: current.network ?? null})
      || !allowed(current)) throw new Error('DEVICE_AUTHORIZATION_TARGET_REJECTED');
  };
}

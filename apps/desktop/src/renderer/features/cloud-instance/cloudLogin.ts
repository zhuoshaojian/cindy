/** Derive the CIS browser-login URL from the locally validated endpoint only. */
export function cloudInstanceLoginUrl(): string | null {
  const baseUrl = window.electronAPI?.clientEndpoints?.cloudInstanceApiBaseUrl?.trim();
  if (!baseUrl) return null;
  try {
    const url = new URL('/instance-login', baseUrl);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

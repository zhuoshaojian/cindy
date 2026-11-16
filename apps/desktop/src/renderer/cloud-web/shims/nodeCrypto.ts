/**
 * Browser stand-in for the node:crypto calls in the shared cloud client and viewer modules
 * this build reuses. Clipboard sync (the only hashing caller) is not offered on the web.
 */
export function randomUUID(): string {
  return crypto.randomUUID();
}
export function createHash(): never {
  throw new Error('DESKTOP_VIEWER_CLIPBOARD_UNAVAILABLE');
}

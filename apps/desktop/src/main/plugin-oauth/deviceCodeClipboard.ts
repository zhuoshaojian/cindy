/** Own only this temporary code; never erase newer user clipboard content. */
export function copyPrivateDeviceCode(
  clipboard: { writeText(value: string): void; readText(): string; clear(): void },
  code: string,
): () => void {
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) throw new Error('OAUTH_BRIDGE_UNAVAILABLE');
  clipboard.writeText(code);
  return () => {
    try {
      if (clipboard.readText() === code) clipboard.clear();
    } catch {
      /* clipboard service closed */
    }
  };
}

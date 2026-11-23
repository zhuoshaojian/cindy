/** The remote desktop is a browser tab of its own, like the native viewer window. */
export function openDesktopTab(deviceId: string, name: string): void {
  const params = new URLSearchParams({ deviceId, name });
  if (!window.open(`${location.pathname}#/desktop?${params}`, '_blank')) throw new Error('DESKTOP_TAB_BLOCKED');
}

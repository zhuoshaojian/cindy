/** Browser-only adapter. No React, Electron, credentials or device-link ownership. */
export function mountRemoteDesktopViewer(
  root: Document | HTMLElement,
  post: (message: Record<string, unknown>) => void,
  config: {
    net: object;
    iceServers: readonly object[];
    keyCodes: readonly string[];
    desktop?: boolean;
    nativeMedia?: boolean;
    /** A browser page without a native clipboard helper: Cmd/Ctrl+V goes through the browser's paste event. */
    browserPaste?: boolean;
  },
): { receive(message: object): void; dispose(): void };

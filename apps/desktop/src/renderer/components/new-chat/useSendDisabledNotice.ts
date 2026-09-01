import { useCallback, useEffect, useRef } from 'react';

export function useSendDisabledNotice({
  active,
  message,
  onNotify,
}: {
  active: boolean;
  message?: string;
  onNotify: (message: string) => void;
}): () => void {
  const shownRef = useRef(false);

  useEffect(() => {
    if (!active || !message) shownRef.current = false;
  }, [active, message]);

  return useCallback(() => {
    if (!active || !message || shownRef.current) return;
    shownRef.current = true;
    onNotify(message);
  }, [active, message, onNotify]);
}

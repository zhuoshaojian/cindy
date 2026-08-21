/** A session seam used to drain only sessions that are still idle. */
export interface CloudQuiesceSession {
  closeIfIdle(): Promise<boolean>;
}

export interface CloudQuiesceResult {
  quiesced: boolean;
  attempted: number;
  closed: number;
  reason: 'quiesced' | 'session-busy' | 'close-failed';
}

/**
 * Close idle sessions before the control plane stops the process. Any busy or
 * failed session keeps the runtime alive; callers must clear their draining
 * gate when `quiesced` is false.
 */
export async function quiesceCloudSessions(
  sessions: readonly CloudQuiesceSession[],
): Promise<CloudQuiesceResult> {
  let closed = 0;
  for (const session of sessions) {
    try {
      if (!(await session.closeIfIdle())) {
        return {
          quiesced: false,
          attempted: closed + 1,
          closed,
          reason: 'session-busy',
        };
      }
    } catch {
      return {
        quiesced: false,
        attempted: closed + 1,
        closed,
        reason: 'close-failed',
      };
    }
    closed += 1;
  }
  return {
    quiesced: true,
    attempted: sessions.length,
    closed,
    reason: 'quiesced',
  };
}

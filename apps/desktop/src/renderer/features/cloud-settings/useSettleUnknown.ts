import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * S3 (owner, 2026-11-09: "the system checks, and says only what it knows"): when a write's
 * outcome is unknown, its result is read back, never written again. Each entry waits this long
 * before each read; a read that answers decides.
 */
export const SETTLE_DELAYS_MS = {
  /** Sleep and wake, read from the instance list. */
  power: [2_000, 4_000, 8_000, 16_000, 30_000],
  /** Claiming the first instance, read from the instance list. */
  claim: [2_000, 4_000, 8_000, 16_000, 30_000],
  /** An upgrade request, read from the instance. */
  upgrade: [2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
  /** An automatic save of the update settings, read from the instance's policy. */
  policy: [1_000, 2_000, 4_000, 8_000, 15_000],
  /** An authorization, read from its operation or, failing that, the item's connection. */
  authorization: [2_000, 4_000, 8_000, 16_000, 30_000],
} as const;

/** What one read found: the change took effect, it did not, or not yet decided (read again). */
export type SettleVerdict = 'done' | 'notDone' | 'pending';
/** checking: reading back. unreadable: no read answered; a reload reads once more. */
export type SettleState = 'checking' | 'unreadable';

/**
 * Reads back the outcome of one write whose result is unknown, backing off between reads.
 * `check` throws when it cannot read, and returns a verdict when it can. With `until`, the last
 * delay repeats until that time (a sign-in that may still finish); otherwise the reads end with
 * the list. Starting again, or a new context, replaces the previous check.
 */
export function useSettleUnknown<C>({
  check,
  delays,
  until,
  onSettled,
}: {
  check(context: C): Promise<SettleVerdict>;
  delays: readonly number[];
  until?(context: C): number | undefined;
  onSettled(verdict: 'done' | 'notDone', context: C): void;
}) {
  const [state, setState] = useState<SettleState>();
  const [context, setContext] = useState<C>();
  const run = useRef(0);
  const latest = useRef({ check, until, onSettled });
  latest.current = { check, until, onSettled };
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );
  const read = async (id: number, value: C) => {
    try {
      const verdict = await latest.current.check(value);
      if (id !== run.current) return true;
      if (verdict === 'pending') return false;
      run.current++;
      setState(undefined);
      setContext(undefined);
      latest.current.onSettled(verdict, value);
      return true;
    } catch {
      return id !== run.current;
    }
  };
  const wait = (id: number, ms: number) =>
    new Promise<boolean>((resolve) => setTimeout(() => resolve(id === run.current), ms));
  const start = useCallback(async (value: C) => {
    const id = ++run.current;
    setContext(value);
    setState('checking');
    for (let attempt = 0; ; attempt++) {
      const deadline = latest.current.until?.(value);
      const delay =
        attempt < delays.length
          ? delays[attempt]!
          : deadline !== undefined && Date.now() < deadline
            ? delays[delays.length - 1]!
            : undefined;
      if (delay === undefined) break;
      // A hidden window waits; nothing is read until it is shown again.
      if (!(await wait(id, delay))) return;
      while (document.visibilityState === 'hidden') if (!(await wait(id, 1_000))) return;
      if (await read(id, value)) return;
    }
    if (id === run.current) setState('unreadable');
  }, [delays]);
  /** After the reads ran out: one more read now, still read-only. */
  const reload = useCallback(async () => {
    if (state !== 'unreadable' || context === undefined) return;
    const id = ++run.current;
    setState('checking');
    if (!(await read(id, context)) && id === run.current) setState('unreadable');
  }, [state, context]);
  /** Stops checking without a verdict (the item went away, the page left). */
  const stop = useCallback(() => {
    run.current++;
    setState(undefined);
    setContext(undefined);
  }, []);
  return { state, context, start, reload, stop };
}

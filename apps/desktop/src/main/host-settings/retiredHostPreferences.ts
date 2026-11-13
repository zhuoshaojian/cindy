import { createLogger } from '../logger.js';
import { returnRetiredDesktopPreferences } from './retiredDesktopPreferences.js';
import { returnRetiredModelPresentation } from './retiredModelPresentation.js';
import { returnRetiredPersonalization } from './retiredPersonalization.js';

const log = createLogger('retired-host-preferences');
type Outcome = 'none' | 'returned' | 'retry';
// Settings earlier cloud builds kept in Host files; each goes back where upstream keeps it, once.
const RETURNS: ReadonlyArray<{ name: string; run(): Promise<Outcome> }> = [
  { name: 'desktop preferences', run: () => returnRetiredDesktopPreferences() },
  { name: 'model visibility, engines and favorites', run: () => returnRetiredModelPresentation() },
  { name: 'custom instructions', run: () => returnRetiredPersonalization() },
];

/** Cloud instances only. Tries after startup and then every half minute for up to an hour. */
export function startReturningRetiredHostPreferences(): () => void {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let attempts = 0;
  let pending = [...RETURNS];
  const schedule = (delay: number) => { timer = setTimeout(() => void attempt(), delay); timer.unref?.(); };
  const attempt = async () => {
    timer = null;
    const next: typeof pending = [];
    for (const item of pending) {
      if (stopped) return;
      const outcome = await item.run().catch((): Outcome => 'retry');
      if (outcome === 'returned') log.info(`earlier ${item.name} returned to the app window`);
      if (outcome === 'retry') next.push(item);
    }
    pending = next;
    if (pending.length && !stopped && ++attempts < 120) schedule(30_000);
  };
  schedule(10_000);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

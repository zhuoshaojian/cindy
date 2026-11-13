import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { manageAppPreferences } from '../app-settings/preferences.js';
import { appPreferenceSchema, type AppPreferencePatch } from '../../shared/appPreferenceControl.js';
import { createLogger } from '../logger.js';

const log = createLogger('retired-desktop-preferences');
const FILE = 'host-desktop-preferences.json';
const RETURNED = 'host-desktop-preferences.returned.json';
// Field in the earlier builds' file → upstream preference, with what those builds showed when absent.
const FIELDS: Record<string, readonly [keyof AppPreferencePatch, unknown]> = {
  theme: ['theme', 'system'], themeFamilyId: ['themeFamily', 'cindy'], locale: ['language', 'system'],
  sidebarPinnedMode: ['sidebarPinned', 'text'], sidebarMainMode: ['sidebarTasks', 'list'],
  notificationsEnabled: ['notifications', true], feishuNotificationsEnabled: ['feishuNotifications', false],
  swallowActivationClick: ['swallowActivationClick', false], composerSendShortcut: ['sendShortcut', 'enter'],
  webLinkOpenPreference: ['webLinks', 'external'], localLinkOpenPreference: ['localLinks', 'sidebar'],
  streamFadePreference: ['streamFade', 'on'], promptRecommendationEnabled: ['promptRecommendations', true],
  messageNavRailEnabled: ['messageNavigation', true], networkDebugEnabled: ['networkDebug', false],
};

/**
 * What an earlier cloud build showed, as upstream preferences. Null when that build never held
 * them: before its first import the app window's own storage was still the source.
 */
export function retiredDesktopPreferencePatch(raw: unknown, themeFamilies: readonly string[]): AppPreferencePatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as { _initialized?: unknown })._initialized !== true) return null;
  const stored = raw as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [field, [key, absent]] of Object.entries(FIELDS)) {
    const value = Object.hasOwn(stored, field) ? stored[field] : absent;
    if (!appPreferenceSchema.shape[key].safeParse(value).success) continue;
    if (key === 'themeFamily' && !themeFamilies.includes(value as string)) continue;
    patch[key] = value;
  }
  return patch as AppPreferencePatch;
}

// The window answered and refused this one value (a removed theme, a shortcut conflict).
const refused = (error: unknown) => error instanceof Error && ['PREFERENCE_NOT_SAVED', 'PREFERENCE_READBACK_MISMATCH'].includes(error.message);

/**
 * Earlier cloud builds kept the desktop preferences in a Host file; they now live in the app window
 * as upstream keeps them. Each value goes back through upstream's preferences once, then the file
 * is kept aside for manual recovery. `retry`: the window did not answer yet (starting, signed out).
 */
export async function returnRetiredDesktopPreferences(
  root = app.getPath('userData'), manage: typeof manageAppPreferences = manageAppPreferences,
): Promise<'none' | 'returned' | 'retry'> {
  const file = path.join(root, FILE);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'retry'; }
  let raw: unknown = null;
  try { raw = JSON.parse(text); } catch { /* an unreadable file is kept aside unchanged */ }
  try {
    const patch = retiredDesktopPreferencePatch(raw, (await manage('get')).themeFamilies ?? []) ?? {};
    for (const [key, value] of Object.entries(patch)) {
      try { await manage('update', { [key]: value }); }
      catch (error) { if (!refused(error)) throw error; log.warn('earlier desktop preference not taken', { key }); }
    }
  } catch { return 'retry'; }
  fs.renameSync(file, path.join(root, RETURNED));
  return 'returned';
}

/** Cloud instances only. Tries after startup and then every half minute for up to an hour. */
export function startReturningRetiredDesktopPreferences(): () => void {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let attempts = 0;
  const schedule = (delay: number) => { timer = setTimeout(() => void attempt(), delay); timer.unref?.(); };
  const attempt = async () => {
    timer = null;
    if (stopped) return;
    const outcome = await returnRetiredDesktopPreferences().catch(() => 'retry' as const);
    if (outcome === 'returned') log.info('earlier desktop preferences returned to the app window');
    if (outcome === 'retry' && !stopped && ++attempts < 120) schedule(30_000);
  };
  schedule(10_000);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

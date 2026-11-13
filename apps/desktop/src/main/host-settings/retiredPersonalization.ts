import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { manageAppPreferences } from '../app-settings/preferences.js';
import { dataOwnerStorageKey } from '../appSessionState.js';
import { currentSettingsOwner } from './personalization.js';

const FILE = 'host-personalization.json';
const RETURNED = 'host-personalization.returned.json';
type Window = (userPrompt?: string) => Promise<string>;
const upstream: Window = async userPrompt =>
  (await manageAppPreferences('user-prompt', undefined, undefined, undefined, userPrompt)).userPrompt ?? '';

/**
 * Earlier cloud builds kept the owner's custom instructions in a Host file; they now live in the
 * app window as upstream keeps them. The window takes the file's text once, then the file is kept
 * aside. A file the earlier build never took over leaves the window's own text as it is.
 */
export async function returnRetiredPersonalization(root: string | null = ownerRoot(), window: Window = upstream): Promise<'none' | 'returned' | 'retry'> {
  if (!root) return 'retry';
  const file = path.join(root, FILE);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'retry'; }
  let raw: unknown = null;
  try { raw = JSON.parse(text); } catch { /* an unreadable file is kept aside unchanged */ }
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { _initialized?: unknown; userPrompt?: unknown } : null;
  if (stored?._initialized === true) {
    const wanted = typeof stored.userPrompt === 'string' && stored.userPrompt.length <= 8000 ? stored.userPrompt : '';
    try {
      if (await window() !== wanted && await window(wanted) !== wanted) return 'retry';
    } catch { return 'retry'; }
  }
  fs.renameSync(file, path.join(root, RETURNED));
  return 'returned';
}

function ownerRoot(): string | null {
  const owner = currentSettingsOwner();
  return owner?.dataOwnerId ? path.join(app.getPath('userData'), 'owners', dataOwnerStorageKey(owner.dataOwnerId)) : null;
}

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { manageAppPreferences } from '../app-settings/preferences.js';
import { dataOwnerStorageKey } from '../appSessionState.js';
import { validateNewTaskPreferenceHistory, type NewTaskPreferenceHistory, type PreferenceVendor } from '../../shared/newTaskPreferenceHistory.js';
import { currentSettingsOwner } from './personalization.js';

const FILE = 'host-new-task-defaults.json';
const RETURNED = 'host-new-task-defaults.returned.json';
type Window = (history: NewTaskPreferenceHistory) => Promise<void>;
const upstream: Window = async newTaskHistory => {
  await manageAppPreferences('new-task-history', undefined, undefined, { newTaskHistory });
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const harnessVendor = (value: unknown): PreferenceVendor | null =>
  value === 'claude-code' ? 'cc' : value === 'codex' || value === 'pi' ? value : null;
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 256;

/**
 * The choices an earlier cloud build saved: its history of the new-task page, with the fields it
 * kept as explicit overrides laid over it. Fields it left to the recommendation stay unchosen.
 */
export function retiredNewTaskHistory(raw: unknown): NewTaskPreferenceHistory | null {
  if (!record(raw) || raw._initialized !== true) return null;
  const base = raw._history;
  if (base !== null && base !== undefined) validateNewTaskPreferenceHistory(base);
  const history: NewTaskPreferenceHistory = structuredClone((base as NewTaskPreferenceHistory | undefined) ?? {
    vendor: 'cc', lastByVendor: {}, modelChosenByVendor: {}, defaultTupleCustomized: false, defaultTupleSelectionCustomized: false,
    effortByModel: {}, fastModeByModel: {}, worktreeEnabled: false, worktreePreferenceCustomized: false, providerModelMemory: {},
  });
  const has = (key: string) => Object.hasOwn(raw, key);
  const vendor = (has('harness') ? harnessVendor(raw.harness) : null) ?? history.vendor;
  const harness = vendor === 'cc' ? 'claude-code' : vendor;
  const selection = ['harness', 'providerId', 'modelId'].some(has);
  const active = { model: '', effort: '', providerId: null as string | null, ...history.lastByVendor[vendor] };
  if (has('modelId')) active.model = text(raw.modelId) ? raw.modelId : '';
  if (has('providerId')) active.providerId = text(raw.providerId) ? raw.providerId : null;
  if (has('effort')) active.effort = text(raw.effort) ? raw.effort : '';
  if (has('planMode') && typeof raw.planMode === 'boolean') active.planMode = raw.planMode;
  history.vendor = vendor;
  history.lastByVendor[vendor] = active;
  if (selection) {
    history.modelChosenByVendor[vendor] = true;
    history.defaultTupleSelectionCustomized = true;
  }
  if (selection || ['effort', 'fast', 'thinking'].some(has)) history.defaultTupleCustomized = true;
  const fast = raw.fast === true || raw.fast === false || raw.fast === 'ultrafast' ? raw.fast : undefined;
  if (active.model && fast !== undefined) history.fastModeByModel[active.model] = fast;
  if (active.model && active.providerId) {
    const key = `${harness}:${active.providerId}`;
    const memory = history.providerModelMemory[key] ?? { lastModel: '', effortByModel: {}, fastByModel: {}, thinkingByModel: {} };
    if (selection) memory.lastModel = active.model;
    if (fast !== undefined) memory.fastByModel[active.model] = fast;
    if (typeof raw.thinking === 'boolean') memory.thinkingByModel[active.model] = raw.thinking;
    history.providerModelMemory[key] = memory;
  }
  if (has('worktree') && typeof raw.worktree === 'boolean') {
    history.worktreeEnabled = raw.worktree;
    history.worktreePreferenceCustomized = true;
  }
  validateNewTaskPreferenceHistory(history);
  return history;
}

/**
 * Earlier cloud builds kept the owner's new-task choices in a Host file; they now live in the app
 * window's new-task draft as upstream keeps them. The window takes them once, then the file is kept
 * aside. A file the earlier build never took over, or one that cannot be read, is only kept aside.
 */
export async function returnRetiredNewTaskDefaults(root: string | null = ownerRoot(), window: Window = upstream): Promise<'none' | 'returned' | 'retry'> {
  if (!root) return 'retry';
  const file = path.join(root, FILE);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'retry'; }
  let history: NewTaskPreferenceHistory | null = null;
  try { history = retiredNewTaskHistory(JSON.parse(text)); } catch { /* kept aside unchanged */ }
  if (history) {
    try { await window(history); } catch { return 'retry'; }
  }
  fs.renameSync(file, path.join(root, RETURNED));
  return 'returned';
}

function ownerRoot(): string | null {
  const owner = currentSettingsOwner();
  return owner?.dataOwnerId ? path.join(app.getPath('userData'), 'owners', dataOwnerStorageKey(owner.dataOwnerId)) : null;
}

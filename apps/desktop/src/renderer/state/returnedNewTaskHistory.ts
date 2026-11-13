import type { NewTaskPreferenceHistory } from '../../shared/newTaskPreferenceHistory';
import type { AgentKind } from '@/hooks/useAgentCapabilities';
import type { Effort, PermissionMode } from '@/lib/userPreferences.types';
import {
  markDefaultTupleCustomized, patchVendorPrefs, patchVendorPrefsPreservingModelChoice, setEffortForModel,
  setFastModeForModel, setNewChatDefaultPermissionMode, setWorktreePreference, switchVendor, type VendorPrefs,
} from './newMakerDraft';
import {
  editProviderModelMemoryBatch, getProviderModelEffort, setProviderModelChoice, setProviderModelThinking,
  snapshotForSeed, type ProviderModelMemoryEdit,
} from './providerModelMemory';

const AGENTS = new Set<string>(['claude-code', 'codex', 'pi']);
/** Draft fields an earlier cloud build kept beside the window's draft while the Host held the rest. */
const workspaceKey = (ownerId: string) => `xdt:newMakerDraft:v1:${encodeURIComponent(ownerId)}:workspace`;

function slotOf(key: string): { agent: AgentKind; providerId: string } | null {
  const at = key.indexOf(':');
  const agent = key.slice(0, at);
  const providerId = key.slice(at + 1);
  // The `agent:*` preset slot is written together with each source slot below.
  return at > 0 && AGENTS.has(agent) && providerId && providerId !== '*' ? { agent: agent as AgentKind, providerId } : null;
}

/**
 * Earlier cloud builds kept the owner's new-task choices outside the app window. This writes them
 * back once through the setters the new-task page itself uses, so the window's draft and model
 * memory hold them again. Per-model effort and Fast that were cleared there are cleared here too.
 */
export function applyReturnedNewTaskHistory(history: NewTaskPreferenceHistory, ownerId: string): void {
  try {
    const raw = localStorage.getItem(workspaceKey(ownerId));
    const mode = raw ? (JSON.parse(raw) as { newChatDefaultPermissionMode?: unknown }).newChatDefaultPermissionMode : undefined;
    if (typeof mode === 'string' && mode) setNewChatDefaultPermissionMode(mode as PermissionMode);
  } catch { /* a damaged side record only loses that one default */ }
  for (const vendor of ['cc', 'codex', 'pi'] as const) {
    const saved = history.lastByVendor[vendor];
    if (!saved) continue;
    const patch: Partial<VendorPrefs> = { model: saved.model, providerId: saved.providerId, effort: saved.effort as Effort,
      ...(typeof saved.planMode === 'boolean' ? { planMode: saved.planMode } : {}) };
    if (history.modelChosenByVendor[vendor]) patchVendorPrefs(vendor, patch);
    else patchVendorPrefsPreservingModelChoice(vendor, patch);
    // A remembered permission is not a new explicit choice.
    if (saved.permissionMode)
      patchVendorPrefsPreservingModelChoice(vendor, { permissionMode: saved.permissionMode as PermissionMode });
  }
  switchVendor(history.vendor);
  if (history.defaultTupleCustomized) markDefaultTupleCustomized(history.defaultTupleSelectionCustomized);
  for (const [model, effort] of Object.entries(history.effortByModel)) setEffortForModel(model, effort as Effort);
  for (const [model, fast] of Object.entries(history.fastModeByModel)) setFastModeForModel(model, fast);
  if (history.worktreePreferenceCustomized) setWorktreePreference(history.worktreeEnabled);

  const edits: ProviderModelMemoryEdit[] = [];
  const current = snapshotForSeed();
  for (const [key, memory] of Object.entries(current)) {
    const slot = slotOf(key);
    const kept = history.providerModelMemory[key];
    if (!slot) continue;
    for (const model of Object.keys(memory.effortByModel))
      if (!kept || !Object.hasOwn(kept.effortByModel, model)) edits.push({ kind: 'clear-effort', ...slot, model });
    for (const model of Object.keys(memory.fastByModel))
      if (!kept || !Object.hasOwn(kept.fastByModel, model)) edits.push({ kind: 'clear-fast', ...slot, model });
  }
  for (const [key, memory] of Object.entries(history.providerModelMemory)) {
    const slot = slotOf(key);
    if (!slot) continue;
    for (const [model, effort] of Object.entries(memory.effortByModel))
      edits.push({ kind: 'set-effort', ...slot, model, effort: effort as Effort });
    for (const [model, enabled] of Object.entries(memory.fastByModel))
      edits.push({ kind: 'set-fast', ...slot, model, enabled });
  }
  if (edits.length && !editProviderModelMemoryBatch(edits)) throw new Error('MODEL_MEMORY_NOT_SAVED');
  for (const [key, memory] of Object.entries(history.providerModelMemory)) {
    const slot = slotOf(key);
    if (!slot) continue;
    for (const [model, enabled] of Object.entries(memory.thinkingByModel))
      setProviderModelThinking(slot.agent, slot.providerId, model, enabled);
    const effort = memory.lastModel ? getProviderModelEffort(slot.agent, slot.providerId, memory.lastModel) : undefined;
    if (memory.lastModel && effort) setProviderModelChoice(slot.agent, slot.providerId, memory.lastModel, effort);
  }
  try { localStorage.removeItem(workspaceKey(ownerId)); } catch { /* nothing else reads it */ }
}

/** Remembered reasoning effort by memory slot and model, as the model settings show it. */
export function modelEffortSnapshot(): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.entries(snapshotForSeed()).map(([slot, memory]) => [slot, { ...memory.effortByModel }]));
}

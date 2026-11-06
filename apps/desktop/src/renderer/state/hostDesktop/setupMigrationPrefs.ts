/**
 * 托管云实例：迁移助理读写的界面偏好里，Host 保存的那部分（主题、语言、通知、聊天偏好等）
 * 与个性化提示词以 Host 为正本，窗口存储只是缓存。读出时按上游窗口存储的键和取值格式导出
 * Host 确认值；写入时只补这台云实例尚未自定义的项，等 Host 回执后才计入。其余键沿用上游实现。
 */
import { getDataOwnerGeneration } from '../../contexts/dataOwnerGeneration';
import {
  DESKTOP_PREFERENCE_KEYS, DESKTOP_PREFERENCE_STORAGE_KEYS, type DesktopPreferenceKey,
} from '../../../shared/desktopPreferences';
import { isPortableRendererPrefKey } from '../../../shared/setupMigration';
import {
  getDesktopPreference, isDesktopPreferenceCustomized, parseStoredDesktopPreference, setDesktopPreference,
} from '../hostDesktopPreferences';
import { getUserPromptView, hasHostPersonalization, refreshUserPrompt, setUserPrompt } from '../hostPersonalization';

type ReadPrefs = (storage?: Storage, ownerId?: string | null) => Record<string, string>;
type ApplyPrefs = (values: Record<string, string>, storage?: Storage, ownerId?: string | null) => number;

const PROMPT_PREFIX = 'userPrompt.value.';
/** Portable window-storage keys whose value this instance keeps in the Host profile. */
const HOST_KEYS = new Map<string, DesktopPreferenceKey>(DESKTOP_PREFERENCE_KEYS
  .filter((key) => isPortableRendererPrefKey(DESKTOP_PREFERENCE_STORAGE_KEYS[key]))
  .map((key) => [DESKTOP_PREFERENCE_STORAGE_KEYS[key], key]));

const ownerOf = (ownerId: string | null | undefined) => ownerId === undefined ? getDataOwnerGeneration().dataOwnerId : ownerId;
const hostPrompt = (key: string) => key.startsWith(PROMPT_PREFIX) && hasHostPersonalization();
const encode = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
/** The prompt view belongs to the signed-in owner only while its owner key names that owner. */
function promptView(owner: string | null) {
  const view = getUserPromptView();
  try { return owner && JSON.parse(view.ownerKey)[0] === owner ? view : null; } catch { return null; }
}
function writeHostPreference<K extends DesktopPreferenceKey>(key: K, raw: string): Promise<boolean> | null {
  const value = parseStoredDesktopPreference(key, raw);
  return value === undefined ? null : setDesktopPreference(key, value);
}

/** Answers another computer with what this instance actually uses, in upstream's key format. */
export function hostedPortablePrefsReader(readLocal: ReadPrefs): ReadPrefs {
  return (storage, ownerId) => {
    const owner = ownerOf(ownerId);
    const prefs = readLocal(storage, owner);
    for (const key of Object.keys(prefs)) if (HOST_KEYS.has(key) || hostPrompt(key)) delete prefs[key];
    for (const [storageKey, key] of HOST_KEYS) {
      if (isDesktopPreferenceCustomized(key)) prefs[storageKey] = encode(getDesktopPreference(key));
    }
    const view = hasHostPersonalization() ? promptView(owner) : null;
    if (owner && view?.ready && view.customized) prefs[`${PROMPT_PREFIX}${owner}`] = view.value;
    return prefs;
  };
}

/** Like upstream, keeps what this instance already chose; counts a Host value once it is saved. */
export function hostedPortablePrefsApplier(applyLocal: ApplyPrefs) {
  return async (values: Record<string, string>, storage?: Storage, ownerId?: string | null): Promise<number> => {
    const owner = ownerOf(ownerId);
    const local: Record<string, string> = {};
    const writes: Promise<boolean>[] = [];
    let prompt: string | null = null;
    for (const [storageKey, raw] of Object.entries(values)) {
      const key = HOST_KEYS.get(storageKey);
      if (key) {
        if (typeof raw !== 'string' || isDesktopPreferenceCustomized(key)) continue;
        const write = writeHostPreference(key, raw);
        if (write) writes.push(write);
      } else if (hostPrompt(storageKey)) {
        if (owner && storageKey === `${PROMPT_PREFIX}${owner}` && typeof raw === 'string') prompt = raw;
      } else {
        local[storageKey] = raw;
      }
    }
    let changed = applyLocal(local, storage, owner);
    changed += (await Promise.all(writes)).filter(Boolean).length;
    if (prompt !== null) {
      await refreshUserPrompt();
      const view = promptView(owner);
      if (view?.ready && !view.customized) {
        await setUserPrompt(prompt);
        changed += 1;
      }
    }
    return changed;
  };
}

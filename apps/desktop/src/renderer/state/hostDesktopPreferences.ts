import { useSyncExternalStore } from 'react';
import {
  DESKTOP_PREFERENCE_KEYS, DESKTOP_PREFERENCE_STORAGE_KEYS, desktopPreferenceDefaults,
  normalizeDesktopPreference, type DesktopPreferenceKey, type DesktopPreferences,
  type DesktopPreferencesSnapshot, type DesktopPreferencesRendererApi, type DesktopPreferencesReaderApi,
} from '../../shared/desktopPreferences';
import { findFamilyByThemeId } from '../themes/families';
import { getSidebarInstallVintage } from '../features/cc-agent/lib/sidebarInstallVintage';
import { createLogger } from '../lib/logger';

const log = createLogger('host-desktop-preferences');
type Mutation = { set?: Partial<DesktopPreferences>; clear?: DesktopPreferenceKey[] };
type PendingMutation = Mutation | ((current: DesktopPreferences) => Mutation);
/** 只读白名单中的旧偏好，不删旧值，不读取登录、owner 或凭据存储。 */
export function captureLegacyDesktopPreferences(includeVintage = true): Partial<DesktopPreferences> | null {
  const result: Partial<DesktopPreferences> = {};
  try {
    for (const key of DESKTOP_PREFERENCE_KEYS) {
      const raw = localStorage.getItem(DESKTOP_PREFERENCE_STORAGE_KEYS[key]);
      if (raw === null) continue;
      let value: unknown = raw;
      if (key === 'agentIslandSoundSettings' || key === 'agentIslandDisplayTarget') {
        // 旧 hook 对坏 JSON 使用组默认值，但仍以键存在表示自定义；兼容迁移保留这一来源事实。
        try { value = JSON.parse(raw); } catch { value = {}; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
      } else if (typeof desktopPreferenceDefaults()[key] === 'boolean') {
        if (raw !== 'true' && raw !== 'false') continue;
        value = raw === 'true';
      } else if (key === 'sidebarPinnedMode') {
        if (raw === 'true') value = 'card';
        if (raw === 'false') value = 'text';
      }
      try { Object.assign(result, { [key]: normalizeDesktopPreference(key, value) }); } catch { /* 无效旧值沿用原 hook 的默认回退。 */ }
    }
    if (!result.themeFamilyId) {
      const family = findFamilyByThemeId(localStorage.getItem('theme.darkId')) ?? findFamilyByThemeId(localStorage.getItem('theme.lightId'));
      if (family) result.themeFamilyId = family.id;
    }
    if (!result.sidebarMainMode) {
      if (result.sidebarPinnedMode) result.sidebarMainMode = result.sidebarPinnedMode === 'text' ? 'text' : 'list';
      // 沿用既有一次性侧栏版本判定，不按「值等于默认值」猜来源。
      else if (includeVintage && getSidebarInstallVintage() === 'legacy') result.sidebarMainMode = 'text';
    }
    const legacyLink = localStorage.getItem('chat.linkOpenPreference');
    if (legacyLink === 'sidebar' || legacyLink === 'external') {
      result.webLinkOpenPreference ??= legacyLink;
      result.localLinkOpenPreference ??= legacyLink;
    }
    return result;
  } catch { return null; } // 存储不可读不能作为空导入的证据。
}

/** 只有 Host 成功回执能单向刷新这几个启动兼容缓存字段。 */
function updateStartupCache(state: Extract<DesktopPreferencesSnapshot, { status: 'ready' }>): void {
  try {
    for (const key of ['theme', 'themeFamilyId', 'locale'] as const) {
      const storageKey = DESKTOP_PREFERENCE_STORAGE_KEYS[key];
      if (state.customizedKeys.includes(key)) localStorage.setItem(storageKey, state.value[key]);
      else localStorage.removeItem(storageKey);
    }
  } catch { /* Chromium 存储不可用时仍以 Host 为正本。 */ }
}

/** 每个本地 profile 的写入串行 CAS；失败或冲突时丢弃旧写入，禁止自动重放。 */
export function createDesktopPreferencesClient(options: {
  api: DesktopPreferencesReaderApi & Partial<Pick<DesktopPreferencesRendererApi, 'update'>>;
  readOnly?: boolean;
  legacy: Partial<DesktopPreferences> | null;
  initial?: DesktopPreferencesSnapshot | null;
  accepted?: (snapshot: Extract<DesktopPreferencesSnapshot, { status: 'ready' }>) => void;
  failed?: () => void;
}) {
  let stopped = false;
  let writing = false;
  let initializing = true;
  let dirty = false;
  let sequence = 0;
  let snapshot = options.initial ?? null;
  let stamp = snapshot?.profileStamp ?? null;
  let value: DesktopPreferences = snapshot?.status === 'ready' ? snapshot.value : { ...desktopPreferenceDefaults(), ...options.legacy };
  let customized = snapshot?.status === 'ready' ? snapshot.customizedKeys : Object.keys(options.legacy ?? {}) as DesktopPreferenceKey[];
  const listeners = new Set<() => void>();
  const queue: Array<{ mutation: PendingMutation; resolve: (saved: boolean) => void }> = [];
  const emit = () => listeners.forEach(fn => fn());
  const discard = () => { for (const entry of queue.splice(0)) entry.resolve(false); };
  const idle: Array<() => void> = [];
  const settle = () => { if (stopped || (!writing && !queue.length)) for (const fn of idle.splice(0)) fn(); };
  const accept = (next: DesktopPreferencesSnapshot): boolean => {
    if (stopped) return false;
    if (stamp !== null && next.profileStamp !== stamp) {
      // 存活 Renderer 不得把原 profile 的 localStorage 带入另一个 profile。
      stopped = true; discard(); options.failed?.(); return false;
    }
    stamp = next.profileStamp;
    snapshot = next;
    if (next.status === 'ready') {
      value = next.value; customized = next.customizedKeys;
      options.accepted?.(next); emit();
    }
    return true;
  };
  const reload = async () => {
    const seq = ++sequence;
    const next = await options.api.get();
    if (!stopped && seq === sequence && !writing) accept(next);
  };
  let started: Promise<void> | null = null;
  const start = (): Promise<void> => started ??= (async () => {
    try {
      let next = await options.api.get();
      if (!accept(next)) return;
      if (next.status === 'migrationPending' && options.legacy !== null && !options.readOnly && options.api.update) {
        try {
          next = await options.api.update({ profileStamp: next.profileStamp, expectedRevision: next.revision, importOnly: true, set: options.legacy });
        } catch {
          // 包括提交结果不明的传输错误：只重读，不拿新 revision 重导旧整表。
          next = await options.api.get();
        }
        accept(next);
      }
    } catch { snapshot = null; options.failed?.(); }
    finally {
      initializing = false;
      if (dirty && !writing && !stopped) {
        dirty = false;
        try { await reload(); } catch { snapshot = null; options.failed?.(); }
      }
    }
  })();
  const flush = async () => {
    if (writing || stopped) return;
    writing = true;
    try {
      await start();
      if (stopped) return;
      if (snapshot?.status !== 'ready') {
        // 恢复阶段只读；后续编辑不得静默重试已经失败的迁移。
        const next = await options.api.get();
        if (!accept(next) || next.status !== 'ready') { discard(); options.failed?.(); return; }
      }
      while (queue.length && !stopped && snapshot?.status === 'ready') {
        const entry = queue.shift()!;
        ++sequence;
        try {
          // 排队期间的组内叶子编辑基于上一份确认值计算，不重放旧 sound 整表。
          const mutation = typeof entry.mutation === 'function' ? entry.mutation(value) : entry.mutation;
          const next = await options.api.update!({ ...mutation, profileStamp: snapshot.profileStamp, expectedRevision: snapshot.revision, importOnly: false });
          entry.resolve(accept(next) && next.status === 'ready');
        } catch {
          entry.resolve(false); discard(); snapshot = null; dirty = true; options.failed?.(); break;
        }
      }
    } catch { discard(); snapshot = null; options.failed?.(); }
    finally {
      writing = false;
      if (dirty && !stopped) {
        dirty = false;
        try { await reload(); } catch { snapshot = null; options.failed?.(); }
      }
      settle();
    }
  };
  const off = options.api.onChanged(nextStamp => {
    if (stopped || (stamp !== null && stamp !== nextStamp)) return;
    if (writing || initializing) { dirty = true; return; }
    void reload().catch(() => { snapshot = null; options.failed?.(); });
  });
  return {
    start,
    get: <K extends DesktopPreferenceKey>(key: K): DesktopPreferences[K] => value[key],
    customized: (key: DesktopPreferenceKey) => customized.includes(key),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async mutate(mutation: PendingMutation): Promise<boolean> {
      if (stopped || options.readOnly || !options.api.update) return false;
      return new Promise(resolve => { queue.push({ mutation, resolve }); void flush(); });
    },
    /** Resolves once every queued write has its Host receipt (accepted, rejected or discarded). */
    settled(): Promise<void> {
      return new Promise(resolve => { idle.push(resolve); settle(); });
    },
    stop() { stopped = true; ++sequence; discard(); off(); settle(); },
  };
}

type Client = ReturnType<typeof createDesktopPreferencesClient>;
let client: Client | null = null;
let startup: Partial<DesktopPreferences> | null = null;
let startupHost: DesktopPreferencesSnapshot | null = null;
let startupRead = false;
const subscribers = new Set<() => void>();
const fallbackDefaults = desktopPreferenceDefaults();
/** Remote desktop viewer windows keep the upstream localStorage hooks. */
function isRemoteViewer(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.remoteDesktopViewer;
}

/** Preload exposes the Host profile store only on a managed cloud instance. */
export function hasHostDesktopPreferences(): boolean {
  return !!api();
}
function api(): (DesktopPreferencesReaderApi & Partial<Pick<DesktopPreferencesRendererApi, 'update'>>) | undefined {
  return typeof window === 'undefined' || isRemoteViewer() ? undefined : window.electronAPI?.desktopPreferences;
}
function ensureStartup(): void {
  if (startupRead) return;
  startupRead = true;
  try { startupHost = api()?.getSync() ?? null; } catch { startupHost = null; }
  // 读取不改写启动缓存，尤其不可影响先于迁移定型的首启标记判断。
  startup = startupHost?.status === 'ready' ? null : captureLegacyDesktopPreferences(false);
}
export function getDesktopPreference<K extends DesktopPreferenceKey>(key: K): DesktopPreferences[K] {
  ensureStartup();
  return client ? client.get(key) : startupHost?.status === 'ready' ? startupHost.value[key] : startup?.[key] ?? fallbackDefaults[key];
}
export function isDesktopPreferenceCustomized(key: DesktopPreferenceKey): boolean {
  ensureStartup();
  return client ? client.customized(key) : startupHost?.status === 'ready' ? startupHost.customizedKeys.includes(key) : Object.hasOwn(startup ?? {}, key);
}
export function subscribeDesktopPreferences(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
export function useDesktopPreference<K extends DesktopPreferenceKey>(key: K): DesktopPreferences[K] {
  return useSyncExternalStore(subscribeDesktopPreferences, () => getDesktopPreference(key));
}
export function useDesktopPreferenceCustomized(key: DesktopPreferenceKey): boolean {
  return useSyncExternalStore(subscribeDesktopPreferences, () => isDesktopPreferenceCustomized(key));
}
/** 各可信本地入口在首启门判定之后、React 挂载之前连接一次。 */
export function connectHostDesktopPreferences(options: { readOnly?: boolean } = {}): () => void {
  if (client) return () => {};
  const bridge = api();
  if (!bridge) return () => {};
  ensureStartup();
  const next = createDesktopPreferencesClient({ api: bridge, initial: startupHost, readOnly: options.readOnly,
    legacy: startupHost?.status === 'ready' ? null : options.readOnly || !bridge.update ? startup : captureLegacyDesktopPreferences(),
    accepted: updateStartupCache, failed: () => log.warn('Desktop preferences unavailable; saved Host values retained'),
  });
  client = next;
  const off = next.subscribe(() => subscribers.forEach(fn => fn()));
  void next.start();
  return () => { next.stop(); off(); if (client === next) client = null; };
}
export async function setDesktopPreference<K extends DesktopPreferenceKey>(key: K, value: DesktopPreferences[K]): Promise<boolean> {
  if (!client) connectHostDesktopPreferences();
  if (!client) return false;
  return client.mutate({ set: { [key]: normalizeDesktopPreference(key, value) } });
}
/** 组内连续编辑在写队列出队时才计算，只影响用户本次点名的叶子。 */
export async function updateDesktopPreference<K extends DesktopPreferenceKey>(key: K, update: (current: DesktopPreferences[K]) => DesktopPreferences[K]): Promise<boolean> {
  if (!client) connectHostDesktopPreferences();
  return client?.mutate(current => ({ set: { [key]: normalizeDesktopPreference(key, update(current[key])) } })) ?? false;
}
export async function clearDesktopPreference(key: DesktopPreferenceKey): Promise<boolean> {
  if (!client) connectHostDesktopPreferences();
  return client?.mutate({ clear: [key] }) ?? false;
}
/** Waits for the pending Host writes; callers then read the confirmed value, never localStorage. */
export function whenDesktopPreferencesSettled(): Promise<void> {
  return client?.settled() ?? Promise.resolve();
}
/** The Host-owned preference behind an upstream localStorage key, if this profile stores it on the Host. */
export function hostDesktopPreferenceForStorageKey(storageKey: string): DesktopPreferenceKey | undefined {
  return DESKTOP_PREFERENCE_KEYS.find(key => DESKTOP_PREFERENCE_STORAGE_KEYS[key] === storageKey);
}
export function __resetDesktopPreferencesForTests(): void {
  client?.stop(); client = null; startup = null; startupHost = null; startupRead = false; subscribers.clear();
}

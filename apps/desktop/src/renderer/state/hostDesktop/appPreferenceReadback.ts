import type { AppPreferencePatch } from '../../../shared/appPreferenceControl';
import {
  getDesktopPreference, hasHostDesktopPreferences, hostDesktopPreferenceForStorageKey, whenDesktopPreferencesSettled,
} from '../hostDesktopPreferences';

type Readback = (key: keyof AppPreferencePatch) => { value: unknown } | undefined;

/**
 * 托管云实例的桌面偏好以 Host 为正本，写入是异步回执，localStorage 只是启动缓存。
 * 等待写入回执后按 Host 确认值核对；普通桌面返回 null，沿用上游的 localStorage 核对。
 */
export async function hostedPreferenceReadback(
  storage: Record<keyof AppPreferencePatch, { key: string }>,
): Promise<Readback | null> {
  if (!hasHostDesktopPreferences()) return null;
  await whenDesktopPreferencesSettled();
  return key => {
    const hostKey = hostDesktopPreferenceForStorageKey(storage[key].key);
    return hostKey ? { value: getDesktopPreference(hostKey) } : undefined;
  };
}

/** Replaces Host-owned fields with their confirmed values; other fields keep the hook state. */
export function withHostedPreferences<T extends Required<AppPreferencePatch>>(state: T, readback: Readback | null): T {
  if (!readback) return state;
  const next = { ...state };
  for (const key of Object.keys(next) as Array<keyof AppPreferencePatch>) {
    const confirmed = readback(key);
    if (confirmed) Object.assign(next, { [key]: confirmed.value });
  }
  return next;
}

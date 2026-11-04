import { getDesktopPreference, setDesktopPreference, useDesktopPreference, subscribeDesktopPreferences } from '../hostDesktopPreferences';
export function getPromptRecommendationPreference(): boolean { return getDesktopPreference('promptRecommendationEnabled'); }
/** 旧 storage 事件只能请求读取当前值，不能再用 localStorage 改写 Host 正本。 */
export function syncPromptRecommendationPreferenceFromStorageValue(): boolean {
  return getPromptRecommendationPreference();
}
export function usePromptRecommendationPreference() {
  return { enabled: useDesktopPreference('promptRecommendationEnabled'),
    setEnabled: (next: boolean) => { void setDesktopPreference('promptRecommendationEnabled', next); } };
}
export function subscribePromptRecommendationPreference(listener: (enabled: boolean) => void): () => void {
  let previous = getPromptRecommendationPreference();
  return subscribeDesktopPreferences(() => {
    const next = getPromptRecommendationPreference();
    if (next !== previous) { previous = next; listener(next); }
  });
}

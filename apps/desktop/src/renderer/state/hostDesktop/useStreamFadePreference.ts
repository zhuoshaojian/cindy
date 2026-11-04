import { getDesktopPreference, setDesktopPreference, clearDesktopPreference, useDesktopPreference, useDesktopPreferenceCustomized } from '../hostDesktopPreferences';
import { desktopPreferenceDefaults } from '../../../shared/desktopPreferences';
export type StreamFadePreference = 'on' | 'off';
export function getStreamFadePreference(): StreamFadePreference { return getDesktopPreference('streamFadePreference'); }
export function useStreamFadeEnabled(): boolean { return useDesktopPreference('streamFadePreference') === 'on'; }
export function useStreamFadePreference() {
  return {
    preference: useDesktopPreference('streamFadePreference'),
    isCustomized: useDesktopPreferenceCustomized('streamFadePreference'),
    setPreference: (next: StreamFadePreference) => { void (next === desktopPreferenceDefaults().streamFadePreference ? clearDesktopPreference('streamFadePreference') : setDesktopPreference('streamFadePreference', next)); },
  };
}

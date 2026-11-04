import { getDesktopPreference, setDesktopPreference, clearDesktopPreference, useDesktopPreference, useDesktopPreferenceCustomized } from '../hostDesktopPreferences';
import { desktopPreferenceDefaults } from '../../../shared/desktopPreferences';
export function getMessageNavRailEnabled(): boolean { return getDesktopPreference('messageNavRailEnabled'); }
export function useMessageNavRailPreference() {
  return {
    enabled: useDesktopPreference('messageNavRailEnabled'),
    isCustomized: useDesktopPreferenceCustomized('messageNavRailEnabled'),
    setEnabled: (next: boolean) => { void (next === desktopPreferenceDefaults().messageNavRailEnabled ? clearDesktopPreference('messageNavRailEnabled') : setDesktopPreference('messageNavRailEnabled', next)); },
  };
}

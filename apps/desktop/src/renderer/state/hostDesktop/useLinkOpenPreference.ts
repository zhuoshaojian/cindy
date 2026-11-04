import { getDesktopPreference, setDesktopPreference, clearDesktopPreference, useDesktopPreference, useDesktopPreferenceCustomized } from '../hostDesktopPreferences';

import { desktopPreferenceDefaults } from '../../../shared/desktopPreferences';

export type LinkOpenPreference = 'sidebar' | 'external';
export type LinkOpenKind = 'web' | 'local';

const LINK_OPEN_DEFAULTS: Record<LinkOpenKind, LinkOpenPreference> = {
  web: desktopPreferenceDefaults().webLinkOpenPreference,
  local: desktopPreferenceDefaults().localLinkOpenPreference,
};

const field = (kind: LinkOpenKind) => kind === 'web' ? 'webLinkOpenPreference' as const : 'localLinkOpenPreference' as const;
export function getLinkOpenPreference(kind: LinkOpenKind): LinkOpenPreference { return getDesktopPreference(field(kind)); }
export function useLinkOpenPreference(kind: LinkOpenKind) {
  const key = field(kind);
  return { preference: useDesktopPreference(key), isCustomized: useDesktopPreferenceCustomized(key),
    setPreference: (next: LinkOpenPreference) => { void (next === LINK_OPEN_DEFAULTS[kind] ? clearDesktopPreference(key) : setDesktopPreference(key, next)); } };
}

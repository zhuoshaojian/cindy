import { getDesktopPreference, setDesktopPreference, clearDesktopPreference, useDesktopPreference, useDesktopPreferenceCustomized } from '../hostDesktopPreferences';

import { desktopPreferenceDefaults } from '../../../shared/desktopPreferences';
import { getVoiceInputSettings } from '@/hooks/useVoiceInputSettings';
import { findComposerVoiceInputConflict } from '@/voice-input/composerVoiceInputConflict';

export type ComposerSendShortcutPreference = 'enter' | 'modifier-enter';

export type ComposerSendShortcutUpdateResult =
  | { ok: true }
  | { ok: false; conflict: 'composer-voice-input' };

const DEFAULT_COMPOSER_SEND_SHORTCUT: ComposerSendShortcutPreference = desktopPreferenceDefaults().composerSendShortcut;

export function getComposerSendShortcutPreference(): ComposerSendShortcutPreference { return getDesktopPreference('composerSendShortcut'); }
export function useComposerSendShortcutPreference() {
  return { preference: useDesktopPreference('composerSendShortcut'), isCustomized: useDesktopPreferenceCustomized('composerSendShortcut'),
    setPreference: (next: ComposerSendShortcutPreference): ComposerSendShortcutUpdateResult => {
      if (findComposerVoiceInputConflict(next, getVoiceInputSettings().shortcut, window.electronAPI?.platform)) {
        return { ok: false, conflict: 'composer-voice-input' };
      }
      void (next === DEFAULT_COMPOSER_SEND_SHORTCUT ? clearDesktopPreference('composerSendShortcut') : setDesktopPreference('composerSendShortcut', next));
      return { ok: true };
    },
  };
}

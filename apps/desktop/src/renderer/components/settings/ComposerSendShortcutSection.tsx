import { personalizationDetailsSettings } from './PersonalizationDetails.settings-search';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Switch } from '@/components/ui/switch';
import {
  getComposerModifierShortcutLabel,
  useComposerSendShortcutPreference,
  type ComposerSendShortcutPreference,
} from '@/hooks/useComposerSendShortcutPreference';
import { toast } from '@/lib/toast';
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/ui/settings-rows';
import { DefaultOverrideControls } from './DefaultOverrideControls';

export function ComposerSendShortcutSection() {
  const { t } = useTranslation();
  const { preference, isCustomized, setPreference } = useComposerSendShortcutPreference();
  const shortcut = getComposerModifierShortcutLabel(window.electronAPI?.platform);

  const onReset = useCallback(() => {
    setPreference('enter');
    toast.success(t('settings.defaults.restored'));
  }, [setPreference, t]);

  return (
    <ComposerSendShortcutSectionView
      preference={preference}
      isCustomized={isCustomized}
      shortcut={shortcut}
      onReset={onReset}
      onChange={(next) => {
        const result = setPreference(next);
        if (!result.ok && result.conflict === 'composer-voice-input') {
          toast.error(t('settings.shortcuts.errors.composerVoiceConflict'));
        }
      }}
    />
  );
}

/** Presentation only: the controller owns the target, persistence and platform. */
export function ComposerSendShortcutSectionView({
  preference,
  isCustomized,
  shortcut,
  disabled = false,
  onReset,
  onChange,
}: {
  preference: ComposerSendShortcutPreference;
  isCustomized: boolean;
  shortcut: string;
  disabled?: boolean;
  onReset(): void;
  onChange(next: ComposerSendShortcutPreference): void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsSection title={t('settings.composer.title')}>
      <SettingsCard>
        <SettingsRow
          title={t(personalizationDetailsSettings.composerSendShortcutLabel.titleKey, { shortcut })}
          hint={t(personalizationDetailsSettings.composerSendShortcutLabel.descriptionKey, { shortcut })}
          trailing={
            <div className="flex shrink-0 items-center gap-2">
              <DefaultOverrideControls
                isCustomized={isCustomized}
                onReset={onReset}
                disabled={disabled}
              />
              <Switch data-setting-id={personalizationDetailsSettings.composerSendShortcutLabel.id}
                checked={preference === 'modifier-enter'}
                disabled={disabled}
                onCheckedChange={(enabled) => onChange(enabled ? 'modifier-enter' : 'enter')}
                aria-label={t('settings.composer.sendShortcut.ariaLabel', { shortcut })}
              />
            </div>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}

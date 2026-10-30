import { useEffect, useRef, useState } from 'react';
import { AppearanceSectionView } from '@/components/settings/AppearanceSection';
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_UI_FONT_SIZE,
} from '@/hooks/useFontSettings';
import type { SidebarMainViewMode, SidebarViewMode } from '@/hooks/useSidebarCardMode';
import { getThemeFamilies, type ThemeFamily } from '@/themes/families';
import type { CloudSettingsDomain, CloudSettingsState } from '../../../shared/cloudSettings';

type Attempt = (
  domain: CloudSettingsDomain,
  set: Record<string, unknown>,
  clear?: string[],
) => Promise<void>;
type ThemeOption = 'light' | 'dark' | 'system';

/** Slider drags preview locally and save once the value settles; one write per change. */
function useSettledField(
  value: number,
  save: (next: number) => Promise<void>,
  blocked: boolean,
  changed: (dirty: boolean) => void,
): [number, (next: number) => void] {
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flush = (next: number) => {
    if (blockedRef.current) {
      timer.current = window.setTimeout(() => flush(next), 300);
      return;
    }
    void save(next).finally(() => {
      setDraft((current) => (current === next ? null : current));
      changed(false);
    });
  };
  return [
    draft ?? value,
    (next) => {
      setDraft(next);
      changed(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(next), 500);
    },
  ];
}

/** Target theme choices; built-in families keep their previews, target-only themes show names. */
function targetFamilies(state: CloudSettingsState): ThemeFamily[] {
  const known = getThemeFamilies();
  const current = String(state.value?.themeFamilyId ?? '');
  const choices = state.choices?.themeFamilyId ?? [];
  const entries = choices.length ? choices : [{ value: current, label: current }];
  return entries.map(({ value, label }) => {
    const id = String(value);
    const family = known.find((entry) => entry.id === id);
    return family ? { ...family, name: label || family.name } : { id, name: label || id, light: null, dark: null };
  });
}

export function CloudAppearanceSettings({
  general,
  appearance,
  disabled,
  attempt,
  changed,
}: {
  general: CloudSettingsState;
  appearance: CloudSettingsState;
  disabled: boolean;
  attempt: Attempt;
  changed(domain: string, dirty: boolean): void;
}) {
  const g = general.value ?? {};
  const a = appearance.value ?? {};
  const markFonts = (dirty: boolean) => changed('appearance', dirty);
  const [uiSize, setUiSize] = useSettledField(
    Number(a.uiSize ?? DEFAULT_UI_FONT_SIZE),
    (uiSize) => attempt('appearance', { uiSize }),
    disabled,
    markFonts,
  );
  const [codeSize, setCodeSize] = useSettledField(
    Number(a.codeSize ?? DEFAULT_CODE_FONT_SIZE),
    (codeSize) => attempt('appearance', { codeSize }),
    disabled,
    markFonts,
  );
  return (
    <AppearanceSectionView
      theme={String(g.theme ?? 'system') as ThemeOption}
      setTheme={(theme) => void attempt('desktopGeneral', { theme })}
      familyId={String(g.themeFamilyId ?? '')}
      setFamily={(themeFamilyId) => void attempt('desktopGeneral', { themeFamilyId })}
      families={targetFamilies(general)}
      fonts={{
        uiFamily: String(a.uiFamily ?? ''),
        codeFamily: String(a.codeFamily ?? ''),
        uiSize,
        codeSize,
        setUiFamily: (uiFamily) => void attempt('appearance', { uiFamily }),
        setCodeFamily: (codeFamily) => void attempt('appearance', { codeFamily }),
        setUiSize,
        setCodeSize,
        resetUiFamily: () => void attempt('appearance', {}, ['uiFamily']),
        resetCodeFamily: () => void attempt('appearance', {}, ['codeFamily']),
        resetUiSize: () => void attempt('appearance', {}, ['uiSize']),
        resetCodeSize: () => void attempt('appearance', {}, ['codeSize']),
      }}
      sidebarViewMode={String(g.sidebarPinnedMode ?? 'text') as SidebarViewMode}
      setSidebarViewMode={(sidebarPinnedMode) => void attempt('desktopGeneral', { sidebarPinnedMode })}
      sidebarMainViewMode={String(g.sidebarMainMode ?? 'text') as SidebarMainViewMode}
      setSidebarMainViewMode={(sidebarMainMode) => void attempt('desktopGeneral', { sidebarMainMode })}
    />
  );
}

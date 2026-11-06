import type { TFunction } from 'i18next';

/** A user rename wins. Otherwise the default name carries the instance's place among
 * the owner's current instances (computed in Main), never CIS's lifetime claim count. */
export function cloudInstanceName(
  t: TFunction,
  instance: { name: string | null; ordinal: number | null },
): string {
  return (
    instance.name ??
    (instance.ordinal === null
      ? t('cloudSettings.onboarding.defaultNameSole')
      : t('cloudSettings.onboarding.defaultName', { number: instance.ordinal }))
  );
}

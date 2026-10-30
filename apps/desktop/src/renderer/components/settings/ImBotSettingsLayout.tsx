import { Lightbulb } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';

export type ImBotSettingsGroup = 'cindy' | 'personal';

/** One display order for local and remote personal IM settings. */
export const personalBotChannels = [
  'wechat',
  'wecom',
  'feishu',
  'dingtalk',
  'discord',
  'telegram',
] as const;
export type PersonalBotChannel = (typeof personalBotChannels)[number];

/** Presentation only: each target supplies its own controllers and connection context. */
export function ImBotSettingsFrame({
  children,
  context,
  contentKey,
}: {
  children: ReactNode;
  context?: ReactNode;
  contentKey?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
          {t('settings.sections.imBot')}
        </h2>
        <span className="rounded-full border border-[var(--settings-badge-border)] bg-[var(--settings-badge-bg)] px-2 py-[1px] text-10 font-medium uppercase leading-[1.5] tracking-wide text-[var(--text-secondary)]">
          {t('settings.imBot.beta')}
        </span>
      </div>
      {context}
      <div key={contentKey} className="mt-4 flex flex-col gap-8">
        {children}
      </div>
    </div>
  );
}

export function ImBotGroupSection({
  group,
  children,
  sectionRef,
  idPrefix = '',
}: {
  group: ImBotSettingsGroup;
  children: ReactNode;
  sectionRef?: Ref<HTMLElement>;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const headingId = `${idPrefix}im-bot-group-heading-${group}`;
  return (
    <section
      ref={sectionRef}
      id={`${idPrefix}im-bot-group-${group}`}
      aria-labelledby={headingId}
      className="flex scroll-mt-4 flex-col gap-3"
    >
      <h3
        id={headingId}
        className="text-14 font-medium leading-[1.4] text-[var(--settings-section-title)]"
      >
        {t(`settings.imBot.groups.${group}`)}
      </h3>
      <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-chip)] px-3.5 py-2.5">
        <Lightbulb size={14} className="mt-[2px] shrink-0 text-[var(--text-tertiary)]" />
        <p className="text-12 leading-[1.6] text-[var(--text-secondary)]">
          {t(`settings.imBot.tips.${group}`)}
        </p>
      </div>
      {children}
    </section>
  );
}

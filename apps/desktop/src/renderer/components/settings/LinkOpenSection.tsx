/**
 * LinkOpenSection — Settings → 个性化 下的「链接打开方式」偏好。
 *
 * 控制消息流里左键点击时的默认打开位置,拆成两个互不影响的开关:
 *   - 外部网页:互联网链接。默认系统默认浏览器。
 *   - 内部网页:本地硬盘 HTML 与本机地址(localhost)。默认内置侧边栏浏览器。
 * 右键菜单里始终两种都可临时选,本设置只决定左键直开走哪个。
 *
 * 存储走 useLinkOpenPreference(Host profile 只存 override,恢复默认删除 override,
 * 规则 20);每个开关各自「恢复默认」,复用 DefaultOverrideControls。
 *
 * 版式跟 AgentResourceSection 同一套多行卡:一张卡、两行、控件贴右,
 * 避免两张独立卡把分段控件单独占一整行。
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/ui/segmented-control';

import { toast } from '@/lib/toast';
import {
  useLinkOpenPreference,
  type LinkOpenKind,
  type LinkOpenPreference,
} from '@/hooks/useLinkOpenPreference';
import { DefaultOverrideControls } from './DefaultOverrideControls';
import {
  SETTINGS_CARD_CLASS,
  SETTINGS_ROW_DIVIDER_CLASS,
  SETTINGS_ROW_HINT_CLASS,
  SETTINGS_ROW_LABEL_CLASS,
} from './settingsRowClasses';

const OPTIONS: Array<{ value: LinkOpenPreference; labelKey: string }> = [
  { value: 'sidebar', labelKey: 'settings.linkOpen.options.sidebar' },
  { value: 'external', labelKey: 'settings.linkOpen.options.external' },
];

/** 带分割线的多行卡片:卡片自身不留内边距,由每行 `px-4 py-4` 承担。 */
const CARD_CLASS = SETTINGS_CARD_CLASS;
const ROW_CLASS = 'cindy-segmented-row px-4 py-4';
const ROW_LABEL_CLASS = SETTINGS_ROW_LABEL_CLASS;
const ROW_HINT_CLASS = SETTINGS_ROW_HINT_CLASS;
const DIVIDER_CLASS = SETTINGS_ROW_DIVIDER_CLASS;

function LinkOpenPreferenceRow({ kind }: { kind: LinkOpenKind }) {
  const { t } = useTranslation();
  const { preference, isCustomized, setPreference, resetPreference } = useLinkOpenPreference(kind);

  const onReset = useCallback(async () => {
    if (await resetPreference()) toast.success(t('settings.defaults.restored'));
    else toast.error(t('hostSettings.saveFailed'));
  }, [resetPreference, t]);

  return (
    <LinkOpenPreferenceRowView
      kind={kind}
      preference={preference}
      isCustomized={isCustomized}
      onReset={onReset}
      onChange={setPreference}
    />
  );
}

type LinkOpenControl = {
  preference: LinkOpenPreference;
  isCustomized: boolean;
  onReset(): Promise<void>;
  onChange(next: LinkOpenPreference): void;
};
function LinkOpenPreferenceRowView({
  kind,
  preference,
  isCustomized,
  onReset,
  onChange,
  disabled = false,
}: LinkOpenControl & { kind: LinkOpenKind; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={ROW_CLASS}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className={ROW_LABEL_CLASS} style={{ letterSpacing: '0.12px' }}>
          {t(`settings.linkOpen.${kind}.label`)}
        </p>
        <p className={ROW_HINT_CLASS}>{t(`settings.linkOpen.${kind}.description`)}</p>
      </div>

      <div className="cindy-segmented-row-actions">
        <DefaultOverrideControls
          isCustomized={isCustomized}
          onReset={onReset}
          disabled={disabled}
        />
        <SegmentedControl
          aria-label={t(`settings.linkOpen.${kind}.ariaLabel`)}
          value={preference}
          onValueChange={onChange}
          disabled={disabled}
          options={OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
        />
      </div>
    </div>
  );
}

export function LinkOpenSection() {
  return (
    <LinkOpenSectionFrame>
      <LinkOpenPreferenceRow kind="web" />
      <div className={DIVIDER_CLASS} />
      <LinkOpenPreferenceRow kind="local" />
    </LinkOpenSectionFrame>
  );
}

export function LinkOpenSectionView({
  web,
  local,
  disabled,
}: {
  web: LinkOpenControl;
  local: LinkOpenControl;
  disabled?: boolean;
}) {
  return (
    <LinkOpenSectionFrame>
      <LinkOpenPreferenceRowView kind="web" {...web} disabled={disabled} />
      <div className={DIVIDER_CLASS} />
      <LinkOpenPreferenceRowView kind="local" {...local} disabled={disabled} />
    </LinkOpenSectionFrame>
  );
}

function LinkOpenSectionFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-1">
        <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
          {t('settings.linkOpen.title')}
        </h2>
        <p className="text-12 leading-[1.45] text-[var(--settings-section-desc)]">
          {t('settings.linkOpen.description')}
        </p>
      </div>

      <div className={CARD_CLASS}>{children}</div>
    </div>
  );
}

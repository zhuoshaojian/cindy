import { additionalSettings } from '@/components/settings/AdditionalSettings.settings-search';
import { useSettingDefinition } from '@/components/settings/useSettingDefinition';
import { useBotTranslation } from './botPronounContext';
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/ui/settings-rows';
import { Switch } from '@/components/ui/switch';
import { useBotReplyTargetPreference } from './useBotReplyTargetPreference';

export function BotsGlobalSettingsSection() {
  const { t } = useBotTranslation();
  const replySetting = useSettingDefinition(additionalSettings.botReplyTarget, t);
  const replyTarget = useBotReplyTargetPreference();

  return (
    <BotsGlobalSettingsSectionView
      modelChain={modelChain}
      pending={pending}
      notice={notice}
      onChange={(next) => changeModelChain(() => setBotGlobalModelChain(next))}
      onRestoreDefault={customized !== false
        ? () => changeModelChain(resetBotGlobalModelChain, true)
        : undefined}
      replyTarget={replyTarget}
    />
  );
}

/**
 * 伙伴全局设置的展示部分。deviceId 指定模型目录所在的设备(云实例设置传目标实例);
 * 不传 replyTarget 时不显示「显示回复对应的消息」(它只保存在本机界面)。
 */
export function BotsGlobalSettingsSectionView({
  modelChain,
  pending,
  notice,
  onChange,
  onRestoreDefault,
  deviceId,
  replyTarget,
  headingStatus,
}: {
  modelChain: BotModelRoute[];
  pending: boolean;
  notice: string | null;
  onChange: (next: BotModelRoute[]) => void;
  onRestoreDefault?: () => void;
  deviceId?: string;
  replyTarget?: { enabled: boolean; setEnabled: (next: boolean) => void };
  /** Cloud settings: a group that could not be read says so here, in place of the heading's action. */
  headingStatus?: React.ReactNode;
}) {
  const { t } = useBotTranslation();
  const modelSetting = useSettingDefinition(additionalSettings.botModel, t);
  const replySetting = useSettingDefinition(additionalSettings.botReplyTarget, t);
  return (
    <SettingsSection title={t('bots.globalSettings.title')} action={headingStatus}>
      <SettingsCard>
        <SettingsRow
          {...replySetting.anchorProps}
          title={replySetting.title}
          hint={replySetting.description}
          trailing={
            <Switch {...replySetting.controlProps}
              aria-label={replySetting.title}
              className="shrink-0"
              checked={replyTarget.enabled}
              onCheckedChange={(value) => replyTarget.setEnabled(value === true)}
            />
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}

/** Shared default model chain; individual teammates may override it. */
import { useEffect, useRef, useState } from 'react';
import { useBotTranslation } from './botPronounContext';

import { cn } from '@/lib/utils';
import {
  SETTINGS_CARD_CLASS,
  SETTINGS_ROW_CLASS,
  SETTINGS_ROW_HINT_CLASS,
  SETTINGS_ROW_LABEL_CLASS,
  SETTINGS_SECTION_TITLE_CLASS,
} from '@/components/settings/settingsRowClasses';
import { Switch } from '@/components/ui/switch';
import { useBotReplyTargetPreference } from './useBotReplyTargetPreference';
import { useProviders } from '@/hooks/useProviders';
import { useAvailableAgents } from '@/hooks/useAvailableAgents';
import {
  getEffectiveBotModelChain,
  isBotGlobalModelChainCustomized,
  resetBotGlobalModelChain,
  setBotGlobalModelChain,
  subscribeBotGlobalModel,
} from './botStore';
import { BotModelChainEditor } from './BotModelChainEditor';
import type { BotModelRoute } from '../../../shared/botModelChain';

export function BotsGlobalSettingsSection() {
  const { t } = useBotTranslation();
  // Re-render derived defaults when the shared picker inputs change, including
  // when the empty-chain editor has no ModelSelector mounted yet.
  useProviders();
  useAvailableAgents();
  const [, bumpModelSettings] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => subscribeBotGlobalModel(() => bumpModelSettings((value) => value + 1)), []);
  const modelChain = getEffectiveBotModelChain();
  const customized = isBotGlobalModelChainCustomized();
  const replyTarget = useBotReplyTargetPreference();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const changeModelChain = (operation: () => Promise<void>, restoring = false) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setNotice(null);
    void operation().catch((error: unknown) => {
      setNotice(restoring
        ? t('bots.globalSettings.restoreFailed')
        : error instanceof Error ? error.message : String(error));
    }).finally(() => {
      pendingRef.current = false;
      setPending(false);
    });
  };

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
}: {
  modelChain: BotModelRoute[];
  pending: boolean;
  notice: string | null;
  onChange: (next: BotModelRoute[]) => void;
  onRestoreDefault?: () => void;
  deviceId?: string;
  replyTarget?: { enabled: boolean; setEnabled: (next: boolean) => void };
}) {
  const { t } = useBotTranslation();
  return (
    <div className="flex flex-col gap-[14px]">
      <h2 className={SETTINGS_SECTION_TITLE_CLASS}>{t('bots.globalSettings.title')}</h2>

      <div className={SETTINGS_CARD_CLASS}>
        <fieldset disabled={pending} aria-busy={pending} className="min-w-0">
          <BotModelChainEditor
            layout="settings"
            settingsRows={{
              primaryLabel: t('bots.globalSettings.defaultModel'),
              primaryHint: t('bots.globalSettings.defaultModelHint'),
            }}
            disabled={pending}
            deviceId={deviceId}
            value={modelChain}
            onChange={onChange}
            onRestoreDefault={onRestoreDefault}
          />
        </fieldset>
        {notice ? (
          <p className={cn(SETTINGS_ROW_HINT_CLASS, 'px-4 pb-4')} role="status">
            {notice}
          </p>
        ) : null}
      </div>

      {replyTarget ? (
        <div className={SETTINGS_CARD_CLASS}>
          <div className={SETTINGS_ROW_CLASS}>
            <div className="min-w-0 flex-1">
              <p className={SETTINGS_ROW_LABEL_CLASS}>{t('bots.globalSettings.showReplyTarget')}</p>
              <p className={SETTINGS_ROW_HINT_CLASS}>{t('bots.globalSettings.showReplyTargetHint')}</p>
            </div>
            <Switch
              aria-label={t('bots.globalSettings.showReplyTarget')}
              className="shrink-0"
              checked={replyTarget.enabled}
              onCheckedChange={(value) => replyTarget.setEnabled(value === true)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useState, type ReactNode, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { WechatBotSectionView } from '@/components/settings/WechatBotSection';
import { WecomBotSectionView } from '@/components/settings/WecomBotSection';
import { FeishuBotSectionView } from '@/components/settings/FeishuBotSection';
import { DingTalkBotSectionView } from '@/components/settings/DingTalkBotSection';
import { DiscordBotSectionView } from '@/components/settings/DiscordBotSection';
import { TelegramBotSectionView } from '@/components/settings/TelegramBotSection';
import type { ImDefaultSettingsSummary } from '@/components/settings/ImDefaultSettingsSection';
import type { ManagementItem } from '../../../shared/settingsManagement';
import type { FeishuBotService } from '@/hooks/useFeishuBot';
import { DISCORD_OWNER_USER_ID_PATTERN } from '@/hooks/useDiscordBot';
import { TELEGRAM_OWNER_USER_ID_PATTERN, TELEGRAM_BOT_TOKEN_PATTERN } from '@/hooks/useTelegramBot';
import type { useCloudAuthorization } from './useCloudAuthorization';

export const personalBotChannels = [
  'wechat',
  'wecom',
  'feishu',
  'dingtalk',
  'discord',
  'telegram',
] as const;
export type PersonalBotChannel = (typeof personalBotChannels)[number];

/** Target-only controllers for the SAME native views. Never instantiate a local bot hook.
 * Inputs live for one ticket only (the parent keys this controller by that ticket).
 * Passwords are not prefilled, read back, persisted or sent with a different action.
 */
export function CloudPersonalBotSettings({
  channel,
  item,
  disabled,
  expanded,
  onToggle,
  defaults,
  summary,
  supplementary,
  telegramSettings,
  pending,
  run,
  cancel,
}: {
  channel: PersonalBotChannel;
  item: ManagementItem;
  disabled: boolean;
  expanded: boolean;
  onToggle(): void;
  defaults: ReactNode;
  summary?: ImDefaultSettingsSummary | null;
  supplementary: ReactNode;
  telegramSettings?: ReactNode;
  pending: boolean;
  run: ReturnType<typeof useCloudAuthorization>['run'];
  cancel(): Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const validationError = null;
  useEffect(() => {
    // The controller lives above the native accordion, unlike the old form.
    // Clear its draft when the editor closes as well as when the ticket changes.
    if (!expanded) setValues({});
  }, [expanded]);
  const form = item.actions.find((a) => a.intent === 'connect' && a.fields.length > 0);
  const reconnectAction = item.actions.find((a) => a.intent === 'reconnect');
  const disconnectAction = item.actions.find((a) => a.intent === 'disconnect');
  const authorizeAction = item.actions.find((a) => a.intent === 'authorize');
  const value = (key: string) =>
    values[key] ??
    (() => {
      const field = form?.fields.find((f) => f.name === key);
      return field?.kind === 'password' ? '' : (field?.value ?? '');
    })();
  const set = (key: string) => (next: SetStateAction<string>) => {
    setValues((old) => ({
      ...old,
      [key]: typeof next === 'function' ? next(old[key] ?? '') : next,
    }));
  };
  const valid =
    !!form &&
    form.fields.every((field) => {
      const input = value(field.name).trim();
      return (
        (!field.required || !!input) &&
        input.length <= field.maxLength &&
        (field.kind !== 'select' || field.options?.some((option) => option.value === input))
      );
    }) &&
    (channel !== 'discord' || DISCORD_OWNER_USER_ID_PATTERN.test(value('ownerUserId').trim())) &&
    (channel !== 'telegram' ||
      (TELEGRAM_OWNER_USER_ID_PATTERN.test(value('ownerUserId').trim()) &&
        TELEGRAM_BOT_TOKEN_PATTERN.test(value('token').trim())));
  const execute = async (
    action: ManagementItem['actions'][number] | undefined,
    submitted: Record<string, string> = {},
  ) => {
    if (!action || disabled || pending) return false;
    setValues({});
    try {
      await run(item, action, submitted, { confirmed: true });
      return true;
    } finally {
      for (const key of Object.keys(submitted)) delete submitted[key];
    }
  };
  const connect = async () => {
    if (!valid) return false;
    return execute(
      form,
      Object.fromEntries(form!.fields.map((field) => [field.name, value(field.name).trim()])),
    );
  };
  const reconnect = () => execute(reconnectAction);
  const disconnect = async () => {
    await execute(disconnectAction);
  };
  const configured =
    !!disconnectAction || ['connected', 'offline', 'conflict'].includes(item.status);
  const fallback = t('cloudSettings.imConnectionDetailsUnavailable');
  const details = (
    <p className="text-12 leading-[1.6] text-[var(--settings-section-desc)]">{fallback}</p>
  );
  const unsupported = (label: string) => (
    <section className="flex flex-col gap-2">
      <h3 className="text-13 font-medium text-[var(--settings-section-title)]">{t(label)}</h3>
      <p className="text-12 leading-[1.6] text-[var(--settings-section-desc)]">
        {t('cloudSettings.imRemoteControlUnavailable')}
      </p>
    </section>
  );
  const idle = item.status === 'disconnected' || item.status === 'available';
  const status: DiscordBotTransportStatus =
    pending || item.status === 'connecting'
      ? { kind: 'connecting' }
      : item.status === 'connected'
        ? { kind: 'connected', appId: '' }
        : item.status === 'conflict' || item.status === 'offline'
          ? { kind: 'conflict', appId: '' }
          : idle
            ? { kind: 'idle' }
            : { kind: 'error', reason: t('cloudSettings.authFailed') };
  const common = {
    expanded,
    onToggle,
    routeSummary: summary ?? null,
    defaultSettings: defaults,
    idPrefix: 'cloud-',
    canDisconnect: !!disconnectAction,
    canReconnect: !!reconnectAction,
    connectionDetails: details,
  };
  let view: ReactNode;
  switch (channel) {
    case 'wechat':
      view = (
        <WechatBotSectionView
          {...common}
          authorizationAvailable={!!authorizeAction}
          workingDirectory={unsupported('settings.wechatBot.workingDir.title')}
          controller={{
            state: {
              phase: pending
                ? 'authorizing'
                : item.status === 'connected'
                  ? 'connected'
                  : item.status === 'error'
                    ? 'error'
                    : 'disconnected',
              bound: configured,
              queuedTasks: 0,
            },
            channelSettings: null,
            isAuthorizing: pending,
            isUnbinding: false,
            authorize: () => execute(authorizeAction),
            cancelAuthorization: cancel,
            unbind: () => execute(disconnectAction),
            setCompanion: async () => false,
            isUpdatingCompanion: false,
          }}
        />
      );
      break;
    case 'wecom':
      view = (
        <WecomBotSectionView
          {...common}
          notificationSettings={unsupported('settings.notifications.wecomGroupLabel')}
          controller={{
            botId: value('botId'),
            setBotId: set('botId'),
            secret: value('secret'),
            setSecret: set('secret'),
            ownerUserId: '',
            status,
            validationError,
            isSaving: pending,
            isDisconnecting: false,
            canConnect: valid && !pending,
            canReconnect: !!reconnectAction && !pending,
            connect,
            reconnect,
            disconnect,
          }}
        />
      );
      break;
    case 'feishu':
      view = (
        <FeishuBotSectionView
          {...common}
          notificationSettings={unsupported('settings.feishuBot.lifecycleAnnouncement.label')}
          canSubmit={valid}
          services={
            form?.fields
              .find((f) => f.name === 'service')
              ?.options?.map((o) => o.value)
              .filter((s): s is FeishuBotService => s === 'feishu' || s === 'lark') ?? ['feishu']
          }
          controller={{
            service: value('service') === 'lark' ? 'lark' : 'feishu',
            setService: set('service'),
            appId: value('appId'),
            setAppId: set('appId'),
            appSecret: value('appSecret'),
            setAppSecret: set('appSecret'),
            status: status.kind === 'connecting' ? 'testing' : status.kind,
            errorMessage: null,
            hasSavedCreds: configured,
            hasLoadedState: true,
            ownerOpenId: null,
            validationError,
            isSaving: pending,
            isClearing: false,
            isReconnecting: false,
            save: connect,
            reconnect,
            clear: disconnect,
          }}
        />
      );
      break;
    case 'dingtalk':
      view = (
        <DingTalkBotSectionView
          {...common}
          controller={{
            appKey: value('appKey'),
            setAppKey: set('appKey'),
            appSecret: value('appSecret'),
            setAppSecret: set('appSecret'),
            hasSecret: configured,
            ownerUserId: '',
            status,
            validationError,
            isSaving: pending,
            isClearing: false,
            canConnect: valid && !pending,
            connect,
            reconnect,
            clear: disconnect,
          }}
        />
      );
      break;
    case 'discord':
      view = (
        <DiscordBotSectionView
          savedConnectionAvailable={!!reconnectAction}
          {...common}
          notificationSettings={unsupported('settings.discordBot.lifecycleAnnouncement.label')}
          controller={{
            token: value('token'),
            setToken: set('token'),
            ownerUserId: value('ownerUserId'),
            setOwnerUserId: set('ownerUserId'),
            status,
            validationError,
            isSaving: pending,
            isDisconnecting: false,
            canConnect: valid && !pending,
            connect,
            reconnect: async () => {
              await reconnect();
            },
            disconnect,
          }}
        />
      );
      break;
    case 'telegram':
      view = (
        <TelegramBotSectionView
          {...common}
          telegramSettings={telegramSettings}
          canToggleOnline={item.status === 'offline' && !!reconnectAction}
          controller={{
            token: value('token'),
            setToken: set('token'),
            ownerUserId: value('ownerUserId'),
            setOwnerUserId: set('ownerUserId'),
            status: item.status === 'offline' && !pending ? { kind: 'offline', appId: '' } : status,
            botUsername: null,
            validationError,
            isSaving: pending,
            isDisconnecting: false,
            isTogglingOnline: false,
            canConnect: valid && !pending,
            connect,
            disconnect,
            setOnline: async (online) => {
              if (online) await reconnect();
            },
          }}
        />
      );
      break;
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
        {view}
      </fieldset>
      {expanded && supplementary}
    </div>
  );
}

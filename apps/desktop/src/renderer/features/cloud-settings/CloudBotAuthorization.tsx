import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ImChannelSettingsCard } from '@/components/settings/ImChannelSettingsCard';
import { OAuthBrowserLink, OAuthDeviceCodeCard } from '@/components/settings/OAuthDeviceCodeCard';
import { CloudBotConnectionForm, cloudBotActionLabel } from './CloudBotConnectionForm';
import {
  CloudPersonalBotSettings,
  personalBotChannels,
  type PersonalBotChannel,
} from './CloudPersonalBotSettings';
import type { ImDefaultSettingsSummary } from '@/components/settings/ImDefaultSettingsSection';
import { ImBotSettingsFrame, ImBotGroupSection } from '@/components/settings/ImBotSettingsLayout';
import {
  ChannelStatusBadge,
  HookConnectionsDescription,
} from '@/components/settings/HookConnectionsSection';
import {
  useCloudAuthorization,
  supportedBotActions,
  type CloudAuthorizationProps,
} from './useCloudAuthorization';
import {
  CloudBotNotificationSettings,
  type CloudBotNotificationPreferences,
} from './CloudBotNotificationSettings';
import {
  BOT_NOTIFICATION_GROUP,
  BOT_NOTIFICATION_ITEMS,
} from '../../../shared/cloudBotNotifications';

/** Same accordion and group layout as local IM settings; only cloud tickets are executed. */
export function CloudBotAuthorization(
  props: CloudAuthorizationProps & {
    settings?(itemId: string, section?: 'defaults' | 'telegram'): ReactNode;
    summary?(itemId: string): ImDefaultSettingsSummary | null;
    notificationPreferences?: CloudBotNotificationPreferences;
  },
) {
  const {
    t,
    items,
    loading,
    failure,
    operation,
    operationItem,
    requesting,
    load,
    run,
    operate,
    prompt,
    open,
    busy,
  } = useCloudAuthorization(props, 'bots');
  const [expanded, setExpanded] = useState<Record<string, string | null>>({});
  const disabled = !props.online || requesting || loading;
  // Notification items belong inside their channel card. An older target lists none,
  // and its cards keep the explicit "not available" note.
  const notificationsSupported = items.some((item) => item.group === BOT_NOTIFICATION_GROUP);
  const notificationSettings = (channel: PersonalBotChannel) => {
    if (channel !== 'wecom' && channel !== 'feishu' && channel !== 'discord') return undefined;
    // Like the credential forms, no webhook input stays on screen for an offline target.
    if (!props.online) return null;
    if (!notificationsSupported) return undefined;
    const item = items.find(
      (entry) => entry.id === BOT_NOTIFICATION_ITEMS[channel === 'wecom' ? 'wecomGroup' : channel],
    );
    // Feishu, like the local card, shows no notification section before credentials exist.
    if (!item) return channel === 'feishu' ? null : undefined;
    const own = operationItem === item.id;
    return (
      <CloudBotNotificationSettings
        channel={channel}
        item={item}
        preferences={props.notificationPreferences}
        disabled={disabled || !props.active || (busy && !own)}
        pending={own && busy}
        runSettled={(target, action, values) =>
          new Promise((settled) => void run(target, action, values, { confirmed: true, settled }))
        }
      />
    );
  };
  const label = (id: string, fallback: string) =>
    ['wechat', 'wecom', 'feishu', 'dingtalk', 'discord', 'telegram'].includes(
      id.replace(/^bot:/, ''),
    )
      ? t(`settings.${id.slice(4)}Bot.title`)
      : fallback;
  // Official channels reuse the local card copy; other items (e.g. a bound Slack
  // workspace) name the target instance instead.
  const description = (id: string) =>
    id === 'bot:official:slack'
      ? t('settings.remoteControl.hook.slackDescription')
      : id === 'bot:official:telegram' || id === 'bot:official:x'
        ? t(`settings.remoteControl.hook.${id.slice(13)}.description`)
        : props.name;
  return (
    <ImBotSettingsFrame
      context={
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-13 text-[var(--settings-section-desc)]">
              {t('cloudSettings.authScope', { name: props.name })}
            </p>
            <Button
              variant="secondary"
              size="md"
              disabled={disabled || busy}
              onClick={() => void load()}
            >
              {t('cloudSettings.reload')}
            </Button>
          </div>
          {failure && (
            <p role="alert" className="text-13 text-[var(--text-secondary)]">
              {t(`cloudSettings.${failure}`)}
            </p>
          )}
          {loading && !items.length && <p role="status">{t('cloudSettings.loading')}</p>}
        </>
      }
    >
      {(['cindy', 'personal'] as const).map((group) => {
        const entries = items.filter(
          (item) =>
            item.group !== BOT_NOTIFICATION_GROUP &&
            (item.group === 'management.officialBots') === (group === 'cindy'),
        );
        if (!entries.length) return null;
        if (group === 'personal') {
          const rank = (id: string) => {
            const index = personalBotChannels.indexOf(
              id.replace(/^bot:/, '') as PersonalBotChannel,
            );
            return index < 0 ? personalBotChannels.length : index;
          };
          entries.sort((left, right) => rank(left.id) - rank(right.id));
        }
        return (
          <ImBotGroupSection key={group} group={group} idPrefix="cloud-">
            {group === 'cindy' && <HookConnectionsDescription />}
            {entries.map((item) => {
              const own = operationItem === item.id;
              const connected = item.status === 'connected';
              const actions = supportedBotActions(item);
              const toggleAction = actions.find(
                (action) => action.intent === (connected ? 'disconnect' : 'authorize'),
              );
              const form = actions.find((action) => action.fields.length > 0);
              const personal = item.group === 'management.personalBots' && item.id !== 'bot:wechat';
              const statusKey =
                item.status === 'connected'
                  ? 'connected'
                  : item.status === 'disconnected'
                    ? 'needsConfig'
                    : item.status;
              const channel = item.id.replace(/^bot:/, '') as PersonalBotChannel;
              if (
                item.group === 'management.personalBots' &&
                personalBotChannels.includes(channel)
              ) {
                return (
                  <CloudPersonalBotSettings
                    key={`${item.id}:${form?.id ?? 'no-form'}:${props.online}:${props.active}`}
                    item={item}
                    channel={channel}
                    targetName={props.name}
                    disabled={
                      disabled ||
                      !props.active ||
                      (busy && !own) ||
                      (own && operation?.phase === 'unknown')
                    }
                    pending={own && busy}
                    expanded={expanded[group] === item.id}
                    onToggle={() =>
                      setExpanded((old) => ({
                        ...old,
                        [group]: old[group] === item.id ? null : item.id,
                      }))
                    }
                    defaults={props.settings?.(item.id)}
                    summary={props.summary?.(item.id)}
                    telegramSettings={props.settings?.(item.id, 'telegram')}
                    notificationSettings={notificationSettings(channel)}
                    run={run}
                    cancel={() => operate('cancel')}
                    supplementary={
                      own ? (
                        <>
                          {operation && (
                            <p role="status" className="text-13 text-[var(--text-secondary)]">
                              {t(`cloudSettings.authPhase.${operation.phase}`)}
                            </p>
                          )}
                          {(busy || operation?.phase === 'unknown') && channel !== 'wechat' && (
                            <Button
                              variant="secondary"
                              disabled={disabled}
                              onClick={() => void operate('cancel')}
                            >
                              {t('settings.providers.button.cancel')}
                            </Button>
                          )}
                          {operation?.phase === 'unknown' && channel === 'wechat' && (
                            <Button
                              variant="secondary"
                              disabled={disabled}
                              onClick={() => void operate('cancel')}
                            >
                              {t('settings.providers.button.cancel')}
                            </Button>
                          )}
                          {prompt &&
                            (prompt.kind === 'device' && prompt.userCode ? (
                              <OAuthDeviceCodeCard
                                deviceCode={{
                                  verificationUrl: prompt.url,
                                  userCode: prompt.userCode,
                                  expiresAt: prompt.expiresAt,
                                }}
                                onOpen={open}
                              />
                            ) : (
                              <OAuthBrowserLink url={prompt.url} onOpen={open} />
                            ))}
                          {operation?.phase === 'unknown' && (
                            <Button disabled={disabled} onClick={() => void operate('status')}>
                              {t('cloudSettings.authCheck')}
                            </Button>
                          )}
                          {prompt && props.trial && (
                            <Button onClick={() => void operate('respond')}>
                              {t('cloudSettings.authTrialComplete')}
                            </Button>
                          )}
                        </>
                      ) : null
                    }
                  />
                );
              }
              return (
                <ImChannelSettingsCard
                  key={item.id}
                  id={`cloud-${item.id}`}
                  title={label(item.id, item.label)}
                  description={description(item.id)}
                  routeSummary={null}
                  status={
                    <ChannelStatusBadge
                      tone={connected ? 'ok' : 'attention'}
                      label={t(
                        personal
                          ? `settings.${item.id.slice(4)}Bot.status.${statusKey}`
                          : connected
                            ? 'cloudSettings.authConnected'
                            : 'cloudSettings.authDisconnected',
                      )}
                    />
                  }
                  expanded={expanded[group] === item.id}
                  onToggle={() =>
                    setExpanded((old) => ({
                      ...old,
                      [group]: old[group] === item.id ? null : item.id,
                    }))
                  }
                  headerAction={
                    personal ? undefined : (
                      <Switch
                        checked={connected}
                        aria-label={label(item.id, item.label)}
                        disabled={
                          disabled ||
                          (busy && !own) ||
                          (own && operation?.phase === 'unknown') ||
                          (!toggleAction && !busy)
                        }
                        onCheckedChange={() => {
                          setExpanded((old) => ({ ...old, [group]: item.id }));
                          if (own && busy) void operate('cancel');
                          else if (toggleAction) void run(item, toggleAction);
                        }}
                      />
                    )
                  }
                >
                  {own && operation && (
                    <p role="status" className="text-13 text-[var(--text-secondary)]">
                      {t(`cloudSettings.authPhase.${operation.phase}`)}
                    </p>
                  )}
                  {own &&
                    prompt &&
                    (prompt.kind === 'device' && prompt.userCode ? (
                      <OAuthDeviceCodeCard
                        deviceCode={{
                          verificationUrl: prompt.url,
                          userCode: prompt.userCode,
                          expiresAt: prompt.expiresAt,
                        }}
                        onOpen={open}
                      />
                    ) : (
                      <OAuthBrowserLink url={prompt.url} onOpen={open} />
                    ))}
                  {form &&
                    props.online &&
                    props.active &&
                    !(own && (busy || operation?.phase === 'unknown')) && (
                      <CloudBotConnectionForm
                        key={`${item.id}:${form.id}`}
                        item={item}
                        action={form}
                        disabled={disabled || busy}
                        submit={(values) => run(item, form, values)}
                      />
                    )}
                  <div className="flex flex-wrap gap-2">
                    {own && (busy || operation?.phase === 'unknown') ? (
                      <>
                        {operation?.phase === 'unknown' && (
                          <Button
                            variant="secondary"
                            size="md"
                            disabled={disabled}
                            onClick={() => void operate('status')}
                          >
                            {t('cloudSettings.authCheck')}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="md"
                          disabled={disabled}
                          onClick={() => void operate('cancel')}
                        >
                          {t('settings.providers.button.cancel')}
                        </Button>
                      </>
                    ) : (
                      actions
                        .filter((action) => !action.fields.length)
                        .map((action) => (
                          <Button
                            key={action.id}
                            variant="secondary"
                            size="md"
                            disabled={disabled || busy}
                            onClick={() => void run(item, action)}
                          >
                            {t(cloudBotActionLabel(item, action))}
                          </Button>
                        ))
                    )}
                    {own && prompt && props.trial && (
                      <Button variant="secondary" size="md" onClick={() => void operate('respond')}>
                        {t('cloudSettings.authTrialComplete')}
                      </Button>
                    )}
                  </div>
                  {props.settings?.(item.id)}
                </ImChannelSettingsCard>
              );
            })}
          </ImBotGroupSection>
        );
      })}
      {!loading && !failure && !items.length && <p>{t('cloudSettings.noFields')}</p>}
      {props.trial && (
        <p className="text-12 text-[var(--text-tertiary)]">{t('cloudSettings.authTrial')}</p>
      )}
    </ImBotSettingsFrame>
  );
}

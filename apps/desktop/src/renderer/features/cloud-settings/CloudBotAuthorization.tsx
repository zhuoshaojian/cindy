import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ImChannelSettingsCard } from '@/components/settings/ImChannelSettingsCard';
import { OAuthBrowserLink, OAuthDeviceCodeCard } from '@/components/settings/OAuthDeviceCodeCard';
import { CloudBotConnectionForm, cloudBotActionLabel } from './CloudBotConnectionForm';
import { GroupTip } from '@/components/settings/ImBotSection';
import {
  useCloudAuthorization,
  supportedBotActions,
  type CloudAuthorizationProps,
} from './useCloudAuthorization';

/** Same accordion and group layout as local IM settings; only cloud tickets are executed. */
export function CloudBotAuthorization(
  props: CloudAuthorizationProps & { settings?(itemId: string): ReactNode },
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
  const label = (id: string, fallback: string) =>
    ['wechat', 'wecom', 'feishu', 'dingtalk', 'discord', 'telegram'].includes(
      id.replace(/^bot:/, ''),
    )
      ? t(`settings.${id.slice(4)}Bot.title`)
      : fallback;
  return (
    <section className="flex flex-col gap-6" aria-label={t('settings.tabs.imBot')}>
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
      {(['cindy', 'personal'] as const).map((group) => {
        const entries = items.filter(
          (item) => (item.group === 'management.officialBots') === (group === 'cindy'),
        );
        if (!entries.length) return null;
        return (
          <div key={group} className="flex flex-col gap-3">
            <h2 className="text-16 font-medium text-[var(--settings-section-title)]">
              {t(`settings.imBot.groups.${group}`)}
            </h2>
            <GroupTip message={t(`settings.imBot.tips.${group}`)} />
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
              return (
                <ImChannelSettingsCard
                  key={item.id}
                  id={`cloud-${item.id}`}
                  title={label(item.id, item.label)}
                  description={props.name}
                  routeSummary={null}
                  status={
                    <span
                      className="text-12"
                      style={{
                        color: connected
                          ? 'var(--settings-badge-connected)'
                          : 'var(--settings-badge-needs-config)',
                      }}
                    >
                      {t(
                        personal
                          ? `settings.${item.id.slice(4)}Bot.status.${statusKey}`
                          : connected
                            ? 'cloudSettings.authConnected'
                            : 'cloudSettings.authDisconnected',
                      )}
                    </span>
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
          </div>
        );
      })}
      {!loading && !failure && !items.length && <p>{t('cloudSettings.noFields')}</p>}
      {props.trial && (
        <p className="text-12 text-[var(--text-tertiary)]">{t('cloudSettings.authTrial')}</p>
      )}
    </section>
  );
}

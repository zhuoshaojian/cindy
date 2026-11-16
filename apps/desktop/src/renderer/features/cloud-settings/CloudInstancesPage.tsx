import { useTranslation } from 'react-i18next';
import {
  Cloud,
  ExternalLink,
  RefreshCw,
  Check,
  ChevronRight,
  ArrowLeft,
  Monitor,
  Moon,
  Play,
  CalendarClock,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { CloudInstanceView } from '../../../shared/cloudInstanceControl';
import { instanceStatus, canChangeInstancePower } from './instanceState';
import { byShownName, cloudDisplayName, cloudInstanceName } from './instanceName';
import { BlockReadFailure } from './blockRetry';
import { useCloudInstances, type CloudInstancesApi } from './useCloudInstances';

export type { CloudInstancesApi } from './useCloudInstances';

const card =
  'rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5';
const description = 'text-13 leading-[1.6] text-[var(--settings-section-desc)]';

/** Membership discovery is read-only. Only the explicit claim button can ensure
 * a first instance; offline, loading and failed reads never become an empty list. */
export function CloudInstancesPage({
  api,
  onBack,
  onOpen,
  onOpenDesktop,
  canOpenDesktop,
  trial = false,
  embedded = false,
}: {
  api: CloudInstancesApi;
  onBack?(): void;
  onOpen(deviceId: string, section?: 'maintenance'): void;
  onOpenDesktop?(instance: CloudInstanceView): void;
  canOpenDesktop?(instance: CloudInstanceView): boolean;
  trial?: boolean;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, values?: Record<string, string | number>) =>
    t(`cloudSettings.onboarding.${key}`, values);
  const {
    instances,
    busy,
    error,
    waiting,
    powerPending,
    powerNote,
    reloadPower,
    claim,
    reloadClaim,
    load,
    act,
    power,
    capacity,
    claimAnother,
  } = useCloudInstances(api, onOpen);
  // Each by its own name (CIS's), with the client's usual 「(1)」「(2)」 when two share one, as on
  // the desktop's device cards; listed in that name order.
  const sources = (instances ?? []).map((instance) => ({
    deviceId: instance.deviceId,
    name: cloudInstanceName(t, instance),
  }));
  const shown = (instances ?? [])
    .map((instance) => ({
      instance,
      name: cloudDisplayName(instance.deviceId, cloudInstanceName(t, instance), sources),
    }))
    .sort((a, b) => byShownName(a.name, b.name));
  return (
    <div
      className={embedded ? 'min-w-0' : 'flex h-full min-h-0 bg-[var(--settings-bg)]'}
      data-testid="cloud-instances-page"
    >
      <div className={embedded ? 'min-w-0' : 'min-w-0 flex-1 overflow-y-auto px-6 pb-8'}>
        <div className="mx-auto max-w-[920px]">
          {!embedded && onBack && (
            <div className="pt-5">
              <Button variant="secondary" tone="quiet" compact onClick={onBack}>
                <ArrowLeft size={14} aria-hidden />
                {t('settings.back')}
              </Button>
            </div>
          )}
          <header className="mb-6 flex flex-wrap items-center gap-3 border-b border-[var(--settings-theme-card-border)] py-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--settings-input-bg)] text-[var(--settings-section-title)]">
              <Cloud size={22} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-20 font-medium text-[var(--settings-section-title)]">
                {t('cloudSettings.instance.title')}
              </h2>
              <p className={description}>{tr(trial ? 'preview' : 'subtitle')}</p>
            </div>
            <Button
              variant="secondary"
              tone="quiet"
              compact
              disabled={busy}
              onClick={() => void load()}
              aria-label={t('settings.devices.refresh')}
            >
              <RefreshCw size={15} />
            </Button>
          </header>
          {error && (
            <p role="alert" className={`${description} mb-4`}>
              {error.startsWith('cloudSettings.') ? t(error) : tr(error)}
            </p>
          )}
          {instances === null && !error && (
            <div className="flex items-center gap-2 text-13" role="status">
              <Spinner size={16} />
              {tr('loading')}
            </div>
          )}
          {instances?.length === 0 && (
            <section className={`${card} flex flex-col items-start gap-4`}>
              <h3 className="text-16 font-medium text-[var(--settings-section-title)]">
                {tr('emptyTitle')}
              </h3>
              <p className={`${description} max-w-[560px]`} role={claim ? 'status' : undefined}>
                {tr(claim === 'notClaimed' ? 'claimNotDone' : 'emptyDescription')}
              </p>
              {/* While the claim is sent and read back, only the button spins (2026-11-11). */}
              <Button
                loading={busy || claim === 'checking'}
                disabled={claim === 'unreadable' || !!error}
                onClick={() => void act(true)}
              >
                <Cloud size={16} />
                {tr('claim')}
              </Button>
              {claim === 'unreadable' && (
                <BlockReadFailure
                  title={tr('claimUnreadable')}
                  disabled={busy}
                  onReload={() => void reloadClaim()}
                />
              )}
            </section>
          )}
          <div className="flex flex-col gap-4">
            {shown.map(({ instance, name }) => {
              const state = instanceStatus(instance);
              // Each instance sleeps and wakes on its own; another's never holds this one.
              const pending = powerPending(instance.deviceId);
              const note = powerNote(instance.deviceId);
              return (
                <section key={instance.instanceId} className={card} aria-label={name}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <h3 className="break-all text-16 font-medium text-[var(--settings-section-title)]">
                        {name}
                      </h3>
                      <p role="status" className={`${description} mt-1 flex items-start gap-2`}>
                        {['starting', 'stopping', 'upgrading'].includes(state) ? (
                          <Spinner size={14} />
                        ) : state === 'running' ? (
                          <Check size={14} className="mt-1 shrink-0" />
                        ) : null}
                        <span>
                          {instance.loginRequired
                            ? tr(
                                instance.desiredState === 'stopped'
                                  ? 'asleepNeedsLogin'
                                  : 'needsLogin',
                              )
                            : t(`cloudSettings.instance.state.${state}`)}
                        </span>
                      </p>
                    </div>
                    {instance.loginRequired ? (
                      <Button
                        disabled={
                          busy ||
                          !!error ||
                          !!pending ||
                          !!instance.upgradeOperation?.active ||
                          !!instance.resourceChanging ||
                          instance.upgradeState === 'verifying'
                        }
                        onClick={() => void act(false, instance.deviceId)}
                      >
                        <ExternalLink size={15} />
                        {tr(
                          instance.desiredState === 'stopped' && instance.loginWakeSupported
                            ? 'wakeAndLogin'
                            : waiting === instance.deviceId
                              ? 'reopenLogin'
                              : 'initialize',
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        tone="quiet"
                        onClick={() => onOpen(instance.deviceId)}
                      >
                        {tr('openSettings')}
                        <ChevronRight size={15} />
                      </Button>
                    )}
                  </div>
                  <>
                    <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-12 text-[var(--settings-section-desc)]">
                          {t('cloudSettings.instance.currentVersion')}
                        </dt>
                        <dd className="mt-1 break-all text-13 text-[var(--settings-section-title)]">
                          {instance.version ?? t('cloudSettings.instance.unknown')}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-12 text-[var(--settings-section-desc)]">
                          {t('cloudSettings.instance.availableVersion')}
                        </dt>
                        <dd className="mt-1 break-all text-13 text-[var(--settings-section-title)]">
                          {instance.updateAvailable
                            ? instance.latestVersion && instance.latestVersion !== instance.version
                              ? instance.latestVersion
                              : t('cloudSettings.instance.revisionAvailable')
                            : t(
                                `cloudSettings.instance.${instance.manualUpgrade || instance.latestVersion ? 'noUpdate' : 'unknown'}`,
                              )}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--settings-theme-card-border)] pt-4">
                      {onOpenDesktop && (
                        <Button
                          variant="secondary"
                          compact
                          disabled={
                            busy ||
                            !!pending ||
                            !instance.ready ||
                            instance.desiredState !== 'running' ||
                            instance.upgradeState === 'verifying' ||
                            !!instance.upgradeOperation?.active ||
                            !canOpenDesktop?.(instance)
                          }
                          onClick={() => onOpenDesktop(instance)}
                        >
                          <Monitor size={14} />
                          {t('remoteDesktop.title')}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        tone="quiet"
                        compact
                        onClick={() => onOpen(instance.deviceId, 'maintenance')}
                      >
                        <CalendarClock size={14} />
                        {t('cloudSettings.instance.updates')}
                      </Button>
                      {!(
                        instance.loginRequired &&
                        instance.desiredState === 'stopped' &&
                        instance.loginWakeSupported
                      ) && (
                        <Button
                          variant="secondary"
                          tone="quiet"
                          compact
                          disabled={
                            busy || !!pending || !!error || !canChangeInstancePower(instance)
                          }
                          onClick={() => void power(instance, name)}
                        >
                          {instance.desiredState === 'stopped' ? (
                            <Play size={14} />
                          ) : (
                            <Moon size={14} />
                          )}
                          {t(
                            `cloudSettings.instance.${instance.desiredState === 'stopped' ? 'wake' : 'sleep'}`,
                          )}
                        </Button>
                      )}
                    </div>
                    {note?.kind === 'unreadable' ? (
                      <div className="mt-3">
                        <BlockReadFailure
                          title={t('cloudSettings.instance.statusUnreadable')}
                          disabled={busy}
                          onReload={() => void reloadPower(instance.deviceId)}
                        />
                      </div>
                    ) : note?.kind === 'refused' && note.refusal ? (
                      // CIS refused it: nothing changed, and the reason is the whole message.
                      <p role="alert" className={`${description} mt-3`}>
                        {t(note.refusal)}
                      </p>
                    ) : note ? (
                      // A request under way shows in the state above; only its outcome is said here.
                      <p role="status" className={`${description} mt-3`}>
                        {t(`cloudSettings.instance.${note.action}NotTaken`)}
                      </p>
                    ) : null}
                  </>
                  {instance.loginRequired && (
                    <p className={`${description} mt-4`}>
                      {tr(waiting === instance.deviceId ? 'waitingLogin' : instance.loginWakeSupported ? 'recoveryDescription' : 'loginDescription', {
                        name,
                      })}
                    </p>
                  )}
                  {(instance.loginRequired || state === 'starting') && (
                    <ol
                      className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--settings-theme-card-border)] pt-4 text-12 text-[var(--settings-section-desc)]"
                      aria-label={tr('progress')}
                    >
                      {['allocated', 'identity', 'start'].map((step, index) => (
                        <li
                          key={step}
                          className="flex items-center gap-1.5"
                          aria-current={
                            index === (instance.loginRequired ? 1 : 2) ? 'step' : undefined
                          }
                        >
                          {index < (instance.loginRequired ? 1 : 2) ? (
                            <Check size={13} />
                          ) : (
                            <span>{index + 1}.</span>
                          )}
                          {tr(step)}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              );
            })}
            {/* Below the limit another can be claimed; an owner allowed several who has them all
                sees the count and why there is no button. */}
            {!!instances?.length && capacity && (capacity.used < capacity.limit || capacity.limit > 1) && (
              <section
                className={`${card} flex flex-wrap items-center justify-between gap-3`}
                aria-label={tr('capacity', { used: capacity.used, limit: capacity.limit })}
              >
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="text-14 font-medium tabular-nums text-[var(--settings-section-title)]">
                    {tr('capacity', { used: capacity.used, limit: capacity.limit })}
                  </h3>
                  <p className={`${description} mt-1`}>
                    {capacity.used < capacity.limit
                      ? tr('capacityRemaining', { n: capacity.limit - capacity.used })
                      : tr('capacityFull')}
                  </p>
                </div>
                {capacity.used < capacity.limit && (
                  <Button
                    variant="secondary"
                    disabled={!!error || claim === 'unreadable'}
                    loading={busy || claim === 'checking'}
                    onClick={() => void claimAnother()}
                  >
                    <Plus size={16} />
                    {tr('claimAnother')}
                  </Button>
                )}
                {/* An unknown result of claiming another is read back, as for the first claim. */}
                {claim === 'notClaimed' && (
                  <p role="status" className={`${description} basis-full`}>
                    {tr('claimNotDone')}
                  </p>
                )}
                {claim === 'unreadable' && (
                  <div className="basis-full">
                    <BlockReadFailure
                      title={tr('claimUnreadable')}
                      disabled={busy}
                      onReload={() => void reloadClaim()}
                    />
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

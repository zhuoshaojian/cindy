/**
 * CloudInstancesPanel —— 「远程连接」里的云端 Cindy 管理区。
 *
 * 控制面实例是事实源，device-link 只补在线状态与硬件信息。首次还没有实例时，
 * 本区直接提供唤醒入口；实例创建后保留唤醒、休眠、更新、自动更新、重建与删除。
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleArrowUp, Hammer, Moon, RefreshCw, Sun, Trash2 } from 'lucide-react';

import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  CloudInstanceActionTimeoutError,
  type UseCloudInstances,
} from '@/features/cloud-instance/useCloudInstances';
import { desktopCloudInstanceDisplayName } from '@/features/cloud-instance/cloudDeviceName';
import {
  cloudInstanceLifecycleAction,
  cloudInstanceLifecycleActionForTarget,
  cloudInstanceLifecycleProgressKey,
} from '@/features/cloud-instance/cloudLifecyclePresentation';
import { resolveCloudVersionPresentation } from '@/features/cloud-instance/cloudVersionPresentation';
import type { DeviceLinkSettings } from '@/hooks/useDeviceLinkSettings';
import { toast } from '@/lib/toast';
import { extractIpcError } from '@/utils/ipcError';

const MIN_REFRESH_SPIN_MS = 1_000;

function platformLabel(platform: string | null): string {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return platform ?? '—';
  }
}

function hardwareLabel(deviceInfo: DeviceLinkDeviceInfo | null | undefined): string | null {
  const label = deviceInfo?.modelLabel?.trim() || deviceInfo?.cpuLabel?.trim();
  return label || null;
}

function memoryLabel(memoryGb: number | null | undefined): string | null {
  if (typeof memoryGb !== 'number' || !Number.isFinite(memoryGb) || memoryGb <= 0) return null;
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(memoryGb);
  return `${formatted} GB`;
}

function relativeTime(
  iso: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const diffMin = Math.floor((Date.now() - ts) / 60_000);
  if (diffMin < 1) return t('settings.devices.justNow');
  if (diffMin < 60) return t('settings.devices.minutesAgo', { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t('settings.devices.hoursAgo', { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return t('settings.devices.daysAgo', { count: diffDay });
  return new Date(ts).toLocaleDateString();
}

function deviceSubtitle(
  device: DeviceLinkDeviceView,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return [
    platformLabel(device.platform),
    hardwareLabel(device.deviceInfo),
    memoryLabel(device.deviceInfo?.memoryGb),
    device.online
      ? device.busy
        ? t('settings.devices.status.busy')
        : t('settings.devices.status.online')
      : t('settings.devices.lastSeen', { time: relativeTime(device.lastSeenAt, t) }),
  ].filter(Boolean).join(' · ');
}

function CloudControlRow({
  label,
  reason,
  children,
}: {
  label: string;
  reason?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-12 text-[var(--text-primary)]">{label}</span>
        {reason ? <span className="text-11 text-[var(--text-tertiary)]">{reason}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function CloudInstancesPanel({
  s,
  cloud,
}: {
  s: DeviceLinkSettings;
  cloud: UseCloudInstances;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);
  const cloudDevicesById = new Map(
    (s.devices ?? [])
      .filter((device) => device.deviceInfo?.kind === 'cloud')
      .map((device) => [device.deviceId, device]),
  );
  const cloudInstanceIds = cloud.instances.map((instance) => instance.instanceId);

  const refreshLists = async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([
        cloud.refresh(),
        s.refresh(true),
        new Promise((resolve) => setTimeout(resolve, MIN_REFRESH_SPIN_MS)),
      ]);
    } finally {
      refreshInFlightRef.current = false;
      setRefreshing(false);
    }
  };

  const handleFirstWake = async () => {
    try {
      await cloud.wake();
      void s.refresh(true);
      toast.success(t('settings.devices.cloudInstance.toast.woke'));
    } catch (error) {
      toast.error(t(extractIpcError(error)?.code === 'CLOUD_INSTANCE_REBUILD_IN_PROGRESS'
        ? 'settings.devices.cloudInstance.toast.rebuildStillCleaning'
        : error instanceof CloudInstanceActionTimeoutError
          ? 'settings.devices.cloudInstance.toast.actionTimedOut'
          : 'settings.devices.cloudInstance.toast.wakeFailed'));
    }
  };

  const handleCloudStop = async (instanceId: string) => {
    try {
      await cloud.stopInstance(instanceId);
      void s.refresh(true);
      toast.success(t('settings.devices.cloudInstance.toast.stopped'));
    } catch (error) {
      toast.error(t(error instanceof CloudInstanceActionTimeoutError
        ? 'settings.devices.cloudInstance.toast.actionTimedOut'
        : 'settings.devices.cloudInstance.toast.stopFailed'));
    }
  };

  const handleCloudWake = async (instanceId: string) => {
    try {
      await cloud.wake(instanceId);
      void s.refresh(true);
      toast.success(t('settings.devices.cloudInstance.toast.woke'));
    } catch (error) {
      toast.error(t(extractIpcError(error)?.code === 'CLOUD_INSTANCE_REBUILD_IN_PROGRESS'
        ? 'settings.devices.cloudInstance.toast.rebuildStillCleaning'
        : error instanceof CloudInstanceActionTimeoutError
          ? 'settings.devices.cloudInstance.toast.actionTimedOut'
          : 'settings.devices.cloudInstance.toast.wakeFailed'));
    }
  };

  const handleCloudDelete = async (instanceId: string) => {
    const confirmed = await confirm({
      title: t('settings.devices.cloudInstance.deleteConfirm.title'),
      description: t('settings.devices.cloudInstance.deleteConfirm.description'),
      confirmText: t('settings.devices.cloudInstance.deleteConfirm.confirm'),
      cancelText: t('settings.devices.cloudInstance.deleteConfirm.cancel'),
    });
    if (!confirmed) return;
    try {
      await cloud.deleteInstance(instanceId);
      void s.refresh(true);
      toast.success(t('settings.devices.cloudInstance.toast.deleted'));
    } catch {
      toast.error(t('settings.devices.cloudInstance.toast.deleteFailed'));
    }
  };

  const handleCloudUpgrade = async (instanceId: string) => {
    const confirmed = await confirm({
      title: t('settings.devices.cloudInstance.updateConfirm.title'),
      description: t('settings.devices.cloudInstance.updateConfirm.description'),
      confirmText: t('settings.devices.cloudInstance.updateConfirm.confirm'),
      cancelText: t('settings.devices.cloudInstance.updateConfirm.cancel'),
    });
    if (!confirmed) return;
    try {
      await cloud.upgradeInstance(instanceId);
      toast.success(t('settings.devices.cloudInstance.toast.updateStarted'));
    } catch (error) {
      if (extractIpcError(error)?.code === 'NO_RELEASE_AVAILABLE') {
        toast.warning(t('settings.devices.cloudInstance.toast.noReleaseAvailable'));
        return;
      }
      toast.error(t('settings.devices.cloudInstance.toast.updateFailed'));
    }
  };

  const handleCloudRebuild = async (instanceId: string) => {
    const confirmed = await confirm({
      title: t('settings.devices.cloudInstance.rebuildConfirm.title'),
      description: t('settings.devices.cloudInstance.rebuildConfirm.description'),
      confirmText: t('settings.devices.cloudInstance.rebuildConfirm.confirm'),
      cancelText: t('settings.devices.cloudInstance.rebuildConfirm.cancel'),
      confirmVariant: 'destructive',
    });
    if (!confirmed) return;
    try {
      await cloud.rebuildInstance(instanceId);
      void s.refresh(true);
      toast.success(t('settings.devices.cloudInstance.toast.rebuildStarted'));
    } catch (error) {
      if (error instanceof CloudInstanceActionTimeoutError) {
        toast.error(t('settings.devices.cloudInstance.toast.actionTimedOut'));
        return;
      }
      toast.error(t('settings.devices.cloudInstance.toast.rebuildFailed'));
    }
  };

  const handleCloudAutoUpdate = async (instanceId: string, enabled: boolean) => {
    try {
      await cloud.setAutoUpdate(instanceId, enabled);
    } catch {
      toast.error(t('settings.devices.cloudInstance.toast.autoUpdateFailed'));
    }
  };

  if (cloud.loadState === 'loading') {
    return (
      <div className="flex justify-center py-6 text-[var(--text-tertiary)]">
        <Spinner icon={RefreshCw} size={14} spinning />
      </div>
    );
  }

  if (cloud.loadState === 'error') {
    return (
      <div className="rounded-xl border border-[var(--border-default)] px-4 py-5 text-center">
        <p className="text-12 text-[var(--text-tertiary)]">
          {t('settings.remoteControl.cloud.loadFailed')}
        </p>
        <button
          type="button"
          onClick={refreshLists}
          className="mt-3 h-7 rounded-full border border-[var(--border-default)] px-3 text-12 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          {t('settings.devices.refresh')}
        </button>
      </div>
    );
  }

  if (cloud.instances.length === 0) {
    const firstWakeAction =
      cloudInstanceLifecycleActionForTarget(cloud.pending, 'new', cloudInstanceIds)
      ?? cloudInstanceLifecycleAction(cloud.pending);
    const lifecycleInProgress = firstWakeAction !== null;
    return (
      <div className="rounded-xl border border-[var(--border-default)] px-4 py-5 text-center">
        <p className="text-12 text-[var(--text-tertiary)]">
          {t(cloud.rebuildAttention
            ? 'settings.devices.cloudInstance.manualWakeRequired'
            : 'settings.remoteControl.cloud.empty')}
        </p>
        <button
          type="button"
          data-testid="cloud-instance-first-wake"
          onClick={() => void handleFirstWake()}
          disabled={cloud.pending !== null}
          className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-default)] px-3 text-12 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Spinner icon={Sun} size={12} spinning={lifecycleInProgress} />
          {t(lifecycleInProgress
            ? cloudInstanceLifecycleProgressKey(firstWakeAction, cloud.pending)
            : cloud.rebuildAttention
              ? 'settings.devices.cloudInstance.manualWakeAction'
              : 'ccAgent.sidebar.cloud.wake')}
        </button>
      </div>
    );
  }

  const cardClass = 'rounded-xl border border-[var(--border-default)] px-4 py-3';

  return (
    <div>
      <ul className="flex flex-col gap-2" aria-label={t('settings.remoteControl.sections.cloudCindy')}>
        {cloud.instances.map((cloudInstance) => {
          const device = cloudDevicesById.get(cloudInstance.deviceId);
          const cloudProgressAction = cloudInstanceLifecycleActionForTarget(
            cloud.pending,
            cloudInstance.instanceId,
            cloudInstanceIds,
          );
          const cloudProgressKey = cloudProgressAction
            ? cloudInstanceLifecycleProgressKey(cloudProgressAction, cloud.pending)
            : null;
          const cloudUpgradePending =
            cloud.pending?.target === cloudInstance.instanceId
            && cloud.pending.action === 'upgrade';
          const cloudUpgradeVerifying =
            cloudInstance?.status.upgrade?.state === 'verifying';
          const cloudUpdating = cloudUpgradePending || cloudUpgradeVerifying;
          const cloudHasReleaseChannel = cloudInstance.status.latestReleaseTag != null;
          const cloudUpdateAvailable =
            cloudHasReleaseChannel
            && cloudInstance.status.updateAvailable === true
            && !cloudUpdating;
          const cloudRebuildAvailable = !cloudHasReleaseChannel && !cloudUpdating;
          const cloudAutoUpdateSupported =
            typeof cloudInstance.status.autoUpdate === 'boolean';
          const cloudAutoUpdatePending =
            cloud.pending?.target === cloudInstance.instanceId
            && cloud.pending.action === 'autoUpdate';
          const cloudLifecycleAction =
            cloudProgressAction === 'wake' || cloudProgressAction === 'stop'
              ? cloudProgressAction
              : device?.online ? 'stop' : 'wake';
          const cloudVersion = resolveCloudVersionPresentation({
            image: cloudInstance.status.image,
            updateAvailable: cloudInstance.status.updateAvailable === true,
            updating: cloudUpdating,
          });
          const failedUpgradeImage = cloudInstance.status.lastFailedUpgradeImage
            ?? (cloudInstance.status.upgrade?.state === 'rolled-back'
              ? cloudInstance.status.upgrade.targetImage
              : null);
          const registered = device !== undefined;

          return (
            <li
              key={cloudInstance.instanceId}
              data-testid={registered ? 'cloud-instance-card' : 'cloud-instance-unregistered-card'}
              data-instance-id={cloudInstance.instanceId}
              className={cardClass}
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: device?.online
                      ? 'var(--remote-status-ready)'
                      : 'var(--remote-status-disconnected)',
                  }}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-13 font-medium text-[var(--text-primary)]">
                      {desktopCloudInstanceDisplayName(cloudInstance, t)}
                    </span>
                    {cloudUpdateAvailable ? (
                      <span className="shrink-0 select-none rounded-full bg-[var(--surface-chip)] px-2 py-0.5 text-10 text-[var(--text-secondary)]">
                        {cloudInstance.status.latestReleaseTag
                          ? t('settings.devices.cloudInstance.updateAvailableTag', {
                              tag: cloudInstance.status.latestReleaseTag,
                            })
                          : t('settings.devices.cloudInstance.updateAvailable')}
                      </span>
                    ) : null}
                  </div>
                  {device ? (
                    <span className="truncate text-11 text-[var(--text-tertiary)]">
                      {deviceSubtitle(device, t)}
                    </span>
                  ) : (
                    <span className="text-11 text-[var(--warning-fg)]">
                      {t('settings.devices.cloudInstance.unregisteredStatus')}
                    </span>
                  )}
                  {cloudVersion.currentVersion ? (
                    <span
                      data-testid="cloud-instance-current-version"
                      className="truncate text-11 text-[var(--text-tertiary)]"
                    >
                      {t(
                        cloudVersion.upToDate
                          ? 'settings.devices.cloudInstance.currentVersionUpToDate'
                          : 'settings.devices.cloudInstance.currentVersion',
                        { version: cloudVersion.currentVersion },
                      )}
                    </span>
                  ) : null}
                  {failedUpgradeImage ? (
                    <span className="text-11 text-[var(--warning-fg)]">
                      {t('settings.devices.cloudInstance.updateRolledBack')}
                    </span>
                  ) : null}
                  {cloudInstance.status.readiness?.modelAccess === 'not-ready' ? (
                    <span
                      data-testid="cloud-instance-model-access-stale"
                      className="text-11 text-[var(--warning-fg)]"
                    >
                      {t('settings.devices.cloudInstance.modelAccessStale')}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    data-testid="cloud-instance-refresh"
                    onClick={() => void refreshLists()}
                    disabled={cloud.pending !== null}
                    aria-busy={refreshing}
                    aria-label={t('settings.devices.refresh')}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Spinner icon={RefreshCw} size={12} spinning={refreshing} />
                  </button>
                  {(cloudUpdateAvailable || cloudUpdating) ? (
                    <button
                      type="button"
                      onClick={() => void handleCloudUpgrade(cloudInstance.instanceId)}
                      disabled={cloud.pending !== null || cloudUpgradeVerifying}
                      className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 text-11 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Spinner icon={CircleArrowUp} size={12} spinning={cloudUpdating} />
                      {t(cloudUpdating
                        ? 'settings.devices.cloudInstance.updating'
                        : 'settings.devices.cloudInstance.update')}
                    </button>
                  ) : null}
                  {cloudRebuildAvailable ? (
                    <button
                      type="button"
                      data-testid="cloud-instance-rebuild"
                      onClick={() => void handleCloudRebuild(cloudInstance.instanceId)}
                      disabled={cloud.pending !== null}
                      className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 text-11 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Spinner
                        icon={Hammer}
                        size={12}
                        spinning={cloudProgressAction === 'rebuild'}
                      />
                      {t(
                        cloudProgressAction === 'rebuild' && cloudProgressKey
                          ? cloudProgressKey
                          : 'settings.devices.cloudInstance.rebuild',
                      )}
                    </button>
                  ) : null}
                  {cloudLifecycleAction === 'stop' ? (
                    <button
                      type="button"
                      onClick={() => void handleCloudStop(cloudInstance.instanceId)}
                      disabled={cloud.pending !== null}
                      className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 text-11 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Spinner
                        icon={Moon}
                        size={12}
                        spinning={cloudProgressAction === 'stop'}
                      />
                      {t(
                        cloudProgressAction === 'stop' && cloudProgressKey
                          ? cloudProgressKey
                          : 'settings.devices.cloudInstance.stop',
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleCloudWake(cloudInstance.instanceId)}
                      disabled={cloud.pending !== null}
                      className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 text-11 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Spinner
                        icon={Sun}
                        size={12}
                        spinning={cloudProgressAction === 'wake'}
                      />
                      {t(
                        cloudProgressAction === 'wake' && cloudProgressKey
                          ? cloudProgressKey
                          : 'settings.devices.cloudInstance.wake',
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleCloudDelete(cloudInstance.instanceId)}
                    disabled={cloud.pending !== null}
                    className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 text-11 text-[var(--text-secondary)] transition-colors hover:text-[var(--error-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Spinner
                      icon={Trash2}
                      size={12}
                      spinning={cloudProgressAction === 'delete'}
                    />
                    {t(
                      cloudProgressAction === 'delete' && cloudProgressKey
                        ? cloudProgressKey
                        : 'settings.devices.cloudInstance.delete',
                    )}
                  </button>
                </div>
              </div>

              {cloudAutoUpdateSupported ? (
                <div className="mt-3 border-t border-[var(--border-default)] pt-3">
                  <CloudControlRow
                    label={t('settings.devices.cloudInstance.autoUpdate')}
                    reason={t('settings.devices.cloudInstance.autoUpdateHint')}
                  >
                    <Switch
                      checked={cloudInstance.status.autoUpdate === true}
                      disabled={cloud.pending !== null}
                      onCheckedChange={(enabled) => void handleCloudAutoUpdate(
                        cloudInstance.instanceId,
                        enabled,
                      )}
                      aria-label={t('settings.devices.cloudInstance.autoUpdate')}
                      data-testid="cloud-instance-auto-update"
                      data-pending={cloudAutoUpdatePending || undefined}
                    />
                  </CloudControlRow>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

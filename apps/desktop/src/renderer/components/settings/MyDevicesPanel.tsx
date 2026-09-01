/**
 * MyDevicesPanel —— 「远程连接」里的同账号设备管理。
 *
 * 本机卡常驻，折叠区只列真实设备。云端实例由同级的 CloudInstancesPanel 管理，
 * 即使 relay 里仍有 cloud 设备快照，也不会混回「我的设备」。
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { deviceDisplayName, isCloudInstanceDeviceId } from '@cindy/maker-shared/device-list';

import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import type { DeviceLinkSettings } from '@/hooks/useDeviceLinkSettings';
import { revokedDevicesStore } from '@/features/device-link/revokedDevicesStore';
import { compareDevicesByName } from '@/features/device-link/deviceSort';
import {
  canBeControlledPlatform,
  controlToggleState,
  inboundToggleState,
  resolveActiveConnectionIssue,
} from './myDevicesModel';

function platformLabel(platform: string | null): string {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    case 'ios':
      return 'iOS';
    case 'android':
      return 'Android';
    default:
      return platform ?? '—';
  }
}

function hardwareLabel(deviceInfo: DeviceLinkDeviceInfo | null | undefined): string | null {
  const label = deviceInfo?.modelLabel?.trim() || deviceInfo?.cpuLabel?.trim();
  return label || null;
}

function displayDeviceName(device: DeviceLinkDeviceView | null | undefined): string {
  return device ? deviceDisplayName(device) : '';
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

function deviceStatusLabel(
  device: DeviceLinkDeviceView,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (device.online) {
    return device.busy ? t('settings.devices.status.busy') : t('settings.devices.status.online');
  }
  return t('settings.devices.lastSeen', { time: relativeTime(device.lastSeenAt, t) });
}

function deviceSubtitle(
  device: DeviceLinkDeviceView,
  t: (key: string, options?: Record<string, unknown>) => string,
  opts: { isControlling?: boolean; statusOverride?: string } = {},
): string {
  const parts = [
    platformLabel(device.platform),
    hardwareLabel(device.deviceInfo),
    memoryLabel(device.deviceInfo?.memoryGb),
    opts.statusOverride ?? deviceStatusLabel(device, t),
  ].filter(Boolean);
  if (opts.isControlling) parts.push(t('settings.remoteControl.myDevices.controllingThisMac'));
  return parts.join(' · ');
}

function ControlRow({
  label,
  reason,
  children,
}: {
  label: string;
  reason?: string | null;
  children: ReactNode;
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

export function MyDevicesPanel({
  s,
  variant = 'all',
}: {
  s: DeviceLinkSettings;
  variant?: 'all' | 'self' | 'others';
  visible?: boolean;
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const revokedByPeer = useSyncExternalStore(
    revokedDevicesStore.subscribe,
    revokedDevicesStore.getSnapshot,
  );

  const self = (s.devices ?? []).find((device) => device.isSelf);
  const others = (s.devices ?? [])
    .filter((d) => !d.isSelf && !isCloudInstanceDeviceId(d.deviceId))
    .sort(compareDevicesByName);
  const revokedControllers = new Set(s.revokedControllers);
  const controlling = new Set(s.controlledBy.map((controller) => controller.deviceId));

  const activeConnectionIssue = resolveActiveConnectionIssue(s.linkStatus, s.connectionIssue);
  const linkStatusColor = activeConnectionIssue
    ? 'var(--remote-status-disconnected)'
    : s.linkStatus === 'online'
      ? 'var(--remote-status-ready)'
      : s.linkStatus === 'connecting'
        ? 'var(--remote-status-progress)'
        : 'var(--remote-status-disconnected)';

  const handleRename = async (deviceId: string) => {
    const target = self?.deviceId === deviceId
      ? self
      : others.find((device) => device.deviceId === deviceId);
    const name = editingName.trim();
    const currentName = target?.name.trim() ?? '';
    setEditingId(null);
    if (name && name === currentName) return;
    await s.rename(deviceId, name || null);
  };

  const onOutboundChange = async (device: DeviceLinkDeviceView, next: boolean) => {
    await s.setDeviceControlEnabled(device.deviceId, next);
  };

  const onInboundChange = async (device: DeviceLinkDeviceView, next: boolean) => {
    if (next) await s.restore(device.deviceId);
    else await s.revoke(device.deviceId);
  };

  const handleDelete = async (deviceId: string) => {
    if (await s.remove(deviceId)) revokedDevicesStore.clearRevoked(deviceId);
  };

  const cardClass = 'rounded-xl border border-[var(--border-default)] px-4 py-3';

  return (
    <div className="flex flex-col gap-4">
      {variant !== 'self' ? (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => void s.refresh(true)}
            disabled={s.refreshing}
            className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-default)] px-3 text-12 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
            aria-label={t('settings.devices.refresh')}
          >
            <Spinner icon={RefreshCw} size={12} spinning={s.refreshing} />
            {t('settings.devices.refresh')}
          </button>
        </div>
      ) : null}

      <ul
        className="flex flex-col gap-2"
        aria-label={
          variant === 'self'
            ? t('settings.devices.thisDevice')
            : t('settings.remoteControl.sections.myDevices')
        }
      >
        {variant !== 'others' ? (
          <li className={cardClass}>
            <div className="flex items-center gap-3">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: linkStatusColor }}
                aria-hidden
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {self && editingId === self.deviceId ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={editingName}
                      autoFocus
                      maxLength={64}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          void handleRename(self.deviceId);
                        }
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                      className="w-44 rounded-lg border border-[var(--border-default)] bg-transparent px-2 py-0.5 text-13 text-[var(--settings-input-text)] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRename(self.deviceId)}
                      aria-label={t('settings.devices.renameConfirm')}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label={t('settings.devices.renameCancel')}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <span className="truncate text-13 font-medium text-[var(--text-primary)]">
                    {displayDeviceName(self) || t('settings.devices.thisDevice')}
                  </span>
                )}
                <span className="text-11 text-[var(--text-tertiary)]">
                  {self
                    ? deviceSubtitle(self, t, {
                        statusOverride: t(`settings.devices.linkStatus.${s.linkStatus}`),
                      })
                    : `${t('settings.devices.thisDevice')} · ${t(`settings.devices.linkStatus.${s.linkStatus}`)}`}
                </span>
                {activeConnectionIssue ? (
                  <span className="text-11 text-[var(--error-fg)]">
                    {t(`settings.devices.connectionIssue.${activeConnectionIssue.kind}`)}
                  </span>
                ) : null}
                {s.standby ? (
                  <span className="text-11 text-[var(--text-tertiary)]">
                    {t('settings.devices.standbyHint')}
                  </span>
                ) : null}
              </div>
              {self && editingId !== self.deviceId ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(self.deviceId);
                    setEditingName(self.name);
                  }}
                  aria-label={t('settings.devices.rename')}
                  className="shrink-0 rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  <Pencil size={13} />
                </button>
              ) : null}
            </div>
            <div className="mt-3 border-t border-[var(--border-default)] pt-3">
              <ControlRow
                label={t('settings.devices.allowControl')}
                reason={t('settings.devices.allowControlHint')}
              >
                <Switch
                  checked={s.enabled}
                  onCheckedChange={(value) => void s.setEnabled(value)}
                  aria-label={t('settings.devices.allowControl')}
                />
              </ControlRow>
            </div>
          </li>
        ) : null}

        {variant === 'self' ? null : s.listError ? (
          <li className="rounded-xl border border-[var(--border-default)] px-4 py-6 text-center text-12 text-[var(--text-tertiary)]">
            {s.listError}
          </li>
        ) : s.devices === null ? null : others.length === 0 ? (
          <li className="rounded-xl border border-[var(--border-default)] px-4 py-6 text-center text-12 text-[var(--text-tertiary)]">
            {t('settings.devices.empty')}
          </li>
        ) : (
          others.map((device) => {
            const peerRevoked = revokedByPeer.has(device.deviceId);
            const control = controlToggleState(device);
            const inbound = inboundToggleState(
              s.enabled,
              revokedControllers.has(device.deviceId),
            );
            const isControlling = controlling.has(device.deviceId);
            const controlReason = control.reason === 'peer-off'
              ? t('settings.remoteControl.myDevices.peerControlOff')
              : null;

            return (
              <li key={device.deviceId} className={cardClass}>
                <div className="flex items-center gap-3">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${isControlling ? 'animate-pulse' : ''}`}
                    style={{
                      backgroundColor: isControlling
                        ? 'var(--status-bar-accent)'
                        : device.online
                          ? 'var(--remote-status-ready)'
                          : 'var(--remote-status-disconnected)',
                    }}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {editingId === device.deviceId ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={editingName}
                          autoFocus
                          maxLength={64}
                          onChange={(event) => setEditingName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                              void handleRename(device.deviceId);
                            }
                            if (event.key === 'Escape') setEditingId(null);
                          }}
                          className="w-44 rounded-lg border border-[var(--border-default)] bg-transparent px-2 py-0.5 text-13 text-[var(--settings-input-text)] outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRename(device.deviceId)}
                          aria-label={t('settings.devices.renameConfirm')}
                          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          aria-label={t('settings.devices.renameCancel')}
                          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="truncate text-13 font-medium text-[var(--text-primary)]">
                        {displayDeviceName(device)}
                      </span>
                    )}
                    <span className="truncate text-11 text-[var(--text-tertiary)]">
                      {deviceSubtitle(device, t, { isControlling })}
                    </span>
                  </div>
                  {editingId !== device.deviceId ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(device.deviceId);
                          setEditingName(device.name);
                        }}
                        aria-label={t('settings.devices.rename')}
                        className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(device.deviceId)}
                        disabled={device.online}
                        title={device.online ? t('settings.devices.deleteOnlineHint') : undefined}
                        aria-label={t('settings.devices.delete')}
                        className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-col gap-3 border-t border-[var(--border-default)] pt-3">
                  {canBeControlledPlatform(device.platform) && !peerRevoked ? (
                    <ControlRow
                      label={t('settings.remoteControl.myDevices.controlIt')}
                      reason={controlReason}
                    >
                      <Switch
                        checked={control.checked}
                        onCheckedChange={(v) => void onOutboundChange(device, v)}
                        aria-label={t('settings.remoteControl.deviceControlToggleAria', {
                          name: displayDeviceName(device),
                        })}
                      />
                    </ControlRow>
                  ) : null}
                  <ControlRow
                    label={t('settings.remoteControl.myDevices.allowInbound')}
                    reason={
                      inbound.disabled ? t('settings.remoteControl.myDevices.masterOffHint') : null
                    }
                  >
                    <Switch
                      checked={inbound.checked}
                      disabled={inbound.disabled}
                      onCheckedChange={(v) => void onInboundChange(device, v)}
                      aria-label={t('settings.remoteControl.myDevices.allowInboundAria', {
                        name: displayDeviceName(device),
                      })}
                    />
                  </ControlRow>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

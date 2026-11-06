import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Cloud, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { useAuth } from '@/contexts/AuthContext';
import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
} from '@/contexts/dataOwnerGeneration';
import { cn } from '@/lib/utils';
import type { MyDevicesCloudSlot } from '@/components/settings/MyDevicesPanel';
import {
  SETTINGS_ROW_CLASS,
  SETTINGS_ROW_HINT_CLASS,
  SETTINGS_ROW_LABEL_CLASS,
} from '@/components/settings/settingsRowClasses';
import type { CloudInstanceView, CloudMaintenanceView } from '../../../shared/cloudInstanceControl';
import { useCloudInstanceAccess } from './CloudInstanceAccess';
import { CloudInstanceSection, type CloudInstanceFeed } from './CloudInstanceSection';
import { createCloudSettingsClient } from './client';
import { remoteControlReturnPath } from './cloudInstancesLink';
import { canChangeInstancePower, instanceStatus, upgradeProgressKey } from './instanceState';
import { useCloudInstances, type CloudInstancesApi, type PowerPending } from './useCloudInstances';

export const isCloudDeviceId = (deviceId: string | null | undefined): deviceId is string =>
  !!deviceId && /^cloud-device-[a-f0-9]{24}$/.test(deviceId);

type Translate = (key: string, values?: Record<string, string | number>) => string;

const muted = 'text-11 leading-[1.5] text-[var(--text-tertiary)]';
// Standard settings rows (DESIGN.md "Desktop settings rows"). The device card already has the
// row's 16px side padding, so rows and dividers run the width of its content.
const row = cn(SETTINGS_ROW_CLASS, 'px-0');
const divider = 'h-px bg-[var(--border-default)]';
// A row that opens a page or panel is the whole row with a trailing chevron. Its hover fill runs
// from card edge to card edge between the dividers, as in a Settings card.
const linkRow = cn(
  row,
  '-mx-4 w-[calc(100%+32px)] !px-4 text-left transition-colors enabled:hover:bg-[var(--settings-menu-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed',
);
const chevron = 'shrink-0 text-[var(--text-tertiary)]';

function RowText({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className={SETTINGS_ROW_LABEL_CLASS}>{label}</span>
      {hint && <span className={SETTINGS_ROW_HINT_CLASS}>{hint}</span>}
    </span>
  );
}

const instanceStatusText = (view: CloudInstanceView, t: Translate) =>
  view.loginRequired
    ? t(`cloudSettings.onboarding.${view.desiredState === 'stopped' ? 'asleepNeedsLogin' : 'needsLogin'}`)
    : t(`cloudSettings.instance.state.${instanceStatus(view)}`);

function maintenanceHint(policy: CloudMaintenanceView, t: Translate, language: string) {
  const tr = (key: string, values?: Record<string, string | number>) =>
    t(`cloudSettings.instance.${key}`, values);
  if (!policy.autoUpdate) return tr('autoUpdateOff');
  if (policy.executionMode === 'preview-only') return tr('autoUpdateNotEnrolled');
  const { timezone, windows } = policy.effective.calendar;
  if (windows.length !== 1) return tr('autoUpdateWindows', { number: windows.length });
  const rule = windows[0]!;
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' });
  const time = { start: rule.startLocal, end: rule.endLocal };
  const text =
    rule.weekdays.length === 7
      ? tr('autoUpdateDaily', time)
      : tr('autoUpdateWeekly', {
          ...time,
          days: new Intl.ListFormat(language, { style: 'short' }).format(
            [...rule.weekdays]
              .sort()
              // 2024-01-01 is a Monday; rule weekdays count from Monday = 1.
              .map((day) => weekday.format(new Date(Date.UTC(2024, 0, day)))),
          ),
        });
  // The window is local to the policy's timezone: name it when that is not this computer's.
  return timezone === Intl.DateTimeFormat().resolvedOptions().timeZone
    ? text
    : `${text} (${timezone})`;
}

function updateHint(view: CloudInstanceView, loaded: boolean, t: Translate, language: string) {
  const tr = (key: string, values?: Record<string, string | number>) =>
    t(`cloudSettings.instance.${key}`, values);
  const operation = view.upgradeOperation;
  if (operation?.active || operation?.phase === 'recovery-hold')
    return tr(upgradeProgressKey(operation.phase));
  const parts = [
    view.updateAvailable
      ? view.latestVersion && view.latestVersion !== view.version
        ? // The card's subtitle shows versions without the image's region and architecture.
          tr('updateAvailable', {
            version: view.latestVersion.replace(/(-(cn|global))?-(amd64|arm64)$/, ''),
          })
        : tr('revisionAvailable')
      : view.manualUpgrade || view.latestVersion
        ? tr('upToDate')
        : null,
    view.maintenance ? maintenanceHint(view.maintenance, t, language) : null,
  ].filter(Boolean);
  return parts.join(' · ') || (loaded ? tr('unknown') : '');
}

/**
 * Cloud instance operations for Settings → Remote connections → My devices (2026-11-05):
 * a cloud instance is one of the account's devices, so its lifecycle lives on that card.
 * Only an admitted account (CloudInstanceAccess) gets the slot; everyone else sees the
 * device list exactly as before and no CIS request is made. The device directory decides
 * remote control (presence, toggles, remote desktop availability); CIS decides lifecycle.
 */
export function CloudDeviceDirectory({
  enabled,
  directory,
  devicesOpen,
  children,
}: {
  enabled: boolean;
  /** Device ids the device directory lists; null until it has loaded once. */
  directory: readonly string[] | null;
  /** My devices is expanded; coming back from an instance's settings restores it. */
  devicesOpen: boolean;
  children(cloud: MyDevicesCloudSlot | undefined): ReactNode;
}) {
  const access = useCloudInstanceAccess();
  const { mode, dataOwnerId } = useAuth();
  if (!enabled || mode !== 'cloud' || access !== 'allowed') return <>{children(undefined)}</>;
  // A new account or owner generation starts from an empty list and drops any draft.
  return (
    <AdmittedCloudDeviceDirectory
      key={JSON.stringify([dataOwnerId, getDataOwnerGeneration().generation])}
      directory={directory}
      devicesOpen={devicesOpen}
    >
      {children}
    </AdmittedCloudDeviceDirectory>
  );
}

function AdmittedCloudDeviceDirectory({
  directory,
  devicesOpen,
  children,
}: {
  directory: readonly string[] | null;
  devicesOpen: boolean;
  children(cloud: MyDevicesCloudSlot): ReactNode;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const api = useMemo<
    CloudInstancesApi & Pick<typeof window.electronAPI.cloudSettings, 'instanceRead'>
  >(
    () => ({
      ...window.electronAPI.cloudSettings,
      instanceInitialize: async ({ deviceId }: { deviceId: string }) => {
        await window.electronAPI.cloudLoginWindow.open({ deviceId });
      },
      onLoginCompleted: (cb: () => void) => window.electronAPI.cloudLoginWindow.onCompleted(cb),
    }),
    [],
  );
  // Unsaved maintenance edits, by device. Leaving them asks first, wherever the user goes.
  const [drafts, setDrafts] = useState<ReadonlySet<string>>(new Set());
  // Bumped when the user discards drafts, so the open maintenance forms drop their edits too.
  const [discarded, setDiscarded] = useState(0);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const markDraft = useCallback((deviceId: string, dirty: boolean) => {
    setDrafts((before) => {
      if (before.has(deviceId) === dirty) return before;
      const next = new Set(before);
      if (dirty) next.add(deviceId);
      else next.delete(deviceId);
      return next;
    });
  }, []);
  const discard = useCallback(
    async () =>
      !draftsRef.current.size ||
      (await confirm({
        presentation: 'standard',
        title: t('cloudSettings.discardTitle'),
        description: t('cloudSettings.discardBody'),
        confirmText: t('cloudSettings.discard'),
      })),
    [confirm, t],
  );
  const clearDrafts = useCallback(() => {
    draftsRef.current = new Set();
    setDrafts(draftsRef.current);
    setDiscarded((count) => count + 1);
  }, []);
  // Reads the ref: an explicit discard clears it before navigating in the same tick.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      draftsRef.current.size > 0 &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The router commits a blocker change in a transition, so this can re-run while it still reads
  // 'blocked': ask once per blocked navigation, or a second answer hits a settled blocker.
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      asking.current = false;
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void discard().then(
      (leave) => {
        if (!mounted.current) return;
        if (leave) {
          clearDrafts();
          blocker.proceed();
        } else blocker.reset();
      },
      () => {
        if (mounted.current) blocker.reset();
      },
    );
  }, [blocker, clearDrafts, discard]);
  const openSettings = useCallback(
    (deviceId: string) =>
      navigate(`/cloud-settings?${new URLSearchParams({ deviceId })}`, {
        state: { returnTo: remoteControlReturnPath(devicesOpen) },
      }),
    [devicesOpen, navigate],
  );
  const cloud = useCloudInstances(api, openSettings);
  // The list carries no maintenance policy; CIS serves it per instance. Read it once per instance
  // for the card's summary, again when the panel opens, and never on the list's polling timer.
  const [policies, setPolicies] = useState<ReadonlyMap<string, CloudMaintenanceView | null>>(
    new Map(),
  );
  const storePolicy = useCallback((deviceId: string, policy: CloudMaintenanceView | null) => {
    if (mounted.current) setPolicies((before) => new Map(before).set(deviceId, policy));
  }, []);
  const readPolicy = useCallback(
    async (deviceId: string) => {
      storePolicy(deviceId, (await api.instanceRead({ deviceId })).maintenance);
    },
    [api, storePolicy],
  );
  const live = useMemo(
    () =>
      (cloud.instances ?? [])
        .filter((view) => view.desiredState !== 'deleted')
        .map((view) => ({ ...view, maintenance: policies.get(view.deviceId) ?? null })),
    [cloud.instances, policies],
  );
  const policyRead = useRef(new Set<string>());
  useEffect(() => {
    for (const { deviceId } of live) {
      if (policyRead.current.has(deviceId)) continue;
      policyRead.current.add(deviceId);
      // A failed summary read only leaves the policy out; the open panel reports its own failure.
      void readPolicy(deviceId).catch(() => storePolicy(deviceId, null));
    }
  }, [live, readPolicy, storePolicy]);
  const byDevice = new Map(live.map((view) => [view.deviceId, view]));
  const name = (view: CloudInstanceView) =>
    view.name ?? t('cloudSettings.onboarding.defaultName', { number: view.nameSequence });
  const controls = (view: CloudInstanceView, displayName: string) => (
    <CloudInstanceControls
      key={view.instanceId}
      view={view}
      name={displayName}
      policyLoaded={policies.has(view.deviceId)}
      discarded={discarded}
      reload={async () => {
        await Promise.all([readPolicy(view.deviceId), cloud.load(true)]);
      }}
      onPolicySaved={(policy) => storePolicy(view.deviceId, policy)}
      busy={cloud.busy}
      listError={!!cloud.error}
      waiting={cloud.waiting === view.deviceId}
      pending={cloud.powerPending?.deviceId === view.deviceId ? cloud.powerPending : undefined}
      anyPowerPending={!!cloud.powerPending}
      onLogin={() => void cloud.act(false, view.deviceId)}
      onPower={() => void cloud.power(view, displayName)}
      onOpenSettings={async () => {
        if (await discard()) {
          clearDrafts();
          openSettings(view.deviceId);
        }
      }}
      onDraft={(dirty) => markDraft(view.deviceId, dirty)}
      confirmDiscard={discard}
    />
  );
  return (
    <>
      {children({
        isManaged: (deviceId) =>
          isCloudDeviceId(deviceId) && (cloud.instances === null || byDevice.has(deviceId)),
        remoteDesktopReady: (deviceId) => {
          const view = byDevice.get(deviceId);
          return !view || (instanceStatus(view) === 'running' && !view.loginRequired);
        },
        status: (deviceId) => {
          const view = byDevice.get(deviceId);
          return view
            ? {
                label: instanceStatusText(view, t),
                live: instanceStatus(view) === 'running' && !view.loginRequired,
              }
            : null;
        },
        extras: (device) => {
          const view = byDevice.get(device.deviceId);
          return view ? controls(view, device.name || name(view)) : null;
        },
        // CIS instances the device directory does not list (login pending, never started,
        // relay unreachable) still get a row, after the directory's own devices.
        extraRows: [
          ...live
            .filter((view) => directory !== null && !directory.includes(view.deviceId))
            .map((view) => ({
              deviceId: view.deviceId,
              // Same card as a directory device: header, then the instance rows.
              node: (
                <>
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        instanceStatus(view) === 'running' && !view.loginRequired
                          ? 'bg-[var(--remote-status-ready)]'
                          : 'bg-[var(--remote-status-disconnected)]'
                      }`}
                      aria-hidden
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-13 font-medium text-[var(--text-primary)]">
                        {name(view)}
                      </span>
                      <span className="break-words text-11 text-[var(--text-tertiary)]">
                        {[view.version && `Linux · Cindy ${view.version}`, instanceStatusText(view, t)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  </div>
                  {controls(view, name(view))}
                </>
              ),
            })),
          ...(cloud.instances !== null && !live.length
            ? [
                {
                  deviceId: 'cloud-claim',
                  node: (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                          <span className="text-13 font-medium text-[var(--text-primary)]">
                            {t('cloudSettings.onboarding.emptyTitle')}
                          </span>
                          <span className={muted}>
                            {t('cloudSettings.onboarding.emptyDescription')}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {cloud.uncertain && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={cloud.busy}
                              onClick={() => void cloud.checkClaim()}
                            >
                              {t('cloudSettings.onboarding.checkClaim')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            disabled={cloud.busy || cloud.uncertain || !!cloud.error}
                            onClick={() => void cloud.act(true)}
                          >
                            {cloud.busy ? <Spinner size={14} /> : <Cloud size={14} />}
                            {t(`cloudSettings.onboarding.${cloud.busy ? 'claiming' : 'claim'}`)}
                          </Button>
                        </div>
                      </div>
                      <span className={muted}>{t('cloudSettings.onboarding.defaults')}</span>
                    </div>
                  ),
                },
              ]
            : []),
        ],
        notice: cloud.error ? t(`cloudSettings.onboarding.${cloud.error}`) : null,
      })}
    </>
  );
}

/** The instance's settings rows on its card, shared by directory and CIS-only rows. */
function CloudInstanceControls({
  view,
  name,
  policyLoaded,
  discarded,
  reload,
  onPolicySaved,
  busy,
  listError,
  waiting,
  pending,
  anyPowerPending,
  onLogin,
  onPower,
  onOpenSettings,
  onDraft,
  confirmDiscard,
}: {
  view: CloudInstanceView;
  name: string;
  /** The per-instance policy read has finished, whatever it returned. */
  policyLoaded: boolean;
  /** Bumped when the user discards drafts. */
  discarded: number;
  reload(): Promise<void>;
  onPolicySaved(policy: CloudMaintenanceView): void;
  busy: boolean;
  listError: boolean;
  waiting: boolean;
  pending?: PowerPending;
  anyPowerPending: boolean;
  onLogin(): void;
  onPower(): void;
  onOpenSettings(): void;
  onDraft(dirty: boolean): void;
  confirmDiscard(): Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string, values?: Record<string, string | number>) =>
    t(`cloudSettings.onboarding.${key}`, values);
  const trInstance = (key: string) => t(`cloudSettings.instance.${key}`);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const owner = useRef(getDataOwnerGeneration());
  // Instance operations only (upgrade, policy); no settings session is opened.
  const client = useMemo(
    () =>
      maintenanceOpen
        ? createCloudSettingsClient(view.deviceId, window.electronAPI.cloudSettings, () => {
            if (!isDataOwnerGenerationCurrent(owner.current))
              throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
          })
        : null,
    [maintenanceOpen, view.deviceId],
  );
  // Stable for CloudInstanceSection, which reports its maintenance draft through it.
  const draftRef = useRef(onDraft);
  draftRef.current = onDraft;
  const ownDraft = useRef(false);
  const changed = useCallback((_domain: string, dirty: boolean) => {
    ownDraft.current = dirty;
    draftRef.current(dirty);
  }, []);
  useEffect(() => () => draftRef.current(false), []);
  // A discarded draft must not stay on screen: closing the form returns it to the saved policy.
  useEffect(() => {
    if (!discarded) return;
    ownDraft.current = false;
    setMaintenanceOpen(false);
  }, [discarded]);
  const feed: CloudInstanceFeed = { view, reload, onPolicySaved };
  const state = instanceStatus(view);
  const running = state === 'running';
  const asleep = view.desiredState === 'stopped';
  const loginWake = view.loginRequired && asleep && view.loginWakeSupported;
  const toggleMaintenance = async () => {
    // Closing drops this card's draft; ask only when it has one.
    if (maintenanceOpen && ownDraft.current && !(await confirmDiscard())) return;
    if (maintenanceOpen) changed('instance', false);
    setMaintenanceOpen(!maintenanceOpen);
  };
  return (
    // The negative margin takes back the gap the access rows below keep from the header, so the
    // last instance row ends on their divider.
    <div
      className="-mb-3 mt-3 flex flex-col border-t border-[var(--border-default)]"
      data-cloud-instance={view.deviceId}
    >
      {view.loginRequired ? (
        <>
          <div className={cn(row, 'flex-wrap')}>
            <span className="flex min-w-0 flex-1 basis-48">
              <RowText
                label={tr('identity')}
                hint={tr(
                  waiting
                    ? 'waitingLogin'
                    : view.loginWakeSupported
                      ? 'recoveryDescription'
                      : 'loginDescription',
                  { name },
                )}
              />
            </span>
            <Button
              size="sm"
              disabled={
                busy ||
                listError ||
                anyPowerPending ||
                !!view.upgradeOperation?.active ||
                !!view.resourceChanging ||
                view.upgradeState === 'verifying'
              }
              onClick={onLogin}
            >
              <ExternalLink size={14} />
              {tr(loginWake ? 'wakeAndLogin' : waiting ? 'reopenLogin' : 'initialize')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className={cn(linkRow, !running && 'opacity-40')}
            disabled={!running}
            onClick={onOpenSettings}
          >
            <RowText
              label={tr('openSettings')}
              hint={trInstance(
                running ? 'settingsHint' : state === 'asleep' ? 'settingsWakeFirst' : 'settingsNotRunning',
              )}
            />
            <ChevronRight size={16} className={chevron} aria-hidden />
          </button>
          <div className={divider} />
          <button
            type="button"
            className={linkRow}
            aria-expanded={maintenanceOpen}
            onClick={() => void toggleMaintenance()}
          >
            <RowText
              label={trInstance('updates')}
              hint={updateHint(view, policyLoaded, t, i18n.language)}
            />
            {maintenanceOpen ? (
              <ChevronDown size={16} className={chevron} aria-hidden />
            ) : (
              <ChevronRight size={16} className={chevron} aria-hidden />
            )}
          </button>
          {maintenanceOpen && client && (
            <div className="pb-4 pt-1">
              <CloudInstanceSection
                client={client}
                name={name}
                active
                embedded
                feed={feed}
                changed={changed}
              />
            </div>
          )}
        </>
      )}
      {!loginWake && (
        <>
          <div className={divider} />
          <div className={row}>
            <RowText
              label={trInstance(asleep ? 'wake' : 'sleep')}
              hint={trInstance(asleep ? 'wakeHint' : 'sleepHint')}
            />
            <div className="flex shrink-0 items-center gap-2">
              {/* A runtime waiting for sign-in stays 'starting' indefinitely: nothing to spin for. */}
              {((pending && !pending.uncertain) ||
                (!view.loginRequired && ['starting', 'stopping', 'upgrading'].includes(state))) && (
                <Spinner size={14} />
              )}
              <Button
                size="sm"
                compact
                variant="secondary"
                disabled={busy || anyPowerPending || listError || !canChangeInstancePower(view)}
                onClick={onPower}
              >
                {trInstance(asleep ? 'wake' : 'sleep')}
              </Button>
            </div>
          </div>
        </>
      )}
      {pending?.uncertain && (
        <p role="alert" className={cn(muted, '-mt-2 pb-4')}>
          {trInstance('unconfirmed')}
        </p>
      )}
    </div>
  );
}

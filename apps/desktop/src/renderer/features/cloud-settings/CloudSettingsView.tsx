import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
  useOutletContext,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { TAB_IDS } from '@/lib/tabLabels';
import { SettingsSidebar } from '@/components/settings/SettingsSidebar';
import { SettingsSidebarNav } from '@/components/settings/SettingsSidebarNav';
import { resolveSettingsSearchEntry } from '@/components/settings/settingsSearchCatalog';
import { SettingsSearchNavigationContext } from '@/components/settings/SettingsSearchNavigation';
import { useSettingsSectionTarget } from '@/components/settings/useSettingsSectionTarget';
import { useAuth } from '@/contexts/AuthContext';
import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
} from '@/contexts/dataOwnerGeneration';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import {
  CLOUD_SETTINGS_GROUPS,
  type CloudSettingsDomain,
  type CloudSettingsState,
  type CloudSettingsTab,
} from '../../../shared/cloudSettings';
import { createCloudSettingsClient, type CloudSettingsClient } from './client';
import { CloudInstanceSection } from './CloudInstanceSection';
import type { CloudInstanceView } from '../../../shared/cloudInstanceControl';
import { useCloudInstanceAccess } from './CloudInstanceAccess';
import { cloudInstanceName } from './instanceName';
import { CloudImSettings, cloudImSettingsSummary, useCloudImDisplays } from './CloudImSettings';
import { CloudBotAuthorization } from './CloudBotAuthorization';
import { CloudMcpAuthorization } from './CloudMcpAuthorization';
import { CloudPluginAuthorization } from './CloudPluginAuthorization';
import { CloudProvidersSettings } from './CloudProvidersSettings';
import { NativeCloudSections } from './NativeCloudSections';
import type { CloudBotNotificationPreferences } from './CloudBotNotificationSettings';
import { cloudSearchEntryAllowed } from './search';
import type { SettingsSearchEntry } from '@/components/settings/settingsSearchTypes';
import { CloudDesktopFallback } from './CloudDesktopFallback';
const groups = TAB_IDS.filter((tab): tab is CloudSettingsTab => tab in CLOUD_SETTINGS_GROUPS);
const card =
  'rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5';
export function CloudSettingsPanel({
  name,
  client,
  online,
  onBack,
  trial = false,
  focusMaintenance = false,
  version,
  plugins,
}: {
  name: string;
  client: CloudSettingsClient;
  online: boolean;
  onBack(): void;
  trial?: boolean;
  focusMaintenance?: boolean;
  /** Runtime version CIS reports for the instance; shown in About like the local app version. */
  version?: string;
  /** The native client's plugin page for this instance. Absent in a browser, which opens the desktop. */
  plugins?: (active: boolean) => ReactNode;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [tab, setTab] = useState<CloudSettingsTab | 'instance'>(
    client.instance ? 'instance' : 'general',
  );
  const activeDomains = tab === 'instance' ? [] : CLOUD_SETTINGS_GROUPS[tab];
  const outlet = useOutletContext<{ sidebarWidth?: number } | null>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [searchNavigation, setSearchNavigation] = useState<{
    entry: SettingsSearchEntry | null;
    activation: number;
  }>({ entry: null, activation: 0 });
  const [mcpAuthorization, setMcpAuthorization] = useState(false);
  const [botAuthorization, setBotAuthorization] = useState(false);
  const [pluginAuthorization, setPluginAuthorization] = useState(false);
  const [providerAuthorization, setProviderAuthorization] = useState(false);
  // Like the local Plugins tab, the plugin page fills the panel and scrolls inside itself.
  const managesPlugins = !!plugins && !pluginAuthorization;
  const pluginPage = tab === 'ghosts' && managesPlugins;
  const fills = tab === 'providers' || pluginPage;
  const [deviceId, setDeviceId] = useState('');
  const [cpuCount, setCpuCount] = useState<number | undefined>();
  const [states, setStates] = useState<Partial<Record<CloudSettingsDomain, CloudSettingsState>>>(
    {},
  );
  const [domains, setDomains] = useState<CloudSettingsDomain[]>([]);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [tab]);
  const [loading, setLoading] = useState(false);
  // Read after the category has loaded, so the settings come first in the instance's queue,
  // and again for a channel whose saved settings change, so the automatic route follows them.
  const [loadedTab, setLoadedTab] = useState<string>();
  const imDisplays = useCloudImDisplays(
    deviceId,
    online && !trial && tab === 'im-bot' && loadedTab === tab && !loading,
    states,
  );
  const [failure, setFailure] = useState<string>();
  const [result, setResult] = useState<string>();
  const [epoch, setEpoch] = useState(0);
  const dirty = useRef(new Set<string>());
  const pending = useRef(false);
  const [writing, setWriting] = useState(false);
  const alive = useRef(true);
  const fresh = useRef(false);
  const changed = useMemo(
    () => (domain: string, value: boolean) => {
      if (value) dirty.current.add(domain);
      else dirty.current.delete(domain);
    },
    [],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      client.cancelAuthorizations?.();
    };
  }, [client]);
  // What the shown values were last read for. A finished save reads its own domain
  // back, so a save alone does not reread the whole category (seconds on IM and model
  // categories); a load it interrupted, a new tab or an explicit refresh still does.
  const loadedFor = useRef<readonly unknown[] | null>(null);
  useEffect(() => {
    if (!online || writing || failure === 'saveUnconfirmed') return;
    const key = [client, online, tab, epoch];
    if (fresh.current && loadedFor.current?.every((value, index) => value === key[index])) return;
    let current = true;
    fresh.current = false;
    loadedFor.current = null;
    setLoading(true);
    setFailure(undefined);
    void client
      .connect()
      .then(async (cap) => {
        const wanted = activeDomains.filter((domain) => cap.domains.includes(domain));
        const values = wanted.length ? await client.read(wanted) : [];
        if (!current) return;
        fresh.current = true;
        loadedFor.current = key;
        setLoadedTab(tab);
        setDomains(cap.domains);
        setCpuCount(cap.cpuCount);
        setDeviceId(cap.deviceId);
        setProviderAuthorization(cap.providerAuthorization === 1);
        setMcpAuthorization(cap.mcpAuthorization === 1);
        setBotAuthorization(cap.botAuthorization === 1);
        setPluginAuthorization(cap.pluginAuthorization === 1);
        setStates((before) => ({
          ...Object.fromEntries(
            Object.entries(before).filter(([domain]) =>
              cap.domains.includes(domain as CloudSettingsDomain),
            ),
          ),
          ...Object.fromEntries(values.map((state) => [state.domain, state])),
        }));
      })
      .catch((error) => {
        if (current)
          setFailure(
            error instanceof Error && error.message === 'CLOUD_SETTINGS_UNSUPPORTED'
              ? 'unsupported'
              : 'readFailed',
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      fresh.current = false;
    };
  }, [client, online, tab, epoch, writing]);
  useEffect(() => {
    const visibility = () => {
      fresh.current = false;
      if (document.visibilityState !== 'hidden') setEpoch((value) => value + 1);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  const leave = async () => {
    if (pending.current) return;
    if (
      dirty.current.size &&
      !(await confirm({
        presentation: 'standard',
        title: t('cloudSettings.discardTitle'),
        description: t('cloudSettings.discardBody'),
        confirmText: t('cloudSettings.discard'),
      }))
    )
      return;
    client.close();
    onBack();
  };
  const reload = async () => {
    if (pending.current || loading || !online) return;
    fresh.current = false;
    setLoading(true);
    try {
      await client.reconnect();
      if (alive.current) {
        setFailure(undefined);
        setEpoch((value) => value + 1);
      }
    } catch {
      if (alive.current) setFailure('readFailed');
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  const save = async (
    state: CloudSettingsState,
    set: Record<string, unknown>,
    clear?: string[],
  ) => {
    if (
      !alive.current ||
      !fresh.current ||
      !online ||
      pending.current ||
      document.visibilityState === 'hidden'
    )
      throw new Error('NOT_READY');
    pending.current = true;
    setWriting(true);
    setResult(undefined);
    try {
      const saved = await client.save(state, set, clear);
      if (!alive.current) throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
      setStates((before) => ({ ...before, [state.domain]: saved.state }));
      // The saved domain was just read back; the others are as current as before the save.
      fresh.current = true;
      dirty.current.delete(state.domain);
      setResult(
        saved.application === 'failed'
          ? 'hostSettings.savedApplyFailed'
          : trial
            ? 'cloudSettings.trialSaved'
            : 'cloudSettings.saved',
      );
      return saved.state;
    } catch (error) {
      fresh.current = false;
      setFailure('saveUnconfirmed');
      throw error;
    } finally {
      pending.current = false;
      setWriting(false);
    }
  };
  // Target values shown in the native notification sections of the IM cards.
  const ready = (domain: CloudSettingsDomain) =>
    states[domain]?.status === 'ready' ? states[domain] : undefined;
  const wecomNotifications = ready('wecomNotifications');
  const desktopNotifications = ready('desktopNotifications');
  const notificationPreferences: CloudBotNotificationPreferences = {
    wecomEnabled: wecomNotifications && wecomNotifications.value?.enabled === true,
    feishuSessionEnabled:
      desktopNotifications && desktopNotifications.value?.feishuNotificationsEnabled === true,
    setWecomEnabled: async (enabled) => {
      if (!wecomNotifications) throw new Error('NOT_READY');
      await save(wecomNotifications, { enabled });
    },
    setFeishuSessionEnabled: async (enabled) => {
      if (!desktopNotifications) throw new Error('NOT_READY');
      await save(desktopNotifications, { feishuNotificationsEnabled: enabled });
    },
    refresh: () => setEpoch((value) => value + 1),
  };
  const tabs = groups.filter((group) =>
    group === 'providers'
      ? providerAuthorization
      : group === 'im-bot'
        ? botAuthorization
        : group === 'ghosts'
          ? true
          : !domains.length || CLOUD_SETTINGS_GROUPS[group].some((d) => domains.includes(d)),
  );
  const allowSearchEntry = (entry: SettingsSearchEntry) =>
    entry.tab === 'providers'
      ? providerAuthorization && entry.id === 'providers'
      : entry.tab === 'im-bot'
        ? botAuthorization && entry.id === 'im-bot'
        : entry.tab === 'ghosts'
          ? entry.id === 'ghosts'
          : cloudSearchEntryAllowed(
              entry,
              domains.filter((domain) => !states[domain] || states[domain]?.status === 'ready'),
              trial,
            );
  useSettingsSectionTarget(
    searchNavigation.entry?.targetId ?? null,
    scrollRef,
    `${tab}:${searchNavigation.activation}:${loading}`,
    searchNavigation.entry?.fallbackTargetId,
  );
  return (
    <SettingsSearchNavigationContext.Provider value={searchNavigation}>
      <div
        className="h-full w-full overflow-hidden bg-[var(--settings-bg)]"
        role="main"
        aria-label={t('cloudSettings.title')}
        data-testid="cloud-settings"
      >
        <div className="flex h-full min-h-0 w-full justify-start pb-5">
          <SettingsSidebar
            width={outlet?.sidebarWidth}
            onBack={() => void leave()}
            disabled={writing}
          >
            <SettingsSidebarNav
              tabIds={tabs}
              activeTab={tab === 'instance' ? null : tab}
              leadingTab={
                client.instance
                  ? {
                      id: 'instance',
                      label: t('cloudSettings.instance.title'),
                      icon: Cloud,
                      selected: tab === 'instance',
                      onSelect: () => {
                        if (!pending.current) {
                          setTab('instance');
                          setSearchNavigation({ entry: null, activation: 0 });
                        }
                      },
                    }
                  : undefined
              }
              allowSearchEntry={allowSearchEntry}
              onSelectTab={(next) => {
                if (!pending.current) {
                  setTab(next as CloudSettingsTab);
                  setSearchNavigation({ entry: null, activation: 0 });
                  setResult(undefined);
                }
              }}
              onSelectSearchResult={({ tab: next, sectionId }) => {
                if (!pending.current) {
                  setTab(next as CloudSettingsTab);
                  setSearchNavigation((previous) => ({
                    entry: resolveSettingsSearchEntry(next, sectionId),
                    activation: previous.activation + 1,
                  }));
                }
              }}
            />
            {tab !== 'instance' && (
              <div className="mt-auto flex flex-col gap-2 px-3 pb-3 pt-6 text-12 leading-[1.5] text-[var(--settings-section-desc)]">
                <Button
                  variant="secondary"
                  tone="quiet"
                  compact
                  disabled={loading || !online || writing}
                  onClick={() => void reload()}
                >
                  {t('cloudSettings.reload')}
                </Button>
              </div>
            )}
          </SettingsSidebar>
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col pl-4 pr-6">
            <header
              data-cloud-settings-context
              className="mx-auto mb-4 flex w-full max-w-[920px] shrink-0 items-center gap-3 border-b border-[var(--settings-theme-card-border)] px-1 py-5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--settings-input-bg)] text-[var(--settings-section-title)]">
                <Cloud size={22} aria-hidden />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-20 font-medium leading-[1.2] text-[var(--settings-section-title)]">
                  {t('cloudSettings.title')}
                </h2>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-13 leading-[1.5]">
                  <span
                    className="break-words font-medium text-[var(--settings-section-title)]"
                    title={name}
                  >
                    {name}
                  </span>
                  <span className="text-[var(--settings-section-desc)]">
                    {t(
                      trial
                        ? 'cloudSettings.trial'
                        : online
                          ? 'cloudSettings.onlyTarget'
                          : 'cloudSettings.offline',
                    )}
                  </span>
                </div>
              </div>
            </header>
            {/* Providers scroll inside their card, as on the local settings page. */}
            <div
              ref={scrollRef}
              className={`min-h-0 flex-1 [scrollbar-gutter:stable] ${fills ? 'overflow-hidden' : 'overflow-y-auto'}`}
            >
              <div
                className={`mx-auto w-full min-w-0 animate-fade-in ${pluginPage ? 'max-w-none' : 'max-w-[920px] px-1'} ${fills ? 'flex h-full min-h-0 flex-col' : 'pb-32'}`}
              >
                {failure && tab !== 'instance' && (
                  <div role="alert" className={card}>
                    {t(`cloudSettings.${failure}`)}
                  </div>
                )}
                {!failure &&
                  !loading &&
                  activeDomains.some((d) => states[d]?.status === 'unreadable') && (
                    <p
                      role="alert"
                      className="py-[18px] text-13 text-[var(--settings-section-desc)]"
                    >
                      {t('cloudSettings.readFailed')}
                    </p>
                  )}
                <span
                  className={
                    result === 'hostSettings.savedApplyFailed'
                      ? 'text-13 text-[var(--text-secondary)]'
                      : 'sr-only'
                  }
                  role="status"
                >
                  {result ? t(result) : ''}
                </span>
                {activeDomains.length > 0 && loading && !activeDomains.some((d) => states[d]) && (
                  <p
                    role="status"
                    className="py-[18px] text-13 text-[var(--settings-section-desc)]"
                  >
                    {t('cloudSettings.loading')}
                  </p>
                )}
                {activeDomains.length > 0 &&
                  !loading &&
                  !failure &&
                  !activeDomains.some((d) => states[d]?.status === 'ready') && (
                    <p className="py-[18px] text-13 text-[var(--settings-section-desc)]">
                      {t('cloudSettings.noFields')}
                    </p>
                  )}
                {client.instance && (
                  <div
                    hidden={tab !== 'instance'}
                    role="tabpanel"
                    id="settings-panel-instance"
                    aria-labelledby="settings-tab-instance"
                  >
                    <CloudInstanceSection
                      client={client}
                      name={name}
                      active={tab === 'instance'}
                      changed={changed}
                      focusMaintenance={focusMaintenance}
                    />
                  </div>
                )}
                {groups.map((group) => (
                  <div
                    key={group}
                    hidden={tab !== group}
                    className={group === 'providers' || (group === 'ghosts' && managesPlugins) ? 'min-h-0 flex-1' : undefined}
                    role="tabpanel"
                    id={`settings-panel-${group}`}
                    aria-labelledby={`settings-tab-${group}`}
                  >
                    {group === 'im-bot' ? (
                      botAuthorization && (
                        <CloudBotAuthorization
                          deviceId={deviceId}
                          summary={(itemId) =>
                            // The collapsed row is one short line like the local "Pi · auto";
                            // the full automatic explanation stays in the expanded picker.
                            cloudImSettingsSummary(
                              itemId,
                              states,
                              t('hostSettings.card.automatic'),
                              imDisplays[itemId.replace(/^bot:/, '')],
                            )
                          }
                          settings={(itemId, section) => (
                            <CloudImSettings
                              itemId={itemId}
                              section={section}
                              deviceId={deviceId}
                              name={name}
                              display={imDisplays[itemId.replace(/^bot:/, '')]}
                              states={states}
                              supportedDomains={domains}
                              loading={loading}
                              readFailed={!!failure || !online}
                              retry={() => void reload()}
                              retryDisabled={!online || loading || writing || tab !== group}
                              disabled={!online || loading || writing || !!failure || tab !== group}
                              save={save}
                            />
                          )}
                          notificationPreferences={notificationPreferences}
                          client={client}
                          name={name}
                          online={online}
                          active={tab === group}
                          trial={trial}
                          refresh={epoch}
                        />
                      )
                    ) : group === 'ghosts' ? (
                      pluginAuthorization ? (
                        <CloudPluginAuthorization
                          client={client}
                          name={name}
                          online={online}
                          active={tab === group}
                          trial={trial}
                          refresh={epoch}
                        />
                      ) : plugins ? (
                        plugins(tab === group)
                      ) : (
                        // A browser has no plugin page: the instance's own settings (2026-11-04 review).
                        <CloudDesktopFallback
                          deviceId={deviceId}
                          name={name}
                          description={t('cloudSettings.pluginsDesktopFallback')}
                        />
                      )
                    ) : group === 'providers' ? (
                      providerAuthorization && (
                        <CloudProvidersSettings
                          client={client}
                          name={name}
                          online={online}
                          active={tab === group}
                          trial={trial}
                          refresh={epoch}
                          deviceId={deviceId}
                        />
                      )
                    ) : (
                      <fieldset
                        disabled={!online || loading || writing || !!failure || tab !== group}
                        className="m-0 min-w-0 border-0 p-0"
                      >
                        <NativeCloudSections
                          tab={group}
                          deviceId={deviceId}
                          name={name}
                          states={states}
                          // Hidden categories do not read (e.g. the instance prompt) on every save.
                          disabled={!online || loading || writing || !!failure || tab !== group}
                          cpuCount={cpuCount}
                          appVersion={version}
                          trial={trial}
                          save={save}
                          changed={changed}
                        />
                      </fieldset>
                    )}
                    {group === 'builtin-tools' && mcpAuthorization && (
                      <CloudMcpAuthorization
                        client={client}
                        name={name}
                        online={online}
                        active={tab === group}
                        trial={trial}
                        refresh={epoch}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsSearchNavigationContext.Provider>
  );
}

/** The native client's plugin page for one instance; see CloudPluginManagement. */
type CloudPluginPage = ComponentType<{ deviceId: string; name: string; active: boolean }>;

export function CloudSettingsView({ plugins }: { plugins?: CloudPluginPage }) {
  const access = useCloudInstanceAccess();
  if (access === 'checking') return null;
  if (access !== 'allowed') return <Navigate to="/settings" replace />;
  return <AuthorizedCloudSettingsView plugins={plugins} />;
}

/** Loads the plugin page, and reads the instance for it, only once the category is opened. */
function PluginPageGate({ active, children }: { active: boolean; children: ReactNode }) {
  const [opened, setOpened] = useState(active);
  useEffect(() => {
    if (active) setOpened(true);
  }, [active]);
  return opened ? <Suspense fallback={null}>{children}</Suspense> : null;
}

function AuthorizedCloudSettingsView({ plugins: Plugins }: { plugins?: CloudPluginPage }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { dataOwnerId } = useAuth();
  const devices = useDeviceLinkDeviceList();
  const candidates =
    devices?.filter(
      (device) => !device.isSelf && /^cloud-device-[a-f0-9]{24}$/.test(device.deviceId),
    ) ?? [];
  const selected = params.get('deviceId');
  const device = candidates.find((item) => item.deviceId === selected);
  const owner = getDataOwnerGeneration();
  const scope = JSON.stringify([dataOwnerId, owner.generation, selected]);
  const current = useRef({ scope });
  current.current = { scope };
  const [availability, setAvailability] = useState<{ scope: string; view?: CloudInstanceView }>();
  const client = useMemo(
    () =>
      selected
        ? createCloudSettingsClient(selected, window.electronAPI.cloudSettings, () => {
            if (!isDataOwnerGenerationCurrent(owner) || current.current.scope !== scope)
              throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
          })
        : undefined,
    [scope],
  );
  useEffect(() => {
    if (!client?.instance) return;
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const view = await client.instance!();
        if (!disposed && current.current.scope === scope)
          setAvailability({ scope, view: view.deviceId === selected ? view : undefined });
      } catch {
        if (!disposed && current.current.scope === scope) setAvailability({ scope });
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [client, scope, selected, device?.online]);
  const instance = availability?.scope === scope ? availability.view : undefined;
  // Settings use CIS, not the local relay. A stopped/revoked relay can have an
  // empty device directory even while the owned cloud runtime is healthy.
  // Reads and writes still pass Main/CIS ownership and runtime checks.
  const online = client?.instance
    ? !!instance?.ready && instance.desiredState === 'running' && !instance.loginRequired
    : !!device?.online;
  const returnTo: unknown = location.state?.returnTo;
  const back = () =>
    navigate(
      typeof returnTo === 'string' &&
        returnTo.startsWith('/') &&
        !returnTo.startsWith('//') &&
        (!returnTo.startsWith('/cloud-settings') || (returnTo === '/cloud-settings' && !!selected))
        ? returnTo
        : '/cc-agent',
    );
  if (selected && /^cloud-device-[a-f0-9]{24}$/.test(selected) && client) {
    const name =
      device?.name ??
      instance?.name ??
      (instance ? cloudInstanceName(t, instance) : t('cloudSettings.instance.title'));
    return (
      <CloudSettingsPanel
        key={scope}
        name={name}
        plugins={
          Plugins &&
          ((active) => (
            <PluginPageGate active={active}>
              <Plugins deviceId={selected} name={name} active={active} />
            </PluginPageGate>
          ))
        }
        client={client}
        online={online}
        onBack={back}
        focusMaintenance={params.get('section') === 'maintenance'}
        version={instance?.version ?? undefined}
      />
    );
  }
  return <Navigate to="/settings?tab=cloud-instances" replace />;
}

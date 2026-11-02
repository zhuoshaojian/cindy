import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  isCustomRoutedProvider,
  isOrganizationManagedProvider,
  type ProviderView,
} from '@cindy/model-providers';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tooltip';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { hasProviderLogo, ProviderLogoMark } from '@/components/icons/ProviderLogoMark';
import { SortableList } from '@/components/sidebar/SortableList';
import { ProviderListEntry } from '@/components/settings/ProviderListEntry';
import { ConnectedPill, ProviderAccountHeader } from '@/components/settings/ProviderAccountHeader';
import { OAuthBrowserLink, OAuthDeviceCodeCard } from '@/components/settings/OAuthDeviceCodeCard';
import { SettingsTextInput } from '@/components/settings/SettingsTextInput';
import { buildUnionRows, UnifiedModelList } from '@/components/settings/UnifiedModelList';
import { ModelSettingsSourceContext } from '@/components/settings/modelSettingsSource';
import { useDeviceProviderSubscriptionCard } from '@/components/settings/useProviderSubscriptionCard';
import { QuotaHoverCard } from '@/components/status/QuotaHoverCard';
import { ProviderShareEntryButton } from '@/features/provider-share/ProviderShareEntryButton';
import { ProviderShareManagePage } from '@/features/provider-share/ProviderShareManagePage';
import { ProviderSharePasteButton } from '@/features/provider-share/ProviderSharePasteDialog';
import {
  ProviderShareReceivedDetail,
  ProviderShareReceivedRailGroup,
} from '@/features/provider-share/ProviderShareReceivedRail';
import {
  ProviderShareSourceContext,
  type ProviderShareSource,
} from '@/features/provider-share/providerShareSource';
import type { ReceivedSnapshot } from '@/features/provider-share/providerShareStore';
import { providerShareGate } from '@/features/provider-share/providerShareFormat';
import { useProviderSharePendingRequests } from '@/features/provider-share/providerShareStore';
import { useDeviceProviders } from '@/hooks/useDeviceProviders';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { providerDisplayName } from '@/lib/providerDisplayName';
import { providerMonogram } from '@/lib/providerModels';
import {
  customProviderSubtitleForDisplay,
  providerSubtitleForDisplay,
} from '@/lib/providerSubtitle';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { ManagementItem, ManagementResult } from '../../../shared/settingsManagement';
import type { CloudProviderSettingsRequest } from '../../../shared/cloudProviderSettings';
import { MANAGED_LLAMACPP_PROVIDER_ID } from '../../../shared/llamaCpp';
import {
  MANAGED_LMSTUDIO_PROVIDER_ID,
  MANAGED_OLLAMA_PROVIDER_ID,
} from '../../../shared/localModelRuntime';
import { applyProviderOrder } from '../../../shared/providerOrder';
import { localCliDisplayName, type LocalCliDetection } from '../../../shared/localCliDetect';
import { isBuiltinRefreshableProviderId } from '../../../shared/providerModelRefresh';
import { providerGroupDeviceCount } from '../../../shared/providerGroup';
import { remoteProviderGroupOf } from '../../../shared/remoteProviderGroups';
import { CloudProviderAuthorization } from './CloudProviderAuthorization';
import { CloudAddProviderDialog } from './CloudAddProviderDialog';
import { CloudXdQuota } from './CloudXdQuota';
import { useCloudProviderCatalog } from './cloudProviderCatalog';
import { useCloudAuthorization, type CloudAuthorizationProps } from './useCloudAuthorization';

type Action = ManagementItem['actions'][number];
type ShareCommand = Extract<CloudProviderSettingsRequest, { op: 'share' }>['command'];
type Phase = Extract<ManagementResult, { kind: 'operation' }>['phase'];

function providerHasModels(provider: ProviderView): boolean {
  return (
    provider.agents.some((agent) => (provider.models[agent]?.length ?? 0) > 0) ||
    (provider.imageModels?.length ?? 0) > 0 ||
    (provider.videoModels?.length ?? 0) > 0 ||
    (provider.audioModels?.length ?? 0) > 0 ||
    (provider.embeddingModels?.length ?? 0) > 0
  );
}

/** Same rail rule as the local page: removed and never-connected built-ins stay out. */
export function cloudRailProviders(providers: readonly ProviderView[]): ProviderView[] {
  return providers.filter((p) => {
    if (p.removed) return false;
    if (p.source === 'builtin')
      return (
        p.id === 'xd' ||
        p.connected ||
        p.removed === false ||
        p.openAiAccount?.reconnectRequired === true ||
        (p.id === 'openai' && (p.imageModels?.length ?? 0) > 0)
      );
    if (isOrganizationManagedProvider(p)) return true;
    return (
      p.source === 'user' &&
      (p.id === MANAGED_OLLAMA_PROVIDER_ID ||
        p.id === MANAGED_LLAMACPP_PROVIDER_ID ||
        p.id === MANAGED_LMSTUDIO_PROVIDER_ID ||
        providerHasModels(p) ||
        (p.auth.method === 'oauth' && (!!p.auth.oauth || !!p.auth.native)))
    );
  });
}

function providerIcon(p: ProviderView, size: number): ReactNode {
  return hasProviderLogo(p.id, p.routing) ? (
    <ProviderLogoMark providerId={p.id} routing={p.routing} size={size} />
  ) : (
    <span className="text-15 font-medium leading-none">{providerMonogram(p.name)}</span>
  );
}

function CustomTag({ label }: { label: string }) {
  return (
    <span
      className="flex h-[18px] shrink-0 items-center rounded-full px-2 text-11 font-medium"
      style={{
        border: '1px solid var(--settings-integration-avatar-border)',
        color: 'var(--text-tertiary)',
      }}
    >
      {label}
    </span>
  );
}

/**
 * The cloud instance's model providers, composed from the local page's components. The
 * catalog and model management go over the instance's private settings channel; logins,
 * keys and new connections stay on the CIS management tickets. An older runtime, or a
 * viewer who does not own the instance, keeps the ticket-only list.
 */
export function CloudProvidersSettings(props: CloudAuthorizationProps & { deviceId: string }) {
  const catalog = useCloudProviderCatalog({
    deviceId: props.deviceId,
    online: props.online,
    active: props.active,
    refresh: props.refresh,
  });
  if (props.trial || !props.deviceId || catalog.status === 'unsupported')
    return (
      <div className="h-full overflow-y-auto pb-32">
        <CloudProviderAuthorization {...props} />
      </div>
    );
  return <CloudProviderCatalogPage {...props} catalog={catalog} />;
}

function CloudProviderCatalogPage({
  catalog,
  ...props
}: CloudAuthorizationProps & {
  deviceId: string;
  catalog: ReturnType<typeof useCloudProviderCatalog>;
}) {
  const { name, online, deviceId } = props;
  const auth = useCloudAuthorization(props, 'providers', { all: true });
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const reducedMotion = useReducedMotion();
  const pending = useProviderSharePendingRequests();
  const remote = useDeviceProviders(deviceId);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareProviderId, setShareProviderId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [keyFormFor, setKeyFormFor] = useState<string | null>(null);
  const [addStart, setAddStart] = useState<string | null>(null);
  const [selectedShareId, setSelectedShareId] = useState<string | null>(null);
  const [shares, setShares] = useState<ReceivedSnapshot>({ received: [], loaded: false });
  const shareSupported = catalog.supportedOps.includes('share');
  // Shares as the instance sees them; trust and leaving run on the instance too.
  const loadShares = useCallback(() => {
    if (!shareSupported) return;
    void catalog
      .send({ op: 'share', command: { action: 'received' } })
      .then((receipt) => {
        if (Array.isArray(receipt.value))
          setShares({ received: receipt.value as ReceivedSnapshot['received'], loaded: true });
      })
      .catch(() => undefined);
  }, [shareSupported, deviceId]);
  useEffect(() => loadShares(), [loadShares]);
  const shareSource = useMemo<ProviderShareSource>(
    () => ({
      received: shares,
      command: (async (command: { action: string }) => {
        if (
          command.action !== 'get-credential-consent' &&
          command.action !== 'set-credential-consent' &&
          command.action !== 'leave'
        )
          throw new Error('[UNSUPPORTED] not available for the cloud instance');
        const receipt = await catalog.send({
          op: 'share',
          command: command as ShareCommand,
        });
        if (command.action === 'leave') loadShares();
        return receipt.value;
      }) as ProviderShareSource['command'],
    }),
    [shares, loadShares, catalog.send],
  );
  const selectedShare = shares.received.find((share) => share.shareId === selectedShareId) ?? null;
  const [detections, setDetections] = useState<LocalCliDetection[]>([]);
  const scanSupported = catalog.supportedOps.includes('cli-scan');
  // The instance's own CLIs, scanned once like the local page; suggestions are optional.
  useEffect(() => {
    if (!scanSupported) return;
    let cancelled = false;
    void catalog
      .send({ op: 'cli-scan' })
      .then((receipt) => {
        const value = receipt.value as { detections?: LocalCliDetection[] } | undefined;
        if (!cancelled) setDetections(Array.isArray(value?.detections) ? value.detections : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scanSupported, deviceId]);
  const rail = useMemo(
    () => applyProviderOrder(cloudRailProviders(catalog.providers), catalog.providerOrder),
    [catalog.providers, catalog.providerOrder],
  );
  const list = pendingOrder ? applyProviderOrder(rail, pendingOrder) : rail;
  useEffect(() => setPendingOrder(null), [catalog.providerOrder]);
  const selected = list.find((p) => p.id === selectedId) ?? list[0] ?? null;
  const railIds = new Set(list.map((p) => p.id));
  const unlisted = useMemo(
    () =>
      new Set(
        catalog.providers
          .filter((p) => p.source === 'builtin' && !rail.some((row) => row.id === p.id))
          .map((p) => p.id),
      ),
    [catalog.providers, rail],
  );
  // Same rule as the local page: installed, in the catalog, not connected and not in the rail.
  const suggestions = detections
    .filter((d) => d.installed && !railIds.has(d.providerId))
    .map((d) => ({ detection: d, provider: catalog.providers.find((p) => p.id === d.providerId) }))
    .filter(
      (s): s is { detection: LocalCliDetection; provider: ProviderView } =>
        !!s.provider && !s.provider.connected && !s.provider.removed,
    );
  const itemFor = (p: ProviderView) =>
    auth.items.find((item) => item.id === `provider:${p.id}` || item.id === `builtin-key:${p.id}`);
  const disabled = !online || auth.requesting || auth.loading;

  const persistOrder = (ids: string[]) => {
    if (ids.every((id, index) => id === list[index]?.id)) return;
    setPendingOrder(ids);
    void catalog.write({ op: 'order', providerIds: ids }).then((ok) => {
      if (!ok) {
        setPendingOrder(null);
        toast.error(t('settings.providers.order.saveFailed'));
      }
    });
  };
  const moveWithKeyboard = (id: string, delta: -1 | 1) => {
    const ids = list.map((p) => p.id);
    const index = ids.indexOf(id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    persistOrder(ids);
  };
  const writeOrToast = async (
    request: Parameters<typeof catalog.write>[0],
    failure = 'settings.providers.models.accessWriteFailed',
  ) => {
    if (!(await catalog.write(request))) toast.error(t(failure));
  };
  const runAction = (item: ManagementItem, action: Action, values?: Record<string, string>) =>
    new Promise<Phase>(
      (resolve) => void auth.run(item, action, values, { settled: (phase) => resolve(phase) }),
    ).then((phase) => {
      // The instance changed the catalog through its own handlers; reread it.
      void catalog.load();
      return phase;
    });

  if (shareProviderId) {
    const provider = catalog.providers.find((p) => p.id === shareProviderId);
    return (
      <ProviderShareManagePage
        key={`${deviceId}:${shareProviderId}`}
        providerId={shareProviderId}
        providerName={provider ? providerDisplayName(provider, t) : shareProviderId}
        providerIcon={provider ? providerIcon(provider, 18) : null}
        deviceId={deviceId}
        deviceName={name}
        remoteProvider={provider}
        gate={providerShareGate({
          remoteControlEnabled: true,
          invocationEnabled: !provider || provider.remoteInvocationEnabled === true,
        })}
        onBack={() => {
          setSelectedId(shareProviderId);
          setShareProviderId(null);
        }}
      />
    );
  }

  const header = (p: ProviderView, children: ReactNode) => {
    const item = itemFor(p);
    const actions = item?.actions ?? [];
    const authorize = actions.find((a) => a.intent === 'authorize');
    const disconnect = actions.find((a) => a.intent === 'disconnect');
    const connectKey = actions.find((a) => a.intent === 'connect' && a.fields.length);
    const remove = actions.find((a) => a.intent === 'delete');
    const owns = !!item && auth.operationItem === item.id;
    const reconnectRequired = p.openAiAccount?.reconnectRequired === true;
    const primary =
      owns && auth.busy
        ? {
            label: t('settings.providers.button.cancel'),
            onClick: () => void auth.operate('cancel'),
          }
        : authorize && (!p.connected || reconnectRequired)
          ? {
              label: t(
                reconnectRequired
                  ? 'settings.providers.openai.reconnect'
                  : 'settings.providers.button.authorize',
              ),
              onClick: () => void runAction(item!, authorize),
            }
          : connectKey && !p.connected
            ? {
                label: t('settings.providers.builtinApiKey.saveKey'),
                onClick: () => setKeyFormFor(p.id),
              }
            : disconnect && p.connected
              ? {
                  label: t('settings.providers.button.disconnect'),
                  onClick: () => void runAction(item!, disconnect),
                }
              : null;
    const canRename = p.id !== 'xd' && !isOrganizationManagedProvider(p);
    const builtinRemovable =
      p.source === 'builtin' && p.id !== 'xd' && !isOrganizationManagedProvider(p);
    const removeProvider = async () => {
      if (remove) {
        await runAction(item!, remove);
        return;
      }
      // A built-in connection is hidden only after its login is gone.
      if (p.connected && disconnect && (await runAction(item!, disconnect)) !== 'succeeded') return;
      await writeOrToast(
        { op: 'presentation', providerId: p.id, action: 'remove' },
        'settings.providers.custom.toast.deleteFailed',
      );
    };
    const subscriptionProduct = p.access?.kind === 'subscription' ? p.access.product : null;
    const singleAgent =
      p.agents.length === 1
        ? t('settings.providers.detail.singleAgentNote', {
            agent:
              p.agents[0] === 'claude-code' ? 'Claude Code' : p.agents[0] === 'pi' ? 'Pi' : 'Codex',
          })
        : null;
    // Same subtitles as the local headers for Cindy AI and organization connections.
    const subtitle =
      p.id === 'xd'
        ? t('settings.providers.xd.simpleSubtitle')
        : isOrganizationManagedProvider(p)
          ? t('settings.providers.byok.managed')
          : p.source === 'user'
            ? customProviderSubtitleForDisplay(p)
            : providerSubtitleForDisplay(p, '');
    const prompt = owns ? auth.prompt : undefined;
    const detail =
      prompt?.kind === 'device' && prompt.userCode ? (
        <OAuthDeviceCodeCard
          deviceCode={{
            verificationUrl: prompt.url,
            userCode: prompt.userCode,
            expiresAt: prompt.expiresAt,
          }}
          onOpen={auth.open}
        />
      ) : prompt ? (
        <div className="flex flex-col gap-2">
          <OAuthBrowserLink url={prompt.url} onOpen={auth.open} />
          {prompt.kind === 'callback' && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (auth.callback.trim()) void auth.operate('respond');
              }}
            >
              <SettingsTextInput
                aria-label={t('cloudSettings.authCallback')}
                type="password"
                autoComplete="off"
                value={auth.callback}
                onChange={auth.setCallback}
                disabled={disabled}
              />
              <div>
                <Button
                  type="submit"
                  variant="secondary"
                  size="md"
                  disabled={disabled || !auth.callback.trim()}
                >
                  {t('cloudSettings.authContinue')}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : owns && auth.operation?.phase === 'unknown' ? (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            disabled={disabled}
            onClick={() => void auth.operate('status')}
          >
            {t('cloudSettings.authCheck')}
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={disabled}
            onClick={() => void auth.operate('cancel')}
          >
            {t('settings.providers.button.cancel')}
          </Button>
        </div>
      ) : keyFormFor === p.id && connectKey && item ? (
        <KeyForm
          disabled={disabled || auth.busy}
          onCancel={() => setKeyFormFor(null)}
          submit={async (apiKey) => {
            if ((await runAction(item, connectKey, { apiKey })) === 'succeeded')
              setKeyFormFor(null);
          }}
        />
      ) : undefined;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ProviderAccountHeader
          icon={providerIcon(p, 18)}
          title={providerDisplayName(p, t)}
          subtitle={`${subtitle}${singleAgent ? ` · ${singleAgent}` : ''}`}
          badges={
            <>
              {subscriptionProduct && (
                <CustomTag
                  label={t('settings.providers.models.subscriptionProduct', {
                    product: subscriptionProduct,
                  })}
                />
              )}
              {p.suspended && <CustomTag label={t('settings.providers.pill.suspended')} />}
            </>
          }
          actions={
            <>
              {p.connected && !reconnectRequired && <ConnectedPill />}
              {primary && (
                <Button
                  variant="secondary"
                  size="md"
                  disabled={disabled || (auth.busy && !owns)}
                  onClick={primary.onClick}
                >
                  {primary.label}
                </Button>
              )}
            </>
          }
          menu={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Tip text={t('settings.providers.detail.moreActionsAria')}>
                  <button
                    type="button"
                    aria-label={t('settings.providers.detail.moreActionsAria')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </Tip>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canRename && (
                  <DropdownMenuItem disabled={!online} onClick={() => void rename(p)}>
                    <Pencil size={18} className="mr-2.5" />
                    {t('settings.providers.pill.rename')}
                  </DropdownMenuItem>
                )}
                {connectKey && p.connected && (
                  <DropdownMenuItem disabled={!online} onClick={() => setKeyFormFor(p.id)}>
                    <Pencil size={18} className="mr-2.5" />
                    {t('settings.providers.builtinApiKey.replaceKey')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  disabled={!online}
                  onClick={() =>
                    void writeOrToast({
                      op: 'model-disable',
                      kind: 'provider',
                      providerId: p.id,
                      disabled: !p.suspended,
                    })
                  }
                >
                  {t(
                    p.suspended
                      ? 'settings.providers.menu.enableProvider'
                      : 'settings.providers.menu.disableProvider',
                  )}
                </DropdownMenuItem>
                {(remove || builtinRemovable) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!online || auth.busy}
                      onClick={() => void removeProvider()}
                    >
                      <Trash2 size={18} className="mr-2.5" />
                      {t('settings.providers.custom.deleteAria')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <div
          data-testid="provider-detail-scroll"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain [&>*]:shrink-0"
        >
          {owns && auth.operation && auth.busy && !prompt && (
            <p role="status" className="px-5 pb-2 text-13 text-[var(--text-secondary)]">
              {t(`cloudSettings.authPhase.${auth.operation.phase}`)}
            </p>
          )}
          {detail && <div className="px-5 pb-4">{detail}</div>}
          {p.id === 'xd' ? (
            <CloudXdQuota deviceId={deviceId} online={online} />
          ) : (
            <CloudProviderQuota provider={p} deviceId={deviceId} />
          )}
          {children}
        </div>
      </div>
    );
  };

  const rename = async (p: ProviderView) => {
    let next = p.name;
    const ok = await confirm({
      title: t('settings.providers.pill.rename'),
      content: (
        <RenameInput
          initialName={p.name}
          onChange={(value) => {
            next = value;
          }}
        />
      ),
      confirmText: t('settings.providers.custom.save'),
      cancelText: t('settings.providers.custom.cancel'),
    });
    if (!ok || !next.trim()) return;
    await writeOrToast(
      { op: 'presentation', providerId: p.id, action: 'rename', name: next.trim() },
      'settings.providers.custom.toast.saveFailed',
    );
  };

  const refreshModels = async (p: ProviderView) => {
    setRefreshing(p.id);
    try {
      await writeOrToast({
        op: isBuiltinRefreshableProviderId(p.id) ? 'refresh' : 'rediscover',
        providerId: p.id,
      });
    } finally {
      setRefreshing(null);
    }
  };

  return (
    // The real model list, panel and price dialog read and write the instance through this.
    <ModelSettingsSourceContext.Provider value={catalog.source}>
      <ProviderShareSourceContext.Provider value={shareSupported ? shareSource : null}>
        <section
          className="flex h-full min-h-0 flex-col gap-[14px]"
          aria-label={t('settings.providers.title')}
        >
          <div className="flex shrink-0 items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2
                className="text-16 font-medium leading-[1.2]"
                style={{ color: 'var(--settings-section-title)' }}
              >
                {t('settings.providers.title')}
              </h2>
              <p
                className="text-13 leading-[1.5]"
                style={{ color: 'var(--settings-section-desc)' }}
              >
                {t('settings.providers.subtitle')}
              </p>
            </div>
            {/* Joining by link is an account action, as on the local page. */}
            <ProviderSharePasteButton />
          </div>
          {auth.failure && (
            <p role="alert" className="text-13 text-[var(--text-secondary)]">
              {t(`cloudSettings.${auth.failure}`)}
            </p>
          )}
          {catalog.status === 'loading' && <p role="status">{t('cloudSettings.loading')}</p>}
          {catalog.status === 'unavailable' && (
            <div className="flex items-center gap-3">
              <p role="alert" className="text-13 text-[var(--text-secondary)]">
                {t('cloudSettings.readFailed')}
              </p>
              <Button
                variant="secondary"
                size="md"
                disabled={!online}
                onClick={() => void catalog.load()}
              >
                <RefreshCw size={14} />
                {t('cloudSettings.reload')}
              </Button>
            </div>
          )}
          {catalog.status === 'ready' && (
            <div
              className="flex min-h-0 flex-1 overflow-hidden rounded-xl border"
              style={{
                backgroundColor: 'var(--settings-theme-card-bg)',
                borderColor: 'var(--settings-theme-card-border)',
              }}
            >
              <div
                className="flex w-[224px] shrink-0 flex-col border-r"
                style={{ borderColor: 'var(--settings-theme-card-border)' }}
              >
                <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
                  {list.length > 1 && (
                    <div className="select-none px-1.5 pb-1 pt-1">
                      <span className="text-11" style={{ color: 'var(--text-tertiary)' }}>
                        {t('settings.providers.order.hint')}
                      </span>
                    </div>
                  )}
                  <SortableList
                    items={list}
                    getId={(p) => p.id}
                    onReorder={persistOrder}
                    renderItem={(p, index) => (
                      <RailRow
                        provider={p}
                        selected={selected?.id === p.id}
                        onSelect={() => {
                          setSelectedShareId(null);
                          setSelectedId(p.id);
                        }}
                        position={index + 1}
                        total={list.length}
                        onMove={(delta) => moveWithKeyboard(p.id, delta)}
                        sortable={list.length > 1 && online}
                      />
                    )}
                    disabled={list.length < 2 || !online}
                    reducedMotion={reducedMotion}
                    filter="input, textarea, select, a, [data-no-drag]"
                    className="flex flex-col gap-0.5"
                    rowClassName="provider-settings-sortable-row"
                  />
                  {/* Only the instance's own list; never this computer's shares in its place. */}
                  {shareSupported && (
                    <ProviderShareReceivedRailGroup
                      selectedShareId={selectedShare?.shareId ?? null}
                      onSelect={(shareId) => setSelectedShareId(shareId)}
                    />
                  )}
                  {suggestions.length > 0 && (
                    <>
                      <span
                        className="px-2.5 pb-1 pt-3 text-11 font-medium uppercase"
                        style={{ color: 'var(--text-tertiary)', letterSpacing: '0.5px' }}
                      >
                        {t('settings.providers.detect.groupLabel')}
                      </span>
                      {suggestions.map((s) => (
                        <SuggestionRow
                          key={s.detection.cli}
                          detection={s.detection}
                          provider={s.provider}
                          disabled={!online}
                          onClick={() => {
                            setAddStart(s.provider.id);
                            setAdding(true);
                          }}
                        />
                      ))}
                    </>
                  )}
                </div>
                <div
                  id="settings-search-settings-providers-addProvider"
                  className="border-t p-2"
                  style={{ borderColor: 'var(--settings-theme-card-border)' }}
                >
                  <Button
                    variant="secondary"
                    size="lg"
                    type="button"
                    disabled={!online}
                    onClick={() => {
                      setAddStart(null);
                      setAdding(true);
                    }}
                    className="w-full"
                  >
                    <Plus size={15} />
                    {t('settings.providers.addProvider')}
                  </Button>
                </div>
              </div>
              <div
                key={selectedShare ? `share:${selectedShare.shareId}` : selected?.id}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {selectedShare ? (
                  <ProviderShareReceivedDetail share={selectedShare} />
                ) : (
                  selected &&
                  header(
                    selected,
                    <>
                      {selected.suspended && (
                        <div
                          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-13"
                          style={{ borderColor: 'var(--settings-theme-card-border)' }}
                        >
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            {t('settings.providers.detail.suspendedBanner')}
                          </span>
                          <Button
                            variant="secondary"
                            size="md"
                            disabled={!online}
                            onClick={() =>
                              void writeOrToast({
                                op: 'model-disable',
                                kind: 'provider',
                                providerId: selected.id,
                                disabled: false,
                              })
                            }
                          >
                            {t('settings.providers.button.enableProvider')}
                          </Button>
                        </div>
                      )}
                      {!selected.suspended &&
                        selected.connected &&
                        selected.agents.length > 0 &&
                        selected.remoteInvocationEnabled !== undefined && (
                          <CloudRemoteAccessRow
                            key={selected.id}
                            provider={selected}
                            disabled={!online}
                            groupSize={(() => {
                              const view = remote.providers.find((p) => p.id === selected.id);
                              const group = view ? remoteProviderGroupOf(view) : null;
                              return group ? providerGroupDeviceCount(group.members) : null;
                            })()}
                            pendingShareRequests={
                              pending.filter(
                                (request) =>
                                  request.hostDeviceId === deviceId &&
                                  request.share.providerId === selected.id,
                              ).length
                            }
                            onManageShare={() => setShareProviderId(selected.id)}
                            write={(enabled) =>
                              catalog.write({
                                op: 'remote-access',
                                providerId: selected.id,
                                enabled,
                              })
                            }
                          />
                        )}
                      {!selected.suspended &&
                        catalog.source &&
                        (providerHasModels(selected) ||
                          isCustomRoutedProvider(selected) ||
                          isBuiltinRefreshableProviderId(selected.id)) && (
                          <>
                            <div
                              className="border-t"
                              style={{ borderColor: 'var(--settings-theme-card-border)' }}
                            />
                            <UnifiedModelList
                              provider={selected}
                              emptyMessage={
                                selected.source === 'user' && selected.modelDiscoveryFailure
                                  ? t(
                                      `settings.providers.detail.discoveryFailed.${selected.modelDiscoveryFailure.kind}`,
                                    )
                                  : t(
                                      selected.connected
                                        ? 'settings.providers.detail.emptyModelsConnected'
                                        : 'settings.providers.detail.emptyModels',
                                    )
                              }
                              {...(isBuiltinRefreshableProviderId(selected.id) ||
                              isCustomRoutedProvider(selected)
                                ? {
                                    onRefresh: () => void refreshModels(selected),
                                    refreshing: refreshing === selected.id,
                                    refreshDisabled: refreshing !== null || !online,
                                    ...(isBuiltinRefreshableProviderId(selected.id)
                                      ? {
                                          refreshIdleLabel: t(
                                            'settings.providers.models.refreshBuiltinAria',
                                          ),
                                        }
                                      : {}),
                                  }
                                : {})}
                            />
                          </>
                        )}
                    </>,
                  )
                )}
              </div>
            </div>
          )}
          <CloudAddProviderDialog
            open={adding}
            onOpenChange={(next) => {
              setAdding(next);
              if (!next) setAddStart(null);
            }}
            auth={auth}
            disabled={disabled}
            run={runAction}
            unlisted={unlisted}
            start={addStart}
          />
        </section>
      </ProviderShareSourceContext.Provider>
    </ModelSettingsSourceContext.Provider>
  );
}

/** The local built-in API key editor: the key is typed here and stored on the instance. */
function KeyForm({
  disabled,
  onCancel,
  submit,
}: {
  disabled: boolean;
  onCancel: () => void;
  submit: (apiKey: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  return (
    <form
      className="flex flex-col gap-2"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        const value = key.trim();
        if (!value || disabled) return;
        setKey('');
        void submit(value);
      }}
    >
      <SettingsTextInput
        aria-label={t('settings.providers.custom.fields.apiKey')}
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        placeholder={t('settings.providers.builtinApiKey.keyPlaceholder')}
        value={key}
        maxLength={1024}
        disabled={disabled}
        onChange={setKey}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size="md" disabled={disabled || !key.trim()}>
          {t('settings.providers.builtinApiKey.saveKey')}
        </Button>
        <Button type="button" variant="secondary" size="md" onClick={onCancel}>
          {t('settings.providers.button.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The local detection row: the instance's CLI is installed and its provider is not connected. */
function SuggestionRow({
  detection,
  provider,
  disabled,
  onClick,
}: {
  detection: LocalCliDetection;
  provider: ProviderView;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const cliName = localCliDisplayName(detection.cli);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={t(
        detection.loggedIn
          ? 'settings.providers.detect.hintLoggedIn'
          : 'settings.providers.detect.hintInstalled',
        { cli: cliName },
      )}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--settings-menu-bg-hover)]"
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg opacity-70"
        style={{
          backgroundColor: 'var(--settings-integration-avatar-bg)',
          border: '1px solid var(--settings-integration-avatar-border)',
          color: 'var(--settings-integration-avatar-icon)',
        }}
      >
        {providerIcon(provider, 14)}
      </div>
      <span className="min-w-0 flex-1 truncate text-13" style={{ color: 'var(--text-secondary)' }}>
        {providerDisplayName(provider, t)}
      </span>
      <span
        className="flex h-[22px] shrink-0 items-center rounded-full border px-2.5 text-11 font-medium"
        style={{
          borderColor: 'var(--settings-btn-secondary-border)',
          color: 'var(--text-secondary)',
        }}
      >
        {t('settings.providers.detect.action')}
      </span>
    </button>
  );
}

function RenameInput({
  initialName,
  onChange,
}: {
  initialName: string;
  onChange: (name: string) => void;
}) {
  const [value, setValue] = useState(initialName);
  return (
    <SettingsTextInput
      value={value}
      maxLength={128}
      autoFocus
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function RailRow({
  provider,
  selected,
  onSelect,
  position,
  total,
  onMove,
  sortable,
}: {
  provider: ProviderView;
  selected: boolean;
  onSelect: () => void;
  position: number;
  total: number;
  onMove: (delta: -1 | 1) => void;
  sortable: boolean;
}) {
  const { t } = useTranslation();
  const modelCount = useMemo(
    () => (providerHasModels(provider) ? buildUnionRows(provider).length : null),
    [provider],
  );
  const title = providerDisplayName(provider, t);
  const reconnectRequired = provider.openAiAccount?.reconnectRequired === true;
  return (
    <div
      className={cn(
        'relative flex w-full items-center rounded-lg text-left transition-colors',
        selected
          ? 'bg-[var(--settings-menu-bg-selected)]'
          : 'hover:bg-[var(--settings-menu-bg-hover)]',
      )}
    >
      {sortable && (
        <button
          type="button"
          className="provider-order-handle absolute inset-y-0 left-0 z-[1] my-auto flex h-9 w-3 cursor-grab items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-soft)]"
          aria-label={t('settings.providers.order.handle', { provider: title, position, total })}
          aria-keyshortcuts="ArrowUp ArrowDown"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            onMove(event.key === 'ArrowUp' ? -1 : 1);
          }}
          style={{ color: 'var(--text-tertiary)' }}
        >
          <GripVertical size={12} />
        </button>
      )}
      <Tip text={title} side="right" contentClassName="max-w-[360px] break-words">
        <ProviderListEntry
          title={title}
          icon={providerIcon(provider, 14)}
          selected={selected}
          onSelect={onSelect}
          muted={provider.suspended}
          annotation={
            reconnectRequired ? (
              <span
                className="shrink-0 select-none text-11"
                style={{ color: 'var(--settings-integration-warning)' }}
              >
                {t('settings.providers.openai.reconnectRequired')}
              </span>
            ) : provider.suspended ? (
              <span
                className="shrink-0 select-none text-11"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {t('settings.providers.pill.suspended')}
              </span>
            ) : (
              provider.id !== 'xd' &&
              modelCount !== null && (
                <span
                  className="shrink-0 text-11 tabular-nums"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {t('settings.providers.models.modelCount', { count: modelCount })}
                </span>
              )
            )
          }
          statusColor={
            reconnectRequired
              ? 'var(--remote-status-failed)'
              : provider.connected && !provider.suspended
                ? 'var(--remote-status-ready)'
                : 'var(--border-default)'
          }
        />
      </Tip>
    </div>
  );
}

/** The local remote-access row, writing the instance's setting. The instance always accepts remote control. */
function CloudRemoteAccessRow({
  provider,
  disabled,
  groupSize,
  pendingShareRequests,
  onManageShare,
  write,
}: {
  provider: ProviderView;
  disabled: boolean;
  groupSize: number | null;
  pendingShareRequests: number;
  onManageShare: () => void;
  write: (enabled: boolean) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(provider.remoteInvocationEnabled === true);
  const [busy, setBusy] = useState(false);
  useEffect(
    () => setEnabled(provider.remoteInvocationEnabled === true),
    [provider.remoteInvocationEnabled],
  );
  const gate = providerShareGate({ remoteControlEnabled: true, invocationEnabled: enabled });
  return (
    <div
      data-testid="provider-remote-access"
      data-share-gate={gate}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t px-5 py-3"
      style={{ borderColor: 'var(--settings-theme-card-border)' }}
    >
      <div className="flex min-w-[min(100%,240px)] flex-1 flex-col gap-1">
        <span className="text-13 font-medium text-[var(--text-primary)]">
          {t('settings.providers.detail.remoteAccess.label')}
        </span>
        <span className="text-12 leading-[1.4] text-[var(--text-tertiary)]">
          {gate === 'invocation-off'
            ? t('providerShare.entry.descriptionOff')
            : groupSize !== null
              ? t('settings.providers.detail.remoteAccess.descriptionGroup')
              : t('settings.providers.detail.remoteAccess.description')}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <ProviderShareEntryButton
          groupSize={groupSize}
          pendingCount={pendingShareRequests}
          onOpen={onManageShare}
        />
        <Switch
          checked={enabled}
          disabled={busy || disabled}
          aria-label={t('settings.providers.detail.remoteAccess.ariaLabel')}
          onCheckedChange={(next) => {
            const previous = enabled;
            setEnabled(next);
            setBusy(true);
            void write(next)
              .then((ok) => {
                if (ok) return;
                setEnabled(previous);
                toast.error(t('settings.providers.detail.remoteAccess.writeFailed'));
              })
              .finally(() => setBusy(false));
          }}
        />
      </div>
    </div>
  );
}

/** The subscription quota of the instance's account for this provider, as on the local page. */
function CloudProviderQuota({ provider, deviceId }: { provider: ProviderView; deviceId: string }) {
  const account = useDeviceProviderSubscriptionCard(provider, deviceId);
  if (!account) return null;
  return (
    <div
      data-testid="provider-usage-module"
      className="border-t px-1 py-2"
      style={{ borderColor: 'var(--settings-theme-card-border)' }}
    >
      <QuotaHoverCard variant="embedded" account={account} />
    </div>
  );
}

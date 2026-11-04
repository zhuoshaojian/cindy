// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderView } from '@cindy/model-providers';

import { CLOUD_PROVIDER_SETTINGS_CHANNEL } from '../../../../shared/cloudProviderSettings';
import { visibilityPreferenceKey } from '../../../../shared/modelPresentationPreferences';
import type { ManagementItem } from '../../../../shared/settingsManagement';
import type { CloudSettingsClient } from '../client';
import { cloudAddChoices } from '../CloudAddProviderDialog';
import { CloudProvidersSettings, cloudRailProviders } from '../CloudProvidersSettings';

vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
const dialogs = vi.hoisted(() => ({
  confirm: vi.fn<(options: unknown) => Promise<boolean>>(async () => true),
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: dialogs.confirm }),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: toasts }));
vi.mock('@/hooks/useModelPricing', () => ({
  useGatewayModelPricing: () => null,
  useReferenceModelPricing: () => null,
}));
vi.mock('@/hooks/useDeviceProviders', () => ({
  useDeviceProviders: () => ({ providers: [], loading: false, error: null, unsupported: false }),
}));
vi.mock('@/components/settings/useProviderSubscriptionCard', () => ({
  useDeviceProviderSubscriptionCard: () => null,
}));
const localShares = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@/features/provider-share/providerShareStore', () => ({
  useProviderSharePendingRequests: () => [],
  // This computer's list; the cloud page must show the instance's instead.
  useProviderShareReceived: () => ({ received: localShares.list, loaded: true }),
  ensureProviderShareReceivedStarted: () => undefined,
  requestProviderShareJoin: () => undefined,
}));
// The cloud page must never read or write this computer's model preferences.
vi.mock('@/state/modelVisibilityPrefs', async (original) => ({
  ...(await original<typeof import('@/state/modelVisibilityPrefs')>()),
  useModelVisibilityVersion: () => 0,
  isModelEnabled: () => {
    throw Error('LOCAL_VISIBILITY_READ');
  },
  setModelVisibilities: () => {
    throw Error('LOCAL_VISIBILITY_WRITE');
  },
}));

const model = (id: string) => ({
  id,
  name: id,
  contextWindow: 200_000,
  efforts: [],
  defaultEffort: null,
});
const providers = [
  {
    id: 'openai',
    name: 'OpenAI',
    source: 'builtin',
    agents: ['codex'],
    auth: { method: 'oauth' },
    routing: {},
    models: { codex: [model('gpt-a')] },
    connected: true,
    remoteInvocationEnabled: false,
  },
  {
    id: 'web-1',
    name: 'My gateway',
    source: 'user',
    agents: ['codex'],
    auth: { method: 'apiKey' },
    routing: {},
    models: { codex: [model('m-1'), model('m-2')] },
    connected: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    source: 'builtin',
    agents: ['claude-code'],
    auth: { method: 'oauth' },
    routing: {},
    models: { 'claude-code': [model('opus')] },
    connected: false,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    source: 'builtin',
    agents: ['pi'],
    auth: { method: 'apiKey' },
    routing: {},
    models: { pi: [model('g-1')] },
    connected: false,
  },
] as unknown as ProviderView[];

const items: ManagementItem[] = [
  {
    id: 'provider:anthropic',
    label: 'Anthropic',
    status: 'disconnected',
    group: 'management.currentProviders',
    actions: [
      {
        id: 'a0',
        label: 'management.actions.authorize',
        intent: 'authorize',
        fields: [],
        expiresAt: 9e15,
      },
    ],
  },
  {
    id: 'add:xai',
    label: 'xAI',
    status: 'available',
    group: 'management.addProvider',
    actions: [
      {
        id: 'a1',
        label: 'management.actions.authorize',
        intent: 'authorize',
        fields: [],
        expiresAt: 9e15,
      },
    ],
  },
  {
    id: 'add:api-preset',
    label: 'API provider',
    status: 'available',
    group: 'management.addProvider',
    actions: [
      {
        id: 'a2',
        label: 'management.actions.connect',
        intent: 'create',
        expiresAt: 9e15,
        fields: [
          {
            name: 'preset',
            kind: 'select',
            required: true,
            maxLength: 256,
            value: 'deepseek',
            options: [
              { value: 'deepseek', label: 'DeepSeek' },
              { value: 'moonshot', label: 'Moonshot' },
            ],
          },
          { name: 'apiKey', kind: 'password', required: false, maxLength: 512 },
        ],
      },
    ],
  },
  {
    id: 'add:custom',
    label: 'Custom provider',
    status: 'available',
    group: 'management.addProvider',
    actions: [
      {
        id: 'a3',
        label: 'management.actions.create',
        intent: 'create',
        expiresAt: 9e15,
        fields: [{ name: 'name', kind: 'text', required: true, maxLength: 128 }],
      },
    ],
  },
] as unknown as ManagementItem[];

afterEach(cleanup);

function setup(
  options: {
    unsupported?: boolean;
    withoutShare?: boolean;
    extraItems?: ManagementItem[];
    extraProviders?: ProviderView[];
  } = {},
) {
  let visibility = {
    status: 'ready',
    revision: 'r1',
    overrides: { [visibilityPreferenceKey('codex', 'web-1', 'm-2')]: false },
  };
  const invoke = vi.fn(async (_deviceId: string, channel: string, [request]: [{ op: string }]) => {
    if (channel !== CLOUD_PROVIDER_SETTINGS_CHANNEL) throw Error(`UNEXPECTED ${channel}`);
    if (options.unsupported) throw Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] not allowed');
    if (request.op === 'list')
      return {
        version: 1,
        ownerGeneration: 3,
        providers: [...providers, ...(options.extraProviders ?? [])],
        providerOrder: ['web-1', 'openai'],
        visibility,
        supportedOps: [
          'list',
          'visibility-set',
          'order',
          'model-call',
          'effort',
          'model-edit',
          'cli-scan',
          ...(options.withoutShare ? [] : ['share']),
        ],
        efforts: { 'codex:*': { 'm-1': 'high' } },
      };
    if (request.op === 'share') {
      const command = (request as unknown as { command: { action: string; skip?: boolean } })
        .command;
      return {
        ok: true,
        ownerGeneration: 3,
        catalogChanged: false,
        value:
          command.action === 'received'
            ? [
                {
                  shareId: 'share-1',
                  memberId: 'member-1',
                  providerId: 'anthropic',
                  providerLabel: 'Shared Claude',
                  hostDeviceId: 'host',
                  deviceName: 'Host',
                  status: 'active',
                  hostOnline: true,
                  hostCapable: true,
                  owner: { displayName: 'Ada', avatarUrl: null, region: 'cn' },
                },
              ]
            : { skip: command.skip === true },
      };
    }
    if (request.op === 'cli-scan')
      return {
        ok: true,
        ownerGeneration: 3,
        catalogChanged: false,
        value: {
          detections: [
            {
              cli: 'claude-cli',
              providerId: 'anthropic',
              installed: true,
              loggedIn: true,
              sharedWithCindy: false,
            },
          ],
        },
      };
    if (request.op === 'model-call')
      return {
        ok: true,
        ownerGeneration: 3,
        catalogChanged: false,
        value: { limit: null, isCustomized: false },
      };
    if (request.op === 'visibility-set') {
      visibility = { status: 'ready', revision: 'r2', overrides: {} };
      return { ok: true, ownerGeneration: 3, visibility, catalogChanged: false };
    }
    return { ok: true, ownerGeneration: 3, catalogChanged: true };
  });
  Object.assign(window, {
    electronAPI: new Proxy(
      { deviceLink: { invoke } },
      {
        get(target, key) {
          if (key === 'deviceLink') return target.deviceLink;
          // Account-level share reads stay on this computer; model settings never do.
          if (key === 'providerShare')
            return {
              command: async () => {
                throw Error('LOCAL_SHARE_COMMAND');
              },
              onReceivedChanged: () => () => undefined,
            };
          throw Error(`LOCAL_API_FORBIDDEN ${String(key)}`);
        },
      },
    ),
  });
  const manage = vi.fn(async (request: { operation: string }) =>
    request.operation === 'list'
      ? { kind: 'page', section: 'providers', items: [...items, ...(options.extraItems ?? [])] }
      : { kind: 'operation', operationId: 'op', phase: 'succeeded' },
  );
  const client = { manage } as unknown as CloudSettingsClient;
  render(
    <CloudProvidersSettings
      client={client}
      online
      active
      name="Cloud one"
      deviceId="cloud-device-000000000000000000000001"
    />,
  );
  return { invoke, manage };
}

describe('cloud instance providers page', () => {
  it('lists the instance catalog in its own order without local model APIs', async () => {
    setup();
    expect(await screen.findByText('settings.providers.models.modelCount:2')).toBeTruthy();
    const names = screen
      .getAllByText(/^(My gateway|OpenAI|Gemini)$/)
      .filter((node) => node.closest('.provider-settings-sortable-row'))
      .map((node) => node.textContent);
    expect(names).toEqual(['My gateway', 'OpenAI']);
    expect(screen.getByRole('switch', { name: 'm-1' }).getAttribute('aria-checked')).toBe('true');
    // The instance's own override, not this computer's, hides m-2.
    expect(screen.getByRole('switch', { name: 'm-2' }).getAttribute('aria-checked')).toBe('false');
  });

  it('writes model visibility to the instance with its owner generation and revision', async () => {
    const { invoke } = setup();
    fireEvent.click(await screen.findByRole('switch', { name: 'm-1' }));
    await waitFor(() =>
      expect(invoke.mock.calls.map((call) => call[2][0])).toContainEqual({
        op: 'visibility-set',
        providerId: 'web-1',
        targets: [{ agent: 'codex', modelId: 'm-1' }],
        enabled: false,
        ownerGeneration: 3,
        revision: 'r1',
      }),
    );
    // The receipt carries the new state; no catalog reread is needed.
    expect(invoke.mock.calls.filter((call) => call[2][0].op === 'list')).toHaveLength(1);
  });

  it('reorders providers on the instance from the keyboard', async () => {
    const { invoke } = setup();
    const [handle] = await screen.findAllByRole('button', {
      name: 'settings.providers.order.handle',
    });
    fireEvent.keyDown(handle!, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(invoke.mock.calls.map((call) => call[2][0])).toContainEqual({
        op: 'order',
        providerIds: ['openai', 'web-1'],
        ownerGeneration: 3,
      }),
    );
  });

  it('keeps the ticket-only list on a runtime without the channel', async () => {
    setup({ unsupported: true });
    expect(await screen.findByText('cloudSettings.authScope')).toBeTruthy();
    expect(screen.queryByText('settings.providers.addProvider')).toBeNull();
  });

  it('adds a provider through the instance actions in the local wizard layout', async () => {
    const { manage } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /settings.providers.addProvider/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('settings.providers.wizard.groupSubscription')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Moonshot/ }));
    fireEvent.change(within(dialog).getByLabelText('settings.providers.custom.fields.apiKey'), {
      target: { value: 'typed-by-user' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'settings.providers.wizard.finish' }),
    );
    await waitFor(() =>
      expect(manage).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'run',
          actionId: 'a2',
          values: { apiKey: 'typed-by-user', preset: 'moonshot' },
        }),
      ),
    );
  });
});

describe('deleting a provider on the instance', () => {
  const openMenu = async (name: string) => {
    const row = (await screen.findAllByText(name)).find((node) =>
      node.closest('.provider-settings-sortable-row'),
    );
    fireEvent.click(row!);
    fireEvent.keyDown(
      await screen.findByRole('button', { name: 'settings.providers.detail.moreActionsAria' }),
      { key: 'ArrowDown' },
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'settings.providers.custom.deleteAria' }),
    );
  };
  const removals = (invoke: ReturnType<typeof setup>['invoke']) =>
    invoke.mock.calls.filter((call) => call[2][0].op === 'presentation');

  it('asks first and keeps a built-in provider when cancelled', async () => {
    dialogs.confirm.mockResolvedValueOnce(false);
    const { invoke } = setup();
    await openMenu('OpenAI');
    await waitFor(() => expect(dialogs.confirm).toHaveBeenCalled());
    expect(dialogs.confirm.mock.calls.at(-1)![0]).toMatchObject({
      title: 'settings.providers.custom.deleteConfirm.title',
      confirmText: 'settings.providers.custom.deleteConfirm.confirm',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(removals(invoke)).toHaveLength(0);
  });

  it('removes a built-in provider after confirmation, like the local page', async () => {
    const { invoke } = setup();
    await openMenu('OpenAI');
    await waitFor(() =>
      expect(removals(invoke).map((call) => call[2][0])).toEqual([
        { op: 'presentation', providerId: 'openai', action: 'remove', ownerGeneration: 3 },
      ]),
    );
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith('settings.providers.custom.toast.deleted'),
    );
  });

  it('never runs the instance delete action before confirmation', async () => {
    dialogs.confirm.mockResolvedValueOnce(false);
    const { manage } = setup({
      extraItems: [
        {
          id: 'provider:web-1',
          label: 'My gateway',
          status: 'connected',
          group: 'management.currentProviders',
          actions: [
            {
              id: 'd1',
              label: 'management.actions.delete',
              intent: 'delete',
              fields: [],
              expiresAt: 9e15,
            },
          ],
        } as unknown as ManagementItem,
      ],
    });
    await openMenu('My gateway');
    await waitFor(() => expect(dialogs.confirm).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(manage.mock.calls.filter((call) => call[0].operation === 'run')).toHaveLength(0);
  });
});

describe('custom connection header on the instance', () => {
  const disconnectItem = (id: string) =>
    ({
      id: `provider:${id}`,
      label: id,
      status: 'connected',
      group: 'management.currentProviders',
      actions: [
        {
          id: `x-${id}`,
          label: 'management.actions.disconnect',
          intent: 'disconnect',
          fields: [],
          expiresAt: 9e15,
        },
      ],
    }) as unknown as ManagementItem;
  const open = async (name: string) => {
    const row = (await screen.findAllByText(name)).find((node) =>
      node.closest('.provider-settings-sortable-row'),
    );
    fireEvent.click(row!);
    await screen.findByRole('button', { name: 'settings.providers.detail.moreActionsAria' });
  };

  it('offers disconnect only for a key-based endpoint, like the local header', async () => {
    setup({
      extraProviders: [
        {
          id: 'proxy-1',
          name: 'Open proxy',
          source: 'user',
          agents: ['pi'],
          auth: { method: 'none' },
          routing: {},
          models: { pi: [model('p-1')] },
          connected: true,
        } as unknown as ProviderView,
      ],
      extraItems: [disconnectItem('web-1'), disconnectItem('proxy-1')],
    });
    await open('My gateway');
    expect(
      await screen.findByRole('button', { name: 'settings.providers.button.disconnect' }),
    ).toBeTruthy();
    await open('Open proxy');
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'settings.providers.button.disconnect' }),
      ).toBeNull(),
    );
    expect(screen.getByText('settings.providers.pill.configured')).toBeTruthy();
  });
});

describe('cloud model panel', () => {
  it('opens the local model panel and reads the instance context limit', async () => {
    const { invoke } = setup();
    const open = await screen.findAllByRole('button', {
      name: 'settings.providers.models.advanced.openAria',
    });
    fireEvent.click(open[0]!);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() =>
      expect(invoke.mock.calls.map((call) => call[2][0])).toContainEqual(
        expect.objectContaining({
          op: 'model-call',
          call: 'context-get',
          ownerGeneration: 3,
          target: expect.objectContaining({ providerId: 'web-1', agent: 'codex' }),
        }),
      ),
    );
  });
});

describe('instance CLI suggestions', () => {
  it('suggests the instance CLI provider and starts its sign-in on the instance', async () => {
    const { manage } = setup();
    fireEvent.click(
      await screen.findByRole('button', { name: /settings.providers.detect.action/ }),
    );
    await waitFor(() =>
      expect(manage).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'run', actionId: 'a0' }),
      ),
    );
  });
});

describe('shares on the instance', () => {
  it('lists the instance received shares and writes trust on the instance', async () => {
    const { invoke } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Shared Claude/ }));
    expect(await screen.findByTestId('provider-share-received-detail')).toBeTruthy();
    await waitFor(() =>
      expect(invoke.mock.calls.map((call) => call[2][0])).toContainEqual(
        expect.objectContaining({
          op: 'share',
          command: { action: 'get-credential-consent', shareId: 'share-1' },
        }),
      ),
    );
    const trust = within(screen.getByTestId('provider-share-received-detail')).getByRole('switch');
    await waitFor(() => expect((trust as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trust);
    await waitFor(() =>
      expect(invoke.mock.calls.map((call) => call[2][0])).toContainEqual(
        expect.objectContaining({
          op: 'share',
          command: { action: 'set-credential-consent', shareId: 'share-1', skip: true },
        }),
      ),
    );
  });
});

describe('shares on an older runtime', () => {
  it("never shows this computer's shares in place of the instance list", async () => {
    localShares.list = [
      {
        shareId: 'local-share',
        memberId: 'm',
        providerId: 'openai',
        providerLabel: 'Local only share',
        hostDeviceId: 'h',
        deviceName: 'H',
        status: 'active',
        hostOnline: true,
        hostCapable: true,
        owner: { displayName: 'Bo', avatarUrl: null, region: 'cn' },
      },
    ];
    try {
      setup({ withoutShare: true });
      expect(await screen.findByText('settings.providers.models.modelCount:2')).toBeTruthy();
      expect(screen.queryByText('Local only share')).toBeNull();
    } finally {
      localShares.list = [];
    }
  });
});

describe('cloud provider helpers', () => {
  it('uses the local rail rule', () => {
    expect(cloudRailProviders(providers).map((p) => p.id)).toEqual(['openai', 'web-1']);
  });
  it('offers a built-in sign-in only when that provider is not in the rail', () => {
    expect(cloudAddChoices(items).some((c) => c.key === 'provider:anthropic')).toBe(false);
    expect(
      cloudAddChoices(items, new Set(['anthropic'])).find((c) => c.key === 'provider:anthropic')
        ?.group,
    ).toBe('subscription');
  });
  it('expands API presets into rows and keeps custom endpoints last', () => {
    expect(cloudAddChoices(items).map((choice) => [choice.group, choice.name])).toEqual([
      ['subscription', 'xAI'],
      ['apiKey', 'DeepSeek'],
      ['apiKey', 'Moonshot'],
      ['custom', 'Custom provider'],
    ]);
  });
});

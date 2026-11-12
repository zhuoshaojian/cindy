import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { mountPage, forbid } from '../../ui-page/harness';
import { CloudSettingsPanel } from '../../../src/renderer/features/cloud-settings/CloudSettingsView';
import { createTrialCloudSettingsClient } from '../../../src/renderer/features/cloud-settings/trial';
import {
  CLOUD_SETTINGS_VISIBILITY,
} from '../../../src/renderer/features/cloud-settings/cloudSettingsVisibility';
import { CLOUD_PROVIDER_SETTINGS_CHANNEL } from '../../../src/shared/cloudProviderSettings';
import {
  endCloudStage,
  selectCloudFrame,
  useCloudStage,
} from '../../../src/renderer/features/cloud-settings/cloudFaults';
import { CLOUD_SCENARIOS } from '../../../src/renderer/features/cloud-settings/cloudFaultScripts';
import { BUNDLED_CATALOG } from '@cindy/model-providers';

const targetModel = {
  id: 'fixture-model',
  name: 'Cloud model',
  contextWindow: 200000,
  efforts: ['low', 'high'],
  defaultEffort: 'high',
};
const targetProvider = {
  ...BUNDLED_CATALOG.providers.find((p) => p.id === 'anthropic')!,
  id: 'fixture-provider',
  name: 'Cloud provider',
  connected: true,
  agents: ['claude-code'],
  models: { 'claude-code': [targetModel] },
};

// The instance's own catalog for the shown page: one connected provider, the unconnected
// built-ins it leaves out of the rail, and one received share.
const catalogProviders = [
  targetProvider,
  ...BUNDLED_CATALOG.providers
    .filter((p) => p.id === 'openai' || p.id === 'anthropic')
    .map((p) => ({ ...p, connected: false })),
];
const providerSettings = (request: { op: string; command?: { action: string } }) => {
  // The instance does not answer the provider list (C4).
  if (request.op === 'list' && window.__uiPage?.ctx?.data?.providersUnreadable)
    throw Error('[DEVICE_LINK_TIMEOUT] timeout');
  if (request.op === 'list')
    return {
      version: 1,
      ownerGeneration: 1,
      providers: catalogProviders,
      providerOrder: [],
      visibility: { status: 'ready', revision: 'r1', overrides: {} },
      supportedOps: ['list', 'share', 'cli-scan'],
      efforts: {},
    };
  if (request.op === 'share' && request.command?.action === 'received')
    return {
      ok: true,
      ownerGeneration: 1,
      catalogChanged: false,
      value: [
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
          owner: { displayName: 'Ada', avatarUrl: null, region: 'global' },
        },
      ],
    };
  // The instance's own Claude Code CLI, signed in: the suggestion row names Cloud Cindy, not this computer.
  if (request.op === 'cli-scan')
    return {
      ok: true,
      ownerGeneration: 1,
      catalogChanged: false,
      value: {
        detections: [
          { cli: 'claude-cli', providerId: 'anthropic', installed: true, loggedIn: true, sharedWithCindy: false },
        ],
      },
    };
  return forbid(`cloudProviderSettings.${request.op}`)();
};

// Fixture-only IDs: the isolated HTTP origin has no secure-context randomUUID.
if (!crypto.randomUUID) {
  let sequence = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
}

function Fixture({
  unavailable,
  bots,
  imReadFailure,
  shown,
  offline,
  defaultName,
  readBroken,
}: {
  unavailable: boolean;
  bots: boolean;
  imReadFailure: boolean;
  shown: boolean;
  offline: boolean;
  defaultName: boolean;
  readBroken: boolean;
}) {
  const { t } = useTranslation();
  const client = useMemo(() => {
    const client = createTrialCloudSettingsClient();
    // No authorization service is exercised by this display fixture.
    const connect = client.connect;
    client.connect = async () => ({
      ...(await connect()),
      providerAuthorization: shown ? 1 : undefined,
      botAuthorization: bots || shown ? 1 : undefined,
      mcpAuthorization: undefined,
    });
    // One group of General is never answered; the rest of the page reads as usual.
    if (window.__uiPage?.ctx?.data?.domainUnreadable) {
      const read = client.read;
      client.read = async (domains) =>
        (await read(domains)).map((state) =>
          state.domain === 'agentResource'
            ? { domain: state.domain, status: 'unreadable', revision: null, readErrorCode: 'SETTINGS_REQUEST_FAILED' }
            : state,
        );
    }
    // The settings session keeps failing: every reconnect works, every read does not.
    if (readBroken)
      client.read = async () => {
        throw Error('CLOUD_SETTINGS_SCOPE_CHANGED');
      };
    if (imReadFailure) {
      // The IM groups stay unreadable through the page's three automatic re-reads, so the card's
      // own notice (C3) and its reload are what recover them.
      let failures = 0;
      const read = client.read;
      client.read = async (domains) => {
        const states = await read(domains);
        if (failures >= 4 || !domains.some((domain) => domain.startsWith('im'))) return states;
        failures++;
        return states.map((state) =>
          state.domain.startsWith('im')
            ? {
                domain: state.domain,
                status: 'unreadable',
                revision: null,
                readErrorCode: 'SETTINGS_REQUEST_FAILED',
              }
            : state,
        );
      };
    }
    if (unavailable) {
      const read = client.read;
      client.read = async (domains) =>
        (await read(domains)).map((state) =>
          // Contacts left the cloud page in the 2026-11-04 review; an unavailable group now is
          // chat embedding, beside a tips row that stays usable.
          state.domain === 'chatEmbedding'
            ? { domain: state.domain, status: 'unavailable', revision: null }
            : state.domain === 'terminal'
              ? {
                  ...state,
                  value: { defaultShellPref: 'fish' },
                  customizedKeys: ['defaultShellPref'],
                  isCustomized: true,
                }
              : state,
        );
    }
    return client;
  }, [unavailable, bots, imReadFailure, shown, readBroken]);
  return (
    <CloudSettingsPanel
      name={defaultName ? t('cloudSettings.onboarding.defaultNameSole') : 'Cloud example'}
      client={client}
      online={!offline}
      trial={!shown}
      onBack={() => {}}
      visibility={CLOUD_SETTINGS_VISIBILITY}
      onOpenDeviceCard={offline ? () => {} : undefined}
    />
  );
}

/** A simulated frame from the dev options' scenario panel, as AuthorizedCloudSettingsView shows it. */
function StagedFixture() {
  const stage = useCloudStage();
  const settings = stage?.world.settings;
  if (!settings) return null;
  return (
    <CloudSettingsPanel
      key={stage!.key}
      name="Cloud example"
      client={settings.client}
      online={!settings.offline}
      initialTab={settings.tab}
      visibility={CLOUD_SETTINGS_VISIBILITY}
      onBack={() => {}}
    />
  );
}
const showFrame = (frame: unknown) => {
  const [id, code] = (frame ?? []) as [string?, string?];
  const index = CLOUD_SCENARIOS.find((item) => item.id === id)?.frames.findIndex((f) => f.code === code);
  if (id === undefined || index === undefined || index < 0) {
    endCloudStage();
    return false;
  }
  selectCloudFrame(id, index, 'cloud-settings-trial');
  return true;
};

mountPage({
  route: '/cloud-settings-trial',
  host: {
    maker: new Proxy({}, { get: (_, name) => forbid(`maker.${String(name)}`) }),
    hostSettings: { update: forbid('hostSettings.update'), get: forbid('hostSettings.get') },
    // Read-only target catalog for the real native picker. Local maker writes
    // remain forbidden; this is synthetic UI data, not DeviceLink acceptance.
    deviceLink: {
      // Route pickers list other devices for cross-device models; this fixture has none.
      getState: async () => ({ status: 'disconnected' }),
      listDevices: async () => [],
      onPresenceChanged: () => () => undefined,
      onStatusChanged: () => () => undefined,
      onControlTargetChanged: () => () => undefined,
      invoke: async (deviceId: string, channel: string, [request]: [never]) => {
        if (deviceId !== 'cloud-settings-trial') throw Error('Wrong fixture target');
        if (channel === CLOUD_PROVIDER_SETTINGS_CHANNEL) return providerSettings(request);
        // A runtime without these private channels; the page keeps its settings-domain values.
        if (channel.startsWith('cloud:') || channel === 'maker:model-catalog:read')
          throw Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] not allowed');
        if (channel === 'maker:provider:list') return { providers: [targetProvider] };
        if (channel === 'maker:get-capabilities')
          return {
            availableModels: [{ ...targetModel, displayName: targetModel.name }],
            effortLevels: [
              { id: 'low', displayName: 'Low' },
              { id: 'high', displayName: 'High' },
            ],
            permissionModes: [{ id: 'auto', displayName: 'Auto' }],
            hasFastMode: false,
          };
        return forbid(`deviceLink.${channel}`)();
      },
    },
  },
  render: (ctx) =>
    showFrame(ctx.data.frame) ? (
      <StagedFixture />
    ) : (
    <Fixture
      unavailable={ctx.data.unavailable === true}
      bots={ctx.data.bots === true}
      imReadFailure={ctx.data.imReadFailure === true}
      shown={ctx.data.shown === true}
      offline={ctx.data.offline === true}
      defaultName={ctx.data.defaultName === true}
      readBroken={ctx.data.readBroken === true}
    />
    ),
});

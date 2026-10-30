import { useMemo } from 'react';
import { mountPage, forbid } from '../../ui-page/harness';
import { CloudSettingsPanel } from '../../../src/renderer/features/cloud-settings/CloudSettingsView';
import { createTrialCloudSettingsClient } from '../../../src/renderer/features/cloud-settings/trial';
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

// Fixture-only IDs: the isolated HTTP origin has no secure-context randomUUID.
if (!crypto.randomUUID) {
  let sequence = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
}

function Fixture({
  unavailable,
  bots,
  imReadFailure,
}: {
  unavailable: boolean;
  bots: boolean;
  imReadFailure: boolean;
}) {
  const client = useMemo(() => {
    const client = createTrialCloudSettingsClient();
    // No authorization service is exercised by this display fixture.
    const connect = client.connect;
    client.connect = async () => ({
      ...(await connect()),
      providerAuthorization: undefined,
      botAuthorization: bots ? 1 : undefined,
      pluginAuthorization: undefined,
      mcpAuthorization: undefined,
    });
    if (imReadFailure) {
      let failed = false;
      const read = client.read;
      client.read = async (domains) => {
        const states = await read(domains);
        if (failed || !domains.includes('imWechat')) return states;
        failed = true;
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
          state.domain === 'contactsSync'
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
  }, [unavailable, bots, imReadFailure]);
  return <CloudSettingsPanel name="Cloud example" client={client} online trial onBack={() => {}} />;
}

mountPage({
  route: '/cloud-settings-trial',
  host: {
    maker: new Proxy({}, { get: (_, name) => forbid(`maker.${String(name)}`) }),
    hostSettings: { update: forbid('hostSettings.update'), get: forbid('hostSettings.get') },
    // Read-only target catalog for the real native picker. Local maker writes
    // remain forbidden; this is synthetic UI data, not DeviceLink acceptance.
    deviceLink: {
      invoke: async (deviceId: string, channel: string) => {
        if (deviceId !== 'cloud-settings-trial') throw Error('Wrong fixture target');
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
  render: (ctx) => (
    <Fixture
      unavailable={ctx.data.unavailable === true}
      bots={ctx.data.bots === true}
      imReadFailure={ctx.data.imReadFailure === true}
    />
  ),
});

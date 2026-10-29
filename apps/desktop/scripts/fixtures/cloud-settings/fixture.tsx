import { useMemo } from 'react';
import { mountPage, forbid } from '../../ui-page/harness';
import { CloudSettingsPanel } from '../../../src/renderer/features/cloud-settings/CloudSettingsView';
import { createTrialCloudSettingsClient } from '../../../src/renderer/features/cloud-settings/trial';

// Fixture-only IDs: the isolated HTTP origin has no secure-context randomUUID.
if (!crypto.randomUUID) {
  let sequence = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
}

function Fixture({ unavailable, bots }: { unavailable: boolean; bots: boolean }) {
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
  }, [unavailable, bots]);
  return <CloudSettingsPanel name="Cloud example" client={client} online trial onBack={() => {}} />;
}

mountPage({
  route: '/cloud-settings-trial',
  host: {
    maker: new Proxy({}, { get: (_, name) => forbid(`maker.${String(name)}`) }),
    hostSettings: { update: forbid('hostSettings.update'), get: forbid('hostSettings.get') },
  },
  render: (ctx) => (
    <Fixture unavailable={ctx.data.unavailable === true} bots={ctx.data.bots === true} />
  ),
});

import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { BUNDLED_CATALOG } from '@cindy/model-providers';
import { mountPage, forbid } from '../../ui-page/harness';
import { setDataOwnerGeneration } from '../../../src/renderer/contexts/dataOwnerGeneration';
import { ToastContainer } from '../../../src/renderer/components/ui/toast/ToastContainer';
import { CloudInstanceAccessProvider } from '../../../src/renderer/features/cloud-settings/CloudInstanceAccess';
import { RemoteControlSection } from '../../../src/renderer/components/settings/RemoteControlSection';
import { CloudSettingsPanel } from '../../../src/renderer/features/cloud-settings/CloudSettingsView';
import {
  endCloudStage,
  selectCloudFrame,
  useCloudStage,
} from '../../../src/renderer/features/cloud-settings/cloudFaults';
import { CLOUD_SCENARIOS, startUpdatePlay } from '../../../src/renderer/features/cloud-settings/cloudFaultScripts';
import { CLOUD_SETTINGS_VISIBILITY } from '../../../src/renderer/features/cloud-settings/cloudSettingsVisibility';
import { CloudPluginManagement } from '../../../src/renderer/features/cloud-settings/CloudPluginManagement';
import { CloudFaultBeacon } from '../../../src/renderer/features/cloud-settings/CloudFaultBeacon';

/**
 * One frame of the dev options' scenario panel, on the page it belongs to: the device card on My
 * devices (with its updates dialog), or the instance's settings page. Every answer is the frame's
 * own (cloudFaults.ts); nothing here reaches an instance.
 */
export const CLOUD = 'cloud-device-0123456789abcdef01234567';

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

// 34A: the plugin page reads the instance's plugins (read-only) over DeviceLink, as for any computer.
const pluginsPage = () => !!(window as any).__uiPage?.ctx?.data?.plugins;
const notes = {
  manifest: {
    schemaVersion: 3,
    minCindyVersion: '0.1.61',
    id: 'notes',
    name: '个人笔记',
    version: '1.0.0',
    author: 'Example Publisher',
    description: '记录想法和工作摘要，随时查阅重要内容。',
    kind: 'chip',
    entry: 'main.js',
    tools: [{ name: 'read_notes', description: '读取已保存的笔记。', parameters: { type: 'object', properties: {} } }],
  },
  dir: '/fixture/notes',
  instanceKey: 'notes',
  namespace: null,
  enabled: true,
  approval: { state: 'approved', revision: '00000000-0000-4000-8000-000000000001' },
};
function pluginResource(channel: string, args: any[]) {
  if (channel === 'maker:remote-resources:manifest')
    return { collections: [{ id: 'plugins', actions: [{ id: 'management:snapshot' }] }] };
  const request = args[0];
  if (channel !== 'maker:remote-resources:invoke' || request?.actionId !== 'management:snapshot')
    throw Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] not allowed');
  if (request.input?.read === 'capabilities') return { result: { catalogPaging: false }, effects: [] };
  return {
    result: {
      version: 1,
      ghosts: [notes],
      projects: [],
      market: { items: [], unavailableReason: null, customSourceNames: [], unavailableCustomSourceNames: [] },
    },
    effects: [],
  };
}

// Fixture-only IDs: the isolated HTTP origin has no secure-context randomUUID.
if (!crypto.randomUUID) {
  let sequence = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
}

function Frame() {
  const stage = useCloudStage();
  const settings = stage?.world.settings;
  if (settings)
    // As AuthorizedCloudSettingsView passes a simulated frame on.
    return (
      <div className="h-screen">
        <CloudSettingsPanel
          key={stage!.key}
          name="云端 Cindy"
          client={settings.client}
          online={!settings.offline}
          upgrading={settings.offline === 'upgrading'}
          initialTab={settings.tab}
          visibility={CLOUD_SETTINGS_VISIBILITY}
          onBack={() => {}}
          onOpenDeviceCard={() => {}}
          plugins={
            pluginsPage()
              ? (active) => <CloudPluginManagement deviceId={CLOUD} name="云端 Cindy" active={active} />
              : undefined
          }
        />
      </div>
    );
  return (
    <main className="mx-auto max-w-[920px] p-6">
      <RemoteControlSection />
    </main>
  );
}

mountPage({
  host: () => ({
    cloudLoginWindow: { open: forbid('cloudLoginWindow.open'), onCompleted: () => () => {} },
    cloudSettings: {
      instanceAccess: async () => ({ schemaVersion: 1, allowed: true }),
      // The live list under the frame (the frame pins what the card shows).
      instanceList: async () => [],
      instanceRead: async () => {
        throw Error('CLOUD_SETTINGS_UNAVAILABLE');
      },
      instanceClaim: forbid('cloudSettings.instanceClaim'),
      instancePower: forbid('cloudSettings.instancePower'),
      instanceUpgrade: forbid('cloudSettings.instanceUpgrade'),
      instancePolicy: forbid('cloudSettings.instancePolicy'),
      instanceInitialize: forbid('cloudSettings.instanceInitialize'),
    },
    openRemoteDesktop: forbid('openRemoteDesktop'),
    openExternal: forbid('openExternal'),
    remoteSsh: { list: async () => ({ hosts: [] }), onStatusChanged: () => () => {} },
    maker: new Proxy({}, { get: (_, name) => forbid(`maker.${String(name)}`) }),
    hostSettings: { update: forbid('hostSettings.update'), get: forbid('hostSettings.get') },
    deviceLink: {
      getState: async () =>
        pluginsPage()
          ? { status: 'online', linkStatus: 'online', settings: { revokedControllers: [] } }
          : { status: 'disconnected' },
      listDevices: async () => [],
      onPresenceChanged: () => () => undefined,
      onStatusChanged: () => () => undefined,
      onControlTargetChanged: () => () => undefined,
      onRemotePush: () => () => undefined,
      // Shared model pickers read the target's catalog directly (in the app, the real instance's).
      invoke: async (_deviceId: string, channel: string, args: any[]) => {
        if (channel.startsWith('maker:remote-resources:')) return pluginResource(channel, args);
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
        throw Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] not allowed');
      },
    },
  }),
  render: (ctx) => {
    setDataOwnerGeneration('fixture-owner', 1);
    // [scenario, code, name?]: the name tells apart frames that share a code.
    const [id, code, name] = (ctx.data.frame ?? []) as [string?, string?, string?];
    const index =
      CLOUD_SCENARIOS.find((item) => item.id === id)?.frames.findIndex(
        (frame) => frame.code === code && (!name || frame.name === name),
      ) ?? -1;
    // The app's desktop background makes --settings-bg transparent (globals.css): the panel over it.
    if (ctx.data.desktopBackground) document.documentElement.dataset.desktopBackground = 'true';
    // 亲手体验: the update flow, driven by the case's own clicks.
    if (ctx.data.play) startUpdatePlay(ctx.data.play, CLOUD);
    else if (id && index >= 0) selectCloudFrame(id, index, CLOUD);
    else endCloudStage();
    const router = createMemoryRouter([{ path: '*', element: <Frame /> }], {
      initialEntries: [`/settings?tab=remote-control&section=remoteControl.cloudInstances&device=${CLOUD}`],
    });
    return (
      <CloudInstanceAccessProvider>
        <RouterProvider router={router} />
        <ToastContainer />
        {/* The scenario panel itself, over the frame it shows. */}
        {ctx.data.panel && <CloudFaultBeacon />}
      </CloudInstanceAccessProvider>
    );
  },
});

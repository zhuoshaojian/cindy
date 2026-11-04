import { mountPage, forbid } from '../../ui-page/harness';
import { CloudInstancesPage } from '../../../src/renderer/features/cloud-settings/CloudInstancesPage';
import type { CloudInstanceView } from '../../../src/shared/cloudInstanceControl';

mountPage({
  render: (ctx) => {
    const instance: CloudInstanceView = {
      instanceId: 'fixture-sleep-login', deviceId: 'fixture-cloud-device', name: 'Cloud Cindy',
      nameSequence: 1, desiredState: ctx.data.sleeping ? 'stopped' : 'running',
      runtimeState: ctx.data.sleeping ? 'stopped' : 'starting', ready: false,
      loginRequired: true, loginWakeSupported: true, version: '0.1.120-cloud.1', imageId: null,
      latestVersion: '0.1.120-cloud.1', updateAvailable: false, upgradeState: 'idle',
      observedAtMs: null, maintenance: null,
    };
    return <CloudInstancesPage embedded onBack={() => {}} onOpen={forbid('open settings')}
      api={{ instanceList: async () => [instance], instanceClaim: forbid('claim'),
        instancePower: forbid('power'), instanceInitialize: forbid('login') }} />;
  },
});

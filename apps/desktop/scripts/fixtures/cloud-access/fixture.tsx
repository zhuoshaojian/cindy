import { mountPage, forbid } from '../../ui-page/harness';
import { setDataOwnerGeneration } from '../../../src/renderer/contexts/dataOwnerGeneration';
import {
  CloudInstanceAccessProvider,
  useCloudInstanceAccess,
} from '../../../src/renderer/features/cloud-settings/CloudInstanceAccess';
import { CloudInstancesSection } from '../../../src/renderer/features/cloud-settings/CloudInstancesSection';
import { CloudSettingsShortcut } from '../../../src/renderer/features/cloud-settings/CloudSettingsShortcut';

function Preview() {
  const access = useCloudInstanceAccess();
  return (
    <main data-access={access} className="p-6">
      <div className="group/device-header flex items-center gap-1 mb-4">
        <span>Cindy</span>
        <CloudSettingsShortcut deviceId="cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa" name="Cindy" />
      </div>
      <CloudInstancesSection />
    </main>
  );
}

mountPage({
  route: '/settings?tab=cloud-instances',
  host: (ctx) => ({
    cloudSettings: {
      instanceList: async () => {
        if (ctx.data.access === 'hidden') throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
        if (ctx.data.access === 'checking') return new Promise(() => {});
        return [];
      },
      instanceClaim: forbid('cloudSettings.instanceClaim'),
      instancePower: forbid('cloudSettings.instancePower'),
      instanceInitialize: forbid('cloudSettings.instanceInitialize'),
    },
    openRemoteDesktop: forbid('openRemoteDesktop'),
  }),
  render: () => {
    setDataOwnerGeneration('fixture-owner', 1);
    return (
      <CloudInstanceAccessProvider>
        <Preview />
      </CloudInstanceAccessProvider>
    );
  },
});

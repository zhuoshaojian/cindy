import { Route, Routes, useLocation } from 'react-router-dom';
import { mountPage } from '../../ui-page/harness';
import { setDataOwnerGeneration } from '../../../src/renderer/contexts/dataOwnerGeneration';
import { CloudInstanceAccessProvider } from '../../../src/renderer/features/cloud-settings/CloudInstanceAccess';
import { CloudInstanceSidebarEntries } from '../../../src/renderer/features/cloud-settings/CloudInstanceSidebarEntries';

setDataOwnerGeneration('fixture-owner', 1);
function Destination() {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}
mountPage({
  route: '/cc-agent/new',
  host: {
    cloudSettings: {
      instanceAccess: async () => ({ allowed: true }),
      instanceList: async () => [
        {
          instanceId: 'fixture-instance',
          deviceId: 'cloud-device-0123456789abcdef01234567',
          name: null,
          nameSequence: 1,
          desiredState: 'running',
          ready: true,
        },
      ],
    },
  },
  render: () => (
    <CloudInstanceAccessProvider>
      <Routes>
        <Route
          path="/cc-agent/new"
          element={
            <aside className="w-full max-w-[280px] p-3">
              <CloudInstanceSidebarEntries visibleDeviceIds={[]} />
            </aside>
          }
        />
        <Route path="/cloud-settings" element={<Destination />} />
      </Routes>
    </CloudInstanceAccessProvider>
  ),
});

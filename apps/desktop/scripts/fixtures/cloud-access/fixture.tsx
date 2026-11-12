import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { mountPage, forbid } from '../../ui-page/harness';
import { setDataOwnerGeneration } from '../../../src/renderer/contexts/dataOwnerGeneration';
import {
  CloudInstanceAccessProvider,
  useCloudInstanceAccess,
} from '../../../src/renderer/features/cloud-settings/CloudInstanceAccess';
import { RemoteControlSection } from '../../../src/renderer/components/settings/RemoteControlSection';
import { CloudDevOptions } from '../../../src/renderer/features/cloud-settings/CloudPreviewSwitches';

import {
  endCloudStage,
  selectCloudFrame,
} from '../../../src/renderer/features/cloud-settings/cloudFaults';
// Registers the scenario catalog the frames come from.
import { CLOUD_SCENARIOS } from '../../../src/renderer/features/cloud-settings/cloudFaultScripts';

export const CLOUD = 'cloud-device-0123456789abcdef01234567';

function Preview({ devOptions }: { devOptions: boolean }) {
  const access = useCloudInstanceAccess();
  return (
    <main data-access={access} className="mx-auto max-w-[920px] p-6">
      {/* Since 2026-11-05 a cloud instance is managed on its card in My devices. */}
      <RemoteControlSection />
      {/* This page builds as a release, which has no dev options; mount the floating entry itself. */}
      {devOptions && <CloudDevOptions defaultOpen />}
    </main>
  );
}

mountPage({
  host: (ctx) => {
    const allowed = ctx.data.access === 'allowed';
    const instances = (ctx.data.instances ?? []) as { deviceId: string; policy?: unknown }[];
    // As in Main: the list carries no maintenance policy, the per-instance read does.
    const project = ({ policy, ...view }: (typeof instances)[number], maintenance: unknown) => ({
      ...view,
      maintenance,
    });
    return {
      cloudLoginWindow: { open: forbid('cloudLoginWindow.open'), onCompleted: () => () => {} },
      cloudSettings: {
        instanceAccess: async () => {
          if (ctx.data.access === 'hidden') return { schemaVersion: 1, allowed: false };
          if (ctx.data.access === 'checking') return new Promise(() => {});
          return { schemaVersion: 1, allowed: true };
        },
        // Outside the allowlist the device list must not reach CIS at all.
        instanceList: allowed
          ? async () => instances.map((view) => project(view, null))
          : forbid('cloudSettings.instanceList'),
        instanceRead: async ({ deviceId }: { deviceId: string }) => {
          const view = instances.find((item) => item.deviceId === deviceId)!;
          return project(view, view.policy ?? null);
        },
        instanceClaim: forbid('cloudSettings.instanceClaim'),
        instancePower: forbid('cloudSettings.instancePower'),
        instanceUpgrade: forbid('cloudSettings.instanceUpgrade'),
        instancePolicy: forbid('cloudSettings.instancePolicy'),
        instanceInitialize: forbid('cloudSettings.instanceInitialize'),
      },
      openRemoteDesktop: forbid('openRemoteDesktop'),
      remoteSsh: { list: async () => ({ hosts: [] }), onStatusChanged: () => () => {} },
    };
  },
  render: (ctx) => {
    setDataOwnerGeneration('fixture-owner', 1);
    // A simulated frame, as the dev options would choose it (kept in memory on this build).
    // A frame is named by its index, or by its code (which stays put as frames are added).
    const frame = ctx.data.frame as [string, number | string] | undefined;
    const index =
      typeof frame?.[1] === 'string'
        ? (CLOUD_SCENARIOS.find((item) => item.id === frame[0])?.frames.findIndex((f) => f.code === frame[1]) ?? -1)
        : frame?.[1];
    if (frame && index !== undefined && index >= 0) selectCloudFrame(frame[0], index, CLOUD);
    else endCloudStage();
    // The device card's draft guard needs a data router, as in the app.
    const router = createMemoryRouter([{ path: '*', element: <Preview devOptions={!!ctx.data.devOptions} /> }], {
      initialEntries: [
        // Without a device: the plain section also exists before this change, for --compare.
        ctx.data.section
          ? `/settings?tab=remote-control&section=${ctx.data.section}`
          : `/settings?tab=remote-control&section=remoteControl.cloudInstances&device=${CLOUD}`,
      ],
    });
    return (
      <CloudInstanceAccessProvider>
        <RouterProvider router={router} />
      </CloudInstanceAccessProvider>
    );
  },
});

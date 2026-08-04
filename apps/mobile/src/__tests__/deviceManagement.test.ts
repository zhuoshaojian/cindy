import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeviceView } from '@cindy/device-link';

import {
  buildDeviceManagementRouteParams,
  cloudInstanceDetailActionState,
} from '@/device-link/deviceManagement';

const device: DeviceView = {
  appVersion: '1.0.0',
  busy: false,
  deviceId: 'cloud-device-a',
  deviceInfo: {
    cpuLabel: 'Xeon',
    kind: 'cloud',
    memoryGb: 4,
    modelLabel: 'ACS',
    osVersion: '1',
  },
  isSelf: false,
  lastSeenAt: '2026-08-04T00:00:00.000Z',
  name: 'Cloud',
  online: true,
  platform: 'linux',
  remoteControlEnabled: true,
};

describe('device management route and cloud action state', () => {
  it('keeps device management on an independent route from the session list', () => {
    const sessionListSource = readFileSync(
      resolve(process.cwd(), 'app/devices/[deviceId].tsx'),
      'utf8',
    );
    const managementSource = readFileSync(
      resolve(process.cwd(), 'app/devices/manage/[deviceId].tsx'),
      'utf8',
    );

    expect(sessionListSource).toContain('export default function DeviceDetailScreen()');
    expect(sessionListSource).not.toContain('DeviceManagementScreen');
    expect(sessionListSource).not.toContain('params.mode');
    expect(managementSource).toContain('export default function DeviceManagementRoute()');
    expect(managementSource).toContain('<DeviceManagementScreen');
  });

  it('refreshes cloud state on focus and keeps destructive/update actions behind confirmation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/device-link/DeviceManagementScreen.tsx'),
      'utf8',
    );

    expect(source).toContain('useFocusEffect(useCallback(() => {');
    expect(source).toContain('void refreshCloudInstances();');
    expect(source).toContain('cloud.instances.find((item) => item.deviceId === deviceId)');
    expect(source).toContain("t('deviceLink.cloudInstance.updateConfirmDescription')");
    expect(source).toContain("t('deviceLink.cloudInstance.deleteConfirmDescription')");
    expect(source).toContain("testID: 'deviceManagement.cloudUpdate'");
    expect(source).toContain("testID: 'deviceManagement.cloudDelete'");
    expect(source).toContain("testID: `deviceManagement.cloud${actionState.lifecycleAction === 'wake' ? 'Wake' : 'Stop'}`");
  });

  it('pins device metadata and cloud release state into the management route', () => {
    expect(buildDeviceManagementRouteParams({
      device,
      deviceId: device.deviceId,
      name: 'Cloud',
      cloudInstance: {
        customLabel: null,
        deviceId: device.deviceId,
        instanceId: 'cloud-instance-a',
        nameSequence: 1,
        status: {
          lastFailedUpgradeImage: null,
          latestReleaseTag: '0.1.6',
          updateAvailable: true,
          upgrade: {
            deadlineAtMs: null,
            previousImage: null,
            state: 'idle',
            targetImage: null,
          },
        },
      },
    })).toEqual({
      cloudInstanceId: 'cloud-instance-a',
      cpuLabel: 'Xeon',
      deviceId: 'cloud-device-a',
      kind: 'cloud',
      latestReleaseTag: '0.1.6',
      memoryGb: '4',
      modelLabel: 'ACS',
      name: 'Cloud',
      online: '1',
      platform: 'linux',
      updateAvailable: '1',
      upgradeState: 'idle',
    });
  });

  it('keeps relay-only cloud metadata routable while the control-plane row catches up', () => {
    expect(buildDeviceManagementRouteParams({
      device,
      deviceId: device.deviceId,
      name: 'Cloud',
    })).toMatchObject({
      deviceId: 'cloud-device-a',
      kind: 'cloud',
      online: '1',
    });
  });

  it('shows update + sleep when online and an update is available', () => {
    expect(cloudInstanceDetailActionState({
      instanceId: 'cloud-instance-a',
      online: true,
      pending: null,
      updateAvailable: true,
      upgradeState: 'idle',
      wakeWatching: false,
    })).toEqual({
      deleteDisabled: false,
      lifecycleAction: 'stop',
      lifecycleBusy: false,
      lifecycleDisabled: false,
      updateBusy: false,
      updateDisabled: false,
    });
  });

  it('locks lifecycle/delete while verifying and exits into wake after sleep', () => {
    expect(cloudInstanceDetailActionState({
      instanceId: 'cloud-instance-a',
      online: true,
      pending: null,
      updateAvailable: true,
      upgradeState: 'verifying',
      wakeWatching: false,
    })).toMatchObject({
      deleteDisabled: true,
      lifecycleDisabled: true,
      updateBusy: true,
      updateDisabled: true,
    });
    expect(cloudInstanceDetailActionState({
      instanceId: 'cloud-instance-a',
      online: false,
      pending: null,
      updateAvailable: false,
      upgradeState: 'idle',
      wakeWatching: false,
    })).toMatchObject({
      lifecycleAction: 'wake',
      lifecycleBusy: false,
      lifecycleDisabled: false,
    });
  });
});

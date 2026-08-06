import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeviceView } from '@cindy/device-link';

import {
  buildDeviceManagementRouteParams,
  cloudInstanceDetailActionState,
  resolveCloudManagementTarget,
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
    expect(source).toContain('useCloudInstances(apiFetch, cloudCandidate)');
    expect(source).toContain('resolvedInstance={cloudTarget.instance}');
    expect(source).toContain('cloudTarget.isCloud ?');
    expect(source).toContain("t('deviceLink.cloudInstance.updateConfirmDescription')");
    expect(source).toContain('parseCloudInstanceImageTag(status?.image ?? fallbackImage)');
    expect(source).toContain('testID="deviceManagement.cloudCurrentVersion"');
    expect(source).toContain("t('deviceLink.cloudInstance.currentVersionUpToDate'");
    expect(source).toContain("t('deviceLink.cloudInstance.deleteConfirmDescription')");
    expect(source).toContain("testID: 'deviceManagement.cloudUpdate'");
    expect(source).toContain('testID="deviceManagement.cloudAutoUpdate"');
    expect(source).toContain("typeof status?.autoUpdate === 'boolean'");
    expect(source).toContain('cloud.setAutoUpdate(instanceId, enabled)');
    expect(source).toContain("testID: 'deviceManagement.cloudDelete'");
    expect(source).toContain("testID: `deviceManagement.cloud${actionState.lifecycleAction === 'wake' ? 'Wake' : 'Stop'}`");
    // 模型凭据陈旧的观测提示:只在 not-ready 时显示,不影响任何操作可用性。
    expect(source).toContain("status?.modelAccess === 'not-ready'");
    expect(source).toContain('testID="deviceManagement.cloudModelAccessStale"');
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
          autoUpdate: true,
          image: 'registry.example/cindy-cloud:0.1.6@sha256:abc',
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
      autoUpdate: '1',
      cloudCandidate: '1',
      cloudInstanceId: 'cloud-instance-a',
      cpuLabel: 'Xeon',
      deviceId: 'cloud-device-a',
      image: 'registry.example/cindy-cloud:0.1.6@sha256:abc',
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

  it('omits the auto-update route flag for legacy control-plane rows', () => {
    const params = buildDeviceManagementRouteParams({
      device,
      deviceId: device.deviceId,
      name: 'Cloud',
      cloudInstance: {
        customLabel: null,
        deviceId: device.deviceId,
        instanceId: 'cloud-instance-a',
        nameSequence: 1,
        status: {
          image: null,
          lastFailedUpgradeImage: null,
          latestReleaseTag: null,
          updateAvailable: false,
          upgrade: {
            deadlineAtMs: null,
            previousImage: null,
            state: 'idle',
            targetImage: null,
          },
        },
      },
    });

    expect(params).not.toHaveProperty('autoUpdate');
  });

  it('keeps relay-only cloud metadata routable while the control-plane row catches up', () => {
    expect(buildDeviceManagementRouteParams({
      device,
      deviceId: device.deviceId,
      name: 'Cloud',
    })).toMatchObject({
      cloudCandidate: '1',
      deviceId: 'cloud-device-a',
      kind: 'cloud',
      online: '1',
    });
  });

  it('restores cloud management for an offline fallback row from the control-plane deviceId', () => {
    const cloudInstance = {
      customLabel: null,
      deviceId: 'cloud-device-a',
      instanceId: 'cloud-instance-a',
      nameSequence: 1,
      status: {
        autoUpdate: true,
        image: null,
        lastFailedUpgradeImage: null,
        latestReleaseTag: null,
        updateAvailable: false,
        upgrade: {
          deadlineAtMs: null,
          previousImage: null,
          state: 'idle' as const,
          targetImage: null,
        },
      },
    };
    const params = buildDeviceManagementRouteParams({
      cloudCandidate: true,
      device: { ...device, deviceInfo: undefined, online: false },
      deviceId: device.deviceId,
      name: 'Cloud',
    });

    expect(params).toMatchObject({
      cloudCandidate: '1',
      deviceId: 'cloud-device-a',
      online: '0',
    });
    expect(resolveCloudManagementTarget({
      cloudCandidate: params.cloudCandidate === '1',
      deviceId: params.deviceId,
      instances: [cloudInstance],
      kind: params.kind,
    })).toEqual({
      instance: cloudInstance,
      isCloud: true,
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

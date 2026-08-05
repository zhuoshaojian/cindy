import type { DeviceView } from '@cindy/device-link';

import type { CloudInstanceView } from '@/api/cloudInstance';
import type { CloudInstancePending } from '@/cloud-instance/useCloudInstances';

export interface DeviceManagementRouteParams extends Record<string, string | undefined> {
  deviceId: string;
  name: string;
  online: '0' | '1';
  autoUpdate?: '0' | '1';
  cloudCandidate?: '1';
  cloudInstanceId?: string;
  cpuLabel?: string;
  image?: string;
  kind?: string;
  latestReleaseTag?: string;
  lastFailedUpgradeImage?: string;
  memoryGb?: string;
  modelLabel?: string;
  platform?: string;
  updateAvailable?: '0' | '1';
  upgradeState?: 'idle' | 'rolled-back' | 'verifying';
}

export function buildDeviceManagementRouteParams(input: {
  deviceId: string;
  name: string;
  device?: DeviceView | null;
  cloudInstance?: CloudInstanceView | null;
  cloudCandidate?: boolean;
}): DeviceManagementRouteParams {
  const { cloudInstance, device } = input;
  const cloudCandidate = Boolean(
    cloudInstance
    || input.cloudCandidate
    || device?.deviceInfo?.kind === 'cloud'
    || input.deviceId.startsWith('cloud-device-'),
  );
  return {
    deviceId: input.deviceId,
    name: input.name,
    online: device?.online ? '1' : '0',
    ...(cloudCandidate ? { cloudCandidate: '1' } : {}),
    ...(cloudInstance ? {
      cloudInstanceId: cloudInstance.instanceId,
      ...(typeof cloudInstance.status.autoUpdate === 'boolean'
        ? { autoUpdate: cloudInstance.status.autoUpdate ? '1' : '0' }
        : {}),
      ...(cloudInstance.status.image ? { image: cloudInstance.status.image } : {}),
      kind: 'cloud',
      ...(cloudInstance.status.latestReleaseTag
        ? { latestReleaseTag: cloudInstance.status.latestReleaseTag }
        : {}),
      ...(cloudInstance.status.lastFailedUpgradeImage
        ? { lastFailedUpgradeImage: cloudInstance.status.lastFailedUpgradeImage }
        : {}),
      updateAvailable: cloudInstance.status.updateAvailable ? '1' : '0',
      upgradeState: cloudInstance.status.upgrade.state,
    } : device?.deviceInfo?.kind ? { kind: device.deviceInfo.kind } : {}),
    ...(device?.platform ? { platform: device.platform } : {}),
    ...(device?.deviceInfo?.modelLabel ? { modelLabel: device.deviceInfo.modelLabel } : {}),
    ...(device?.deviceInfo?.cpuLabel ? { cpuLabel: device.deviceInfo.cpuLabel } : {}),
    ...(typeof device?.deviceInfo?.memoryGb === 'number'
      ? { memoryGb: String(device.deviceInfo.memoryGb) }
      : {}),
  };
}

export function resolveCloudManagementTarget(input: {
  deviceId: string;
  cloudCandidate?: boolean;
  cloudInstanceId?: string;
  kind?: string;
  instances: readonly CloudInstanceView[];
}): { instance: CloudInstanceView | null; isCloud: boolean } {
  const instance = input.instances.find((item) => item.instanceId === input.cloudInstanceId)
    ?? input.instances.find((item) => item.deviceId === input.deviceId)
    ?? null;
  return {
    instance,
    isCloud: Boolean(
      instance
      || input.cloudCandidate
      || input.kind === 'cloud'
      || input.cloudInstanceId
      || input.deviceId.startsWith('cloud-device-'),
    ),
  };
}

export interface CloudInstanceDetailActionState {
  deleteDisabled: boolean;
  lifecycleAction: 'stop' | 'wake';
  lifecycleBusy: boolean;
  lifecycleDisabled: boolean;
  updateBusy: boolean;
  updateDisabled: boolean;
}

/** Pure action gating shared by the detail UI and its contract tests. */
export function cloudInstanceDetailActionState(input: {
  instanceId: string;
  online: boolean;
  pending: CloudInstancePending;
  updateAvailable: boolean;
  upgradeState: 'idle' | 'rolled-back' | 'verifying';
  wakeWatching: boolean;
}): CloudInstanceDetailActionState {
  const pendingThisInstance = input.pending?.target === input.instanceId;
  const updateBusy = input.upgradeState === 'verifying'
    || (pendingThisInstance && input.pending?.action === 'upgrade');
  const lifecycleAction = input.online ? 'stop' : 'wake';
  const lifecycleBusy = input.wakeWatching || (
    pendingThisInstance
    && input.pending?.action === lifecycleAction
  );
  const anotherActionPending = input.pending !== null && !lifecycleBusy && !updateBusy;
  return {
    deleteDisabled: input.pending !== null || updateBusy,
    lifecycleAction,
    lifecycleBusy,
    lifecycleDisabled: lifecycleBusy || updateBusy || anotherActionPending,
    updateBusy,
    updateDisabled: !input.updateAvailable || input.pending !== null || updateBusy,
  };
}

export function devicePlatformLabel(platform: string | null | undefined): string | null {
  if (!platform) return null;
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  if (platform === 'ios') return 'iOS';
  if (platform === 'android') return 'Android';
  if (platform === 'web') return 'Web';
  return platform;
}

import type { DeviceView } from '@cindy/device-link';
import type { CloudInstancePending } from '@/cloud-instance/useCloudInstances';

export interface DeviceManagementRouteParams extends Record<string, string | undefined> {
  deviceId: string;
  name: string;
  online: '0' | '1';
  autoUpdate?: '0' | '1';
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
}): DeviceManagementRouteParams {
  const { device } = input;
  return {
    deviceId: input.deviceId,
    name: input.name,
    online: device?.online ? '1' : '0',
    ...(device?.platform ? { platform: device.platform } : {}),
    ...(device?.deviceInfo?.modelLabel ? { modelLabel: device.deviceInfo.modelLabel } : {}),
    ...(device?.deviceInfo?.cpuLabel ? { cpuLabel: device.deviceInfo.cpuLabel } : {}),
    ...(typeof device?.deviceInfo?.memoryGb === 'number'
      ? { memoryGb: String(device.deviceInfo.memoryGb) }
      : {}),
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
  loginRequired?: boolean;
  online: boolean;
  pending: CloudInstancePending;
  updateAvailable: boolean;
  upgradeState: 'idle' | 'rolled-back' | 'verifying';
}): CloudInstanceDetailActionState {
  const pendingThisInstance = input.pending?.target === input.instanceId;
  const updateBusy = input.upgradeState === 'verifying'
    || (pendingThisInstance && input.pending?.action === 'upgrade');
  const pendingLifecycleAction = pendingThisInstance
    && (input.pending?.action === 'wake' || input.pending?.action === 'stop')
      ? input.pending.action
      : null;
  const lifecycleAction = pendingLifecycleAction ?? (input.online ? 'stop' : 'wake');
  const lifecycleBusy = pendingThisInstance
    && input.pending?.action === lifecycleAction;
  const anotherActionPending = input.pending !== null && !lifecycleBusy && !updateBusy;
  return {
    deleteDisabled: input.pending !== null || updateBusy,
    lifecycleAction,
    lifecycleBusy,
    lifecycleDisabled: lifecycleBusy || updateBusy || anotherActionPending
      || (input.loginRequired === true && lifecycleAction === 'wake'),
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

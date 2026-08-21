import type { CloudInstanceView } from '@/api/cloudInstance';
import type { MobileHomeDeviceFilterItem } from '@/session/mobileHome';
import { isCloudInstanceDeviceId } from '@cindy/maker-shared/device-list';

export type DeviceMenuCloudLoadState = 'loading' | 'ready' | 'unsupported' | 'error';

export interface DeviceMenuSourceProjection {
  deviceFilters: MobileHomeDeviceFilterItem[];
  fallbackCloudFilters: MobileHomeDeviceFilterItem[];
}

export interface CloudInstanceDeviceMenuItem {
  filter: MobileHomeDeviceFilterItem;
  instance: CloudInstanceView;
  kind: 'cloud';
  label: string;
  online: boolean;
  pendingKey: string;
  updating: boolean;
}

export function resolveDeviceMenuKind(
  deviceId: string,
  kind: 'cloud' | undefined,
): 'cloud' | undefined {
  return kind ?? (isCloudInstanceDeviceId(deviceId) ? 'cloud' : undefined);
}

export function buildCloudDeviceFilterItem(
  view: Pick<CloudInstanceView, 'instanceId' | 'deviceId'>,
  input: { label: string; online: boolean; selected: boolean },
): MobileHomeDeviceFilterItem {
  return {
    available: input.online,
    deviceId: view.deviceId,
    id: `cloud:${view.instanceId}`,
    label: input.label,
    selected: input.selected,
    sessionCount: 0,
    state: input.online ? 'ready' : 'offline',
    statusLabel: input.online ? 'online' : 'offline',
    waitingCount: 0,
  };
}

/** Complete rich cloud rows; rendering consumes this projection directly. */
export function projectCloudInstanceMenuItems(input: {
  instances: readonly CloudInstanceView[];
  nameOf(instance: Pick<CloudInstanceView, 'customLabel' | 'nameSequence'>): string;
  onlineDeviceIds: ReadonlySet<string>;
  selectedDeviceId: string | null;
}): CloudInstanceDeviceMenuItem[] {
  return input.instances.map((instance) => {
    const label = input.nameOf(instance);
    const online = input.onlineDeviceIds.has(instance.deviceId);
    return {
      filter: buildCloudDeviceFilterItem(instance, {
        label,
        online,
        selected: input.selectedDeviceId === instance.deviceId,
      }),
      instance,
      kind: 'cloud',
      label,
      online,
      pendingKey: instance.instanceId,
      updating: instance.status.upgrade.state === 'verifying',
    };
  });
}

/**
 * Control-plane rows own cloud management when present. Keep a relay fallback while the
 * list is unavailable, and also for an unmatched online device: live presence is stronger
 * visibility evidence than a temporarily incomplete control-plane snapshot.
 */
export function projectDeviceMenuSources(input: {
  cloudDeviceIds: ReadonlySet<string>;
  cloudInstanceDeviceIds: ReadonlySet<string>;
  cloudLoadState: DeviceMenuCloudLoadState;
  filters: readonly MobileHomeDeviceFilterItem[];
}): DeviceMenuSourceProjection {
  const deviceFilters: MobileHomeDeviceFilterItem[] = [];
  const fallbackCloudFilters: MobileHomeDeviceFilterItem[] = [];

  for (const item of input.filters) {
    const deviceId = item.deviceId;
    if (deviceId === null || input.cloudInstanceDeviceIds.has(deviceId)) continue;
    const liveCloudDevice = input.cloudDeviceIds.has(deviceId);
    const cloudCandidate = liveCloudDevice || isCloudInstanceDeviceId(deviceId);
    if (!cloudCandidate) {
      // 范围菜单只列当前能打开的电脑(上游 2026-08):离线 / 关远控 / 撤权的设备不占行,
      // 灰行点不进去只会吵。空态引导另走 RemoteAccessGuide。
      if (item.available) deviceFilters.push(item);
      continue;
    }
    // Prefix-only rows come from an orphaned session cache after the live device
    // model has disappeared. Once the control plane is ready they must not sit
    // beside the separate wake-cloud action; a live relay cloud row remains a
    // valid fallback for a temporarily incomplete control-plane snapshot.
    if (input.cloudLoadState !== 'ready' || (liveCloudDevice && item.available)) {
      fallbackCloudFilters.push(item);
    }
  }

  return { deviceFilters, fallbackCloudFilters };
}

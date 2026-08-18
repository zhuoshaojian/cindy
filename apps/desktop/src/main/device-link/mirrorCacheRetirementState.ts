import type { DeviceRetirementTombstone } from './mirrorCacheBarrier';

/**
 * 退役墓碑落盘失败时的进程内 fail-closed 视图。
 *
 * store 在 delete 当下先写入；purge queue 则在重启后从持久账本恢复，再尝试补落磁盘墓碑。
 * 按 owner root 分桶，避免账号边界串扰。
 */
const retirementsByRoot = new Map<string, Map<string, DeviceRetirementTombstone>>();

function bucket(root: string): Map<string, DeviceRetirementTombstone> {
  let entries = retirementsByRoot.get(root);
  if (!entries) {
    entries = new Map();
    retirementsByRoot.set(root, entries);
  }
  return entries;
}

export function rememberVolatileDeviceRetirement(
  root: string,
  tombstone: DeviceRetirementTombstone,
): void {
  bucket(root).set(tombstone.deviceId, tombstone);
}

export function forgetVolatileDeviceRetirement(root: string, deviceId: string): void {
  const entries = retirementsByRoot.get(root);
  if (!entries) return;
  entries.delete(deviceId);
  if (entries.size === 0) retirementsByRoot.delete(root);
}

export function hasVolatileDeviceRetirement(root: string, deviceId: string): boolean {
  return retirementsByRoot.get(root)?.has(deviceId) === true;
}

export function listVolatileDeviceRetirements(root: string): DeviceRetirementTombstone[] {
  return [...(retirementsByRoot.get(root)?.values() ?? [])];
}

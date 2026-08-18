/** Main 内部当代 relay presence 视图；断线重置，不跨连接代保留。 */
export const presenceOnlineByDevice = new Map<string, boolean>();

export type DevicePresenceState = 'online' | 'offline' | 'unknown';

export function getDevicePresenceState(deviceId: string): DevicePresenceState {
  if (!presenceOnlineByDevice.has(deviceId)) return 'unknown';
  return presenceOnlineByDevice.get(deviceId) === true ? 'online' : 'offline';
}

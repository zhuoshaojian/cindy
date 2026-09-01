export interface DeviceDetailRouteParams extends Record<string, string | undefined> {
  deviceId: string;
  name: string;
  online: '0' | '1';
}

/** Build every device-detail navigation target with an explicit presence snapshot. */
export function buildDeviceDetailRouteParams(
  input: { deviceId: string; name: string; online: boolean } & Record<string, unknown>,
): DeviceDetailRouteParams {
  const { online, ...rest } = input;
  return { ...rest, online: online ? '1' : '0' } as DeviceDetailRouteParams;
}

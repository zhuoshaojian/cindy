import { useMemo } from 'react';
import { useDeviceLinkDeviceList } from './useDeviceLinkDeviceList';

/** Return the stable set of device ids marked as cloud instances by the relay. */
export function useCloudDeviceIds(): ReadonlySet<string> {
  const devices = useDeviceLinkDeviceList();
  return useMemo(() => {
    const ids = new Set<string>();
    for (const device of devices ?? []) {
      if (device.deviceInfo?.kind === 'cloud') ids.add(device.deviceId);
    }
    return ids;
  }, [devices]);
}

import { useMemo } from 'react';
import { isCloudInstanceDeviceId } from '@cindy/maker-shared/device-list';
import { useDeviceLinkDeviceList } from './useDeviceLinkDeviceList';
import { useRemoteDevices } from './remoteProjectsStore';

/** Return the stable set of cloud instance device ids. */
export function useCloudDeviceIds(): ReadonlySet<string> {
  const devices = useDeviceLinkDeviceList();
  const remoteDevices = useRemoteDevices();
  return useMemo(() => {
    const ids = new Set<string>();
    for (const device of devices ?? []) {
      // deviceId is minted into the token claim and is what the relay routes on;
      // deviceInfo.kind is only self-reported in hello, so the prefix is stronger.
      if (device.deviceInfo?.kind === 'cloud' || isCloudInstanceDeviceId(device.deviceId)) {
        ids.add(device.deviceId);
      }
    }
    for (const device of remoteDevices) {
      if (device.kind === 'cloud') ids.add(device.deviceId);
    }
    return ids;
  }, [devices, remoteDevices]);
}

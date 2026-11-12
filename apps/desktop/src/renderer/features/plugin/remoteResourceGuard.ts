import { useSyncExternalStore } from 'react';

/**
 * An optional check on requests to another computer's plugins and skills, made before anything is
 * sent. None is registered by default, so these pages behave as they always have. The cloud settings
 * dev options register one that holds back every write to a cloud instance while a failure is
 * simulated (features/cloud-settings/cloudFaults.ts).
 */
export interface RemoteResourceGuard {
  /** Throws to refuse a request; nothing is sent. */
  check(deviceId: string, channel: string, args: readonly unknown[]): void;
  /** Whether a page that writes on its own (a plugin's settings page) may open for this computer. */
  writable(deviceId: string): boolean;
  subscribe(listener: () => void): () => void;
}

let guard: RemoteResourceGuard | null = null;
const none = () => () => {};

export function setRemoteResourceGuard(next: RemoteResourceGuard | null) {
  guard = next;
}

/** DeviceLink to another computer's plugins or skills, through the guard when one is registered. */
export function invokeRemoteResource(
  deviceId: string,
  channel: string,
  args: unknown[],
): Promise<unknown> {
  try {
    guard?.check(deviceId, channel, args);
  } catch (error) {
    return Promise.reject(error);
  }
  return window.electronAPI.deviceLink.invoke(deviceId, channel, args);
}

/** For a request that leaves another way (a package upload): refused as the guard says. */
export function checkRemoteResource(deviceId: string, channel: string) {
  guard?.check(deviceId, channel, []);
}

export function useRemoteResourceWritable(deviceId: string): boolean {
  return useSyncExternalStore(guard?.subscribe ?? none, () => !guard || guard.writable(deviceId));
}

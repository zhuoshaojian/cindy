/** Marker-aware device presentation helpers shared by mobile selectors. */
export interface CloudMarkedDevice {
  kind?: 'cloud';
}

/** Preserve ordinary order while placing cloud Pods at the bottom. */
export function sortCloudDevicesLast<T>(devices: readonly T[]): T[] {
  return [...devices].sort((a, b) => {
    const aCloud = (a as CloudMarkedDevice).kind === 'cloud';
    const bCloud = (b as CloudMarkedDevice).kind === 'cloud';
    return Number(aCloud) - Number(bCloud);
  });
}

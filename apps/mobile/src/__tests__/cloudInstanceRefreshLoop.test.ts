import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLOUD_INSTANCES_REFRESH_INTERVAL_MS,
  CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS,
  createCloudInstanceRefreshLoop,
  type CloudInstanceRefreshLoop,
} from '@/cloud-instance/cloudInstanceRefreshLoop';

afterEach(() => {
  vi.useRealTimers();
});

describe('cloud instance refresh loop', () => {
  it('gates interval refreshes by visibility and refreshes immediately on return', async () => {
    vi.useFakeTimers();
    let visible = false;
    const refresh = vi.fn(async () => undefined);
    const loop = createCloudInstanceRefreshLoop({
      isVisible: () => visible,
      isVerifying: () => false,
      refresh,
    });
    loop.start();

    await vi.advanceTimersByTimeAsync(CLOUD_INSTANCES_REFRESH_INTERVAL_MS);
    expect(refresh).not.toHaveBeenCalled();

    visible = true;
    loop.visibilityChanged();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(CLOUD_INSTANCES_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('uses the short interval only while an upgrade is verifying', async () => {
    vi.useFakeTimers();
    let verifying = true;
    let loop!: CloudInstanceRefreshLoop;
    const refresh = vi.fn(async () => {
      verifying = false;
      loop.instancesChanged();
    });
    loop = createCloudInstanceRefreshLoop({
      isVisible: () => true,
      isVerifying: () => verifying,
      refresh,
    });
    loop.start();

    await vi.advanceTimersByTimeAsync(CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(
      CLOUD_INSTANCES_REFRESH_INTERVAL_MS - CLOUD_INSTANCES_VERIFYING_REFRESH_INTERVAL_MS,
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    loop.stop();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { DeviceView } from '@cindy/device-link';
import {
  createHomePeerRecoveryRefresh,
  isCurrentHomeStartupLoading,
  markHomePeerReady,
  promoteRecoveredHomeDevice,
  pruneHomePeerReady,
} from '@/session/homePeerRecovery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('Home peer recovery refresh', () => {
  it('keeps startup busy until the recovered device hydrate succeeds', async () => {
    const hydration = deferred<{ failure: string | null }>();
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string }) => device.deviceId,
      hydrate: vi.fn(() => hydration.promise),
      onReady: ready,
    });
    await refresh.setDevices([{ deviceId: 'cloud-a' }]);

    const run = refresh.refresh('cloud-a', 1);
    expect(ready).not.toHaveBeenCalled();
    expect(isCurrentHomeStartupLoading({
      initialHomeLoading: true,
      selectedDeviceId: 'cloud-a',
      recoveryReadyDeviceIds: new Set(),
    })).toBe(true);

    hydration.resolve({ failure: null });
    await run;
    expect(ready).toHaveBeenCalledWith('cloud-a', { deviceId: 'cloud-a' });
  });

  it('does not clear busy when the targeted hydrate fails or remains pending', async () => {
    const pending = deferred<{ failure: string | null }>();
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string }) => device.deviceId,
      hydrate: vi.fn((device: { deviceId: string }) => device.deviceId === 'failed'
        ? Promise.resolve({ failure: 'offline' })
        : pending.promise),
      onReady: ready,
    });
    await refresh.setDevices([{ deviceId: 'failed' }, { deviceId: 'pending' }]);

    await refresh.refresh('failed', 1);
    const pendingRun = refresh.refresh('pending', 1);
    await Promise.resolve();

    expect(ready).not.toHaveBeenCalled();
    expect(isCurrentHomeStartupLoading({
      initialHomeLoading: true,
      selectedDeviceId: 'pending',
      recoveryReadyDeviceIds: new Set(),
    })).toBe(true);
    pending.resolve({ failure: 'still offline' });
    await pendingRun;
  });

  it('keeps recovery scoped to the selected peer', () => {
    const ready = markHomePeerReady(new Set<string>(), 'cloud-a');

    expect(isCurrentHomeStartupLoading({
      initialHomeLoading: true,
      selectedDeviceId: 'cloud-a',
      recoveryReadyDeviceIds: ready,
    })).toBe(false);
    expect(isCurrentHomeStartupLoading({
      initialHomeLoading: true,
      selectedDeviceId: 'cloud-b',
      recoveryReadyDeviceIds: ready,
    })).toBe(true);
    expect(isCurrentHomeStartupLoading({
      initialHomeLoading: true,
      selectedDeviceId: null,
      recoveryReadyDeviceIds: ready,
    })).toBe(true);
  });

  it('deduplicates duplicate recovery success while the device refresh is in flight', async () => {
    const hydration = deferred<{ failure: string | null }>();
    const hydrate = vi.fn(() => hydration.promise);
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string }) => device.deviceId,
      hydrate,
      onReady: ready,
    });
    await refresh.setDevices([{ deviceId: 'cloud-a' }]);

    const first = refresh.refresh('cloud-a', 1);
    const duplicate = refresh.refresh('cloud-a', 1);
    expect(first).toBe(duplicate);
    expect(hydrate).toHaveBeenCalledTimes(1);

    hydration.resolve({ failure: null });
    await Promise.all([first, duplicate]);
    expect(ready).toHaveBeenCalledTimes(1);
    await refresh.refresh('cloud-a', 1);
    expect(hydrate).toHaveBeenCalledTimes(1);

    await refresh.refresh('cloud-a', 2);
    expect(hydrate).toHaveBeenCalledTimes(2);

    const unchanged = markHomePeerReady(new Set(['cloud-a']), 'cloud-a');
    expect(markHomePeerReady(unchanged, 'cloud-a')).toBe(unchanged);
  });

  it('preserves an in-flight candidate when the same device arrives as a new object', async () => {
    const hydration = deferred<{ failure: string | null }>();
    const hydrate = vi.fn(() => hydration.promise);
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string; online: boolean }) => device.deviceId,
      hydrate,
      onReady: ready,
    });
    await refresh.setDevices([{ deviceId: 'cloud-a', online: false }]);

    const run = refresh.refresh('cloud-a', 1);
    const listRefresh = refresh.setDevices([{ deviceId: 'cloud-a', online: true }]);
    hydration.resolve({ failure: null });
    await Promise.all([run, listRefresh]);

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith('cloud-a', { deviceId: 'cloud-a', online: false });
  });

  it('does not interrupt a target recovery when another peer is added or changes', async () => {
    const hydration = deferred<{ failure: string | null }>();
    const hydrate = vi.fn((device: { deviceId: string; name: string }) =>
      device.deviceId === 'cloud-a'
        ? hydration.promise
        : Promise.resolve({ failure: null }));
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string; name: string }) => device.deviceId,
      hydrate,
      onReady: ready,
    });
    const target = { deviceId: 'cloud-a', name: 'target' };
    await refresh.setDevices([target]);

    const run = refresh.refresh('cloud-a', 1);
    const addedPeerRefresh = refresh.setDevices([
      { ...target },
      { deviceId: 'desktop-b', name: 'first name' },
    ]);
    const changedPeerRefresh = refresh.setDevices([
      { ...target },
      { deviceId: 'desktop-b', name: 'updated name' },
    ]);
    hydration.resolve({ failure: null });
    await Promise.all([run, addedPeerRefresh, changedPeerRefresh]);

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith('cloud-a', target);
  });

  it('drains a recovery edge that arrives before the REST device list', async () => {
    const hydrate = vi.fn(async () => ({ failure: null }));
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string; online: boolean }) => device.deviceId,
      hydrate,
      onReady: ready,
    });

    await refresh.refresh('cloud-a', 1);
    expect(hydrate).not.toHaveBeenCalled();

    await refresh.setDevices([{ deviceId: 'cloud-a', online: false }]);
    expect(hydrate).toHaveBeenCalledWith({ deviceId: 'cloud-a', online: false });
    expect(ready).toHaveBeenCalledWith('cloud-a', { deviceId: 'cloud-a', online: false });
  });

  it('ignores recovery signals for peers absent from the authoritative device list', async () => {
    const hydrate = vi.fn(async () => ({ failure: null }));
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string }) => device.deviceId,
      hydrate,
      onReady: ready,
    });

    await refresh.refresh('revoked-or-closed', 1);
    await refresh.setDevices([{ deviceId: 'other-peer' }]);
    expect(hydrate).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it('creates a live controller after StrictMode cleanup remount', async () => {
    const hydrate = vi.fn(async () => ({ failure: null }));
    const ready = vi.fn();
    const create = () => createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string }) => device.deviceId,
      hydrate,
      onReady: ready,
    });

    const firstMount = create();
    await firstMount.setDevices([{ deviceId: 'cloud-a' }]);
    firstMount.dispose();

    const remount = create();
    await remount.setDevices([{ deviceId: 'cloud-a' }]);
    await remount.refresh('cloud-a', 1);

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith('cloud-a', { deviceId: 'cloud-a' });
  });

  it('does not revive a peer removed while its recovery hydrate is in flight', async () => {
    const hydration = deferred<{ failure: string | null }>();
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string }) => device.deviceId,
      hydrate: vi.fn(() => hydration.promise),
      onReady: ready,
    });
    await refresh.setDevices([{ deviceId: 'cloud-a' }]);

    const run = refresh.refresh('cloud-a', 1);
    await refresh.setDevices([]);
    hydration.resolve({ failure: null });
    await run;

    expect(ready).not.toHaveBeenCalled();
  });

  it('invalidates an old hydrate after removal and recovers a re-added id as a new candidate', async () => {
    const firstHydration = deferred<{ failure: string | null }>();
    const secondHydration = deferred<{ failure: string | null }>();
    const hydrate = vi.fn()
      .mockImplementationOnce(() => firstHydration.promise)
      .mockImplementationOnce(() => secondHydration.promise);
    const ready = vi.fn();
    const refresh = createHomePeerRecoveryRefresh({
      getDeviceId: (device: { deviceId: string; incarnation: number }) => device.deviceId,
      hydrate,
      onReady: ready,
    });
    await refresh.setDevices([{ deviceId: 'cloud-a', incarnation: 1 }]);

    const staleRun = refresh.refresh('cloud-a', 1);
    await refresh.setDevices([]);
    await refresh.setDevices([{ deviceId: 'cloud-a', incarnation: 2 }]);
    void refresh.refresh('cloud-a', 2);

    firstHydration.resolve({ failure: null });
    await staleRun;
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    expect(ready).not.toHaveBeenCalled();

    secondHydration.resolve({ failure: null });
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(ready).toHaveBeenCalledWith('cloud-a', {
      deviceId: 'cloud-a',
      incarnation: 2,
    });
  });

  it('prunes UI readiness when the authoritative candidate list drops a peer', () => {
    const current = new Set(['cloud-a', 'cloud-b']);

    expect(pruneHomePeerReady(current, new Set(['cloud-b']))).toEqual(new Set(['cloud-b']));
    expect(pruneHomePeerReady(current, new Set(['cloud-a', 'cloud-b']))).toBe(current);
  });

  it('promotes successful offline hydration without overwriting newer device fields', () => {
    const fallback = {
      appVersion: '0.1.0',
      busy: false,
      deviceId: 'cloud-a',
      deviceInfo: { kind: 'cloud' as const },
      isSelf: false,
      lastSeenAt: 'old',
      name: 'stale name',
      online: false,
      platform: 'linux',
      remoteControlEnabled: false,
      selfName: null,
    } satisfies DeviceView;
    const current = {
      ...fallback,
      name: 'newer name',
    };

    expect(promoteRecoveredHomeDevice(current, fallback, 'recovered')).toEqual({
      ...current,
      lastSeenAt: 'recovered',
      online: true,
      remoteControlEnabled: true,
    });
  });
});

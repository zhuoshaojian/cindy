// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createReconcileBackoff,
  nextArchivedSessionRetryDelay,
  nextSessionListTokenRetryDelay,
  resolveIneligibleRemoteProjectAction,
  selectRemoteProjectShardsMissingFromDirectory,
  startRemoteSessionsReconciler,
  startSessionListTokenRefresh,
  useDeviceLinkRemoteProjects,
} from '@/features/device-link/useDeviceLinkRemoteProjects';
import { remoteProjectsStore } from '@/features/device-link/remoteProjectsStore';
import {
  __resetCloudInstanceRendererAuthorityForTest,
  markCloudInstanceRendererAuthorityUnknown,
  publishCloudInstanceRendererAuthority,
} from '@/features/cloud-instance/cloudInstanceRendererAuthority';
import {
  __testing as dataOwnerGenerationTesting,
  getDataOwnerGeneration,
  setDataOwnerGeneration,
} from '@/contexts/dataOwnerGeneration';
import { readCachedSessionList } from '@/features/device-link/mirrorCacheClient';

const authState = vi.hoisted(() => ({ dataOwnerId: 'owner-a' as string | null }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    deviceId: 'self-device',
    dataOwnerId: authState.dataOwnerId,
  }),
}));
vi.mock('@/features/device-link/mirrorCacheClient', () => ({
  cancelSessionListPersist: vi.fn(),
  clearCachedDevice: vi.fn(),
  clearMirrorCacheAccountState: vi.fn(),
  readCachedSessionList: vi.fn(async () => []),
  scheduleSessionListPersist: vi.fn(),
  sessionListOwnerTokensReady: vi.fn(() => true),
}));
vi.mock('@/hooks/useAgentCapabilities', () => ({
  evictDeviceCapabilities: vi.fn(),
  prefetchDeviceCapabilities: vi.fn(),
}));
vi.mock('@/hooks/useDeviceProviders', () => ({
  evictDeviceProviders: vi.fn(),
  prefetchDeviceProviders: vi.fn(),
}));
vi.mock('@/hooks/useGitSafetySettings', () => ({
  evictDeviceGitSafetySettings: vi.fn(),
  prefetchDeviceGitSafetySettings: vi.fn(),
}));

type PresenceListener = (snapshot: DeviceLinkPresenceSnapshot) => void;
let presenceListener: PresenceListener | null = null;
let listDevices: ReturnType<typeof vi.fn>;
let invoke: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  authState.dataOwnerId = 'owner-a';
  dataOwnerGenerationTesting.reset();
  setDataOwnerGeneration('owner-a', 1);
  __resetCloudInstanceRendererAuthorityForTest();
  presenceListener = null;
  listDevices = vi.fn(() => new Promise(() => {}));
  invoke = vi.fn(() => new Promise(() => {}));
  subscribe = vi.fn(async () => ({ ok: true }));
  unsubscribe = vi.fn(async () => ({ ok: true }));
  vi.mocked(readCachedSessionList).mockReset().mockResolvedValue([]);
  remoteProjectsStore.clear();
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      deviceLink: {
        getState: vi.fn(() => new Promise(() => {})),
        invoke,
        listDevices,
        onAccessRevoked: vi.fn(() => vi.fn()),
        onControlTargetChanged: vi.fn(() => vi.fn()),
        onPresenceChanged: vi.fn((listener: PresenceListener) => {
          presenceListener = listener;
          return vi.fn();
        }),
        onRemotePush: vi.fn(() => vi.fn()),
        onResponsivenessChanged: vi.fn(() => vi.fn()),
        onStatusChanged: vi.fn(() => vi.fn()),
        subscribe,
        unsubscribe,
      },
    },
  });
});

afterEach(() => {
  cleanup();
  remoteProjectsStore.clear();
  __resetCloudInstanceRendererAuthorityForTest();
  dataOwnerGenerationTesting.reset();
  vi.useRealTimers();
});

describe('session-list owner token retry backoff', () => {
  it('从 2s 指数退避到 30s 后仍持续恢复,cleanup 停旧循环,新账号从 2s 重启', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const stop = startSessionListTokenRefresh(refresh, () => false);
    await vi.advanceTimersByTimeAsync(0); // 首次立即补读
    expect(refresh).toHaveBeenCalledTimes(1);

    // 实际循环的间隔序列:2s → 4s → 8s → 16s → 30s → 30s,封顶后不停止。
    for (const [index, delay] of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(refresh).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(refresh).toHaveBeenCalledTimes(index + 2);
    }

    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(7); // 旧账号 timer 已取消

    // effect 在新账号边界重建启动器:立即补读一次,首次重试重新回到 2s(不是继承 30s)。
    const stopNextOwner = startSessionListTokenRefresh(refresh, () => false);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(refresh).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(9);
    stopNextOwner();
  });

  it('readiness 就位后不再排后续补读', async () => {
    vi.useFakeTimers();
    let ready = false;
    const refresh = vi.fn(async () => {
      ready = true;
    });
    const stop = startSessionListTokenRefresh(refresh, () => ready);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('纯延迟函数保持 2s 到 30s 封顶', () => {
    const delays: number[] = [];
    let previous = 0;
    for (let i = 0; i < 7; i += 1) {
      previous = nextSessionListTokenRetryDelay(previous);
      delays.push(previous);
    }
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});

describe('archived session retry backoff', () => {
  it('从 2s 指数退避到 30s，并在成功或生命周期清理后可从首档重启', () => {
    const delays: number[] = [];
    let previous = 0;
    for (let i = 0; i < 7; i += 1) {
      previous = nextArchivedSessionRetryDelay(previous);
      delays.push(previous);
    }
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(nextArchivedSessionRetryDelay(0)).toBe(2_000);
  });
});

describe('startRemoteSessionsReconciler', () => {
  it('periodically refreshes every eligible device and stops cleanly', async () => {
    vi.useFakeTimers();
    const eligible = new Map([
      ['dev-a', 'Mac A'],
      ['dev-b', 'Mac B'],
    ]);
    const refresh = vi.fn(async () => 'ok');
    const stop = startRemoteSessionsReconciler(() => eligible, refresh, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh.mock.calls).toEqual([
      ['dev-a', 'Mac A'],
      ['dev-b', 'Mac B'],
    ]);

    eligible.delete('dev-a');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenLastCalledWith('dev-b', 'Mac B');
    expect(refresh).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('counts one coalesced refresh failure once when periodic ticks overlap', async () => {
    vi.useFakeTimers();
    const eligible = new Map([['dev-a', 'Mac A']]);
    let rejectRefresh!: (error: Error) => void;
    const pending = new Promise<unknown>((_, reject) => {
      rejectRefresh = reject;
    });
    const refresh = vi.fn(() => pending);
    const backoff = createReconcileBackoff({
      baseMs: 1_000,
      maxMs: 8_000,
      jitter: (delay) => delay,
      now: () => Date.now(),
    });
    const stop = startRemoteSessionsReconciler(() => eligible, refresh, 1_000, backoff);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    rejectRefresh(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
  });

  it('连续 gave-up 的设备按指数退避放慢,成功后复位;其它设备不受影响', async () => {
    vi.useFakeTimers();
    const eligible = new Map([
      ['dev-bad', 'Mac Bad'],
      ['dev-good', 'Mac Good'],
    ]);
    let badResult: string = 'gave-up';
    const refresh = vi.fn(async (deviceId: string) =>
      deviceId === 'dev-bad' ? badResult : 'ok',
    );
    // 无抖动 + 假时钟,退避序列确定:失败 1 次后推迟 1s(=base),2 次后 2s,3 次后 4s…
    const backoff = createReconcileBackoff({
      baseMs: 1_000,
      maxMs: 8_000,
      jitter: (d) => d,
      now: () => Date.now(),
    });
    const stop = startRemoteSessionsReconciler(() => eligible, refresh, 1_000, backoff);

    const badCalls = () => refresh.mock.calls.filter(([id]) => id === 'dev-bad').length;
    const goodCalls = () => refresh.mock.calls.filter(([id]) => id === 'dev-good').length;

    // tick1: bad 尝试并失败(退避 1s) → tick2(t=2s)已过退避,再试(失败,退避 2s)
    // → tick3(t=3s)在退避中跳过,tick4(t=4s)再试(失败,退避 4s)→ t=5s/6s/7s 跳过,t=8s 再试
    await vi.advanceTimersByTimeAsync(1_000);
    expect(badCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(badCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(badCalls()).toBe(2); // 退避中
    await vi.advanceTimersByTimeAsync(1_000);
    expect(badCalls()).toBe(3);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(badCalls()).toBe(3); // 退避 4s 中
    await vi.advanceTimersByTimeAsync(1_000);
    expect(badCalls()).toBe(4);

    // good 设备每个 tick 照常对账,不被 bad 的退避拖累
    expect(goodCalls()).toBe(8);

    // bad 恢复:下一次尝试成功后退避复位,恢复逐 tick 对账
    badResult = 'ok';
    await vi.advanceTimersByTimeAsync(8_000);
    const afterRecovery = badCalls();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(badCalls()).toBe(afterRecovery + 2);

    stop();
  });

  it('单次刷新横跨多个 tick 时只发一次、只记账一次(在途合并不重复累计退避)', async () => {
    vi.useFakeTimers();
    const eligible = new Map([['dev-slow', 'Mac Slow']]);
    let settle: ((r: string) => void) | null = null;
    const refresh = vi.fn(
      () => new Promise<string>((resolve) => {
        settle = resolve;
      }),
    );
    const failures: string[] = [];
    const backoff = createReconcileBackoff({ baseMs: 1_000, maxMs: 8_000, jitter: (d) => d });
    const origReport = backoff.report.bind(backoff);
    backoff.report = (deviceId, outcome) => {
      if (outcome === 'failure') failures.push(deviceId);
      origReport(deviceId, outcome);
    };
    const stop = startRemoteSessionsReconciler(() => eligible, refresh, 1_000, backoff);

    // 三个 tick 过去,刷新仍在途:不再重复发起,也没有任何记账
    await vi.advanceTimersByTimeAsync(3_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);

    // 在途请求最终 gave-up:恰好记一次失败
    settle!('gave-up');
    await vi.advanceTimersByTimeAsync(0);
    expect(failures).toEqual(['dev-slow']);
    stop();
  });

  it('抖动结果被 clamp 在 maxMs 内(封顶是硬上限,+15% 不得越过)', () => {
    let at = 0;
    const backoff = createReconcileBackoff({
      baseMs: 1_000,
      maxMs: 8_000,
      jitter: (d) => d * 1.15, // 模拟上向抖动
      now: () => at,
    });
    for (let i = 0; i < 10; i++) backoff.report('dev-a', 'failure');
    at = 8_000; // 恰到封顶值:若 jitter 越过 maxMs,这里仍会是退避中
    expect(backoff.shouldAttempt('dev-a')).toBe(true);
    // 负值抖动防御:不会把 nextEligibleAt 推到过去之前(行为上等价于立即可试)
    const negBackoff = createReconcileBackoff({
      baseMs: 1_000,
      maxMs: 8_000,
      jitter: () => -5_000,
      now: () => 100,
    });
    negBackoff.report('dev-b', 'failure');
    expect(negBackoff.shouldAttempt('dev-b')).toBe(true);
  });

  it('设备移出合格集后退避账本随之清理,重新合格时从零开始', () => {
    let at = 0;
    const backoff = createReconcileBackoff({
      baseMs: 1_000,
      maxMs: 8_000,
      jitter: (d) => d,
      now: () => at,
    });
    backoff.report('dev-a', 'failure');
    backoff.report('dev-a', 'failure');
    expect(backoff.shouldAttempt('dev-a')).toBe(false);
    backoff.retainOnly(new Set(['dev-b']));
    expect(backoff.shouldAttempt('dev-a')).toBe(true);
    // neutral 不改变账本
    backoff.report('dev-b', 'neutral');
    expect(backoff.shouldAttempt('dev-b')).toBe(true);
    // 封顶:多次失败后延迟不超过 maxMs
    for (let i = 0; i < 10; i++) backoff.report('dev-b', 'failure');
    at = 7_999;
    expect(backoff.shouldAttempt('dev-b')).toBe(false);
    at = 8_000;
    expect(backoff.shouldAttempt('dev-b')).toBe(true);
  });
});

describe('resolveIneligibleRemoteProjectAction', () => {
  it('keeps the cached shard when an eligible device goes offline even if the offline row reports remoteControlEnabled=false', () => {
    expect(
      resolveIneligibleRemoteProjectAction({
        wasEligible: true,
        hasCachedShard: true,
        isSelf: false,
        online: false,
        remoteControlEnabled: false,
        disabledControl: false,
      }),
    ).toBe('disconnect');
  });

  it('removes an already disconnected cached shard when control is explicitly disabled later', () => {
    expect(
      resolveIneligibleRemoteProjectAction({
        wasEligible: false,
        hasCachedShard: true,
        isSelf: false,
        online: true,
        remoteControlEnabled: false,
        disabledControl: false,
      }),
    ).toBe('remove');

    expect(
      resolveIneligibleRemoteProjectAction({
        wasEligible: false,
        hasCachedShard: true,
        isSelf: false,
        online: false,
        remoteControlEnabled: false,
        disabledControl: true,
      }),
    ).toBe('remove');
  });
});

describe('successful device-directory reconciliation', () => {
  it('removes a deleted cloud shard while retaining an ordinary offline device still in the directory', () => {
    expect(
      selectRemoteProjectShardsMissingFromDirectory({
        authoritativeDeviceIds: new Set(['desktop-offline']),
        cachedDeviceIds: ['cloud-device-deleted', 'desktop-offline'],
        eligibleDeviceIds: new Set(),
      }),
    ).toEqual(['cloud-device-deleted']);
  });

  it('retains a presence-owned device when a directory response temporarily omits it', () => {
    expect(
      selectRemoteProjectShardsMissingFromDirectory({
        authoritativeDeviceIds: new Set(),
        cachedDeviceIds: ['desktop-live'],
        eligibleDeviceIds: new Set(['desktop-live']),
      }),
    ).toEqual([]);
  });

  it('debounces offline presence, retains shards on directory failure, and removes only confirmed absence', async () => {
    vi.useFakeTimers();
    let rejectFirstDirectoryRead!: (reason?: unknown) => void;
    const firstDirectoryRead = new Promise<never>((_resolve, reject) => {
      rejectFirstDirectoryRead = reject;
    });
    remoteProjectsStore.setDeviceSessions(
      'cloud-device-deleted',
      'Cloud',
      [{ id: 'cloud-session', status: 'active' }] as never,
      'active',
      'cloud',
    );
    remoteProjectsStore.setDeviceSessions('desktop-offline', 'Desktop', [
      { id: 'desktop-session', status: 'active' },
    ] as never);
    listDevices.mockReturnValueOnce(firstDirectoryRead).mockResolvedValueOnce({
      devices: [
        {
          deviceId: 'desktop-offline',
          name: 'Desktop',
          online: false,
          remoteControlEnabled: true,
          controlEnabled: true,
          isSelf: false,
          platform: 'darwin',
          appVersion: '1.0.0',
          lastSeenAt: null,
          busy: false,
        },
      ],
    });

    const mounted = renderHook(() => useDeviceLinkRemoteProjects());
    expect(presenceListener).not.toBeNull();
    const offlineCloud = {
      deviceId: 'cloud-device-deleted',
      deviceName: 'Cloud',
      online: false,
      platform: 'linux',
      appVersion: '1.0.0',
      lastSeenAt: Date.now(),
      remoteControlEnabled: false,
      busy: false,
      deviceInfo: { kind: 'cloud' as const },
    };

    act(() => {
      presenceListener?.(offlineCloud);
      presenceListener?.(offlineCloud);
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(listDevices).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(listDevices).toHaveBeenCalledTimes(1);
    expect(remoteProjectsStore.hasDevice('cloud-device-deleted')).toBe(true);
    expect(remoteProjectsStore.hasDevice('desktop-offline')).toBe(true);

    // A slow authoritative read must absorb the rest of the same offline storm.
    act(() => presenceListener?.(offlineCloud));
    await vi.advanceTimersByTimeAsync(300);
    expect(listDevices).toHaveBeenCalledTimes(1);
    rejectFirstDirectoryRead(new Error('relay unavailable'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(remoteProjectsStore.hasDevice('cloud-device-deleted')).toBe(true);

    act(() => presenceListener?.(offlineCloud));
    await vi.advanceTimersByTimeAsync(300);
    expect(listDevices).toHaveBeenCalledTimes(2);
    expect(remoteProjectsStore.hasDevice('cloud-device-deleted')).toBe(false);
    expect(remoteProjectsStore.hasDevice('desktop-offline')).toBe(true);

    mounted.unmount();
    act(() => presenceListener?.(offlineCloud));
    await vi.advanceTimersByTimeAsync(300);
    expect(listDevices).toHaveBeenCalledTimes(2);
  });
});

describe('owner-scoped cloud-instance authority', () => {
  const cloudPresence = (deviceId: string, online: boolean): DeviceLinkPresenceSnapshot => ({
    deviceId,
    deviceName: 'Cloud',
    online,
    platform: 'linux',
    appVersion: '1.0.0',
    lastSeenAt: Date.now(),
    remoteControlEnabled: online,
    busy: false,
    deviceInfo: { kind: 'cloud' },
  });

  it('removes a retired cloud shard and blocks a fresh-epoch rejoin without affecting another peer', async () => {
    let resolveOldRefresh!: (value: unknown) => void;
    invoke.mockImplementation(
      (deviceId: string) =>
        deviceId === 'cloud-old'
          ? new Promise((resolve) => {
              resolveOldRefresh = resolve;
            })
          : new Promise(() => {}),
    );
    const owner = getDataOwnerGeneration();
    publishCloudInstanceRendererAuthority(owner, ['cloud-old', 'cloud-live']);
    remoteProjectsStore.setDeviceSessions(
      'cloud-old',
      'Old Cloud',
      [{ id: 'old-session', status: 'active' }] as never,
      'active',
      'cloud',
    );
    remoteProjectsStore.setDeviceSessions('desktop-peer', 'Desktop Peer', [
      { id: 'desktop-session', status: 'active' },
    ] as never);
    remoteProjectsStore.setDeviceSessions(
      'cloud-live',
      'Live Cloud',
      [{ id: 'live-session', status: 'active' }] as never,
      'active',
      'cloud',
    );

    const mounted = renderHook(() => useDeviceLinkRemoteProjects());
    act(() => presenceListener?.(cloudPresence('cloud-old', true)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledWith(
      'cloud-old',
      'local-db:sessions:list',
      expect.any(Array),
    );

    act(() => publishCloudInstanceRendererAuthority(owner, ['cloud-live']));
    expect(remoteProjectsStore.hasDevice('cloud-old')).toBe(false);
    expect(remoteProjectsStore.hasDevice('desktop-peer')).toBe(true);
    expect(remoteProjectsStore.hasDevice('cloud-live')).toBe(true);
    expect(unsubscribe).toHaveBeenCalledWith('cloud-old', ['sessions']);
    expect(unsubscribe).not.toHaveBeenCalledWith('desktop-peer', expect.anything());
    expect(unsubscribe).not.toHaveBeenCalledWith('cloud-live', expect.anything());

    // The request started while the old Pod was still eligible. Its response
    // cannot rebuild the shard after authority invalidated that device epoch.
    resolveOldRefresh([]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(remoteProjectsStore.hasDevice('cloud-old')).toBe(false);

    // A late online presence must not start a new epoch/refresh either.
    const callsBeforeLatePresence = invoke.mock.calls.length;
    act(() => presenceListener?.(cloudPresence('cloud-old', true)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledTimes(callsBeforeLatePresence);
    expect(remoteProjectsStore.hasDevice('cloud-old')).toBe(false);
    expect(remoteProjectsStore.hasDevice('desktop-peer')).toBe(true);
    expect(remoteProjectsStore.hasDevice('cloud-live')).toBe(true);
    mounted.unmount();
  });

  it('keeps a sleeping active cloud shard as a disconnected cache', () => {
    publishCloudInstanceRendererAuthority(getDataOwnerGeneration(), ['cloud-sleeping']);
    remoteProjectsStore.setDeviceSessions(
      'cloud-sleeping',
      'Sleeping Cloud',
      [{ id: 'sleep-session', status: 'active' }] as never,
      'active',
      'cloud',
    );

    const mounted = renderHook(() => useDeviceLinkRemoteProjects());
    act(() => presenceListener?.(cloudPresence('cloud-sleeping', false)));

    expect(remoteProjectsStore.hasDevice('cloud-sleeping')).toBe(true);
    expect(remoteProjectsStore.getDeviceSessions('cloud-sleeping')).toEqual([
      expect.objectContaining({
        id: 'sleep-session',
        deviceLinkConnectionStatus: 'disconnected',
      }),
    ]);
    expect(unsubscribe).not.toHaveBeenCalledWith('cloud-sleeping', expect.anything());
    mounted.unmount();
  });

  it('fails open before the first successful list and after a later list failure', () => {
    const owner = getDataOwnerGeneration();
    remoteProjectsStore.setDeviceSessions(
      'cloud-before-list',
      'Cloud Before List',
      [{ id: 'before-list-session', status: 'active' }] as never,
      'active',
      'cloud',
    );
    const mounted = renderHook(() => useDeviceLinkRemoteProjects());
    act(() => presenceListener?.(cloudPresence('cloud-before-list', false)));
    expect(remoteProjectsStore.hasDevice('cloud-before-list')).toBe(true);

    publishCloudInstanceRendererAuthority(owner, ['cloud-active']);
    markCloudInstanceRendererAuthorityUnknown(owner);
    remoteProjectsStore.setDeviceSessions(
      'cloud-during-outage',
      'Cloud During Outage',
      [{ id: 'outage-session', status: 'active' }] as never,
      'active',
      'cloud',
    );
    act(() => presenceListener?.(cloudPresence('cloud-during-outage', false)));
    expect(remoteProjectsStore.hasDevice('cloud-during-outage')).toBe(true);
    mounted.unmount();
  });

  it('does not apply a previous owner authority set after an account switch', () => {
    publishCloudInstanceRendererAuthority(getDataOwnerGeneration(), []);
    authState.dataOwnerId = 'owner-b';
    setDataOwnerGeneration('owner-b', 2);
    remoteProjectsStore.setDeviceSessions(
      'cloud-owner-b',
      'Owner B Cloud',
      [{ id: 'owner-b-session', status: 'active' }] as never,
      'active',
      'cloud',
    );

    const mounted = renderHook(() => useDeviceLinkRemoteProjects());
    act(() => presenceListener?.(cloudPresence('cloud-owner-b', false)));
    expect(remoteProjectsStore.hasDevice('cloud-owner-b')).toBe(true);
    mounted.unmount();
  });

  it('filters a retired cloud cache hydration but preserves active cloud and non-cloud caches', async () => {
    let resolveCache!: (value: Awaited<ReturnType<typeof readCachedSessionList>>) => void;
    vi.mocked(readCachedSessionList).mockReturnValue(
      new Promise((resolve) => {
        resolveCache = resolve;
      }),
    );
    publishCloudInstanceRendererAuthority(getDataOwnerGeneration(), ['cloud-active']);
    const mounted = renderHook(() => useDeviceLinkRemoteProjects());

    resolveCache([
      {
        deviceId: 'cloud-retired',
        deviceName: 'Retired Cloud',
        kind: 'cloud',
        sessions: [{ id: 'retired-session', status: 'active' }] as never,
      },
      {
        deviceId: 'cloud-active',
        deviceName: 'Active Cloud',
        kind: 'cloud',
        sessions: [{ id: 'active-session', status: 'active' }] as never,
      },
      {
        deviceId: 'desktop-offline',
        deviceName: 'Desktop Offline',
        sessions: [{ id: 'desktop-session', status: 'active' }] as never,
      },
    ]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(remoteProjectsStore.hasDevice('cloud-retired')).toBe(false);
    expect(remoteProjectsStore.hasDevice('cloud-active')).toBe(true);
    expect(remoteProjectsStore.hasDevice('desktop-offline')).toBe(true);
    mounted.unmount();
  });
});

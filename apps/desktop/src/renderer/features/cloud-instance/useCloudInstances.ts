/**
 * useCloudInstances —— 账号级云端实例的 renderer 状态收口。
 * ---------------------------------------------------------------------------
 * 数据 / 网络 / token 全在 main;这里只调 `electronAPI.cloudInstances`,并 join
 * device-link 全量设备列表判断「就绪」——实例的 stable `deviceId` 在 relay `online`
 * 即代表 Pod 已连上、可对话(控制面 status 仅作诊断,不作可对话终态)。
 * 云端实例的全部变更动作(唤醒 / 休眠 / 删除)与 in-flight 状态由本 hook 单一持有,
 * 消费端(机器切换菜单 / 设置页)只做 UI:按钮、确认框、toast。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractIpcError } from '@/utils/ipcError';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import { remoteProjectsStore } from '@/features/device-link/remoteProjectsStore';
import { revokedDevicesStore } from '@/features/device-link/revokedDevicesStore';
import { removeRemoteSessionActivityForDevice } from '@/features/device-link/remoteSessionActivityStore';
import { setCloudCapability } from '@/features/device-link/cloudCapability';

/** 控制面列出的一个实例(展示模型)。由 electronAPI 返回类型推导,避免跨层类型 import。 */
export type CloudInstanceView = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['list']>
>['instances'][number];
export type CloudInstanceWakeResult = Awaited<
  ReturnType<Window['electronAPI']['cloudInstances']['wake']>
>;

/** 端点未配置 → unsupported(隐藏入口);首次加载 → loading;正常 → ready;其它 → error。 */
export type CloudInstancesLoadState = 'loading' | 'ready' | 'unsupported' | 'error';

export type CloudInstanceAction = 'wake' | 'stop' | 'delete';

/** in-flight 动作:target 为 instanceId,首次唤醒(自动建)为 'new';空闲为 null。 */
export type CloudInstancePendingState = {
  target: string | 'new';
  action: CloudInstanceAction;
} | null;

/** Endpoint absence and server-side capability disablement both hide cloud UI. */
export function isCloudInstancesUnsupportedError(error: unknown): boolean {
  const ipcError = extractIpcError(error);
  return ipcError?.code === 'UNSUPPORTED_CAPABILITY' || ipcError?.code === 'CLOUD_INSTANCE_DISABLED';
}

export interface UseCloudInstances {
  instances: CloudInstanceView[];
  loadState: CloudInstancesLoadState;
  pending: CloudInstancePendingState;
  /** relay 上 online(可对话)的 deviceId 集合。 */
  onlineDeviceIds: Set<string>;
  wake: (instanceId?: string) => Promise<CloudInstanceWakeResult | undefined>;
  stopInstance: (instanceId: string) => Promise<void>;
  deleteInstance: (instanceId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCloudInstances(enabled = true): UseCloudInstances {
  const [instances, setInstances] = useState<CloudInstanceView[]>([]);
  const [loadState, setLoadState] = useState<CloudInstancesLoadState>('loading');
  const [pending, setPending] = useState<CloudInstancePendingState>(null);
  const pendingRef = useRef<CloudInstancePendingState>(null);
  const deviceList = useDeviceLinkDeviceList();

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { instances: next } = await window.electronAPI.cloudInstances.list();
      setInstances(next);
      setLoadState('ready');
    } catch (error) {
      if (isCloudInstancesUnsupportedError(error)) {
        setInstances([]);
        setLoadState('unsupported');
      } else {
        setLoadState('error');
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const onlineDeviceIds = useMemo(
    () => new Set((deviceList ?? []).filter((device) => device.online).map((device) => device.deviceId)),
    [deviceList],
  );
  useEffect(() => {
    if (loadState === 'unsupported') {
      setCloudCapability(
        true,
        new Set(
          (deviceList ?? [])
            .filter((device) => device.deviceInfo?.kind === 'cloud')
            .map((device) => device.deviceId),
        ),
      );
    } else if (loadState === 'ready') {
      setCloudCapability(false);
    }
  }, [deviceList, loadState]);

  // 统一动作骨架:防重(pending 期间拒绝新动作)→ 执行 → 成功后刷新列表 → 清 pending。
  // 判重用 ref 而非 state:setState 异步,同一 render tick 内连点两次会读到未更新的
  // pending 而重复发 IPC;ref 同步写保证第二次调用立即被挡(state 仅供 UI 渲染)。
  // 失败向调用方抛出,由调用方决定用户反馈(菜单 / 设置页的 toast 文案不同)。
  const runAction = useCallback(
    async <T,>(
      target: string | 'new',
      action: CloudInstanceAction,
      op: () => Promise<T>,
    ): Promise<T | undefined> => {
      if (pendingRef.current) return undefined;
      const nextPending = { target, action } as const;
      pendingRef.current = nextPending;
      setPending(nextPending);
      try {
        const result = await op();
        await refresh();
        return result;
      } finally {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [refresh],
  );

  const wake = useCallback(
    (instanceId?: string) =>
      runAction(instanceId ?? 'new', 'wake', () =>
        window.electronAPI.cloudInstances.wake(instanceId ? { instanceId } : {}),
      ),
    [runAction],
  );

  const stopInstance = useCallback(
    async (instanceId: string) => {
      await runAction(instanceId, 'stop', () =>
        window.electronAPI.cloudInstances.stop({ instanceId }),
      );
    },
    [runAction],
  );

  const deleteInstance = useCallback(
    async (instanceId: string) => {
      const target = instances.find((instance) => instance.instanceId === instanceId);
      await runAction(instanceId, 'delete', () =>
        window.electronAPI.cloudInstances.delete({ instanceId }),
      );
      // 控制面清了服务端(容器/store/auth/relay 档案),main 清了设备名缓存;
      // 这里补齐本 renderer 的最后一层:同步分片 / 会话活动 / 被拒标记 ——
      // 否则已删云端会以分片缓存旧名(裸 'Cloud')的断线幽灵行再现于机器菜单。
      // 仅发起端收敛;其它在线客户端的收敛仍依赖后续的 device-removed 推送(已记录)。
      if (target) {
        remoteProjectsStore.removeDevice(target.deviceId);
        removeRemoteSessionActivityForDevice(target.deviceId);
        revokedDevicesStore.clearRevoked(target.deviceId);
      }
    },
    [instances, runAction],
  );

  return { instances, loadState, pending, onlineDeviceIds, wake, stopInstance, deleteInstance, refresh };
}

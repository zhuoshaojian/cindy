import { CLOUD_DEVICE_NAME_SENTINEL } from './deviceList.js';

/** 长动作终态轮询间隔；两端共享，避免进度语义漂移。 */
export const CLOUD_ACTION_WATCH_POLL_INTERVAL_MS = 5_000;

/**
 * 唤醒 / 休眠受理到 presence + runtime 终态通常约一分钟。180s 既容纳
 * 常规启停波动，又能在失败时恢复入口，不让按钮永久禁用。
 */
export const CLOUD_ACTION_WATCH_TIMEOUT_MS = 180_000;

/**
 * 重建包含 delete + create 两段长操作，且要等旧 instanceId 消失与新 deviceId
 * 上线同时成立，因此给 300s 独立预算。
 */
export const CLOUD_REBUILD_WATCH_TIMEOUT_MS = 300_000;

export type CloudInstanceTerminalAction = 'wake' | 'stop' | 'rebuild';

export type CloudInstanceTerminalWatch =
  | {
      action: 'wake';
      instanceId: string;
      deviceId: string;
    }
  | {
      action: 'stop';
      instanceId: string;
      deviceId: string;
    }
  | {
      action: 'rebuild';
      oldInstanceId: string;
      newInstanceId: string;
      newDeviceId: string;
    };

export interface CloudInstanceTerminalView {
  instanceId: string;
  deviceId: string;
  status: {
    runtimeState?: string | null;
  };
}

export interface CloudInstanceTerminalState {
  instances: readonly CloudInstanceTerminalView[];
  onlineDeviceIds: ReadonlySet<string>;
}

/** 三个长动作的权威终态判定，Desktop / Mobile 共用。 */
export function isCloudInstanceTerminalState(
  watch: CloudInstanceTerminalWatch,
  state: CloudInstanceTerminalState,
): boolean {
  if (watch.action === 'wake') return state.onlineDeviceIds.has(watch.deviceId);
  if (watch.action === 'rebuild') {
    return !state.instances.some((instance) => instance.instanceId === watch.oldInstanceId)
      && state.instances.some((instance) => (
        instance.instanceId === watch.newInstanceId
        && instance.deviceId === watch.newDeviceId
      ))
      && state.onlineDeviceIds.has(watch.newDeviceId);
  }
  const target = state.instances.find((instance) => instance.instanceId === watch.instanceId);
  return target !== undefined
    && typeof target.status.runtimeState === 'string'
    && target.status.runtimeState !== 'running'
    && !state.onlineDeviceIds.has(watch.deviceId);
}

export class CloudInstanceActionTimeoutError extends Error {
  readonly action: CloudInstanceTerminalAction;

  constructor(action: CloudInstanceTerminalAction) {
    super(`cloud instance ${action} did not reach its terminal state in time`);
    this.name = 'CloudInstanceActionTimeoutError';
    this.action = action;
  }
}

export interface WaitForCloudInstanceTerminalStateOptions {
  watch: CloudInstanceTerminalWatch;
  getState(): CloudInstanceTerminalState;
  refresh(): Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortSignal = signal;
    if (abortSignal?.aborted) {
      reject(abortSignal.reason ?? new Error('cloud instance action watch aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortSignal?.reason ?? new Error('cloud instance action watch aborted'));
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 有界 anti-entropy watch：启动时先查终态，未完成才按固定间隔刷新权威列表。
 * 超时抛可识别错误，由各端用既有 toast / Alert 告知用户并恢复按钮。
 */
export async function waitForCloudInstanceTerminalState(
  options: WaitForCloudInstanceTerminalStateOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? (
    options.watch.action === 'rebuild'
      ? CLOUD_REBUILD_WATCH_TIMEOUT_MS
      : CLOUD_ACTION_WATCH_TIMEOUT_MS
  );
  const pollIntervalMs = options.pollIntervalMs ?? CLOUD_ACTION_WATCH_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  while (!isCloudInstanceTerminalState(options.watch, options.getState())) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new CloudInstanceActionTimeoutError(options.watch.action);
    await waitForDelay(Math.min(pollIntervalMs, remaining), options.signal);
    await options.refresh().catch(() => undefined);
  }
}

/**
 * Extract the explicit tag from a container image reference without guessing
 * `latest`. Digest-qualified refs keep the tag before `@sha256:...`.
 */
export function parseCloudInstanceImageTag(
  image: string | null | undefined,
): string | null {
  const value = image?.trim();
  if (!value) return null;
  const digestSeparator = value.indexOf('@');
  const name = digestSeparator >= 0 ? value.slice(0, digestSeparator) : value;
  const lastSlash = name.lastIndexOf('/');
  const tagSeparator = name.lastIndexOf(':');
  if (tagSeparator <= lastSlash) return null;
  const tag = name.slice(tagSeparator + 1);
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag) ? tag : null;
}

/** Control-plane naming metadata joined to a relay device by stable deviceId. */
export interface CloudInstanceNameMetadata {
  customLabel: string | null;
  nameSequence: number;
}

/**
 * Pure, locale-free cloud instance name presentation.
 *
 * UI hosts translate `default` with their viewer locale, render `custom`
 * verbatim, and resolve `fallback` through the existing generic cloud-device
 * sentinel when control-plane metadata is unavailable or malformed.
 */
export type CloudInstanceNameDescriptor =
  | { kind: 'custom'; label: string }
  | { kind: 'default'; sequence: number }
  | { kind: 'fallback'; name: typeof CLOUD_DEVICE_NAME_SENTINEL };

export function describeCloudInstanceName(
  metadata: CloudInstanceNameMetadata | null | undefined,
): CloudInstanceNameDescriptor {
  if (
    !metadata ||
    !Number.isInteger(metadata.nameSequence) ||
    metadata.nameSequence < 1
  ) {
    return { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL };
  }
  if (typeof metadata.customLabel === 'string') {
    return metadata.customLabel.length > 0
      ? { kind: 'custom', label: metadata.customLabel }
      : { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL };
  }
  if (metadata.customLabel !== null) {
    return { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL };
  }
  return { kind: 'default', sequence: metadata.nameSequence };
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLOUD_DEVICE_NAME_SENTINEL } from '../deviceList.js';
import {
  CloudInstanceActionTimeoutError,
  describeCloudInstanceName,
  isCloudInstanceTerminalState,
  parseCloudInstanceImageTag,
  waitForCloudInstanceTerminalState,
} from '../cloudInstance.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('cloud instance lifecycle terminal state', () => {
  const running = {
    instanceId: 'old-instance',
    deviceId: 'old-device',
    status: { runtimeState: 'running' },
  };

  it('waits for wake presence and for stop runtime + presence together', () => {
    expect(isCloudInstanceTerminalState(
      { action: 'wake', instanceId: 'old-instance', deviceId: 'old-device' },
      { instances: [running], onlineDeviceIds: new Set() },
    )).toBe(false);
    expect(isCloudInstanceTerminalState(
      { action: 'wake', instanceId: 'old-instance', deviceId: 'old-device' },
      { instances: [running], onlineDeviceIds: new Set(['old-device']) },
    )).toBe(true);

    expect(isCloudInstanceTerminalState(
      { action: 'stop', instanceId: 'old-instance', deviceId: 'old-device' },
      {
        instances: [{ ...running, status: { runtimeState: 'stopped' } }],
        onlineDeviceIds: new Set(['old-device']),
      },
    )).toBe(false);
    expect(isCloudInstanceTerminalState(
      { action: 'stop', instanceId: 'old-instance', deviceId: 'old-device' },
      {
        instances: [{ ...running, status: { runtimeState: 'stopped' } }],
        onlineDeviceIds: new Set(),
      },
    )).toBe(true);
  });

  it('requires the old rebuild instance to disappear and the new device to be online', () => {
    const watch = {
      action: 'rebuild' as const,
      oldInstanceId: 'old-instance',
      newInstanceId: 'new-instance',
      newDeviceId: 'new-device',
    };
    expect(isCloudInstanceTerminalState(watch, {
      instances: [running],
      onlineDeviceIds: new Set(['new-device']),
    })).toBe(false);
    expect(isCloudInstanceTerminalState(watch, {
      instances: [{
        instanceId: 'new-instance',
        deviceId: 'new-device',
        status: { runtimeState: 'running' },
      }],
      onlineDeviceIds: new Set(),
    })).toBe(false);
    expect(isCloudInstanceTerminalState(watch, {
      instances: [{
        instanceId: 'new-instance',
        deviceId: 'new-device',
        status: { runtimeState: 'running' },
      }],
      onlineDeviceIds: new Set(['new-device']),
    })).toBe(true);
  });

  it('checks immediately, polls with a bound, and reports timeout', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const waiting = waitForCloudInstanceTerminalState({
      watch: { action: 'wake', instanceId: 'old-instance', deviceId: 'old-device' },
      getState: () => ({ instances: [running], onlineDeviceIds: new Set() }),
      refresh,
      pollIntervalMs: 10,
      timeoutMs: 25,
    });
    expect(refresh).not.toHaveBeenCalled();
    const timedOut = expect(waiting).rejects.toBeInstanceOf(CloudInstanceActionTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await timedOut;
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});

describe('cloud instance image tag', () => {
  it.each([
    ['registry.example/public/cindy-cloud:0.1.7@sha256:abc', '0.1.7'],
    ['localhost:5000/cindy-cloud:dev-b390b09-packaged', 'dev-b390b09-packaged'],
    ['cindy-cloud:release_candidate-1', 'release_candidate-1'],
  ])('extracts an explicit tag from %s', (image, expected) => {
    expect(parseCloudInstanceImageTag(image)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'registry.example/public/cindy-cloud',
    'registry.example/public/cindy-cloud@sha256:abc',
    'registry.example/public/cindy-cloud:bad tag',
  ])('returns null when no valid explicit tag can be parsed from %s', (image) => {
    expect(parseCloudInstanceImageTag(image)).toBeNull();
  });
});

describe('cloud instance name descriptor', () => {
  it('preserves a user custom label verbatim', () => {
    expect(
      describeCloudInstanceName({
        nameSequence: 2,
        customLabel: '  Build Pod  ',
      }),
    ).toEqual({ kind: 'custom', label: '  Build Pod  ' });
  });

  it('describes an ordinal default without choosing a locale', () => {
    expect(describeCloudInstanceName({ nameSequence: 3, customLabel: null })).toEqual({
      kind: 'default',
      sequence: 3,
    });
  });

  it.each([
    null,
    undefined,
    { nameSequence: 0, customLabel: null },
    { nameSequence: 1.5, customLabel: null },
    { nameSequence: 1, customLabel: '' },
    { nameSequence: 1, customLabel: undefined },
  ])(
    'falls back to the existing generic sentinel for unavailable or malformed metadata',
    (metadata) => {
      expect(
        describeCloudInstanceName(
          metadata as unknown as Parameters<typeof describeCloudInstanceName>[0],
        ),
      ).toEqual({
        kind: 'fallback',
        name: CLOUD_DEVICE_NAME_SENTINEL,
      });
    },
  );
});

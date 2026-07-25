import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => unknown>(),
  assertTrustedAppRendererEvent: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (event: unknown, input?: unknown) => unknown) => {
        mocks.handlers.set(channel, handler);
      },
    ),
  },
}));

vi.mock('../../security/trustedAppRenderer.js', () => ({
  assertTrustedAppRendererEvent: mocks.assertTrustedAppRendererEvent,
}));

import { CLOUD_INSTANCE_INVOKE } from '../../../shared/cloudInstanceIpc.js';
import type { CloudInstanceClient } from '../client.js';
import { registerCloudInstanceIpc, type CloudInstanceIpcDeps } from '../ipc.js';

function deps(): CloudInstanceIpcDeps {
  return {
    getAccessToken: vi.fn(() => 'resource-access-test'),
    client: {
      list: vi.fn().mockResolvedValue({ instances: [] }),
      wake: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      status: vi.fn(),
      stop: vi.fn(),
      delete: vi.fn(),
    } as unknown as CloudInstanceClient,
    forgetDeviceName: vi.fn(async () => true),
  };
}

describe('cloud instance IPC registration', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.assertTrustedAppRendererEvent.mockReset();
  });

  it('guards every fixed channel with the trusted top-level Renderer check', async () => {
    const testDeps = deps();
    registerCloudInstanceIpc(testDeps);
    expect([...mocks.handlers.keys()].sort()).toEqual(
      Object.values(CLOUD_INSTANCE_INVOKE).sort(),
    );

    const event = { senderFrame: { url: 'file:///renderer/index.html' } };
    await mocks.handlers.get(CLOUD_INSTANCE_INVOKE.LIST)?.(event);

    expect(mocks.assertTrustedAppRendererEvent).toHaveBeenCalledWith(event);
    expect(testDeps.client.list).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted sender before any control-plane request', () => {
    const testDeps = deps();
    const denied = Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
    mocks.assertTrustedAppRendererEvent.mockImplementation(() => {
      throw denied;
    });
    registerCloudInstanceIpc(testDeps);

    expect(() =>
      mocks.handlers.get(CLOUD_INSTANCE_INVOKE.WAKE)?.({}, { instanceId: 'instance-1' }),
    ).toThrow(denied);
    expect(testDeps.client.wake).not.toHaveBeenCalled();
  });
});

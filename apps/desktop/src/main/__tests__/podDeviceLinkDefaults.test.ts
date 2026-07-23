import { describe, expect, it, vi } from 'vitest';

import {
  initializePodDeviceLink,
  resolveDeviceLinkDeviceName,
} from '../device-link/pod-defaults.js';

describe('Pod device-link startup defaults', () => {
  it('initializes device-link before enabling remote control in Pod mode', async () => {
    const events: string[] = [];
    const logger = { info: vi.fn() };
    const setRemoteControlEnabled = vi.fn(async (enabled: boolean) => {
      events.push(`set:${enabled}`);
    });

    await expect(
      initializePodDeviceLink(true, {
        initDeviceLinkService: () => events.push('init'),
        readRemoteControlEnabled: () => {
          events.push('read');
          return false;
        },
        setRemoteControlEnabled,
        logger,
      }),
    ).resolves.toBe(true);

    expect(events).toEqual(['init', 'read', 'set:true']);
    expect(setRemoteControlEnabled).toHaveBeenCalledWith(true);
    expect(logger.info).toHaveBeenCalledWith('Pod device-link remote control enabled');
  });

  it('does not rewrite an already-enabled Pod setting', async () => {
    const initDeviceLinkService = vi.fn();
    const setRemoteControlEnabled = vi.fn();

    await expect(
      initializePodDeviceLink(true, {
        initDeviceLinkService,
        readRemoteControlEnabled: () => true,
        setRemoteControlEnabled,
      }),
    ).resolves.toBe(true);

    expect(initDeviceLinkService).toHaveBeenCalledOnce();
    expect(setRemoteControlEnabled).not.toHaveBeenCalled();
  });

  it('leaves ordinary GUI and headless instances unchanged', async () => {
    const initDeviceLinkService = vi.fn();
    const readRemoteControlEnabled = vi.fn();
    const setRemoteControlEnabled = vi.fn();

    await expect(
      initializePodDeviceLink(false, {
        initDeviceLinkService,
        readRemoteControlEnabled,
        setRemoteControlEnabled,
      }),
    ).resolves.toBe(false);

    expect(initDeviceLinkService).not.toHaveBeenCalled();
    expect(readRemoteControlEnabled).not.toHaveBeenCalled();
    expect(setRemoteControlEnabled).not.toHaveBeenCalled();
  });
});

describe('Pod device-link default name', () => {
  it.each([
    ['zh-CN', '云端'],
    ['en', 'Cloud'],
    ['ja', 'クラウド'],
    ['ko', '클라우드'],
  ] as const)('uses the %s localized Pod name', (locale, expected) => {
    expect(
      resolveDeviceLinkDeviceName({
        podMode: true,
        locale,
        hostname: 'host-name-ignored',
      }),
    ).toBe(expected);
  });

  it('keeps ordinary hostname behavior and its empty fallback', () => {
    expect(
      resolveDeviceLinkDeviceName({
        podMode: false,
        locale: 'zh-CN',
        hostname: '  SiriusMac.local  ',
      }),
    ).toBe('SiriusMac.local');
    expect(
      resolveDeviceLinkDeviceName({
        podMode: false,
        locale: 'en',
        hostname: '   ',
      }),
    ).toBe('Unknown Device');
  });
});

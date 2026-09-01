import { describe, expect, it } from 'vitest';

import {
  CLOUD_DEVICE_NAME_SENTINEL,
  formatCloudDeviceName,
} from '@cindy/maker-shared/device-list';
import {
  formatDesktopDeviceNameList,
  resolveDesktopCloudDeviceName,
  translateDesktopCloudInstanceName,
} from '@/features/cloud-instance/cloudDeviceName';
import zhCN from '../i18n/locales/zh-CN/common.json';

const translate = (key: string): string => {
  if (key === 'settings.devices.cloudDeviceName') return '云端';
  return key;
};

describe('desktop cloud device name presentation', () => {
  it('keeps the legacy sentinel compatible', () => {
    expect(resolveDesktopCloudDeviceName(CLOUD_DEVICE_NAME_SENTINEL, translate)).toBe('云端');
  });

  it('renders an ordinal sentinel without leaking its raw value', () => {
    expect(resolveDesktopCloudDeviceName(formatCloudDeviceName(3), translate)).toBe('云端');
  });

  it('keeps ordinary and manually renamed devices verbatim', () => {
    expect(resolveDesktopCloudDeviceName('Build Pod', translate)).toBe('Build Pod');
  });

  it('never exposes a trusted cloud device id as a user-facing name', () => {
    expect(resolveDesktopCloudDeviceName('cloud-device-f59aba78b4c03b495ac9e9ef', translate)).toBe('云端');
  });

  it('uses the same descriptor translation endpoint for custom/default/fallback names', () => {
    expect(translateDesktopCloudInstanceName(
      { kind: 'custom', label: 'Build Pod' },
      translate,
    )).toBe('Build Pod');
    expect(translateDesktopCloudInstanceName(
      { kind: 'default', sequence: 3 },
      translate,
    )).toBe('云端');
    expect(translateDesktopCloudInstanceName(
      { kind: 'fallback', name: CLOUD_DEVICE_NAME_SENTINEL },
      translate,
    )).toBe('云端');
  });

  it('formats loading and failure banner device lists without leaking cloud sentinels', () => {
    const rawNames = [CLOUD_DEVICE_NAME_SENTINEL, formatCloudDeviceName(5), 'Build Pod'];
    const deviceLabel = formatDesktopDeviceNameList(rawNames, 'zh-CN', translate);
    const failureBanner = zhCN.ccAgent.sidebar.machineSwitcher.tasksLoadFailed.replace(
      '{{device}}',
      deviceLabel,
    );
    const partialFailureBanner = zhCN.ccAgent.sidebar.machineSwitcher.tasksPartiallyFailed.replace(
      '{{device}}',
      deviceLabel,
    );

    expect(deviceLabel).toContain('云端');
    expect(deviceLabel).toContain('Build Pod');
    expect(failureBanner).not.toContain(CLOUD_DEVICE_NAME_SENTINEL);
    expect(partialFailureBanner).not.toContain(formatCloudDeviceName(5));
  });
});

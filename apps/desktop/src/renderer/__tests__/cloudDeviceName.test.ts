import { describe, expect, it } from 'vitest';

import {
  CLOUD_DEVICE_NAME_SENTINEL,
  formatCloudDeviceName,
} from '@cindy/maker-shared/device-list';
import {
  resolveDesktopCloudDeviceName,
  translateDesktopCloudInstanceName,
} from '@/features/cloud-instance/cloudDeviceName';

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
});

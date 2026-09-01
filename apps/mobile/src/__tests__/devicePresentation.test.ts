import { afterAll, describe, expect, it } from 'vitest';

import { resolveMobileDeviceDisplayName, sortCloudDevicesLast } from '@/device-link/devicePresentation';
import {
  CLOUD_DEVICE_ID_PREFIX,
  CLOUD_DEVICE_NAME_SENTINEL,
  formatCloudDeviceName,
} from '@cindy/maker-shared/device-list';
import { i18n } from '@/i18n';

const cloud = {
  busy: false,
  deviceId: 'cloud-device-1',
  isSelf: false,
  lastSeenAt: null,
  name: 'Cloud',
  online: true,
  platform: 'linux',
  remoteControlEnabled: true,
  selfName: 'Cloud',
};

const previousLanguage = i18n.language;

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

describe('mobile cloud device presentation', () => {
  it.each([
    ['zh-CN', '云端'],
    ['zh-TW', '雲端'],
    ['en', 'Cloud'],
    ['ja', 'クラウド'],
    ['ko', '클라우드'],
  ])('localizes the cloud self-name for the %s app catalog', async (locale, expected) => {
    await i18n.changeLanguage(locale);
    expect(resolveMobileDeviceDisplayName(cloud)).toBe(expected);
  });

  it('keeps a manually renamed cloud device unchanged', () => {
    expect(resolveMobileDeviceDisplayName({ ...cloud, name: '工作 Pod' })).toBe('工作 Pod');
  });

  it.each([
    ['zh-CN', '云端'],
    ['zh-TW', '雲端'],
    ['en', 'Cloud'],
    ['ja', 'クラウド'],
    ['ko', '클라우드'],
  ])('ignores a cloud ordinal for the %s app catalog', async (locale, expected) => {
    await i18n.changeLanguage(locale);
    const name = formatCloudDeviceName(3);
    expect(resolveMobileDeviceDisplayName({ ...cloud, name, selfName: name })).toBe(expected);
  });

  it('keeps ordinary devices unchanged', () => {
    expect(resolveMobileDeviceDisplayName({
      ...cloud,
      deviceId: 'desktop-device-1',
      name: '办公室 Mac',
    })).toBe('办公室 Mac');
  });

  it('never exposes a trusted cloud device id as a user-facing name', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(resolveMobileDeviceDisplayName('cloud-device-f59aba78b4c03b495ac9e9ef')).toBe('云端');
  });

  it('normalizes cached and route-param names at user-visible page boundaries', async () => {
    await i18n.changeLanguage('zh-CN');
    expect(resolveMobileDeviceDisplayName(CLOUD_DEVICE_NAME_SENTINEL)).toBe('云端');
    expect(resolveMobileDeviceDisplayName(formatCloudDeviceName(5))).toBe('云端');
    expect(resolveMobileDeviceDisplayName('Build Pod')).toBe('Build Pod');
  });

  it('places cloud devices after ordinary devices without reordering either group', () => {
    const devices = [
      { deviceId: 'desktop-2' },
      { deviceId: `${CLOUD_DEVICE_ID_PREFIX}pod-1` },
      { deviceId: 'desktop-1' },
      { deviceId: `${CLOUD_DEVICE_ID_PREFIX}pod-2` },
    ];
    expect(sortCloudDevicesLast(devices).map((device) => device.deviceId)).toEqual([
      'desktop-2',
      'desktop-1',
      `${CLOUD_DEVICE_ID_PREFIX}pod-1`,
      `${CLOUD_DEVICE_ID_PREFIX}pod-2`,
    ]);
  });

  // 回归:判据曾读调用方带来的 `kind` 字段,设备结构没有该字段时比较子恒为 0、排序静默
  // 空转(首页范围菜单因此没置底)。这两条锁住「只看 deviceId 前缀」。
  it('orders by device id even when no kind field is present', () => {
    expect(sortCloudDevicesLast([
      { deviceId: `${CLOUD_DEVICE_ID_PREFIX}pod-1` },
      { deviceId: 'desktop-1' },
    ]).map((device) => device.deviceId)).toEqual([
      'desktop-1',
      `${CLOUD_DEVICE_ID_PREFIX}pod-1`,
    ]);
  });

  it('ignores a stale kind field that disagrees with the device id', () => {
    expect(sortCloudDevicesLast([
      { deviceId: `${CLOUD_DEVICE_ID_PREFIX}pod-1`, kind: undefined },
      { deviceId: 'desktop-1', kind: 'cloud' },
    ]).map((device) => device.deviceId)).toEqual([
      'desktop-1',
      `${CLOUD_DEVICE_ID_PREFIX}pod-1`,
    ]);
  });
});

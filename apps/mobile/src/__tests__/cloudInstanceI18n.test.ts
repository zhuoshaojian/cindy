import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { CloudInstanceAction } from '@/cloud-instance/cloudInstanceWake';
import { i18n } from '@/i18n';
import enDeviceLink from '@/i18n/locales/en/deviceLink.json';
import jaDeviceLink from '@/i18n/locales/ja/deviceLink.json';
import koDeviceLink from '@/i18n/locales/ko/deviceLink.json';
import zhCNDeviceLink from '@/i18n/locales/zh-CN/deviceLink.json';
import zhTWDeviceLink from '@/i18n/locales/zh-TW/deviceLink.json';

const locales = {
  en: enDeviceLink,
  ja: jaDeviceLink,
  ko: koDeviceLink,
  'zh-CN': zhCNDeviceLink,
  'zh-TW': zhTWDeviceLink,
} as const;

const actions = [
  'wake',
  'stop',
  'upgrade',
  'rebuild',
  'autoUpdate',
  'delete',
] as const satisfies readonly CloudInstanceAction[];
const actionErrorKeys = {
  wake: 'deviceLink.cloudInstance.wakeFailed',
  stop: 'deviceLink.cloudInstance.stopFailed',
  upgrade: 'deviceLink.cloudInstance.updateFailed',
  rebuild: 'deviceLink.cloudInstance.rebuildFailed',
  autoUpdate: 'deviceLink.cloudInstance.autoUpdateFailed',
  delete: 'deviceLink.cloudInstance.deleteFailed',
} as const satisfies Record<CloudInstanceAction, string>;
const useCloudInstancesSource = readFileSync(
  resolve(process.cwd(), 'src/cloud-instance/useCloudInstances.ts'),
  'utf8',
);

const previousLanguage = i18n.language;

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

describe('cloud instance app-language copy', () => {
  it('routes cloud-instance copy through the active app catalog', async () => {
    await i18n.changeLanguage('en');

    expect(i18n.t('deviceLink.cloudInstance.wakeFailed')).toBe(
      enDeviceLink.cloudInstance.wakeFailed,
    );
    expect(i18n.t('deviceLink.cloudInstance.wakeFailed')).not.toBe(
      zhCNDeviceLink.cloudInstance.wakeFailed,
    );
    expect(i18n.t('deviceLink.cloudInstance.cloud')).toBe(enDeviceLink.cloudInstance.cloud);
  });

  it('maps every action to an existing localized failure key', async () => {
    expect(useCloudInstancesSource).toContain(
      '} as const satisfies Record<CloudInstanceAction, string>;',
    );
    expect(useCloudInstancesSource).toContain(
      'i18n.t(CLOUD_INSTANCE_ACTION_ERROR_KEYS[action])',
    );

    for (const [locale, catalog] of Object.entries(locales)) {
      await i18n.changeLanguage(locale);
      const cloudInstance = catalog.cloudInstance as Record<string, string>;
      for (const action of actions) {
        const key = actionErrorKeys[action];
        expect(useCloudInstancesSource).toContain(`${action}: '${key}'`);
        const leaf = key.slice('deviceLink.cloudInstance.'.length);
        expect(cloudInstance[leaf], `${locale} is missing ${key}`).toBeTruthy();
        expect(i18n.t(key), `${locale} did not resolve ${key}`).toBe(cloudInstance[leaf]);
        expect(i18n.t(key)).not.toBe(key);
      }
    }
  });

  it('labels the update badge with both its state and details action in every locale', async () => {
    for (const [locale, catalog] of Object.entries(locales)) {
      await i18n.changeLanguage(locale);
      const template = catalog.cloudInstance.updateAvailableOpenDetails;
      expect(template, `${locale} is missing updateAvailableOpenDetails`).toBeTruthy();
      expect(i18n.t('deviceLink.cloudInstance.updateAvailableOpenDetails', { label: 'Cloud' }))
        .toBe(template.replace('{{label}}', 'Cloud'));
    }
  });

  it('provides a bounded-action timeout message in every locale', async () => {
    for (const [locale, catalog] of Object.entries(locales)) {
      await i18n.changeLanguage(locale);
      expect(catalog.cloudInstance.actionTimedOut).toBeTruthy();
      expect(i18n.t('deviceLink.cloudInstance.actionTimedOut')).toBe(
        catalog.cloudInstance.actionTimedOut,
      );
    }
  });

  it('logs cloud-list failures with metadata only', () => {
    expect(useCloudInstancesSource).toContain("console.warn('[cloud-instance] list failed', {");
    expect(useCloudInstancesSource).toContain('code: result.error.code');
    expect(useCloudInstancesSource).toContain('silent: silentFailure');
    expect(useCloudInstancesSource).toContain('status: result.error.status');
    expect(useCloudInstancesSource).not.toContain('message: result.error.message');
  });

  it('shares the action lock across Home and device-management hook mounts', () => {
    expect(useCloudInstancesSource).toContain(
      'const sharedPendingRef: { current: CloudInstancePending } = { current: null };',
    );
    expect(useCloudInstancesSource).toContain('sharedPendingSubscribers.add(subscriber);');
    expect(useCloudInstancesSource).toContain('pendingRef: sharedPendingRef');
    expect(useCloudInstancesSource).not.toContain(
      'const pendingRef = useRef<CloudInstancePending>(null)',
    );
  });
});

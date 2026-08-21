import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CloudInstancesPanel boundaries', () => {
  it('owns the full cloud lifecycle, including first activation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/components/settings/CloudInstancesPanel.tsx'),
      'utf8',
    );

    expect(source).toContain('await cloud.wake()');
    expect(source).toContain('await cloud.stopInstance(instanceId)');
    expect(source).toContain('await cloud.wake(instanceId)');
    expect(source).toContain('await cloud.upgradeInstance(instanceId)');
    expect(source).toContain('await cloud.rebuildInstance(instanceId)');
    expect(source).toContain('await cloud.deleteInstance(instanceId)');
    expect(source).toContain('await cloud.setAutoUpdate(instanceId, enabled)');
    expect(source).not.toContain('window.electronAPI.cloudInstances');
    expect(source).toContain('data-testid="cloud-instance-first-wake"');
    expect(source).toContain("'cloud-instance-unregistered-card'");
    expect(source).toContain('data-testid="cloud-instance-rebuild"');
    expect(source).toContain('data-testid="cloud-instance-refresh"');
    expect(source).toContain('const MIN_REFRESH_SPIN_MS = 1_000');
    expect(source).toContain('if (refreshInFlightRef.current) return');
    expect(source).toContain('setTimeout(resolve, MIN_REFRESH_SPIN_MS)');
    expect(source).toContain('disabled={cloud.pending !== null}');
    expect(source).toContain('aria-busy={refreshing}');
    expect(source).toContain('icon={Hammer}');
    expect(source).toContain('data-testid="cloud-instance-auto-update"');
    expect(source).toContain("cloudInstance?.status.upgrade?.state === 'verifying'");
    expect(source).toContain('cloudInstance.status.lastFailedUpgradeImage');
    expect(source).toContain("confirmVariant: 'destructive'");
    expect(source.match(/settings\.devices\.refresh/g)).toHaveLength(2);
  });

  it('keeps cloud products out of MyDevicesPanel', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/components/settings/MyDevicesPanel.tsx'),
      'utf8',
    );

    expect(source).toContain(".filter((d) => !d.isSelf && d.deviceInfo?.kind !== 'cloud')");
    expect(source).not.toContain('useCloudInstances');
    expect(source).not.toContain('cloud-instance-');
  });

  it('provides the cloud Cindy section label in every desktop locale', () => {
    const expected: Record<string, string> = {
      en: 'Cloud Cindy',
      'zh-CN': '云端 Cindy',
      'zh-TW': '雲端 Cindy',
      ja: 'クラウド Cindy',
      ko: '클라우드 Cindy',
    };

    for (const [locale, label] of Object.entries(expected)) {
      const messages = JSON.parse(
        readFileSync(
          resolve(process.cwd(), `src/renderer/i18n/locales/${locale}/common.json`),
          'utf8',
        ),
      ) as { settings: { remoteControl: { sections: { cloudCindy?: string } } } };
      expect(messages.settings.remoteControl.sections.cloudCindy).toBe(label);
    }
  });
});

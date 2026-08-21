import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MyDevicesPanel rename guards', () => {
  it('does not write a manual name when rename is confirmed without changes', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/components/settings/MyDevicesPanel.tsx'),
      'utf8',
    );

    expect(source).toContain('const currentName =');
    expect(source).toContain('if (name && name === currentName) return;');
    expect(source).toContain('await s.rename(deviceId, name || null);');
  });

  it('places cloud devices last and omits rename controls', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/components/settings/MyDevicesPanel.tsx'),
      'utf8',
    );

    // 云端判断收敛到 isCloudDevice(device) helper:置底排序 + 重命名入口门控都走它。
    expect(source).toContain('function isCloudDevice(');
    expect(source).toContain('Number(isCloudDevice(a)) - Number(isCloudDevice(b))');
    expect(source).toContain('!isCloudDevice(d)');
    expect(source).toContain('!isCloudDevice(self)');
  });

  it('joins cloud devices to control-plane instances and exposes guarded lifecycle actions', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/components/settings/MyDevicesPanel.tsx'),
      'utf8',
    );

    expect(source).toContain('instance.deviceId === d.deviceId');
    // 动作/防重/云端列表刷新收敛在 useCloudInstances(单一状态机);面板只留
    // UI 关注点:确认框、toast、device-link 列表补刷。不许在面板直调 electronAPI。
    expect(source).toContain('await cloud.stopInstance(instanceId)');
    expect(source).toContain('await cloud.deleteInstance(instanceId)');
    expect(source).not.toContain('window.electronAPI.cloudInstances');
    expect(source).toContain('void s.refresh(true)');
    expect(source).toContain("title: t('settings.devices.cloudInstance.deleteConfirm.title')");
    expect(source).toContain(
      "description: t('settings.devices.cloudInstance.deleteConfirm.description')",
    );
  });

  it('hides relay cloud cards when the cloud capability is not ready', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/components/settings/MyDevicesPanel.tsx'),
      'utf8',
    );

    expect(source).toContain(
      'cloud.loadState === \'ready\' || !isCloudDevice(d)',
    );
  });
});

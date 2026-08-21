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
});

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

  it('excludes cloud devices from the physical device list', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/components/settings/MyDevicesPanel.tsx'),
      'utf8',
    );

    expect(source).toContain(".filter((d) => !d.isSelf && d.deviceInfo?.kind !== 'cloud')");
    expect(source).not.toContain('useCloudInstances');
    expect(source).toContain('onCheckedChange={(v) => void onOutboundChange(device, v)}');
    expect(source).toContain('onCheckedChange={(v) => void onInboundChange(device, v)}');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildDeviceManagementRouteParams,
  cloudInstanceDetailActionState,
} from '@/device-link/deviceManagement';

describe('mobile cloud actions on the ordinary device detail route', () => {
  it('keeps the management route for ordinary-device rename only', () => {
    const detailSource = readFileSync(resolve(process.cwd(), 'app/devices/[deviceId].tsx'), 'utf8');
    const managementSource = readFileSync(resolve(process.cwd(), 'src/device-link/DeviceManagementScreen.tsx'), 'utf8');
    expect(detailSource).toContain('export default function DeviceDetailScreen()');
    expect(detailSource).toContain('CloudInstanceActions');
    expect(detailSource).toContain('testID="deviceDetail.cloudActions"');
    expect(managementSource).not.toContain('CloudInstanceManagement');
    expect(managementSource).toContain('testID="deviceManagement.renameSection"');
  });

  it('renders cloud actions before sessions and keeps an offline wake reachable', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/[deviceId].tsx'), 'utf8');
    expect(source).toContain('useCloudInstances(apiFetch, cloudDevice)');
    expect(source).toContain('cloud.updateOnlineDeviceIds(online ? new Set([deviceId]) : new Set())');
    expect(source).toContain('resolveCloudAffordance({');
    expect(source).toContain('testID="deviceDetail.cloudActions"');
    expect(source).toContain("actionState.lifecycleAction === 'wake' ? () => void wake() : () => void stop()");
    expect(source).toContain('testID="deviceDetail.sessionList"');
    expect(source.indexOf('{cloudDevice ?')).toBeLessThan(source.indexOf('testID="deviceDetail.sessionList"'));
    expect(source).toContain('const hasInstance = cloud.loadState === \'ready\' ? instance !== null : true;');
  });

  it('shows update, sleep and destructive confirmation for an online instance', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/[deviceId].tsx'), 'utf8');
    expect(source).toContain("t('deviceLink.cloudInstance.updateConfirmDescription')");
    expect(source).toContain('testID="deviceDetail.cloudCurrentVersion"');
    expect(source).toContain('testID="deviceDetail.cloudAutoUpdate"');
    expect(source).toContain("t('deviceLink.cloudInstance.deleteConfirmDescription')");
    expect(source).toContain('testID: \'deviceDetail.cloudDelete\'');
  });

  it('gates lifecycle and deletion while a cloud action is pending or verifying', () => {
    expect(cloudInstanceDetailActionState({
      instanceId: 'cloud-instance-a', online: true, pending: null, updateAvailable: true, upgradeState: 'verifying',
    })).toMatchObject({ deleteDisabled: true, lifecycleDisabled: true, updateBusy: true, updateDisabled: true });
    expect(cloudInstanceDetailActionState({
      instanceId: 'cloud-instance-a', online: false, pending: null, updateAvailable: false, upgradeState: 'idle',
    })).toMatchObject({ lifecycleAction: 'wake', lifecycleBusy: false, lifecycleDisabled: false });
  });

  it('uses login affordance for a zero-instance or login-required cloud target', () => {
    expect(cloudInstanceDetailActionState({
      instanceId: 'unresolved:cloud-device-a', loginRequired: true, online: false, pending: null, updateAvailable: false, upgradeState: 'idle',
    })).toMatchObject({ lifecycleAction: 'wake', lifecycleDisabled: true });
    const source = readFileSync(resolve(process.cwd(), 'app/devices/[deviceId].tsx'), 'utf8');
    expect(source).toContain("t(hasInstance ? 'deviceLink.cloudInstance.loginRequired' : 'deviceLink.cloudInstance.loginRequiredZeroInstance')");
    expect(source).toContain("t('deviceLink.cloudInstance.loginRequiredAction')");
    expect(source).toContain('Linking.openURL(loginUrl)');
  });

  it('keeps ordinary device metadata on the management route', () => {
    expect(buildDeviceManagementRouteParams({
      deviceId: 'desktop-device-a',
      name: 'Desktop',
      device: { deviceId: 'desktop-device-a', name: 'Desktop', online: true, platform: 'darwin' } as never,
    })).toMatchObject({ deviceId: 'desktop-device-a', name: 'Desktop', online: '1', platform: 'darwin' });
  });

  it('does not add cloud-only route flags for an ordinary device', () => {
    const params = buildDeviceManagementRouteParams({ deviceId: 'desktop-device-a', name: 'Desktop' });
    expect(params).not.toHaveProperty('cloudCandidate');
    expect(params).not.toHaveProperty('cloudInstanceId');
  });

  it('keeps the manage route separate from the session detail route', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/index.tsx'), 'utf8');
    expect(source).toContain("pathname: '/devices/manage/[deviceId]'");
    expect(source).toContain("pathname: '/devices/[deviceId]'");
  });

  it('does not expose cloud rename controls in the detail action block', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/[deviceId].tsx'), 'utf8');
    const start = source.indexOf('function CloudInstanceActions');
    const end = source.indexOf('function DeviceDetailSessionRow');
    expect(source.slice(start, end)).not.toContain('rename');
  });

  it('keeps browser login fail-closed when the endpoint is unavailable', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/[deviceId].tsx'), 'utf8');
    expect(source).toContain('{loginUrl ? (');
    expect(source).toContain('if (loginUrl) void Linking.openURL(loginUrl)');
  });

  it('keeps delete behind a destructive confirmation', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/[deviceId].tsx'), 'utf8');
    expect(source).toContain('style: \'destructive\'');
    expect(source).toContain('testID="deviceDetail.cloudDeleteSection"');
  });

  it('keeps cloud blocks scoped to cloud device ids only', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/[deviceId].tsx'), 'utf8');
    expect(source).toContain('const cloudDevice = isCloudInstanceDeviceId(deviceId);');
    expect(source).toContain('{cloudDevice ? (');
  });
});

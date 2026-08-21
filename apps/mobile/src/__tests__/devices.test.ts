import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeviceView } from '@cindy/device-link';
import { sortCloudDevicesLast } from '@/device-link/devicePresentation';
import { i18n } from '@/i18n';
import {
  buildMobileHomePresentation,
  selectMobileHomeSources,
  type MobileHomeDeviceFilterItem,
  type MobileHomeSessionLike,
} from '@/session/mobileHome';
import {
  deviceAccessState,
  isControllableDevice,
  platformLabel,
  toDeviceListItems,
  visibleDeviceListItems,
} from '@/device-link/devices';
import {
  projectCloudInstanceMenuItems,
  projectDeviceMenuSources,
  resolveDeviceMenuKind,
} from '@/device-link/deviceMenuProjection';

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

function device(patch: Partial<DeviceView> = {}): DeviceView {
  return {
    deviceId: 'dev-1',
    name: 'Mac',
    platform: 'darwin',
    appVersion: '0.0.0-test',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    online: true,
    busy: false,
    remoteControlEnabled: true,
    isSelf: false,
    ...patch,
  };
}

function deviceFilter(
  deviceId: string | null,
  id: string,
): MobileHomeDeviceFilterItem {
  return {
    available: true,
    deviceId,
    id,
    label: id,
    selected: false,
    sessionCount: 0,
    state: 'ready',
    statusLabel: 'online',
    waitingCount: 0,
  };
}

function mobileSession(
  id: string,
  patch: Partial<MobileHomeSessionLike> = {},
): MobileHomeSessionLike {
  return {
    agentKind: 'cc',
    createdAt: '2026-01-01T00:00:00.000Z',
    effort: 'medium',
    fastMode: false,
    id,
    model: 'claude-sonnet-4-6',
    permissionMode: 'ask',
    pinnedAt: null,
    status: 'active',
    title: id,
    updatedAt: '2026-01-01T00:00:00.000Z',
    userId: 'user-1',
    userSendAt: null,
    workspaceKind: 'project',
    workingDir: '/repo/app',
    ...patch,
  };
}

describe('mobile controllable device filter', () => {
  it('places cloud Pods after ordinary devices without changing stable order', () => {
    expect(sortCloudDevicesLast([
      { id: 'normal-a' },
      { id: 'cloud-a', kind: 'cloud' as const },
      { id: 'normal-b' },
      { id: 'cloud-b', kind: 'cloud' as const },
    ])).toEqual([
      { id: 'normal-a' },
      { id: 'normal-b' },
      { id: 'cloud-a', kind: 'cloud' },
      { id: 'cloud-b', kind: 'cloud' },
    ]);
  });

  it('keeps ordinary-device long press on the task detail and routes the chevron to management', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/index.tsx'), 'utf8');
    expect(source).toContain("pathname: '/devices/[deviceId]'");
    expect(source).toContain('params: { deviceId: item.deviceId, name: item.label }');
    expect(source).toContain('onLongPress={item.deviceId ? () => onOpenDevice(item) : undefined}');
    expect(source).toContain('onDetails={item.deviceId ? () => onOpenManage(item) : undefined}');
    expect(source).toContain('onDetails={item.deviceId ? () => onOpenManage(item, true) : undefined}');
    expect(source).toContain('onLongPress={item.deviceId ? () => onOpenManage(item, true) : undefined}');
    expect(source).toContain('cloudCandidate,');
    expect(source).toContain('onOpenCloudInstance={(instance, label) => openDeviceManagement({');
    expect(source).toContain("pathname: '/devices/manage/[deviceId]'");
    expect(source).toContain('testID={testID ? `${testID}.details` : undefined}');
    expect(source).toContain('projectDeviceMenuSources({');
    expect(source).toContain('fallbackCloudFilters.map((item) => (');
    // 常规设备保留行内重命名(铅笔)入口;云端行(rich/兜底)不提供重命名。
    expect(source).toContain('onRename={item.deviceId ? () => onRenameDevice(item) : undefined}');
    expect(source.match(/onRename=\{/g)).toHaveLength(1);
    expect(source).toContain('testID="home.renameDevice.modal"');
    // 带更新徽标的云端行让出空铅笔占位,窄面板里名字与徽标必须并存可见。
    expect(source).toContain('{(status || onRename) && !badge ? (');
  });

  it('does not render a cloud icon in the home device menu', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/index.tsx'), 'utf8');
    expect(source).not.toContain('deviceMenuIconSlot');
    // 只防 JSX 图标(<Cloud ... />),不误伤 Pick<CloudInstanceView> 这类类型标注。
    expect(source).not.toMatch(/<Cloud[\s/>]/);
  });

  it('renders each cloud instance once and wakes offline rows before switching filters', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/devices/index.tsx'), 'utf8');
    expect(source).toContain('const cloudInstanceDeviceIds = useMemo');
    expect(source).toContain('const cloudItems = useMemo');
    expect(source).toContain('cloudInstanceDeviceIds,');
    expect(source).toContain('onSelect(item.filter)');
    expect(source).toContain('void cloud.wake(item.instance.instanceId).then');
    expect(source).toContain('onSelect(buildCloudDeviceFilterItem(result');
    expect(source).toContain('const selectedCloudExists = cloudInstances.instances.some');
    expect(source).toContain('disabled={!item.online && cloud.pending !== null}');
    expect(source).toContain("status={item.online ? 'online' : 'offline'}");
    expect(source).toContain('onBadgePress={() => onOpenCloudInstance(item.instance, item.label)}');
    expect(source).toContain(
      "t('deviceLink.cloudInstance.updateAvailableOpenDetails', { label })",
    );
    expect(source).toContain('hitSlop={{ bottom: 10, top: 10 }}');
    const badgeTextStyle = source.slice(
      source.indexOf('deviceMenuBadgeText:'),
      source.indexOf('deviceMenuStatusSlot:'),
    );
    expect(badgeTextStyle).toContain('lineHeight: lineHeight.micro');
    expect(source).toContain('onDetails={() => onOpenCloudInstance(item.instance, item.label)}');
    expect(source).toContain('onLongPress={() => onOpenCloudInstance(item.instance, item.label)}');
    expect(source).toContain('item.instance.status.updateAvailable && !busy');
    expect(source).toContain('projectCloudInstanceMenuItems({');
    expect(source).toContain('void refreshCloudInstances()');
    expect(source).not.toContain('openCloudInstanceActions');
    expect(source).not.toContain('cloudWakeItems');
  });

  it('keeps live cloud devices while dropping unbound cached cloud sessions when control plane is unavailable', () => {
    const regularSession = {
      deviceLinkDeviceId: 'regular-device',
      deviceLinkDeviceName: 'Mac',
    };
    const cloudSession = {
      deviceLinkDeviceId: 'cloud-device',
      deviceLinkDeviceName: '__cindy_cloud_device_name__:7',
    };
    const hiddenCachedCloudSession = {
      deviceLinkDeviceId: 'cached-cloud-device',
      deviceLinkDeviceName: '__cindy_cloud_device_name__',
    };
    const result = selectMobileHomeSources(
      [
        { deviceId: 'regular-device' },
        { deviceId: 'cloud-device', kind: 'cloud' },
      ],
      [regularSession, cloudSession, hiddenCachedCloudSession],
      true,
    );
    expect(result.devices).toEqual([
      { deviceId: 'regular-device' },
      { deviceId: 'cloud-device', kind: 'cloud' },
    ]);
    expect(result.sessions).toEqual([regularSession, cloudSession]);

    const source = readFileSync(resolve(process.cwd(), 'app/devices/index.tsx'), 'utf8');
    expect(source).toContain('selectMobileHomeSources(');
    expect(source).toContain("cloudInstances.loadState === 'unsupported'");
    expect(source).toContain('excludeOrcaWorkerSessions(visibleSessions)');
    expect(source).not.toContain(
      "item.device.deviceInfo?.kind !== 'cloud' || cloudInstances.loadState === 'ready'",
    );
    expect(source).not.toContain(
      "item.kind !== 'cloud' || cloudInstances.loadState === 'ready'",
    );
  });

  it('keeps a relay kind=cloud row in the device menu until a rich control-plane row can replace it', () => {
    const all = deviceFilter(null, 'all');
    const regular = deviceFilter('regular-device', 'regular');
    const cloud = deviceFilter('cloud-device', 'cloud');

    expect(projectDeviceMenuSources({
      cloudDeviceIds: new Set(['cloud-device']),
      cloudInstanceDeviceIds: new Set(),
      cloudLoadState: 'ready',
      filters: [all, regular, cloud],
    })).toEqual({
      deviceFilters: [regular],
      fallbackCloudFilters: [cloud],
    });

    expect(projectDeviceMenuSources({
      cloudDeviceIds: new Set(['cloud-device']),
      cloudInstanceDeviceIds: new Set(['cloud-device']),
      cloudLoadState: 'ready',
      filters: [all, regular, cloud],
    })).toEqual({
      deviceFilters: [regular],
      fallbackCloudFilters: [],
    });
  });

  it('casts live prefix devices at the model boundary and hides only a reachable orphan cache row', () => {
    const liveModels = [
      {
        canOpen: true,
        deviceId: 'cloud-device-live',
        kind: resolveDeviceMenuKind('cloud-device-live', undefined),
        name: 'Cloud',
        state: 'ready',
        statusLabel: 'online',
      },
    ];
    const liveHome = buildMobileHomePresentation({ devices: liveModels, sessions: [] });
    const liveCloudDeviceIds = new Set(
      liveModels.filter((item) => item.kind === 'cloud').map((item) => item.deviceId),
    );
    const liveCloud = liveHome.deviceFilters.find(
      (item) => item.deviceId === 'cloud-device-live',
    );
    expect(liveCloud).toBeDefined();
    expect(projectDeviceMenuSources({
      cloudDeviceIds: liveCloudDeviceIds,
      cloudInstanceDeviceIds: new Set(),
      cloudLoadState: 'ready',
      filters: [liveCloud!],
    }).fallbackCloudFilters).toEqual([liveCloud!]);

    const home = buildMobileHomePresentation({
      devices: [],
      sessions: [mobileSession('stale-cloud', {
        deviceLinkDeviceId: 'cloud-device-deleted',
        deviceLinkDeviceName: '__cindy_cloud_device_name__',
      })],
    });
    const staleCloud = home.deviceFilters.find(
      (item) => item.deviceId === 'cloud-device-deleted',
    );
    expect(staleCloud).toBeDefined();

    expect(projectDeviceMenuSources({
      cloudDeviceIds: new Set(),
      cloudInstanceDeviceIds: new Set(),
      cloudLoadState: 'ready',
      filters: [staleCloud!],
    })).toEqual({
      deviceFilters: [],
      fallbackCloudFilters: [],
    });

    // Without an authoritative control-plane result, preserve the existing
    // offline-cache fallback instead of guessing that the instance was deleted.
    expect(projectDeviceMenuSources({
      cloudDeviceIds: new Set(),
      cloudInstanceDeviceIds: new Set(),
      cloudLoadState: 'error',
      filters: [staleCloud!],
    })).toEqual({
      deviceFilters: [],
      fallbackCloudFilters: [staleCloud!],
    });
  });

  it('projects a ready control-plane instance into one kind=cloud menu item', () => {
    const instance = {
      customLabel: null,
      deviceId: 'cloud-device',
      instanceId: 'cloud-instance',
      nameSequence: 1,
      status: {
        image: 'registry.example/cindy-cloud:0.1.6',
        lastFailedUpgradeImage: null,
        latestReleaseTag: '0.1.6',
        updateAvailable: true,
        upgrade: {
          deadlineAtMs: null,
          previousImage: null,
          state: 'idle' as const,
          targetImage: null,
        },
      },
    };

    expect(projectCloudInstanceMenuItems({
      instances: [instance],
      nameOf: () => 'Cloud',
      onlineDeviceIds: new Set(['cloud-device']),
      selectedDeviceId: 'cloud-device',
    })).toMatchObject([{
      filter: {
        deviceId: 'cloud-device',
        selected: true,
        statusLabel: 'online',
      },
      instance,
      kind: 'cloud',
      label: 'Cloud',
      online: true,
      updating: false,
    }]);

    expect(projectCloudInstanceMenuItems({
      instances: [{
        ...instance,
        status: {
          ...instance.status,
          upgrade: { ...instance.status.upgrade, state: 'verifying' },
        },
      }],
      nameOf: () => 'Cloud',
      onlineDeviceIds: new Set(['cloud-device']),
      selectedDeviceId: null,
    })[0]?.updating).toBe(true);
  });

  it('keeps cloud devices and mirror sessions when cloud capability is enabled', () => {
    const devices = [{ deviceId: 'cloud-device', kind: 'cloud' }];
    const sessions = [{
      deviceLinkDeviceId: 'cloud-device',
      deviceLinkDeviceName: '__cindy_cloud_device_name__:7',
    }];
    const result = selectMobileHomeSources(devices, sessions, false);
    expect(result.devices).toBe(devices);
    expect(result.sessions).toBe(sessions);
  });

  it('requires online, remoteControlEnabled and not self', () => {
    expect(isControllableDevice(device())).toBe(true);
    expect(isControllableDevice(device({ busy: true }))).toBe(true);
    expect(isControllableDevice(device({ online: false }))).toBe(false);
    expect(isControllableDevice(device({ remoteControlEnabled: false }))).toBe(false);
    expect(isControllableDevice(device({ isSelf: true }))).toBe(false);
    expect(isControllableDevice(device({ platform: 'ios' }))).toBe(false);
    expect(isControllableDevice(device({ platform: 'android' }))).toBe(false);
  });

  it('uses user-facing platform labels', () => {
    expect(platformLabel('darwin')).toBe('macOS');
    expect(platformLabel('win32')).toBe('Windows');
    expect(platformLabel('linux')).toBe('Linux');
    expect(platformLabel('ios')).toBe('iOS');
    expect(platformLabel('android')).toBe('Android');
    expect(platformLabel(null)).toBe('Unknown');
  });

  it('maps device access states without treating busy as unavailable', () => {
    expect(deviceAccessState(device())).toBe('ready');
    expect(deviceAccessState(device({ busy: true }))).toBe('busy');
    expect(deviceAccessState(device({ deviceId: 'revoked' }), new Set(['revoked']))).toBe('access_revoked');
    expect(deviceAccessState(device({ online: false }))).toBe('offline');
    expect(deviceAccessState(device({ remoteControlEnabled: false }))).toBe('remote_disabled');
    expect(deviceAccessState(device({ isSelf: true }))).toBe('self');
  });

  it('omits the current mobile device and other mobile clients while keeping unavailable peers with actionable details', () => {
    const now = new Date('2026-01-01T00:10:00.000Z').getTime();
    const items = toDeviceListItems([
      device({ deviceId: 'self', isSelf: true }),
      device({ deviceId: 'phone', platform: 'ios' }),
      device({ deviceId: 'tablet', platform: 'android' }),
      device({ deviceId: 'disabled', name: 'Charlie', remoteControlEnabled: false }),
      device({ deviceId: 'busy', name: 'Alpha', busy: true }),
      device({ deviceId: 'revoked', name: 'Delta' }),
      device({ deviceId: 'offline', name: 'Echo', online: false, lastSeenAt: '2026-01-01T00:00:00.000Z' }),
      device({ deviceId: 'ready', name: 'Beta' }),
    ], now, new Set(['revoked']));

    expect(items.map((item) => [item.device.deviceId, item.state, item.canOpen])).toEqual([
      ['busy', 'busy', true],
      ['ready', 'ready', true],
      ['disabled', 'remote_disabled', false],
      ['revoked', 'access_revoked', false],
      ['offline', 'offline', false],
    ]);
    expect(items.find((item) => item.device.deviceId === 'ready')?.statusDetail).toBe('已允许远程控制');
    expect(items.find((item) => item.device.deviceId === 'busy')?.statusDetail).toBe('电脑端正在处理任务');
    expect(items.find((item) => item.device.deviceId === 'revoked')?.statusDetail).toContain('恢复');
    expect(items.find((item) => item.device.deviceId === 'disabled')?.statusDetail).toContain('打开允许远程控制');
    expect(items.find((item) => item.device.deviceId === 'offline')?.statusDetail).toContain('10 分钟前在线');
  });

  it('defaults the visible list to controllable devices while keeping unavailable diagnostics behind a toggle', () => {
    const items = toDeviceListItems([
      device({ deviceId: 'disabled', name: 'A disabled', remoteControlEnabled: false }),
      device({ deviceId: 'busy', name: 'B busy', busy: true }),
      device({ deviceId: 'offline', name: 'C offline', online: false }),
      device({ deviceId: 'ready', name: 'D ready' }),
    ]);

    expect(visibleDeviceListItems(items, false)).toMatchObject({
      availableCount: 2,
      hiddenUnavailableCount: 2,
      unavailableCount: 2,
    });
    expect(visibleDeviceListItems(items, false).visibleItems.map((item) => item.device.deviceId)).toEqual([
      'busy',
      'ready',
    ]);
    expect(visibleDeviceListItems(items, true).visibleItems.map((item) => item.device.deviceId)).toEqual([
      'busy',
      'ready',
      'disabled',
      'offline',
    ]);
  });

  it('shows unavailable devices by default when there is no controllable peer', () => {
    const items = toDeviceListItems([
      device({ deviceId: 'disabled', remoteControlEnabled: false }),
      device({ deviceId: 'offline', online: false }),
    ]);

    const visibility = visibleDeviceListItems(items, false);
    expect(visibility.availableCount).toBe(0);
    expect(visibility.hiddenUnavailableCount).toBe(0);
    expect(visibility.visibleItems.map((item) => item.device.deviceId)).toEqual(['disabled', 'offline']);
  });

  it('sorts same-bucket devices by stable identity instead of lastSeenAt or caller order', () => {
    const items = toDeviceListItems([
      device({ deviceId: 'second', name: 'Beta', lastSeenAt: '2026-01-01T00:00:00.000Z' }),
      device({ deviceId: 'first', name: 'Alpha', lastSeenAt: '2026-01-01T00:10:00.000Z' }),
    ]);

    expect(items.map((item) => item.device.deviceId)).toEqual(['first', 'second']);
  });

  it('keeps bucket order stable when ready and busy states change', () => {
    const readyBusy = toDeviceListItems([
      device({ deviceId: 'beta', name: 'Beta', busy: false }),
      device({ deviceId: 'alpha', name: 'Alpha', busy: true }),
    ]);
    const busyReady = toDeviceListItems([
      device({ deviceId: 'beta', name: 'Beta', busy: true }),
      device({ deviceId: 'alpha', name: 'Alpha', busy: false }),
    ]);

    expect(readyBusy.map((item) => [item.device.deviceId, item.state])).toEqual([
      ['alpha', 'busy'],
      ['beta', 'ready'],
    ]);
    expect(busyReady.map((item) => [item.device.deviceId, item.state])).toEqual([
      ['alpha', 'ready'],
      ['beta', 'busy'],
    ]);
  });

  it('keeps available devices before unavailable devices while sorting within each bucket by stable identity', () => {
    const items = toDeviceListItems([
      device({ deviceId: 'unavailable-a', name: 'A unavailable', online: false }),
      device({ deviceId: 'available-b', name: 'B available' }),
      device({ deviceId: 'unavailable-c', name: 'C unavailable', remoteControlEnabled: false }),
      device({ deviceId: 'available-d', name: 'D available', busy: true }),
    ]);

    expect(items.map((item) => [item.device.deviceId, item.canOpen])).toEqual([
      ['available-b', true],
      ['available-d', true],
      ['unavailable-a', false],
      ['unavailable-c', false],
    ]);
  });
});

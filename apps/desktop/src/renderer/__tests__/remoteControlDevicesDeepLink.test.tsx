// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { cloudInstances, deviceLinkSettings } = vi.hoisted(() => ({
  cloudInstances: {
    instances: [],
    loadState: 'ready' as 'loading' | 'ready' | 'unsupported' | 'error',
    pending: null,
    onlineDeviceIds: new Set<string>(),
    refresh: vi.fn(async () => undefined),
    wake: vi.fn(async () => undefined),
    stopInstance: vi.fn(async () => undefined),
    upgradeInstance: vi.fn(async () => undefined),
    rebuildInstance: vi.fn(async () => undefined),
    setAutoUpdate: vi.fn(async () => true),
    deleteInstance: vi.fn(async () => undefined),
  },
  deviceLinkSettings: {
    enabled: true,
    linkStatus: 'online',
    connectionIssue: null,
    devices: [
      {
        deviceId: 'self',
        name: 'Studio Mac',
        platform: 'darwin',
        appVersion: '1.0.0',
        lastSeenAt: null,
        online: true,
        busy: false,
        remoteControlEnabled: true,
        controlEnabled: true,
        isSelf: true,
      },
    ],
    controlledBy: [],
    revokedControllers: [],
    disabledControlDeviceIds: [],
    listError: null,
    refreshing: false,
  },
}));
vi.mock('@/hooks/useDeviceLinkSettings', () => ({
  useDeviceLinkSettings: () => deviceLinkSettings,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ mode: 'cloud' }) }));
vi.mock('../components/settings/MyDevicesPanel', () => ({
  MyDevicesPanel: () => <div data-testid="my-devices-panel" />,
}));
vi.mock('../components/settings/CloudInstancesPanel', () => ({
  CloudInstancesPanel: () => <div data-testid="cloud-instances-panel" />,
}));
vi.mock('../components/settings/RemoteSection', () => ({
  RemoteSection: () => <div data-testid="remote-section" />,
}));
vi.mock('@/features/cloud-instance/useCloudInstances', () => ({
  useCloudInstances: () => cloudInstances,
}));

import { RemoteControlSection } from '@/components/settings/RemoteControlSection';

// 收起态的 header 无障碍名里还会带上摘要文案,所以用前缀匹配。
const devicesHeader = () =>
  screen.getByRole('button', { name: /^settings\.remoteControl\.sections\.myDevices/ });
const cloudHeader = () =>
  screen.getByRole('button', { name: /^settings\.remoteControl\.sections\.cloudCindy/ });
const sshHeader = () =>
  screen.getByRole('button', { name: /^settings\.remoteControl\.sections\.ssh/ });

function DeepLinkTrigger() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/settings?tab=remote-control&section=devices')}>
      go devices
    </button>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="search">{location.search}</span>;
}

const currentSearch = () => screen.getByTestId('search').textContent ?? '';

beforeEach(() => {
  cloudInstances.loadState = 'ready';
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      remoteSsh: {
        list: vi.fn(async () => ({ hosts: [] })),
        onStatusChanged: vi.fn(() => vi.fn()),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RemoteControlSection devices deep link', () => {
  it('renders cloud Cindy as a peer section, expanded by default, while SSH stays collapsed', () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=remote-control']}>
        <RemoteControlSection />
      </MemoryRouter>,
    );

    expect(devicesHeader()).toBeTruthy();
    expect(cloudHeader().getAttribute('aria-expanded')).toBe('true');
    expect(sshHeader().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('cloud-instances-panel')).toBeTruthy();
  });

  it('hides the cloud Cindy section when the server does not support cloud instances', () => {
    cloudInstances.loadState = 'unsupported';

    render(
      <MemoryRouter initialEntries={['/settings?tab=remote-control']}>
        <RemoteControlSection />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole('button', { name: /^settings\.remoteControl\.sections\.cloudCindy/ }),
    ).toBeNull();
    expect(screen.queryByTestId('cloud-instances-panel')).toBeNull();
  });

  it('renders the devices section expanded on the very first paint', () => {
    // 用 SSR 渲染拿「effect 跑之前」的那一帧:放在 effect 里展开会先画一帧收起,
    // 再把下方内容顶开一格。render() 会同步冲掉 effect,分辨不出这一帧。
    const firstPaint = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/settings?tab=remote-control&section=devices']}>
        <RemoteControlSection />
      </MemoryRouter>,
    );

    // 只看「我的设备」那颗 header:SSH 子块默认收起,它的 aria-expanded=false 是对的。
    expect(firstPaint).toMatch(
      /aria-expanded="true"[\s\S]{0,300}?settings\.remoteControl\.sections\.myDevices/,
    );
    expect(firstPaint).not.toMatch(
      /aria-expanded="false"[\s\S]{0,300}?settings\.remoteControl\.sections\.myDevices/,
    );
  });

  it('keeps the deep link when it arrives while the page is already mounted', async () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=remote-control']}>
        <LocationProbe />
        <DeepLinkTrigger />
        <RemoteControlSection />
      </MemoryRouter>,
    );
    expect(devicesHeader().getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'go devices' }));
    await waitFor(() => expect(devicesHeader().getAttribute('aria-expanded')).toBe('true'));

    // 清 URL 的 effect 不能拿这一帧还没提交的 devicesOpen=false 把刚进来的深链清掉,
    // 否则刷新/返回时这条链接就失效了。
    expect(currentSearch()).toContain('section=devices');
  });

  it('drops the section param once the user collapses the list', async () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=remote-control&section=devices']}>
        <LocationProbe />
        <RemoteControlSection />
      </MemoryRouter>,
    );

    fireEvent.click(devicesHeader());

    await waitFor(() => expect(currentSearch()).not.toContain('section=devices'));
    expect(currentSearch()).toContain('tab=remote-control');
    expect(devicesHeader().getAttribute('aria-expanded')).toBe('false');
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const defaultCloudInstances = () => [
    {
      instanceId: 'cloud-instance-a',
      deviceId: 'cloud-device-a',
      customLabel: 'Cloud A',
      nameSequence: 1,
      status: { updateAvailable: true, upgrade: { state: 'idle' } },
    },
  ];
  return {
    navigate: vi.fn(),
    openStates: [] as (boolean | undefined)[],
    select: vi.fn(),
    toggle: vi.fn(),
    navigateToView: vi.fn(),
    refresh: vi.fn(),
    wake: vi.fn(),
    pending: null as { action: string; target: string } | null,
    toastError: vi.fn(),
    defaultCloudInstances,
    cloudInstances: defaultCloudInstances(),
    onlineDeviceIds: new Set(['cloud-device-a']),
    machineDevices: [] as Array<{
      deviceId: string;
      name: string;
      status: 'connected' | 'connecting' | 'rejected';
    }>,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
  useMatch: () => null,
}));

vi.mock('@/features/cloud-instance/useCloudInstances', () => ({
  CloudInstanceActionTimeoutError: class CloudInstanceActionTimeoutError extends Error {},
  useCloudInstances: () => ({
    loadState: 'ready',
    instances: mocks.cloudInstances,
    onlineDeviceIds: mocks.onlineDeviceIds,
    pending: mocks.pending,
    refresh: mocks.refresh,
    wake: mocks.wake,
  }),
}));

vi.mock('@/features/device-link/useMachineSwitcher', () => ({
  useRemoteSessionBootstrapLoading: () => false,
  useMachineSwitcher: () => ({
    devices: mocks.machineDevices,
    selectedDeviceId: 'all',
    hasRemote: mocks.machineDevices.length > 0,
    select: mocks.select,
    toggle: mocks.toggle,
  }),
}));

vi.mock('@/hooks/useActiveMainView', () => ({
  useActiveMainView: () => ({ navigateToView: mocks.navigateToView }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  // 上游 2026-08 去掉了 hover 展开,菜单改由组件自己的 open state 受控。
  // 关闭动作因此不再经过任何可 mock 的入口,只能从传给 DropdownMenu 的 open
  // prop 序列观测 —— 点徽标后必须出现一次 false。
  DropdownMenu: ({ children, open }: { children: ReactNode; open?: boolean }) => {
    mocks.openStates.push(open);
    return <>{children}</>;
  },
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: (event: MouseEvent<HTMLDivElement>) => void;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <div
      role="menuitem"
      aria-disabled={disabled}
      onClick={(event) => {
        if (disabled) return;
        onClick?.(event);
        if (!event.defaultPrevented) onSelect?.({ preventDefault: vi.fn() });
      }}
    >
      {children}
    </div>
  ),
}));

vi.mock('@/lib/toast', () => ({
  toast: { error: mocks.toastError, warning: vi.fn() },
}));

import { MachineSwitcherMenu } from '../MachineSwitcherMenu';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.cloudInstances = mocks.defaultCloudInstances();
  mocks.onlineDeviceIds = new Set(['cloud-device-a']);
  mocks.machineDevices = [];
  mocks.pending = null;
  mocks.openStates.length = 0;
  mocks.wake.mockReset();
  vi.useRealTimers();
});

describe('MachineSwitcherMenu cloud update badge', () => {
  it('opens the existing cloud device settings deep link without selecting the machine', () => {
    render(<MachineSwitcherMenu />);

    fireEvent.click(screen.getByTestId('machine-cloud-update-badge'));

    expect(mocks.navigate).toHaveBeenCalledWith('/settings?tab=remote-control&section=devices');
    // 点徽标只做深链跳转 + 关菜单,不改机器选择。
    expect(mocks.openStates).toContain(false);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.toggle).not.toHaveBeenCalled();
  });

  it('renders only wake-cloud when a deleted cached cloud shard remains during convergence', () => {
    mocks.cloudInstances = [];
    mocks.onlineDeviceIds = new Set();
    mocks.machineDevices = [
      {
        deviceId: 'cloud-device-deleted',
        name: 'Stale Cloud',
        status: 'connecting',
      },
    ];

    render(<MachineSwitcherMenu />);

    expect(screen.queryByText('Stale Cloud')).toBeNull();
    expect(screen.getByText('ccAgent.sidebar.cloud.wake')).toBeTruthy();
  });

  it('renders one control-plane row for a real prefixed cloud device without kind metadata', () => {
    mocks.machineDevices = [
      {
        deviceId: 'cloud-device-a',
        name: 'Relay Cloud A',
        status: 'connected',
      },
    ];

    render(<MachineSwitcherMenu />);

    expect(screen.getAllByText('Cloud A')).toHaveLength(1);
    expect(screen.queryByText('Relay Cloud A')).toBeNull();
  });

  it('keeps the target waking and disabled while the shared hook is pending', () => {
    mocks.onlineDeviceIds = new Set();
    mocks.pending = { action: 'wake', target: 'cloud-instance-a' };
    const view = render(<MachineSwitcherMenu />);
    expect(
      screen.getByText('settings.devices.cloudInstance.waking')
        .closest('[role="menuitem"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');

    mocks.pending = null;
    mocks.onlineDeviceIds = new Set(['cloud-device-a']);
    view.rerender(<MachineSwitcherMenu />);
    expect(screen.queryByText('settings.devices.cloudInstance.waking')).toBeNull();
    expect(screen.getByText('Cloud A')).toBeTruthy();
  });

  it('shows the first-instance path as waking while the shared hook is pending', () => {
    mocks.cloudInstances = [];
    mocks.onlineDeviceIds = new Set();
    mocks.pending = { action: 'wake', target: 'new' };
    render(<MachineSwitcherMenu />);
    const row = screen
      .getByText('settings.devices.cloudInstance.waking')
      .closest('[role="menuitem"]');
    expect(row?.getAttribute('aria-disabled')).toBe('true');
  });

  it('labels the folded row with the active lifecycle action while keeping it disabled', () => {
    mocks.onlineDeviceIds = new Set();
    mocks.pending = { action: 'stop', target: 'cloud-instance-a' };
    const view = render(<MachineSwitcherMenu />);

    expect(
      screen.getByText('settings.devices.cloudInstance.stopping')
        .closest('[role="menuitem"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');

    mocks.pending = { action: 'wake', target: 'cloud-instance-other' };
    view.rerender(<MachineSwitcherMenu />);
    expect(screen.getByText('settings.devices.cloudInstance.waking')).toBeTruthy();

    mocks.pending = { action: 'rebuild', target: 'cloud-instance-a' };
    view.rerender(<MachineSwitcherMenu />);
    expect(screen.getByText('settings.devices.cloudInstance.rebuilding')).toBeTruthy();
  });

  it('keeps the folded row busy when the pending instance is no longer first offline', () => {
    const cloudA = mocks.cloudInstances[0];
    const cloudB = {
      ...cloudA,
      instanceId: 'cloud-instance-b',
      deviceId: 'cloud-device-b',
      customLabel: 'Cloud B',
      nameSequence: 2,
    };
    mocks.cloudInstances = [cloudA, cloudB];
    mocks.onlineDeviceIds = new Set();
    mocks.pending = { action: 'wake', target: cloudA.instanceId };
    const view = render(<MachineSwitcherMenu />);

    mocks.cloudInstances = [cloudB, cloudA];
    view.rerender(<MachineSwitcherMenu />);
    const foldedRow = screen
      .getByText('settings.devices.cloudInstance.waking')
      .closest('[role="menuitem"]')!;
    expect(foldedRow.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(foldedRow);
    expect(mocks.wake).not.toHaveBeenCalled();
  });

  it('reports a wake failure without leaving the row stuck in waking', async () => {
    mocks.onlineDeviceIds = new Set();
    mocks.wake.mockRejectedValue(new Error('wake failed'));
    render(<MachineSwitcherMenu />);

    fireEvent.click(screen.getByText('ccAgent.sidebar.cloud.wake').closest('[role="menuitem"]')!);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('ccAgent.sidebar.cloud.wakeFailed');
    });
    expect(screen.getByText('ccAgent.sidebar.cloud.wake')).toBeTruthy();
    expect(screen.queryByText('settings.devices.cloudInstance.waking')).toBeNull();
  });

});

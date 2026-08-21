// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_WAKE_WATCH_TIMEOUT_MS } from '@cindy/maker-shared/cloud-instance';

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
    onOpenChange: vi.fn(),
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
      kind?: 'cloud';
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
    devices: [],
    selectedDeviceId: 'all',
    hasRemote: false,
    select: mocks.select,
    toggle: mocks.toggle,
  }),
}));

vi.mock('@/hooks/useActiveMainView', () => ({
  useActiveMainView: () => ({ navigateToView: mocks.navigateToView }),
}));

vi.mock('../useHoverOpenMenu', () => ({
  useHoverOpenMenu: () => ({
    open: true,
    onOpenChange: mocks.onOpenChange,
    triggerRef: { current: null },
    triggerProps: {},
    contentProps: {},
  }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
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
  mocks.wake.mockReset();
  vi.useRealTimers();
});

describe('MachineSwitcherMenu cloud update badge', () => {
  it('opens the existing cloud device settings deep link without selecting the machine', () => {
    render(<MachineSwitcherMenu />);

    fireEvent.click(screen.getByTestId('machine-cloud-update-badge'));

    expect(mocks.navigate).toHaveBeenCalledWith('/settings?tab=remote-control&section=devices');
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.toggle).not.toHaveBeenCalled();
  });

  it('renders only wake-cloud when a deleted cached cloud shard remains during convergence', () => {
    mocks.cloudInstances = [];
    mocks.onlineDeviceIds = new Set();
    mocks.machineDevices = [
      {
        deviceId: 'cloud-device-deleted',
        kind: 'cloud',
        name: 'Stale Cloud',
        status: 'connecting',
      },
    ];

    render(<MachineSwitcherMenu />);

    expect(screen.queryByText('Stale Cloud')).toBeNull();
    expect(screen.getByText('ccAgent.sidebar.cloud.wake')).toBeTruthy();
  });

  it('keeps the target waking after pending clears until its presence comes online', async () => {
    mocks.onlineDeviceIds = new Set();
    mocks.wake.mockResolvedValue(mocks.cloudInstances[0]);
    const view = render(<MachineSwitcherMenu />);

    fireEvent.click(screen.getByText('ccAgent.sidebar.cloud.wake').closest('[role="menuitem"]')!);

    expect(mocks.wake).toHaveBeenCalledWith('cloud-instance-a');
    expect(mocks.select).toHaveBeenCalledWith(['cloud-device-a']);
    await waitFor(() => {
      expect(screen.getByText('ccAgent.sidebar.cloud.waking')).toBeTruthy();
    });
    expect(
      screen.getByText('ccAgent.sidebar.cloud.waking')
        .closest('[role="menuitem"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');

    mocks.onlineDeviceIds = new Set(['cloud-device-a']);
    view.rerender(<MachineSwitcherMenu />);
    await waitFor(() => {
      expect(screen.queryByText('ccAgent.sidebar.cloud.waking')).toBeNull();
      expect(screen.getByText('Cloud A')).toBeTruthy();
    });
  });

  it('starts the same wake watch for the first-instance path', async () => {
    mocks.cloudInstances = [];
    mocks.onlineDeviceIds = new Set();
    mocks.wake.mockResolvedValue({
      instanceId: 'cloud-instance-created',
      deviceId: 'cloud-device-created',
    });
    render(<MachineSwitcherMenu />);

    fireEvent.click(screen.getByText('ccAgent.sidebar.cloud.wake').closest('[role="menuitem"]')!);

    expect(mocks.wake).toHaveBeenCalledWith();
    await waitFor(() => {
      expect(mocks.select).toHaveBeenCalledWith(['cloud-device-created']);
      expect(screen.getByText('ccAgent.sidebar.cloud.waking')).toBeTruthy();
    });
  });

  it('keeps non-wake actions disabled without relabeling, while any wake relabels the folded row', () => {
    mocks.onlineDeviceIds = new Set();
    mocks.pending = { action: 'stop', target: 'cloud-instance-a' };
    const view = render(<MachineSwitcherMenu />);

    expect(screen.getByText('ccAgent.sidebar.cloud.wake')).toBeTruthy();
    expect(screen.queryByText('ccAgent.sidebar.cloud.waking')).toBeNull();
    expect(
      screen.getByText('ccAgent.sidebar.cloud.wake')
        .closest('[role="menuitem"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');

    mocks.pending = { action: 'wake', target: 'cloud-instance-other' };
    view.rerender(<MachineSwitcherMenu />);
    expect(screen.getByText('ccAgent.sidebar.cloud.waking')).toBeTruthy();
  });

  it('keeps the folded row busy when the watched instance is no longer first offline', async () => {
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
    mocks.wake.mockResolvedValue(cloudA);
    const view = render(<MachineSwitcherMenu />);

    fireEvent.click(screen.getByText('ccAgent.sidebar.cloud.wake').closest('[role="menuitem"]')!);
    await waitFor(() => {
      expect(screen.getByText('ccAgent.sidebar.cloud.waking')).toBeTruthy();
    });
    expect(mocks.wake).toHaveBeenCalledTimes(1);

    mocks.cloudInstances = [cloudB, cloudA];
    view.rerender(<MachineSwitcherMenu />);
    const foldedRow = screen.getByText('ccAgent.sidebar.cloud.waking').closest('[role="menuitem"]')!;
    expect(foldedRow.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(foldedRow);
    expect(mocks.wake).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByText('ccAgent.sidebar.cloud.waking')).toBeNull();
  });

  it('does not report timeout when presence arrives just before the deadline', async () => {
    vi.useFakeTimers();
    mocks.onlineDeviceIds = new Set();
    mocks.wake.mockResolvedValue(mocks.cloudInstances[0]);
    const view = render(<MachineSwitcherMenu />);

    await act(async () => {
      fireEvent.click(screen.getByText('ccAgent.sidebar.cloud.wake').closest('[role="menuitem"]')!);
      await Promise.resolve();
    });
    expect(screen.getByText('ccAgent.sidebar.cloud.waking')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(CLOUD_WAKE_WATCH_TIMEOUT_MS - 1);
    });
    mocks.onlineDeviceIds = new Set(['cloud-device-a']);
    view.rerender(<MachineSwitcherMenu />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.queryByText('ccAgent.sidebar.cloud.waking')).toBeNull();
    expect(screen.getByText('Cloud A')).toBeTruthy();
  });

  it('releases a target wake watch after the shared timeout', async () => {
    vi.useFakeTimers();
    mocks.onlineDeviceIds = new Set();
    mocks.wake.mockResolvedValue(mocks.cloudInstances[0]);
    render(<MachineSwitcherMenu />);

    await act(async () => {
      fireEvent.click(screen.getByText('ccAgent.sidebar.cloud.wake').closest('[role="menuitem"]')!);
      await Promise.resolve();
    });
    expect(screen.getByText('ccAgent.sidebar.cloud.waking')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(CLOUD_WAKE_WATCH_TIMEOUT_MS);
    });

    expect(mocks.toastError).toHaveBeenCalledWith('ccAgent.sidebar.cloud.wakeFailed');
    expect(screen.getByText('ccAgent.sidebar.cloud.wake')).toBeTruthy();
  });
});

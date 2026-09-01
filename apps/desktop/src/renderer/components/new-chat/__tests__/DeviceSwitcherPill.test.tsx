// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// 本组只验证行语义；把 Radix portal/定位层压平，避免把浮层实现细节带进测试。
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { DeviceSwitcherPill } from '../DeviceSwitcherPill';
import type { DraftPillDevice } from '@/features/cloud-instance/cloudDraftTarget';

afterEach(cleanup);

const onlineCloud: DraftPillDevice = {
  deviceId: 'cloud-device-a',
  name: 'Cloud A',
  platform: null,
  online: true,
  cloudInstanceId: 'cloud-instance-a',
  updateAvailable: false,
  modelAccessStale: false,
};

const offlineCloud: DraftPillDevice = { ...onlineCloud, online: false };

function renderPill({
  devices = [onlineCloud],
  cloudWake,
}: {
  devices?: DraftPillDevice[];
  cloudWake?: ComponentProps<typeof DeviceSwitcherPill>['cloudWake'];
} = {}) {
  const onChange = vi.fn();
  const onOpenChange = vi.fn();
  const onOpenCloudSettings = vi.fn();
  render(
    <DeviceSwitcherPill
      devices={devices}
      value={null}
      onChange={onChange}
      open
      onOpenChange={onOpenChange}
      onOpenCloudSettings={onOpenCloudSettings}
      cloudWake={cloudWake}
    />,
  );
  return { onChange, onOpenChange, onOpenCloudSettings };
}

describe('DeviceSwitcherPill 云端入口', () => {
  it('在线云端行维持普通设备切换语义', () => {
    const { onChange, onOpenChange } = renderPill();

    fireEvent.click(screen.getByText('Cloud A').closest('button')!);

    expect(onChange).toHaveBeenCalledWith('cloud-device-a', 'Cloud A');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('离线云端行可点击唤醒、立即收起菜单且不提前切草稿目标', () => {
    const onWake = vi.fn();
    const { onChange, onOpenChange } = renderPill({
      devices: [offlineCloud],
      cloudWake: { busy: false, pending: null, onWake },
    });

    const row = screen.getByText('Cloud A').closest('button')!;
    expect(row.disabled).toBe(false);
    expect(screen.getByText('ccAgent.sidebar.cloud.wake')).toBeTruthy();
    fireEvent.click(row);

    expect(onWake).toHaveBeenCalledWith('cloud-instance-a');
    expect(onChange).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('wake 在途时显示共享进行中语义，可回附 transient draft 且不再次调用 onWake', () => {
    const onWake = vi.fn();
    const onReselectWake = vi.fn();
    const { onOpenChange } = renderPill({
      devices: [offlineCloud],
      cloudWake: {
        busy: true,
        pending: { action: 'wake', target: 'cloud-instance-a' },
        onWake,
        onReselectWake,
      },
    });

    const row = screen.getByText('Cloud A').closest('button')!;
    expect(row.disabled).toBe(false);
    expect(screen.getByText('settings.devices.cloudInstance.waking')).toBeTruthy();
    const icon = screen.getByTestId('create-agent-cloud-waking-icon');
    expect(icon.getAttribute('class')).toContain('session-status-breathing');
    expect(icon.firstElementChild?.getAttribute('class')).toContain(
      'text-[var(--remote-status-progress)]',
    );
    const status = screen.getByTestId('create-agent-cloud-waking-status');
    expect(status.getAttribute('class')).toContain('session-status-breathing');
    expect(status.getAttribute('class')).toContain('bg-[var(--remote-status-progress)]');
    fireEvent.click(row);
    expect(onWake).not.toHaveBeenCalled();
    expect(onReselectWake).toHaveBeenCalledWith('cloud-instance-a');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('selectedTarget 在正式 deviceId 上线前驱动 pill label 与进行中状态点', () => {
    renderPill({
      devices: [offlineCloud],
      cloudWake: {
        busy: true,
        pending: { action: 'wake', target: 'cloud-instance-a' },
        onWake: vi.fn(),
        onReselectWake: vi.fn(),
        selectedTarget: { deviceId: 'cloud-device-a', name: 'Cloud A', waking: true },
      },
    });

    expect(screen.getByTestId('create-agent-device-pill').getAttribute('aria-label')).toContain(
      'Cloud A',
    );
    const dot = screen.getByTestId('create-agent-device-pill-status');
    expect(dot.getAttribute('class')).toContain('bg-[var(--remote-status-progress)]');
    expect(dot.getAttribute('class')).toContain('session-status-breathing');
  });

  it('其它云端正在唤醒时，不把当前非唤醒草稿的 pill 误标为进行中', () => {
    renderPill({
      devices: [offlineCloud],
      cloudWake: {
        busy: true,
        pending: { action: 'wake', target: 'another-cloud-instance' },
        onWake: vi.fn(),
        onReselectWake: vi.fn(),
        selectedTarget: { deviceId: 'cloud-device-a', name: 'Cloud A', waking: false },
      },
    });

    const dot = screen.getByTestId('create-agent-device-pill-status');
    expect(dot.getAttribute('class')).not.toContain('bg-[var(--remote-status-progress)]');
    expect(dot.getAttribute('class')).not.toContain('session-status-breathing');
  });

  it.each([
    ['stop', 'settings.devices.cloudInstance.stopping'],
    ['rebuild', 'settings.devices.cloudInstance.rebuilding'],
  ] as const)('%s 在途时显示对应文案、呼吸状态并禁止选择云端行', (action, progressKey) => {
    const onWake = vi.fn();
    const onReselectWake = vi.fn();
    const { onChange } = renderPill({
      devices: [onlineCloud],
      cloudWake: {
        busy: true,
        pending: { action, target: 'cloud-instance-a' },
        onWake,
        onReselectWake,
      },
    });

    const row = screen.getByText('Cloud A').closest('button')!;
    expect(row.disabled).toBe(true);
    expect(screen.getByText(progressKey)).toBeTruthy();
    expect(screen.getByTestId('create-agent-cloud-waking-icon').getAttribute('class')).toContain(
      'session-status-breathing',
    );
    expect(screen.getByTestId('create-agent-cloud-waking-status').getAttribute('class')).toContain(
      'bg-[var(--remote-status-progress)]',
    );
    fireEvent.click(row);
    expect(onChange).not.toHaveBeenCalled();
    expect(onWake).not.toHaveBeenCalled();
    expect(onReselectWake).not.toHaveBeenCalled();
  });

  it('旧 instanceId 被唯一 replacement 替换时仍显示重建中并禁点', () => {
    renderPill({
      devices: [onlineCloud],
      cloudWake: {
        busy: true,
        pending: { action: 'rebuild', target: 'cloud-instance-old' },
        onWake: vi.fn(),
      },
    });

    expect(screen.getByText('settings.devices.cloudInstance.rebuilding')).toBeTruthy();
    expect(screen.getByText('Cloud A').closest('button')!.disabled).toBe(true);
  });

  it('普通离线设备仍置灰禁用', () => {
    const onWake = vi.fn();
    renderPill({
      devices: [
        {
          deviceId: 'plain-device',
          name: 'Office Mac',
          platform: 'darwin',
          online: false,
        },
      ],
      cloudWake: { busy: false, pending: null, onWake },
    });

    const row = screen.getByText('Office Mac').closest('button')!;
    expect(row.disabled).toBe(true);
    expect(screen.getByText('newChat.deviceSwitcher.offlineHint')).toBeTruthy();
    fireEvent.click(row);
    expect(onWake).not.toHaveBeenCalled();
  });

  it('云端有更新时徽标点击只打开设备设置并收起菜单', () => {
    const onWake = vi.fn();
    const { onChange, onOpenChange, onOpenCloudSettings } = renderPill({
      devices: [{ ...onlineCloud, updateAvailable: true }],
      cloudWake: { busy: false, pending: null, onWake },
    });

    fireEvent.click(screen.getByTestId('create-agent-cloud-update-badge'));

    expect(onOpenCloudSettings).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(onWake).not.toHaveBeenCalled();
  });

  it('普通设备与无更新云端设备不显示更新徽标', () => {
    renderPill({
      devices: [
        onlineCloud,
        { deviceId: 'plain-device', name: 'Office Mac', platform: 'darwin', online: true },
      ],
    });

    expect(screen.queryByTestId('create-agent-cloud-update-badge')).toBeNull();
  });

  it('控制面 ready 且 0 实例时仍渲染 pill，并在尾部提供首次唤醒', () => {
    const onWake = vi.fn();
    const { onOpenChange } = renderPill({
      devices: [],
      cloudWake: { busy: false, pending: null, onWake },
    });

    expect(screen.getByTestId('create-agent-device-pill')).toBeTruthy();
    fireEvent.click(screen.getByText('ccAgent.sidebar.cloud.wake').closest('button')!);
    expect(onWake).toHaveBeenCalledWith();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('重建切换实例的空窗期显示重建中而不是首次唤醒', () => {
    renderPill({
      devices: [],
      cloudWake: {
        busy: true,
        pending: { action: 'rebuild', target: 'cloud-instance-old' },
        onWake: vi.fn(),
      },
    });

    const row = screen.getByText('settings.devices.cloudInstance.rebuilding').closest('button')!;
    expect(row.disabled).toBe(true);
    expect(screen.queryByText('ccAgent.sidebar.cloud.wake')).toBeNull();
  });

  it('没有设备且控制面不可用时维持原有不渲染行为', () => {
    const { container } = render(
      <DeviceSwitcherPill
        devices={[]}
        value={null}
        onChange={vi.fn()}
        open={false}
        onOpenChange={vi.fn()}
        onOpenCloudSettings={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});

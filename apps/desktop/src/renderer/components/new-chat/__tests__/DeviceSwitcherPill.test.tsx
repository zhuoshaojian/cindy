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
  deviceId: 'cloud-device',
  name: 'Cloud A',
  platform: null,
  online: true,
  kind: 'cloud',
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

    expect(onChange).toHaveBeenCalledWith('cloud-device', 'Cloud A');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('离线云端行可点击唤醒、立即收起菜单且不提前切草稿目标', () => {
    const onWake = vi.fn();
    const { onChange, onOpenChange } = renderPill({
      devices: [offlineCloud],
      cloudWake: { busy: false, wakingTarget: null, onWake },
    });

    const row = screen.getByText('Cloud A').closest('button')!;
    expect(row.disabled).toBe(false);
    expect(screen.getByText('ccAgent.sidebar.cloud.wake')).toBeTruthy();
    fireEvent.click(row);

    expect(onWake).toHaveBeenCalledWith('cloud-instance-a');
    expect(onChange).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('wake watch 期间显示 pulse 与唤醒中文案，仍允许用户重新选中同一云端', () => {
    const onWake = vi.fn();
    renderPill({
      devices: [offlineCloud],
      cloudWake: { busy: true, wakingTarget: 'cloud-instance-a', onWake },
    });

    const row = screen.getByText('Cloud A').closest('button')!;
    expect(row.disabled).toBe(false);
    expect(screen.getByText('ccAgent.sidebar.cloud.waking')).toBeTruthy();
    const icon = screen.getByTestId('create-agent-cloud-waking-icon');
    expect(icon.getAttribute('class')).toContain('session-status-breathing');
    expect(icon.firstElementChild?.getAttribute('class')).toContain(
      'text-[var(--remote-status-progress)]',
    );
    const status = screen.getByTestId('create-agent-cloud-waking-status');
    expect(status.getAttribute('class')).toContain('session-status-breathing');
    expect(status.getAttribute('class')).toContain('bg-[var(--remote-status-progress)]');
    fireEvent.click(row);
    expect(onWake).toHaveBeenCalledWith('cloud-instance-a');
  });

  it('草稿选中正在唤醒的云端时，pill 状态点使用进行中橙色呼吸', () => {
    renderPill({
      devices: [offlineCloud],
      cloudWake: {
        busy: true,
        wakingTarget: 'cloud-instance-a',
        onWake: vi.fn(),
        selectedTarget: { deviceId: 'cloud-device', name: 'Cloud A', waking: true },
      },
    });

    const dot = screen.getByTestId('create-agent-device-pill-status');
    expect(dot.getAttribute('class')).toContain('bg-[var(--remote-status-progress)]');
    expect(dot.getAttribute('class')).toContain('session-status-breathing');
  });

  it('其它云端正在唤醒时，不把当前非唤醒草稿的 pill 误标为进行中', () => {
    renderPill({
      devices: [offlineCloud],
      cloudWake: {
        busy: true,
        wakingTarget: 'another-cloud-instance',
        onWake: vi.fn(),
        selectedTarget: { deviceId: 'cloud-device', name: 'Cloud A', waking: false },
      },
    });

    const dot = screen.getByTestId('create-agent-device-pill-status');
    expect(dot.getAttribute('class')).not.toContain('bg-[var(--remote-status-progress)]');
    expect(dot.getAttribute('class')).not.toContain('session-status-breathing');
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
      cloudWake: { busy: false, wakingTarget: null, onWake },
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
      cloudWake: { busy: false, wakingTarget: null, onWake },
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
      cloudWake: { busy: false, wakingTarget: null, onWake },
    });

    expect(screen.getByTestId('create-agent-device-pill')).toBeTruthy();
    fireEvent.click(screen.getByText('ccAgent.sidebar.cloud.wake').closest('button')!);
    expect(onWake).toHaveBeenCalledWith();
    expect(onOpenChange).toHaveBeenCalledWith(false);
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

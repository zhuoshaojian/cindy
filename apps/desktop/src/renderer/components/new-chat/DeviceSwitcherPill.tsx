/**
 * DeviceSwitcherPill —— 创建页 pill 排上的「在哪台设备上创建」选择器(#807)。
 *
 * 设备是一级维度:选完设备,右边工作区 pill 才在这台设备的语境里列「对话 + 该设备的项目」
 * (与 mobile 的「设备 → Agent → 工作区」同构)。
 *
 * 几条刻意的取舍:
 *   - **没有对端设备通常整个不渲染**。唯一例外是云端控制面可用(cloudWake 注入)且尚无
 *     实例行:此时 pill 承载「唤醒云端」首次创建动作。除此之外不给只有本机的用户凭空
 *     增加一个维度。
 *   - **离线设备照样列出**。普通设备置灰禁用;云端设备可点击唤醒,presence 上线后由调用方
 *     把草稿目标切过去。掉线时若直接从列表消失,用户会误以为配对或实例丢了。
 *   - **不记忆上次选的设备**,每次进创建页默认本机。draft store 的 deviceLinkDeviceId 本来就
 *     故意不跨重启持久化(绑的是一台可能离线的活动设备),这里与之保持一致 —— 本机是压倒性
 *     主场景,默认停在某台远程机器有误发风险。
 *   - 窄屏且有多台时收成图标 + 状态点:pill 排在窄屏会进正常流并 flex-wrap,省掉设备名可以
 *     少一次换行。只有一台对端时不收(名字短,信息更重要)。
 */

import { Check, ChevronDown, Cloud, CloudOff, Laptop } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { resolveDesktopCloudDeviceName } from '@/features/cloud-instance/cloudDeviceName';
import {
  isCloudPillDevice,
  type DraftPillDevice,
} from '@/features/cloud-instance/cloudDraftTarget';
import {
  cloudInstanceLifecycleAction,
  cloudInstanceLifecycleActionForTarget,
  cloudInstanceLifecycleProgressKey,
} from '@/features/cloud-instance/cloudLifecyclePresentation';
import type { CloudInstancePendingState } from '@/features/cloud-instance/useCloudInstances';
import type { CloudInstanceRebuildAttention } from '@/features/cloud-instance/useCloudInstances';

/** null = 本机。 */
export type DeviceSwitcherValue = string | null;

/**
 * 云端生命周期接线。busy 与 pending 由调用方从**同一份**在途判定派生
 * (含共享终态 watch / 发送在途),pill 不再自行拼装可用性 —— 曾因两处
 * 口径分叉出过「行看着可点、点了被 handler 静默吞掉」的缝。
 */
export interface DeviceSwitcherCloudWake {
  /** 任一云端动作或发送在途:所有唤醒入口禁点防重。 */
  busy: boolean;
  /** 共享云端动作状态；用于呈现 wake / stop / rebuild 的真实进行中语义。 */
  pending: CloudInstancePendingState;
  rebuildAttention?: CloudInstanceRebuildAttention | null;
  /** 省略 instanceId = 首次唤醒(控制面自动建实例)。 */
  onWake: (instanceId?: string) => void;
  /** 已有 wake 在途时只重新附着 transient draft，不再次发起 wake。 */
  onReselectWake?: (instanceId?: string) => void;
  /** 产品上已经选中的云端目标；设备真正上线前不写入 value(deviceLinkDeviceId)。 */
  selectedTarget?: { deviceId: string | null; name: string; waking: boolean };
}

interface Props {
  /** 可选的对端设备(含离线)。空数组时仅注入了 cloudWake 才保持可见(首次唤醒入口)。 */
  devices: readonly DraftPillDevice[];
  /** 当前选中的设备;null = 本机。 */
  value: DeviceSwitcherValue;
  onChange: (deviceId: DeviceSwitcherValue, deviceName: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 窄屏(pill 排进正常流)时收成图标 + 状态点。 */
  compact?: boolean;
  disabled?: boolean;
  cloudWake?: DeviceSwitcherCloudWake;
  /** 打开设置中的云端设备管理区。 */
  onOpenCloudSettings: () => void;
}

/**
 * 当前值对应的展示名。
 *
 * 选中的设备已从可选列表消失(被撤销控制权限 / 解除配对)时**不能回落到本机文案** —— 草稿里
 * 还留着那个 deviceId 并会据此走远程创建,显示「本机」等于谎报目标,用户会以为在本机建、
 * 实际发去了旧设备(或直接失败)。这里退而显示 deviceId,让显示与实际一致;把草稿收敛回本机
 * 是调用方的职责(见 NewMakerDraftRoute 里的失效回落 effect),不在展示函数里偷偷抹掉状态。
 */
export function resolveDeviceLabel(
  devices: readonly DraftPillDevice[],
  value: DeviceSwitcherValue,
  localLabel: string,
): string {
  if (value == null) return localLabel;
  return devices.find((d) => d.deviceId === value)?.name ?? value;
}

export function DeviceSwitcherPill({
  devices,
  value,
  onChange,
  open,
  onOpenChange,
  compact = false,
  disabled = false,
  cloudWake,
  onOpenCloudSettings,
}: Props) {
  const { t } = useTranslation();

  // 空设备列表的唯一可见例外是「云端控制面可用 → 首次唤醒入口」;未注入 cloudWake
  // (端点未配置 / 控制面未 ready)时维持原来的不占位行为。
  if (devices.length === 0 && cloudWake == null) return null;

  const localLabel = t('ccAgent.sidebar.machineSwitcher.localMachine');
  const displayValue = cloudWake?.selectedTarget?.deviceId ?? value;
  const current = displayValue == null
    ? null
    : (devices.find((d) => d.deviceId === displayValue) ?? null);
  // 云端设备的 name 是 locale-neutral sentinel,展示前统一经翻译边界解析
  // (与机器切换菜单同口径);回调仍传原始 name,下游按需再解析。
  const label = cloudWake?.selectedTarget?.name ?? resolveDesktopCloudDeviceName(
    displayValue == null ? localLabel : (current?.name ?? displayValue),
    t,
  );
  // 本机不画状态点(它永远在线,画了只是噪音)。
  const showDot = current != null || cloudWake?.selectedTarget != null;
  const selectedTargetWaking = cloudWake?.selectedTarget?.waking === true;
  // 当前值必须进 aria-label:compact 模式下按钮只剩图标 + 状态点、不渲染设备名文本,只报
  // 「设备」会让读屏用户完全不知道当前选的是哪台机器(Copilot review)。非 compact 时名字虽然
  // 可见,一并读出也不冗余 —— aria-label 会覆盖内文,不会重复播报。
  const triggerLabel = `${t('newChat.deviceSwitcher.label')}: ${label}`;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="create-agent-device-pill"
          disabled={disabled}
          title={compact ? label : undefined}
          aria-label={triggerLabel}
          className={cn(
            'inline-flex h-[30px] items-center justify-center gap-1.5 rounded-full',
            'border border-[var(--create-agent-control-border)] bg-[var(--create-agent-control-bg)]',
            'text-12 font-medium leading-[1.167] text-[var(--create-agent-control-text)]',
            'transition-colors hover:bg-[var(--create-agent-control-bg-hover)]',
            'active:bg-[var(--create-agent-control-bg-pressed)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--create-agent-focus-ring)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
            compact ? 'px-2.5' : 'min-w-20 max-w-[200px] px-3',
          )}
        >
          <Laptop
            size={12}
            strokeWidth={2}
            className="shrink-0 text-[var(--create-agent-control-icon)]"
          />
          {showDot && (
            <span
              aria-hidden
              data-testid="create-agent-device-pill-status"
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                selectedTargetWaking
                  ? 'session-status-breathing bg-[var(--remote-status-progress)]'
                  : current?.online
                    ? 'bg-[var(--remote-status-ready)]'
                    : 'bg-[var(--text-tertiary)]',
              )}
            />
          )}
          {!compact && <span className="min-w-0 truncate">{label}</span>}
          <ChevronDown
            size={12}
            strokeWidth={2}
            className="shrink-0 text-[var(--create-agent-control-icon)]"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className={cn(
          // 宽度**由内容决定 + 设上限**(2026-07-29 用户裁决),而不是写死一个值:
          // DESIGN.md §4 要求 panel 宽度绑 trigger,那条是为「宽度稳定的单行输入框式 Select」
          // 写的;这里的 trigger 是 80–200px 的 pill、宽度还随当前设备名浮动,直接绑上去会让
          // 菜单在 80px 时把「设备名 + 状态点 + 离线副文案」全挤没。所以取自适应:
          //   下限 200px —— 行内容的实际最小需求(padding 24 + 图标 32 + 副文案约 96 + check 28),
          //     低于它副文案会折行;这个值也正好是 trigger 的宽度上限,短名字时两者基本齐平。
          //   上限 320px —— 超长设备名到此为止,由行内的 truncate 有限展现,不让菜单继续摊宽。
          'z-[10010] w-auto min-w-[200px] max-w-[320px] rounded-[12px] p-2',
          'bg-[var(--folder-picker-bg)]',
          'border border-[var(--folder-picker-border)]',
        )}
      >
        {/* 菜单体收进子组件:Radix 关闭时不挂载 Content 子树,行构建(逐行 t()/cn()/
            图标元素)只在真正展开时发生,而不是随父级每次渲染空转。 */}
        <DeviceMenuList
          devices={devices}
          value={displayValue}
          localSelected={cloudWake?.selectedTarget == null && value == null}
          localLabel={localLabel}
          cloudWake={cloudWake == null
            ? undefined
            : {
                ...cloudWake,
                onWake: (instanceId) => {
                  onOpenChange(false);
                  if (instanceId === undefined) cloudWake.onWake();
                  else cloudWake.onWake(instanceId);
                },
                onReselectWake: (instanceId) => {
                  onOpenChange(false);
                  if (instanceId === undefined) cloudWake.onReselectWake?.();
                  else cloudWake.onReselectWake?.(instanceId);
                },
              }}
          onOpenCloudSettings={() => {
            onOpenChange(false);
            onOpenCloudSettings();
          }}
          onSelect={(deviceId, deviceName) => {
            onChange(deviceId, deviceName);
            onOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DeviceMenuList({
  devices,
  value,
  localSelected,
  localLabel,
  cloudWake,
  onOpenCloudSettings,
  onSelect,
}: {
  devices: readonly DraftPillDevice[];
  value: DeviceSwitcherValue;
  localSelected: boolean;
  localLabel: string;
  cloudWake?: DeviceSwitcherCloudWake;
  onOpenCloudSettings: () => void;
  onSelect: (deviceId: DeviceSwitcherValue, deviceName: string | null) => void;
}) {
  const { t } = useTranslation();
  // 行数组里没有云端行 ⟺ 控制面 0 实例(buildDraftPillDevices 保证一实例恰一行、
  // relay 幽灵行已排除),此时菜单尾部挂首次唤醒动作。
  const showFirstWake = cloudWake != null && !devices.some(isCloudPillDevice);
  const cloudInstanceIds = devices
    .filter(isCloudPillDevice)
    .map((device) => device.cloudInstanceId);
  const firstWakeAction =
    cloudInstanceLifecycleActionForTarget(
      cloudWake?.pending ?? null,
      'new',
      cloudInstanceIds,
    ) ?? cloudInstanceLifecycleAction(cloudWake?.pending ?? null);

  return (
    <>
      <div className="px-3 py-2">
        <span className="text-xs font-normal text-[var(--folder-label)]">
          {t('newChat.deviceSwitcher.label')}
        </span>
      </div>

      <DeviceRow
        icon={<Laptop size={20} strokeWidth={2} className="shrink-0 text-[var(--folder-item-icon)]" />}
        name={localLabel}
        hint={t('newChat.deviceSwitcher.localHint')}
        selected={localSelected}
        onSelect={() => onSelect(null, null)}
      />

      <div className="mx-2 my-1 h-px bg-[var(--folder-picker-border)]" />

      <div className="pending-queue-scroll -mr-2 max-h-[216px] overflow-x-hidden overflow-y-auto overscroll-contain pr-2">
        {devices.map((device) => {
          const isCloud = isCloudPillDevice(device);
          const progressAction =
            isCloud
              ? cloudInstanceLifecycleActionForTarget(
                  cloudWake?.pending ?? null,
                  device.cloudInstanceId,
                  cloudInstanceIds,
                )
              : null;
          const inProgress = progressAction !== null;
          const reselectingWake = progressAction === 'wake';
          const Icon = !isCloud ? Laptop : device.online ? Cloud : CloudOff;
          return (
            <DeviceRow
              key={device.deviceId}
              icon={
                <Icon
                  size={20}
                  strokeWidth={2}
                  className={cn(
                    'shrink-0',
                    inProgress
                      ? 'text-[var(--remote-status-progress)]'
                      : 'text-[var(--folder-item-icon)]',
                  )}
                />
              }
              shimmer={inProgress}
              name={resolveDesktopCloudDeviceName(device.name, t)}
              hint={
                progressAction
                  ? t(cloudInstanceLifecycleProgressKey(progressAction, cloudWake?.pending))
                  : device.online
                    ? // 在线但没有可用模型凭据:这一行正在邀请用户建任务,不提示的话
                      // 要到 agent 跑不动时才发现(modelAccess 不阻塞就绪,实例确实是 ready)。
                      isCloud && device.modelAccessStale
                      ? t('newChat.deviceSwitcher.modelAccessStaleHint')
                      : t('newChat.deviceSwitcher.onlineHint')
                    : isCloud
                      ? t('ccAgent.sidebar.cloud.wake')
                      : t('newChat.deviceSwitcher.offlineHint')
              }
              hintWarning={device.online && isCloud && device.modelAccessStale}
              online={device.online}
              statusWaking={inProgress}
              updateAvailable={isCloud && device.updateAvailable}
              // 在线行 = 切换;云端离线行 = 唤醒。当前这台云端已经在唤醒时仍可点：
              // 这是把用户从本机重新带回同一份 transient draft，不会再请求一次 wake。
              // 其它在途云端动作才禁点；普通离线行始终不可选。
              disabled={
                (inProgress && !reselectingWake)
                || (device.online
                  ? false
                  : !isCloud
                    || cloudWake == null
                    || (cloudWake.busy && !reselectingWake))
              }
              selected={value === device.deviceId}
              onSelect={
                reselectingWake
                  ? () => cloudWake?.onReselectWake?.(device.cloudInstanceId)
                  : device.online
                  ? () => onSelect(device.deviceId, device.name)
                  : isCloud
                    ? () => cloudWake?.onWake(device.cloudInstanceId)
                    : undefined
              }
              onUpdateAvailableSelect={
                isCloud && device.updateAvailable ? onOpenCloudSettings : undefined
              }
            />
          );
        })}
        {showFirstWake && (
          <>
            {devices.length > 0 && <div className="mx-2 my-1 h-px bg-[var(--folder-picker-border)]" />}
            <DeviceRow
              icon={
                <CloudOff
                  size={20}
                  strokeWidth={2}
                  className={cn(
                    'shrink-0',
                    firstWakeAction !== null
                      ? 'text-[var(--remote-status-progress)]'
                      : 'text-[var(--folder-item-icon)]',
                  )}
                />
              }
              shimmer={firstWakeAction !== null}
              statusWaking={firstWakeAction !== null}
              name={t(
                firstWakeAction
                  ? cloudInstanceLifecycleProgressKey(firstWakeAction, cloudWake.pending)
                  : cloudWake.rebuildAttention
                    ? 'settings.devices.cloudInstance.manualWakeAction'
                    : 'ccAgent.sidebar.cloud.wake',
              )}
              selected={false}
              // 首次创建同理：用户切回本机后仍能重新选回正在创建的云端，不重复建实例。
              disabled={cloudWake.busy && firstWakeAction !== 'wake'}
              onSelect={firstWakeAction === 'wake'
                ? () => cloudWake.onReselectWake?.()
                : () => cloudWake.onWake()}
            />
          </>
        )}
      </div>
    </>
  );
}

interface RowProps {
  icon: React.ReactNode;
  /** 唤醒在途:图标 pulse(与机器切换菜单 MachineMenuItem 的 shimmer 同口径)。 */
  shimmer?: boolean;
  name: string;
  /** 仅首次唤醒动作行无副文案(它不是一台已存在的设备,没有状态可描述)。 */
  hint?: string;
  /** 副文案按警示呈现(与设置页云端卡的凭据提示同一 token)。 */
  hintWarning?: boolean;
  online?: boolean;
  statusWaking?: boolean;
  disabled?: boolean;
  selected: boolean;
  onSelect?: () => void;
  updateAvailable?: boolean;
  onUpdateAvailableSelect?: () => void;
}

function DeviceRow({
  icon,
  shimmer = false,
  name,
  hint,
  hintWarning = false,
  online,
  statusWaking = false,
  disabled,
  selected,
  onSelect,
  updateAvailable = false,
  onUpdateAvailableSelect,
}: RowProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex w-full items-center gap-3 rounded-[8px] text-left',
        'transition-colors outline-none',
        (!disabled || onUpdateAvailableSelect) && 'hover:bg-[var(--folder-item-hover)]',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        data-testid="create-agent-device-option"
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded-[8px] px-3 py-[10px] text-left outline-none',
          'focus-visible:ring-2 focus-visible:ring-[var(--create-agent-focus-ring)]',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          data-testid={shimmer ? 'create-agent-cloud-waking-icon' : undefined}
          className={cn('inline-flex shrink-0', shimmer && 'session-status-breathing')}
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <span className="flex w-full items-center gap-1.5">
            {online !== undefined && (
              <span
                aria-hidden
                data-testid={statusWaking ? 'create-agent-cloud-waking-status' : undefined}
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  statusWaking
                    ? 'session-status-breathing bg-[var(--remote-status-progress)]'
                    : online
                      ? 'bg-[var(--remote-status-ready)]'
                      : 'bg-[var(--text-tertiary)]',
                )}
              />
            )}
            <span className="min-w-0 truncate text-sm font-medium text-[var(--folder-item-name)]">
              {name}
            </span>
          </span>
          {hint && (
            <span
              data-testid={hintWarning ? 'create-agent-cloud-model-access-stale' : undefined}
              className={cn(
                'w-full truncate text-xs',
                hintWarning ? 'text-[var(--warning-fg)]' : 'text-[var(--folder-item-path)]',
              )}
            >
              {hint}
            </span>
          )}
        </div>
        {selected && (
          <Check size={16} strokeWidth={2.2} className="shrink-0 text-[var(--folder-item-name)]" />
        )}
      </button>
      {updateAvailable && onUpdateAvailableSelect ? (
        <button
          type="button"
          data-testid="create-agent-cloud-update-badge"
          onClick={onUpdateAvailableSelect}
          className="mr-3 shrink-0 select-none rounded-full bg-[var(--surface-chip)] px-2 py-0.5 text-10 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          {t('ccAgent.sidebar.cloud.updateAvailable')}
        </button>
      ) : null}
    </div>
  );
}

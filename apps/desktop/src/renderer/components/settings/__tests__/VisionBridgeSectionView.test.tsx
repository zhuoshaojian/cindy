// @vitest-environment jsdom

/**
 * VisionBridgeSectionView 渲染测试(云实例设置复用的展示部分)。
 *
 * 回归目标:
 *   1. 目标模型行与视觉后端候选只来自注入的 providers(不读本机 useProviders);
 *   2. deviceId 转给主/备两个 ModelSelector;
 *   3. 勾/取消目标模型先 markTargetModelsCustomized,再以默认勾选全集 seed 调 persistPatch;
 *   4. 总开关 / 后端选择 / 目标模型 reset 走注入的回调。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderView } from '@cindy/model-providers';

import { VisionBridgeSectionView, type VisionBridgeSectionViewProps } from '../VisionBridgeSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tip: ({ children }: { children: React.ReactElement }) => children,
}));

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// View 必须只用注入的目录;调用本机 hook 即失败。
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => {
    throw new Error('VisionBridgeSectionView must not read local providers');
  },
}));

vi.mock('@/components/new-chat/ModelSelector', () => ({
  ModelSelector: ({
    deviceId,
    providersOverride,
    fallbackOption,
    onProviderChange,
  }: {
    deviceId?: string;
    providersOverride?: ProviderView[];
    fallbackOption: { label: string; onSelect: () => unknown };
    onProviderChange: (providerId: string | null, modelId?: string) => unknown;
  }) => (
    <div data-testid={`selector:${fallbackOption.label}`} data-device-id={deviceId ?? ''}>
      <span data-testid={`selector:${fallbackOption.label}:catalog`}>
        {(providersOverride ?? [])
          .map((provider) => `${provider.id}=${(provider.models['claude-code'] ?? []).map((m) => m.id).join('|')}`)
          .join(',')}
      </span>
      <button
        type="button"
        aria-label={`${fallbackOption.label}:pick-vision`}
        onClick={() => void onProviderChange('remote-gw', 'claude-opus-5')}
      />
      <button
        type="button"
        aria-label={`${fallbackOption.label}:pick-no-vision`}
        onClick={() => void onProviderChange('remote-gw', 'deepseek/deepseek-v3')}
      />
    </div>
  ),
}));

const REMOTE_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    source: 'builtin',
    auth: { method: 'oauth' },
    agents: ['claude-code'],
    connected: true,
    suspended: false,
    routing: { 'claude-code': { upstream: 'https://x', authStrategy: 'gateway-key' } },
    models: { 'claude-code': [{ id: 'claude-opus-5', name: 'Claude Opus 5' }] },
  },
  {
    id: 'remote-gw',
    name: 'Remote Gateway',
    source: 'user',
    auth: { method: 'apiKey' },
    agents: ['claude-code'],
    connected: true,
    suspended: false,
    routing: { 'claude-code': { upstream: 'https://x', authStrategy: 'api-key-header' } },
    models: {
      'claude-code': [
        { id: 'claude-opus-5', name: 'Claude Opus 5' },
        { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek/deepseek-v3', name: 'DeepSeek V3' },
      ],
    },
  },
] as unknown as ProviderView[];

function renderView(overrides: Partial<VisionBridgeSectionViewProps> = {}) {
  const props: VisionBridgeSectionViewProps = {
    providers: REMOTE_PROVIDERS,
    providersLoading: false,
    deviceId: 'cloud-device-1',
    enabled: true,
    targetModels: [],
    primary: null,
    fallback: null,
    isCustomized: false,
    targetModelsCustomized: false,
    pending: false,
    persistPatch: vi.fn().mockResolvedValue(true),
    resetTargetModels: vi.fn().mockResolvedValue(undefined),
    markTargetModelsCustomized: vi.fn(),
    ...overrides,
  };
  render(<VisionBridgeSectionView {...props} />);
  return props;
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe('VisionBridgeSectionView', () => {
  it('renders target rows from the injected catalog and forwards deviceId to both backend selectors', () => {
    renderView();

    expect(screen.getByText('Claude Opus 5')).toBeTruthy();
    expect(screen.getByText('DeepSeek V4 Flash')).toBeTruthy();
    expect(screen.getByText('DeepSeek V3')).toBeTruthy();
    expect(screen.getAllByLabelText('settings.visionBridge.targetModels.toggleAria')).toHaveLength(3);

    for (const label of ['settings.visionBridge.backends.unset', 'settings.visionBridge.backends.noBackup']) {
      expect(screen.getByTestId(`selector:${label}`).getAttribute('data-device-id')).toBe('cloud-device-1');
      // 视觉后端目录:去掉 OAuth 来源与已知无视觉模型。
      expect(screen.getByTestId(`selector:${label}:catalog`).textContent).toBe('remote-gw=claude-opus-5');
    }
  });

  it('marks targets customized and seeds the default-checked no-vision set before persisting', () => {
    const props = renderView();

    // 排序:no-vision 在前(deepseek-v3、deepseek-v4-flash),vision 在后。
    fireEvent.click(screen.getAllByLabelText('settings.visionBridge.targetModels.toggleAria')[0]);

    expect(props.markTargetModelsCustomized).toHaveBeenCalledTimes(1);
    expect(props.persistPatch).toHaveBeenCalledWith({ targetModels: ['deepseek/deepseek-v4-flash'] });
  });

  it('routes the enable switch, backend selection and target reset to the injected callbacks', () => {
    const props = renderView({ targetModelsCustomized: true });

    fireEvent.click(screen.getByLabelText('settings.visionBridge.enableAria'));
    expect(props.persistPatch).toHaveBeenCalledWith({ enabled: false });

    fireEvent.click(screen.getByRole('button', { name: 'settings.defaults.restore' }));
    expect(props.resetTargetModels).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('settings.visionBridge.backends.unset:pick-vision'));
    expect(props.persistPatch).toHaveBeenCalledWith({
      primary: { providerId: 'remote-gw', modelId: 'claude-opus-5' },
    });

    fireEvent.click(screen.getByLabelText('settings.visionBridge.backends.noBackup:pick-no-vision'));
    expect(props.persistPatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ fallback: expect.anything() }),
    );
  });
});

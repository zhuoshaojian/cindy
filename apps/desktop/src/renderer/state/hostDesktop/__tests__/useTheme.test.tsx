// @vitest-environment jsdom

/**
 * useTheme 跨窗口主题同步：
 * - 云实例窗口只跟随 Host 确认值，忽略 localStorage 事件。
 * - Viewer 不经过 Host 存储,走上游 localStorage 实现(见 hostDesktopSeam.test)。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { __resetDesktopPreferencesForTests } from '../../hostDesktopPreferences';
import { installDesktopPreferencesHarness, settleDesktopPreferences } from '../../../__tests__/desktopPreferencesHarness';
let host: ReturnType<typeof installDesktopPreferencesHarness>;

import { themeService } from '../../../themes/theme-service';
import {
  __resetLoginFirstLaunchLightGateForTest,
  endLoginFirstLaunchLightGate,
  getInitialThemeVariant,
  ThemeProvider,
  useTheme,
} from '../useTheme';

const applyVibrancyMock = vi.fn();
let systemPrefersDark = false;

// jsdom 无 matchMedia,ThemeProvider 初始化与 system 模式需要它。
vi.stubGlobal('matchMedia', (q: string) => ({
  matches: systemPrefersDark,
  media: q,
  addEventListener: () => {},
  removeEventListener: () => {},
}));

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ThemeProvider, null, children);
}

function utilityWindowWrapper({ children }: { children: ReactNode }) {
  return createElement(ThemeProvider, { children, syncWindowVibrancy: false });
}

// 构造 storage 事件:用普通 Event + 显式 key/newValue,避免依赖 jsdom 对
// StorageEvent 构造函数第二参数(init)的重载支持(CodeQL: superfluous trailing arguments)。
function dispatchStorage(key: string | null, newValue: string | null, storageArea = localStorage) {
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: key });
  Object.defineProperty(event, 'newValue', { value: newValue });
  Object.defineProperty(event, 'storageArea', { value: storageArea });
  window.dispatchEvent(event);
}

describe('useTheme 跨窗口主题同步(D2-3)', () => {
  beforeEach(() => {
    __resetLoginFirstLaunchLightGateForTest();
    __resetDesktopPreferencesForTests();
    systemPrefersDark = false;
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.classList.remove('dark');
    vi.spyOn(themeService, 'applyTheme').mockImplementation(() => {});
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      theme: { applyVibrancy: applyVibrancyMock },
    };
    host = installDesktopPreferencesHarness();
    applyVibrancyMock.mockClear();
  });

  it('把应用主题模式同步给 main 作为下次 Windows 创建期 backing 镜像', () => {
    localStorage.setItem('theme', 'dark');
    renderHook(() => useTheme(), { wrapper });

    expect(applyVibrancyMock).toHaveBeenCalledWith('cindy', true, 'dark', true);
  });

  it('utility 窗口复用 ThemeProvider 时不写全局窗口材质快照', () => {
    localStorage.setItem('theme', 'dark');
    renderHook(() => useTheme(), { wrapper: utilityWindowWrapper });

    expect(applyVibrancyMock).not.toHaveBeenCalled();
  });

  it('把单变体家族标记为不随系统模式切换', () => {
    localStorage.setItem('theme.familyId', 'eclipse');
    renderHook(() => useTheme(), { wrapper });

    expect(applyVibrancyMock).toHaveBeenCalledWith('eclipse', true, 'system', false);
  });

  it('系统深色下真首启按亮色门的实际主题上报 backing，门结束后恢复深色', () => {
    systemPrefersDark = true;
    expect(getInitialThemeVariant().theme.type).toBe('light');

    renderHook(() => useTheme(), { wrapper });
    expect(applyVibrancyMock).toHaveBeenLastCalledWith('cindy', false, 'system', true);

    act(() => {
      endLoginFirstLaunchLightGate();
    });
    expect(applyVibrancyMock).toHaveBeenLastCalledWith('cindy', true, 'system', true);
  });

  it('其他窗口切 theme → Host 推送 → 本窗口 theme state 跟随并重应用', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('system');
    await act(async () => {
      await settleDesktopPreferences(); host.external({ theme: 'dark' }); await settleDesktopPreferences();
    });
    expect(result.current.theme).toBe('dark');
    expect(themeService.applyTheme).toHaveBeenCalled();
  });

  it('无存档时默认 cindy,其他窗口切 familyId=default 后本窗口跟随', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.familyId).toBe('cindy');
    await act(async () => {
      await settleDesktopPreferences(); host.external({ themeFamilyId: 'default' }); await settleDesktopPreferences();
    });
    expect(result.current.familyId).toBe('default');
  });

  it('保留已有用户存储的主题家族选择', () => {
    localStorage.setItem('theme.familyId', 'default');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.familyId).toBe('default');
  });

  it('同一主题家族再次应用时仍通知主题订阅者', async () => {
    document.documentElement.dataset.theme = 'cindy-light';
    document.documentElement.classList.remove('dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    const applySpy = themeService.applyTheme as unknown as ReturnType<typeof vi.fn>;
    applySpy.mockClear();

    await act(async () => {
      result.current.setFamily('cindy'); await settleDesktopPreferences();
    });

    expect(applySpy).toHaveBeenCalledOnce();
  });

  it('非法 theme 值不触发 state 变更', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    const before = result.current.theme;
    act(() => {
      dispatchStorage('theme', 'garbage');
    });
    expect(result.current.theme).toBe(before);
  });

  it('非法 familyId(未注册)不触发变更', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    const before = result.current.familyId;
    act(() => {
      dispatchStorage('theme.familyId', 'no-such-family');
    });
    expect(result.current.familyId).toBe(before);
  });

  it('无关 key 的 storage 事件不触发主题变更', () => {
    const applySpy = themeService.applyTheme as unknown as ReturnType<typeof vi.fn>;
    applySpy.mockClear();
    const { result } = renderHook(() => useTheme(), { wrapper });
    const beforeTheme = result.current.theme;
    const beforeFamily = result.current.familyId;
    act(() => {
      dispatchStorage('unrelated.key', 'x');
    });
    expect(result.current.theme).toBe(beforeTheme);
    expect(result.current.familyId).toBe(beforeFamily);
  });

  it('已连接的普通窗口忽略成功缓存事件，继续使用 Host 确认值', async () => {
    host = installDesktopPreferencesHarness({ theme: 'dark', themeFamilyId: 'default' });
    const { result } = renderHook(() => useTheme(), { wrapper });
    await act(async () => { await settleDesktopPreferences(); });
    act(() => {
      localStorage.setItem('theme', 'light');
      localStorage.setItem('theme.familyId', 'cindy');
      dispatchStorage('theme', 'light');
      dispatchStorage('theme.familyId', 'cindy');
    });
    expect(result.current.theme).toBe('dark');
    expect(result.current.familyId).toBe('default');
    expect(host.api.update).not.toHaveBeenCalled();
  });

  it('成功提交后缓存写入失败不回滚 Host 确认值，也不伪造缓存成功', async () => {
    host = installDesktopPreferencesHarness({ theme: 'dark' });
    const { result } = renderHook(() => useTheme(), { wrapper });
    await act(async () => { await settleDesktopPreferences(); });
    expect(localStorage.getItem('theme')).toBe('dark');
    const cacheWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cache unavailable');
    });
    try {
      await act(async () => {
        result.current.setTheme('light');
        await settleDesktopPreferences();
      });
      expect(result.current.theme).toBe('light');
      expect(host.snapshot()).toMatchObject({ value: { theme: 'light' } });
      expect(localStorage.getItem('theme')).toBe('dark');
    } finally { cacheWrite.mockRestore(); }
  });
});

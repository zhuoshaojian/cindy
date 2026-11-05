/**
 * useLocale —— 显示语言偏好 + 实际生效语言。
 *
 * 设计上和 useTheme 镜像：
 *   - Host profile 保存偏好；Renderer 只消费已提交快照与启动缓存。
 *   - 'system' = 运行时跟 OS 走，由 main 进程读取 OS 首选语言列表并解析。
 *   - 切换语言时同步 i18next.changeLanguage 触发 react-i18next 重渲染，
 *     同步 <html lang="...">，并通知 main 刷新 macOS 原生菜单文案。
 *
 * 不做 OS 语言运行时监听。用户改了系统语言后需要重启应用，这是 Electron 通用行为。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createElement } from 'react';
import type { ClassicalReplyStyleId } from '@cindy/maker-shared/classical-reply';
import { getDesktopPreference, setDesktopPreference, useDesktopPreference } from '../hostDesktopPreferences';
import { readStoredClassicalStyle, writeStoredClassicalStyle } from '@/lib/localePreference';

import {
  i18n,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type LocalePreference,
  type SupportedLocale,
} from '@/i18n';

interface LocaleContextValue {
  /** 用户的偏好选择 (含 'system')。 */
  locale: LocalePreference;
  /** 实际生效的语言 ('system' 已解析为 OS 语言)。 */
  effectiveLocale: SupportedLocale;
  /** 设置偏好 —— 等待 Host 提交后刷 i18next、刷 <html lang>。 */
  setLocale: (next: LocalePreference) => void;
  /** 古典界面（文言）下 AI 作答的输出风格；与上游一样只存本窗口存储。 */
  classicalStyle: ClassicalReplyStyleId;
  setClassicalStyle: (next: ClassicalReplyStyleId) => void;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

function readStoredLocale(): LocalePreference { return getDesktopPreference('locale'); }

function detectSystemLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const locale = window.electronAPI?.preferredSystemLocale;
  return typeof locale === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as SupportedLocale)
    : DEFAULT_LOCALE;
}

function effectiveOf(pref: LocalePreference): SupportedLocale {
  if (pref === 'system') return detectSystemLocale();
  return pref;
}

function syncApplicationMenuLocale(loc: SupportedLocale): void {
  if (typeof window === 'undefined') return;
  void window.electronAPI?.setApplicationMenuLocale?.(loc).catch(() => {
    /* Native app menu is macOS-only; renderer locale still updates normally. */
  });
}

function syncClassicalStyle(style: ClassicalReplyStyleId): void {
  if (typeof window === 'undefined') return;
  void window.electronAPI?.setClassicalReplyStyle?.(style).catch(() => {
    /* Older hosts ignore it; replies then keep the default classical style. */
  });
}

function applyLocale(loc: SupportedLocale): void {
  // i18next 自带 isInitialized 检查；同步资源 + 同步 init 下永远是 true。
  void i18n.changeLanguage(loc);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = loc;
  }
  syncApplicationMenuLocale(loc);
}

/**
 * Apply the persisted locale before the first React render.
 *
 * Lightweight windows render their error boundary outside the provider tree;
 * initializing i18next synchronously here keeps even an early render failure
 * in the user's selected language.
 */
export function bootstrapInitialLocale(): SupportedLocale {
  const effectiveLocale = effectiveOf(readStoredLocale());
  applyLocale(effectiveLocale);
  return effectiveLocale;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useDesktopPreference('locale');
  const effectiveLocale = effectiveOf(locale);
  const setLocale = useCallback((next: LocalePreference) => {
    void setDesktopPreference('locale', next);
  }, []);
  const [classicalStyle, setClassicalStyleState] = useState<ClassicalReplyStyleId>(readStoredClassicalStyle);
  const setClassicalStyle = useCallback((next: ClassicalReplyStyleId) => {
    setClassicalStyleState(next);
    writeStoredClassicalStyle(next);
  }, []);

  // Main builds each turn's reply note, so it keeps the current style too.
  useEffect(() => {
    syncClassicalStyle(classicalStyle);
  }, [classicalStyle]);

  // 初次挂载与跨窗口 Host 回执都同步 i18next 和 <html lang>，不让旧启动缓存覆盖正本。
  useEffect(() => {
    applyLocale(effectiveLocale);
  }, [effectiveLocale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, effectiveLocale, setLocale, classicalStyle, setClassicalStyle }),
    [locale, effectiveLocale, setLocale, classicalStyle, setClassicalStyle],
  );

  return createElement(LocaleContext.Provider, { value }, children);
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}

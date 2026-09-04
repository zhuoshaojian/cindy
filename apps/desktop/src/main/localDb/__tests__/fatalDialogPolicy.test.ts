import { describe, expect, it } from 'vitest';

import { vi } from 'vitest';

import {
  presentLocalDbFatalError,
  presentVisibleNativeStartupDialog,
  shouldShowNativeFatalDialog,
} from '../fatalDialogPolicy';

describe('shouldShowNativeFatalDialog', () => {
  it('MIGRATE_FAILED 由 renderer 全屏恢复界面接管，不弹原生对话框', () => {
    expect(shouldShowNativeFatalDialog('MIGRATE_FAILED')).toBe(false);
  });

  it('其余错误码维持原生对话框语义', () => {
    expect(shouldShowNativeFatalDialog('DB_INIT_FAILED')).toBe(true);
    expect(shouldShowNativeFatalDialog('DB_CORRUPT_NO_BACKUP')).toBe(true);
  });
});

describe('presentLocalDbFatalError', () => {
  it('headless Pod 记录结构化错误且不触达原生对话框', () => {
    const logError = vi.fn();
    const activateApp = vi.fn();
    const showNativeDialog = vi.fn();

    presentLocalDbFatalError(
      {
        code: 'DB_INIT_FAILED',
        title: '无法初始化本地数据库',
        detail: 'disk unavailable',
        headlessPodRuntime: true,
      },
      { logError, activateApp, showNativeDialog },
    );

    expect(showNativeDialog).not.toHaveBeenCalled();
    expect(activateApp).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logError.mock.calls[0]?.[0] as string)).toEqual({
      event: 'localDb.fatal.headless',
      code: 'DB_INIT_FAILED',
      title: '无法初始化本地数据库',
      detail: 'disk unavailable',
    });
  });

  it('GUI 的 DB 初始化失败仍交给原生对话框', () => {
    const order: string[] = [];
    const logError = vi.fn();
    const activateApp = vi.fn(() => order.push('activate'));
    const showNativeDialog = vi.fn(() => order.push('show'));
    logError.mockImplementation(() => order.push('log'));

    presentLocalDbFatalError(
      {
        code: 'DB_INIT_FAILED',
        title: '无法初始化本地数据库',
        detail: 'disk unavailable',
        headlessPodRuntime: false,
      },
      { logError, activateApp, showNativeDialog },
    );

    expect(showNativeDialog).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logError.mock.calls[0]?.[0] as string)).toEqual({
      event: 'localDb.fatal.native',
      code: 'DB_INIT_FAILED',
      title: '无法初始化本地数据库',
      detail: 'disk unavailable',
    });
    expect(order).toEqual(['log', 'activate', 'show']);
  });
});

describe('presentVisibleNativeStartupDialog', () => {
  it('先记录原因并激活应用，再展示同步模态', () => {
    const order: string[] = [];

    const result = presentVisibleNativeStartupDialog(
      {
        event: 'startup.dialog.moveToApplications',
        context: { source: 'app-translocation' },
      },
      {
        logBeforePresent: (message) => {
          expect(JSON.parse(message)).toEqual({
            event: 'startup.dialog.moveToApplications',
            source: 'app-translocation',
          });
          order.push('log');
        },
        activateApp: () => order.push('activate'),
        showNativeDialog: () => {
          order.push('show');
          return 1;
        },
      },
    );

    expect(result).toBe(1);
    expect(order).toEqual(['log', 'activate', 'show']);
  });
});

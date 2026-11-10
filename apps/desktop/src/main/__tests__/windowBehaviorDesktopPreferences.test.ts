import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ root: '', preference: vi.fn<(key: string) => boolean | undefined>() }));
vi.mock('electron', () => ({ app: { getPath: () => h.root } }));
vi.mock('../maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => ({ info: vi.fn(), warn: vi.fn() }) } }));
vi.mock('../host-settings/desktop-preferences.js', () => ({ hostDesktopPreference: h.preference }));
vi.mock('../host-settings/startup.js', () => { throw new Error('Host Skill preparation forbidden'); });
vi.mock('../appSessionState.js', () => { throw new Error('Authorization access forbidden'); });
import { inspectWindowBehaviorSettings, readWindowBehaviorSettings, writeSwallowActivationClick } from '../window-behavior-settings-store';

const file = () => path.join(h.root, 'window-behavior-settings.json');
beforeEach(() => {
  h.root = fs.mkdtempSync(path.join(os.tmpdir(), 'window-prefs-'));
  h.preference.mockReset();
  h.preference.mockReturnValue(undefined);
});
afterEach(() => fs.rmSync(h.root, { recursive: true, force: true }));

describe('窗口创建期消费 profile 偏好', () => {
  it('云实例的 Host 正本覆盖旧 click 缓存，保留关闭行为，迟到旧写入不改变生效值', () => {
    fs.writeFileSync(file(), JSON.stringify({ swallowActivationClick: false, windowsCloseBehavior: 'tray', linuxCloseBehavior: 'quit' }));
    h.preference.mockReturnValue(true);
    expect(readWindowBehaviorSettings()).toEqual({ swallowActivationClick: true, windowsCloseBehavior: 'tray', linuxCloseBehavior: 'quit', awayGuard: false, awayGuardDelaySeconds: null });
    writeSwallowActivationClick(false);
    expect(readWindowBehaviorSettings().swallowActivationClick).toBe(true);
    h.preference.mockReturnValue(false);
    writeSwallowActivationClick(true);
    expect(readWindowBehaviorSettings().swallowActivationClick).toBe(false);
    expect(h.preference).toHaveBeenCalledWith('swallowActivationClick');
  });

  it('普通桌面或 Host 值未就绪时沿用本文件，不写默认', () => {
    fs.writeFileSync(file(), JSON.stringify({ swallowActivationClick: true, windowsCloseBehavior: 'tray' }));
    const before = fs.readFileSync(file());
    expect(readWindowBehaviorSettings()).toEqual({ swallowActivationClick: true, windowsCloseBehavior: 'tray', linuxCloseBehavior: null, awayGuard: false, awayGuardDelaySeconds: null });
    expect(fs.readFileSync(file())).toEqual(before);
    expect(fs.readdirSync(h.root)).toEqual(['window-behavior-settings.json']);
  });

  it('core inspector 不读取 Host profile、更不应用 runtime，缺失文件检查也无写入', () => {
    h.preference.mockImplementation(() => { throw new Error('runtime read forbidden during inspection'); });
    expect(inspectWindowBehaviorSettings()).toMatchObject({ status: 'ready', value: { swallowActivationClick: false } });
    expect(h.preference).not.toHaveBeenCalled();
    expect(fs.readdirSync(h.root)).toEqual([]);
  });
});

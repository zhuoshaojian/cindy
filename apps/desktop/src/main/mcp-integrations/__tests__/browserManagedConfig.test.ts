import { afterEach, describe, expect, it } from 'vitest';

import { buildManagedConfig } from '../browser-managed-config.js';
import { HEADLESS_POD_RUNTIME_ENV } from '../../headless-startup.js';

describe('managed browser runtime config', () => {
  it('allows only proxy fake-IP ranges without disabling private-network protection', () => {
    expect(buildManagedConfig().browser?.ssrfPolicy).toEqual({
      allowRfc2544BenchmarkRange: true,
      allowIpv6UniqueLocalRange: true,
    });
  });

  it('labels both isolated and snapshot profiles Cindy on the Chrome chip', () => {
    const isolated = buildManagedConfig().browser;
    expect(isolated?.defaultProfile).toBe('Cindy');
    expect(isolated?.profiles?.Cindy?.displayName).toBe('Cindy');

    const snapshot = buildManagedConfig({ useRealProfile: true }).browser;
    expect(snapshot?.defaultProfile).toBe('Cindy-real');
    expect(snapshot?.profiles?.['Cindy-real']?.displayName).toBe('Cindy');
    expect(Object.keys(snapshot?.profiles ?? {})).toEqual(['Cindy-real']);
  });

  // 云端 Pod 在容器里以非 root 运行,Chrome 的 setuid sandbox 起不来,不给
  // --no-sandbox 会直接启动失败。判定必须留在这个构造函数里 —— 它有四个调用点。
  it('passes --no-sandbox only inside a cloud Pod runtime', () => {
    expect(buildManagedConfig({ podRuntime: true }).browser?.noSandbox).toBe(true);
    expect(buildManagedConfig({ podRuntime: false }).browser?.noSandbox).toBeUndefined();
  });

  // 回归:sandbox 在普通桌面上是真实安全边界,不是配置偏好。默认(无 Pod 环境变量)
  // 必须保持关闭,并且不得因为走了 useRealProfile / executablePath 这些分支而漏开或误开。
  it('never disables the sandbox for an ordinary desktop launch', () => {
    const previous = process.env[HEADLESS_POD_RUNTIME_ENV];
    delete process.env[HEADLESS_POD_RUNTIME_ENV];
    try {
      for (const options of [undefined, { useRealProfile: true }, { executablePath: '/usr/bin/chromium' }]) {
        expect(buildManagedConfig(options).browser?.noSandbox).toBeUndefined();
      }
      process.env[HEADLESS_POD_RUNTIME_ENV] = '0';
      expect(buildManagedConfig().browser?.noSandbox).toBeUndefined();
      process.env[HEADLESS_POD_RUNTIME_ENV] = '1';
      expect(buildManagedConfig().browser?.noSandbox).toBe(true);
    } finally {
      if (previous === undefined) delete process.env[HEADLESS_POD_RUNTIME_ENV];
      else process.env[HEADLESS_POD_RUNTIME_ENV] = previous;
    }
  });

  // Pod 不设 executablePath:resolveBrowserExecutableForPlatform 对「设了但文件不存在」
  // 是抛错而非回落,所以一律交给探测链找 /usr/bin/chromium,失败时只是「未检测到」。
  it('leaves executable discovery to the runtime instead of pinning a path', () => {
    expect(buildManagedConfig({ podRuntime: true }).browser?.executablePath).toBeUndefined();
  });
});

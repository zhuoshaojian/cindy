// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CloudInstancesPage, type CloudInstancesApi } from '../CloudInstancesPage';
import type { CloudInstanceView } from '../../../../shared/cloudInstanceControl';
import zhCN from '@/i18n/locales/zh-CN/common.json';
import zhTW from '@/i18n/locales/zh-TW/common.json';
import en from '@/i18n/locales/en/common.json';
import ja from '@/i18n/locales/ja/common.json';
import ko from '@/i18n/locales/ko/common.json';
const confirmation = vi.hoisted(() => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => confirmation,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  confirmation.confirm.mockResolvedValue(true);
});
const resources = { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja, ko };
const target: CloudInstanceView = {
  instanceId: 'example-instance',
  deviceId: 'example-device',
  name: 'Cloud A',
  nameSequence: 1,
  ordinal: null,
  desiredState: 'running',
  runtimeState: 'missing',
  ready: false,
  loginRequired: true,
  version: '0.1.108',
  imageId: null,
  latestVersion: '0.1.108',
  updateAvailable: false,
  upgradeState: 'idle',
  observedAtMs: null,
  maintenance: null,
};
async function setup(
  items: CloudInstanceView[] = [],
  locale: keyof typeof resources = 'zh-CN',
  fail = false,
  onLoginCompleted?: CloudInstancesApi['onLoginCompleted'],
  capacity?: { limit: number; used: number } | null,
) {
  const api = {
    onLoginCompleted,
    ...(capacity !== undefined
      ? { instanceCapacity: vi.fn<NonNullable<CloudInstancesApi['instanceCapacity']>>().mockResolvedValue(capacity) }
      : {}),
    instanceList: vi.fn<CloudInstancesApi['instanceList']>().mockResolvedValue(items),
    instanceClaim: vi.fn<CloudInstancesApi['instanceClaim']>().mockResolvedValue([target]),
    instanceInitialize: vi.fn<CloudInstancesApi['instanceInitialize']>().mockResolvedValue(),
    instancePower: vi.fn<CloudInstancesApi['instancePower']>().mockResolvedValue(),
  };
  if (fail) api.instanceList.mockRejectedValue(Error('read failed'));
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    resources: Object.fromEntries(
      Object.entries(resources).map(([lang, common]) => [lang, { translation: common }]),
    ),
  });
  const onOpen = vi.fn(),
    onBack = vi.fn(),
    onOpenDesktop = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <CloudInstancesPage
        api={api}
        onBack={onBack}
        onOpen={onOpen}
        onOpenDesktop={onOpenDesktop}
        canOpenDesktop={(instance) => instance.deviceId === 'example-device'}
      />
    </I18nextProvider>,
  );
  await waitFor(() => expect(api.instanceList).toHaveBeenCalledTimes(1));
  return { api, onOpen, onBack, onOpenDesktop, i18n, ...view };
}
it.each(Object.keys(resources) as Array<keyof typeof resources>)(
  'shows the empty state in %s without creating anything',
  async (lang) => {
    const f = await setup([], lang);
    await screen.findByRole('button', { name: resources[lang].cloudSettings.onboarding.claim });
    expect(f.container.textContent).not.toContain('cloudSettings.');
    expect(f.api.instanceClaim).not.toHaveBeenCalled();
    expect(f.api.instanceInitialize).not.toHaveBeenCalled();
  },
);
it('a failed read shows retry, never the claim action', async () => {
  const f = await setup([], 'zh-CN', true);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '领取云端 Cindy' })).toBeNull();
  expect(f.api.instanceClaim).not.toHaveBeenCalled();
});
it('double clicking claim sends once, initializes only the returned device and shows progress', async () => {
  const f = await setup();
  const button = await screen.findByRole('button', { name: '领取云端 Cindy' });
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByRole('button', { name: '重新打开登录页' });
  expect(f.api.instanceClaim).toHaveBeenCalledTimes(1);
  expect(f.api.instanceInitialize).toHaveBeenCalledExactlyOnceWith({ deviceId: 'example-device' });
  expect(screen.getByRole('list', { name: '领取进度' })).toBeTruthy();
  expect(f.onOpen).not.toHaveBeenCalled();
});
// S3: an unknown claim is read back from the list (claiming again could make a second instance).
it('unknown creation is read back from the list and never claimed again', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const f = await setup();
    f.api.instanceClaim.mockRejectedValue(Error('unknown'));
    const claim = await screen.findByRole('button', { name: '领取云端 Cindy' });
    fireEvent.click(claim);
    await waitFor(() => expect(f.api.instanceClaim).toHaveBeenCalledTimes(1));
    // While it is read back only the button spins; another click sends nothing.
    fireEvent.click(claim);
    f.api.instanceList.mockResolvedValue([target]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await screen.findByRole('button', { name: '登录云端 Cindy' });
    expect(f.api.instanceClaim).toHaveBeenCalledTimes(1);
    expect(f.api.instanceInitialize).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it('existing sleeping instances have a settings entry, never a claim or automatic wake', async () => {
  const f = await setup([{ ...target, loginRequired: false, desiredState: 'stopped' }]);
  const button = await screen.findByRole('button', { name: '设置' });
  expect(screen.queryByRole('button', { name: '领取云端 Cindy' })).toBeNull();
  expect(f.api.instanceClaim).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(f.onOpen).toHaveBeenCalledWith('example-device');
});
it('login completion waits for runtime readiness before opening the settings', async () => {
  const f = await setup([target]);
  fireEvent.click(await screen.findByRole('button', { name: '登录云端 Cindy' }));
  await screen.findByRole('button', { name: '重新打开登录页' });
  f.api.instanceList.mockResolvedValue([{ ...target, loginRequired: false }]);
  fireEvent.click(screen.getByRole('button', { name: zhCN.settings.devices.refresh }));
  await screen.findByText(zhCN.cloudSettings.instance.state.starting);
  expect(f.onOpen).not.toHaveBeenCalled();
  f.api.instanceList.mockResolvedValue([
    { ...target, loginRequired: false, ready: true, runtimeState: 'running' },
  ]);
  fireEvent.click(screen.getByRole('button', { name: zhCN.settings.devices.refresh }));
  await waitFor(() => expect(f.onOpen).toHaveBeenCalledExactlyOnceWith('example-device'));
});

const running: CloudInstanceView = {
  ...target,
  loginRequired: false,
  ready: true,
  runtimeState: 'running',
};
const sleeping: CloudInstanceView = {
  ...running,
  desiredState: 'stopped',
  runtimeState: 'stopped',
  ready: false,
};

it('quick desktop opens only the selected ready instance and never changes its power state', async () => {
  const f = await setup([
    running,
    { ...running, deviceId: 'device-b', instanceId: 'b', name: 'Cloud B' },
  ]);
  const own = within(await screen.findByRole('region', { name: 'Cloud A' }));
  fireEvent.click(own.getByRole('button', { name: zhCN.remoteDesktop.title }));
  expect(f.onOpenDesktop).toHaveBeenCalledExactlyOnceWith(running);
  expect(
    (
      within(screen.getByRole('region', { name: 'Cloud B' })).getByRole('button', {
        name: zhCN.remoteDesktop.title,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(f.api.instancePower).not.toHaveBeenCalled();
});

it('canceling quick sleep preserves the instance and names the target in the confirmation', async () => {
  confirmation.confirm.mockResolvedValueOnce(false);
  const f = await setup([running]);
  fireEvent.click(await screen.findByRole('button', { name: '休眠' }));
  await waitFor(() => expect(confirmation.confirm).toHaveBeenCalledOnce());
  expect(confirmation.confirm.mock.calls[0][0].title).toContain('Cloud A');
  expect(f.api.instancePower).not.toHaveBeenCalled();
});

it('quick wake submits once for the selected instance and keeps stale list results disabled', async () => {
  const f = await setup([sleeping]);
  const wake = await screen.findByRole('button', { name: '唤醒' });
  fireEvent.click(wake);
  fireEvent.click(wake);
  await waitFor(() =>
    expect(f.api.instancePower).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'example-device',
      action: 'wake',
    }),
  );
  // Under way: the power buttons wait until the list shows the instance there.
  await waitFor(() => expect((wake as HTMLButtonElement).disabled).toBe(true));
  expect(confirmation.confirm).not.toHaveBeenCalled();
  f.api.instanceList.mockResolvedValue([running]);
  fireEvent.click(screen.getByRole('button', { name: zhCN.settings.devices.refresh }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '休眠' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
});

it.each(Object.keys(resources) as Array<keyof typeof resources>)(
  'a refused claim says why in %s and is not left uncertain',
  async (lang) => {
    const f = await setup([], lang);
    // As it arrives over IPC on the desktop.
    f.api.instanceClaim.mockRejectedValue(
      Error(
        "Error invoking remote method 'cloud-settings:instance-claim': Error: [CLOUD_SETTINGS_ADMISSION_NOT_LISTED] CLOUD_SETTINGS_ADMISSION_NOT_LISTED",
      ),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: resources[lang].cloudSettings.onboarding.claim }),
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      resources[lang].cloudSettings.refusal.CLOUD_SETTINGS_ADMISSION_NOT_LISTED,
    );
    // A refusal created nothing: no read-back of the claim follows.
    expect(screen.queryByText(resources[lang].cloudSettings.onboarding.claimUnreadable)).toBeNull();
    expect(f.api.instanceClaim).toHaveBeenCalledTimes(1);
    // The instance sign-in window resolves the same codes through its own error keys.
    expect(f.i18n.t('login.errors.CLOUD_SETTINGS_MEMBER_SUSPENDED')).toBe(
      resources[lang].cloudSettings.refusal.CLOUD_SETTINGS_MEMBER_SUSPENDED,
    );
  },
);
it('a refused wake says why instead of an unconfirmed result', async () => {
  const f = await setup([sleeping]);
  // As it arrives in the cloud web page.
  f.api.instancePower.mockRejectedValueOnce(Error('CLOUD_SETTINGS_INSTANCE_TRANSFERRED'));
  fireEvent.click(await screen.findByRole('button', { name: '唤醒' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    zhCN.cloudSettings.refusal.CLOUD_SETTINGS_INSTANCE_TRANSFERRED,
  );
  // Nothing changed and asking again would be refused too: no retry, and nothing is read back.
  expect(screen.queryByRole('button', { name: zhCN.commonUi.retry })).toBeNull();
  expect(screen.queryByText(zhCN.cloudSettings.instance.statusUnreadable)).toBeNull();
  expect(f.api.instancePower).toHaveBeenCalledTimes(1);
});
const fill = (text: string, values: Record<string, number>) =>
  text.replace(/\{\{(\w+)\}\}/gu, (_, key: string) => String(values[key]));
it.each(Object.keys(resources) as Array<keyof typeof resources>)(
  'offers another instance below the limit in %s, confirms first, and signs the new one in',
  async (lang) => {
    const words = resources[lang].cloudSettings.onboarding;
    const second: CloudInstanceView = { ...target, instanceId: 'second-instance', deviceId: 'second-device', name: 'Cloud B' };
    const f = await setup([running], lang, false, undefined, { limit: 3, used: 1 });
    await screen.findByText(fill(words.capacity, { used: 1, limit: 3 }));
    expect(screen.getByText(fill(words.capacityRemaining, { n: 2 }))).toBeTruthy();
    expect(f.container.textContent).not.toContain('cloudSettings.');
    f.api.instanceClaim.mockResolvedValue([running, second]);
    fireEvent.click(screen.getByRole('button', { name: words.claimAnother }));
    await waitFor(() => expect(f.api.instanceInitialize).toHaveBeenCalledExactlyOnceWith({ deviceId: 'second-device' }));
    expect(confirmation.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: words.claimAnotherTitle, confirmText: words.claimAnother }));
    expect(f.api.instanceClaim).toHaveBeenCalledExactlyOnceWith({ another: true });
  },
);
it('offers no further instance at the limit, without a reported limit, or when the confirmation is declined', async () => {
  let f = await setup([running], 'zh-CN', false, undefined, { limit: 1, used: 1 });
  await screen.findByText(zhCN.cloudSettings.instance.noUpdate);
  expect(screen.queryByRole('button', { name: zhCN.cloudSettings.onboarding.claimAnother })).toBeNull();
  cleanup();
  f = await setup([running], 'zh-CN', false, undefined, null);
  await screen.findByText(zhCN.cloudSettings.instance.noUpdate);
  expect(screen.queryByRole('button', { name: zhCN.cloudSettings.onboarding.claimAnother })).toBeNull();
  cleanup();
  f = await setup([running], 'zh-CN', false, undefined, { limit: 2, used: 1 });
  confirmation.confirm.mockResolvedValueOnce(false);
  fireEvent.click(await screen.findByRole('button', { name: zhCN.cloudSettings.onboarding.claimAnother }));
  await waitFor(() => expect(confirmation.confirm).toHaveBeenCalledTimes(1));
  expect(f.api.instanceClaim).not.toHaveBeenCalled();
});
// S3: an unknown sleep or wake is read back from the list, never sent again. When no read answers,
// the card says the state could not be read and only an explicit reload reads it once more.
it('unknown power results are read back, never retried, and reload only on request', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const f = await setup([sleeping]);
    f.api.instancePower.mockRejectedValueOnce(Error('unconfirmed'));
    f.api.instanceList.mockRejectedValue(Error('offline'));
    fireEvent.click(await screen.findByRole('button', { name: '唤醒' }));
    await waitFor(() => expect(f.api.instancePower).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '唤醒' }));
    // Every read-back (2 + 4 + 8 + 16 + 30 s) fails.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const failure = (await screen.findByText(zhCN.cloudSettings.instance.statusUnreadable)).closest(
      '[role=alert]',
    ) as HTMLElement;
    expect(failure).not.toBeNull();
    expect(f.api.instancePower).toHaveBeenCalledTimes(1);
    // An explicit reload reads the list once more; the instance is awake after all.
    f.api.instanceList.mockResolvedValue([running]);
    fireEvent.click(within(failure).getByRole('button', { name: zhCN.cloudSettings.reload }));
    await waitFor(() => expect(screen.queryByText(zhCN.cloudSettings.instance.statusUnreadable)).toBeNull());
    expect(f.api.instancePower).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it.each(['starting', 'stopping', 'verifying'] as const)(
  'transition %s never permits quick power or desktop',
  async (state) => {
    const instance =
      state === 'starting'
        ? { ...running, ready: false, runtimeState: 'pending' }
        : state === 'stopping'
          ? { ...sleeping, runtimeState: 'running' }
          : { ...running, upgradeState: 'verifying' as const };
    const f = await setup([instance]);
    const region = within(await screen.findByRole('region', { name: 'Cloud A' }));
    expect(
      (
        region.getByRole('button', {
          name: state === 'stopping' ? '唤醒' : '休眠',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (region.getByRole('button', { name: zhCN.remoteDesktop.title }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(f.api.instancePower).not.toHaveBeenCalled();
  },
);

it('leaving while the sleep confirmation is open sends no power request', async () => {
  let finish!: (value: boolean) => void;
  confirmation.confirm.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const f = await setup([running]);
  fireEvent.click(await screen.findByRole('button', { name: '休眠' }));
  f.unmount();
  finish(true);
  await Promise.resolve();
  expect(f.api.instancePower).not.toHaveBeenCalled();
});

it.each(Object.keys(resources) as Array<keyof typeof resources>)(
  'quick actions and update summaries translate in %s',
  async (lang) => {
    const f = await setup([running], lang);
    await screen.findByText(resources[lang].cloudSettings.instance.noUpdate);
    expect(f.container.textContent).not.toContain('cloudSettings.');
    expect(
      screen.getByRole('button', { name: resources[lang].cloudSettings.instance.sleep }),
    ).toBeTruthy();
    expect(f.api.instancePower).not.toHaveBeenCalled();
  },
);
it('a late claim response after leaving does not initialize a cloud identity', async () => {
  const f = await setup();
  let resolve!: (value: CloudInstanceView[]) => void;
  f.api.instanceClaim.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  fireEvent.click(await screen.findByRole('button', { name: '领取云端 Cindy' }));
  f.unmount();
  resolve([target]);
  await Promise.resolve();
  expect(f.api.instanceInitialize).not.toHaveBeenCalled();
});
it('multiple owned instances require an explicit choice and do not auto-login', async () => {
  const f = await setup([
    target,
    {
      ...target,
      instanceId: 'b',
      deviceId: 'device-b',
      name: 'Cloud B',
      loginRequired: false,
      ready: true,
    },
  ]);
  fireEvent.click(await screen.findByRole('button', { name: '设置' }));
  expect(f.onOpen).toHaveBeenCalledWith('device-b');
  expect(f.api.instanceInitialize).not.toHaveBeenCalled();
  expect(f.api.instanceClaim).not.toHaveBeenCalled();
});

it('names each by its own name, never a made-up number; two alike get the usual (1)/(2)', async () => {
  const sole = { ...target, name: null, nameSequence: 15, ordinal: null };
  await setup([sole]);
  // The instance's own heading; the page title is the same product name since 2026-11-09.
  expect(await screen.findByRole('heading', { name: '云端 Cindy', level: 3 })).toBeTruthy();
  expect(screen.queryByText(/云端 Cindy 15/)).toBeNull();
  cleanup();
  // Listed out of order; the (1)/(2) follow the client's device-name rule and read in order.
  await setup([
    { ...sole, instanceId: 'b', deviceId: 'device-b', nameSequence: 22, ordinal: 2 },
    { ...sole, ordinal: 1 },
  ]);
  const headings = await screen.findAllByRole('heading', { level: 3 });
  expect(headings.map((heading) => heading.textContent)).toEqual(['云端 Cindy (1)', '云端 Cindy (2)']);
  expect(screen.queryByText(/云端 Cindy [12]$/)).toBeNull();
  cleanup();
  await setup([{ ...sole, name: '工作机' }, { ...sole, instanceId: 'b', deviceId: 'device-b' }]);
  expect(await screen.findByRole('heading', { name: '工作机' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '云端 Cindy', level: 3 })).toBeTruthy();
});

it('maintenance shortcut opens only the selected instance without changing its policy', async () => {
  const f = await setup([
    running,
    { ...running, deviceId: 'device-b', instanceId: 'b', name: 'Cloud B' },
  ]);
  fireEvent.click(
    within(await screen.findByRole('region', { name: 'Cloud B' })).getByRole('button', {
      name: '更新',
    }),
  );
  expect(f.onOpen).toHaveBeenCalledExactlyOnceWith('device-b', 'maintenance');
  expect(f.api.instancePower).not.toHaveBeenCalled();
});

// Regression: a background authorization must refresh the list without moving
// the main workspace to another route (including when the runtime is ready).
it('refreshes auxiliary login completion without navigating the client', async () => {
  let complete!: () => void;
  const unsubscribe = vi.fn();
  const f = await setup([target], 'zh-CN', false, (cb) => { complete = cb; return unsubscribe; });
  fireEvent.click(await screen.findByRole('button', { name: '登录云端 Cindy' }));
  await screen.findByRole('button', { name: '重新打开登录页' });
  f.api.instanceList.mockResolvedValue([running]);
  complete();
  await screen.findByRole('button', { name: '设置' });
  expect(f.onOpen).not.toHaveBeenCalled();
  f.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});


it.each(Object.keys(resources) as Array<keyof typeof resources>)(
  'retains sleeping authentication state and offers explicit wake-and-login in %s', async (lang) => {
    const f = await setup([{ ...target, desiredState: 'stopped', loginWakeSupported: true }], lang);
    await screen.findByText(resources[lang].cloudSettings.onboarding.asleepNeedsLogin);
    const button = await screen.findByRole('button', { name: resources[lang].cloudSettings.onboarding.wakeAndLogin });
    expect(f.api.instanceInitialize).not.toHaveBeenCalled();
    expect(f.api.instancePower).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(f.api.instanceInitialize).toHaveBeenCalledExactlyOnceWith({ deviceId: target.deviceId }));
    expect(f.api.instancePower).not.toHaveBeenCalled();
    expect(f.container.textContent).not.toContain('cloudSettings.');
  },
);
it('allows sleep during login without claiming that the runtime is ready', async () => {
  const f = await setup([target]);
  fireEvent.click(await screen.findByRole('button', { name: '休眠' }));
  await waitFor(() => expect(f.api.instancePower).toHaveBeenCalledExactlyOnceWith({ deviceId: target.deviceId, action: 'sleep' }));
  expect(f.onOpen).not.toHaveBeenCalled();
});
it('does not permit authentication or power changes during maintenance', async () => {
  const f = await setup([{ ...target, upgradeState: 'verifying' }]);
  expect((await screen.findByRole('button', { name: '休眠' }) as HTMLButtonElement).disabled).toBe(true);
  expect(f.api.instancePower).not.toHaveBeenCalled();
});

it('sleep cancels the old login completion navigation without waking on a later ready notification', async () => {
  const f = await setup([target]);
  fireEvent.click(await screen.findByRole('button', { name: '登录云端 Cindy' }));
  await screen.findByRole('button', { name: '重新打开登录页' });
  fireEvent.click(screen.getByRole('button', { name: '休眠' }));
  await waitFor(() => expect(f.api.instancePower).toHaveBeenCalledOnce());
  f.api.instanceList.mockResolvedValue([{ ...target, loginRequired: false, ready: true, runtimeState: 'running' }]);
  fireEvent.click(screen.getByRole('button', { name: zhCN.settings.devices.refresh }));
  await screen.findByText(zhCN.cloudSettings.instance.state.running);
  expect(f.onOpen).not.toHaveBeenCalled();
  expect(f.api.instancePower).toHaveBeenCalledExactlyOnceWith({ deviceId: target.deviceId, action: 'sleep' });
});

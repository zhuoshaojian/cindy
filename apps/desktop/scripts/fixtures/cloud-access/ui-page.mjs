import assert from 'node:assert/strict';

const CLOUD = 'cloud-device-0123456789abcdef01234567';
const PENDING = 'cloud-device-89abcdef0123456789abcdef';
const maintenance = {
  instanceId: 'fixture-running', revision: 'a'.repeat(64), defaultsRevision: 1, autoUpdate: true,
  raw: { policyMode: 'inherit', calendar: null, scheduledTaskPolicy: 'protect', pausedUntilMs: null },
  effective: {
    source: 'inherit',
    calendar: {
      timezone: 'Asia/Shanghai',
      windows: [{ id: 'daily', weekdays: [1, 2, 3, 4, 5, 6, 7], startLocal: '03:00', endLocal: '05:00' }],
    },
  },
  executionMode: 'scheduled', nextEligibleAtMs: 1793900000000, serverTimeMs: 1793860000000, windows: [],
};
const instance = (deviceId, extra) => ({
  instanceId: deviceId, deviceId, name: null, nameSequence: 1, desiredState: 'running',
  runtimeState: 'running', ready: true, version: '0.1.121-cloud.10-cn-amd64', imageId: null,
  updateAvailable: false, latestVersion: null, upgradeState: 'idle', observedAtMs: null,
  manualUpgrade: true, ...extra,
});

// The update hours (owner, 2026-11-09, plan A): one dropdown. A saved schedule it cannot show
// stays as it was until another choice is saved.
const complexPolicy = {
  ...maintenance,
  raw: {
    ...maintenance.raw,
    policyMode: 'custom',
    calendar: {
      timezone: 'Asia/Shanghai',
      windows: [
        { id: 'workdays', weekdays: [1, 2, 3, 4, 5], startLocal: '01:00', endLocal: '03:00' },
        { id: 'weekend', weekdays: [6, 7], startLocal: '13:00', endLocal: '15:00' },
      ],
    },
  },
};
complexPolicy.effective = { source: 'custom', calendar: complexPolicy.raw.calendar };
const scheduleCase = (complex, width, extra = {}) => ({
  about: `The updates dialog's update hours, ${complex ? 'with a saved schedule of several windows' : 'following the default'}, ${width}px`,
  viewport: { width, height: 900 },
  data: {
    access: 'allowed', schedule: complex ? 'complex' : 'default', ...extra,
    instances: [instance(CLOUD, { instanceId: 'fixture-running', policy: complex ? complexPolicy : maintenance })],
  },
});

// The card's ⋯ menu (owner, 2026-11-12: the card's only actions layout), in each card state.
const MENU_STATES = {
  running: {},
  update: { updateAvailable: true, latestVersion: '0.1.126-cloud.3' },
  asleep: { desiredState: 'stopped', runtimeState: 'stopped', ready: false },
  upgrading: {
    updateAvailable: true, latestVersion: '0.1.126-cloud.3',
    upgradeOperation: { operationId: 'op', phase: 'backup-running', active: true, updatedAtMs: 1793860000000 },
  },
};
const menuCase = (state, width, extra = {}) => ({
  about: `Card actions in the Manage menu, ${state}, ${width}px`,
  viewport: { width, height: 900 },
  data: {
    access: 'allowed', menuState: state, ...extra,
    instances: [instance(CLOUD, { instanceId: 'fixture-running', policy: maintenance, ...MENU_STATES[state] })],
  },
});
const menuCases = Object.fromEntries(
  Object.keys(MENU_STATES).flatMap((state) =>
    [900, 360].map((width) => [`menu-${state}${width === 360 ? '-narrow' : ''}`, menuCase(state, width)]),
  ),
);

export default {
  name: 'cloud-access',
  entry: './fixture.tsx',
  viewport: { width: 900, height: 900 },
  real: 'RemoteControlSection, MyDevicesPanel and CloudDeviceDirectory (the cloud card ⋯ menu, CIS-only rows, claim entry), CloudMaintenanceDialog with the embedded CloudInstanceSection and the upgrade confirmation and CloudInstanceAccessProvider',
  notCovered:
    'Real CIS/authentication, the device-link directory, the relay/SSH panels and instance mutations (all forbidden here); navigation, search and the dialog draft guard have unit coverage',
  stubs: {
    'src/renderer/contexts/AuthContext':
      'export const useAuth=()=>({mode:"cloud",isAuthenticated:true,isInitializing:false,canEnterApp:true,dataOwnerId:"fixture-owner",dataOwnerGeneration:1});',
    'src/renderer/features/device-link/useDeviceLinkDeviceList':
      'export const useDeviceLinkDeviceList=()=>[];',
    // The device directory as the device-link service reports it: this Mac, the cloud
    // instance (a Linux device) and an ordinary computer.
    'src/renderer/hooks/useDeviceLinkSettings': `const d=(deviceId,name,platform,appVersion,online,isSelf=false)=>({deviceId,name,platform,appVersion,lastSeenAt:Date.now()-3600e3,online,busy:false,remoteControlEnabled:true,controlEnabled:true,isSelf,deviceInfo:null});
const noop=async()=>{};
export const useDeviceLinkSettings=()=>({enabled:true,linkStatus:"online",connectionIssue:null,standby:false,devices:[d("self","Studio Mac","darwin","0.1.126",true,true),d("${CLOUD}","云端 Cindy","linux","0.1.121-cloud.10",!window.__uiPage?.ctx?.data?.offline),d("mac-mini","Mac mini","darwin","0.1.125",false)],controlledBy:[],revokedControllers:[],disabledControlDeviceIds:[],listError:null,refreshing:false,refresh:noop,setEnabled:noop,rename:noop,remove:async()=>false,disconnectAll:noop,revoke:noop,restore:noop,setDeviceControlEnabled:noop});`,
    'src/renderer/components/settings/RemoteDesktopSetting':
      'export const RemoteDesktopSetting=()=>null;',
    'src/renderer/components/settings/RemoteSection': 'export const RemoteSection=()=>null;',
    'src/renderer/components/settings/RelayServicePanel': {
      partial: 'export const RelayServicePanel=()=>null;',
    },
  },
  cases: {
    default: {
      about: 'Admitted account without an instance: claim entry at the end of My devices',
      data: { access: 'allowed', instances: [] },
    },
    listed: {
      about: 'The cloud device card gains CIS state and the Manage menu, marked for an available update; the updates dialog opens from it and the upgrade asks first; a CIS-only instance waiting for login gets its own row',
      data: {
        access: 'allowed',
        instances: [
          instance(CLOUD, {
            instanceId: 'fixture-running', policy: maintenance, updateAvailable: true,
            latestVersion: '0.1.126-cloud.3',
          }),
          instance(PENDING, {
            instanceId: 'fixture-pending', nameSequence: 2, runtimeState: 'starting',
            ready: false, loginRequired: true, version: null,
          }),
        ],
      },
    },
    running: {
      about: 'Running and up to date: the Manage menu, no update mark, no reason',
      data: { access: 'allowed', instances: [instance(CLOUD, { instanceId: 'fixture-running', policy: maintenance })] },
    },
    'dev-options': {
      about: 'The dev-only options open from a floating button in the corner; the page under them keeps its release layout',
      data: { access: 'allowed', devOptions: true, instances: [instance(CLOUD, { instanceId: 'fixture-running', policy: maintenance })] },
    },
    'dev-options-fault': {
      about: 'A simulated frame chosen in the dev options: marked on the floating button, and the card shows it',
      data: {
        // By code: indexes move as frames are added (32I: the card updating).
        access: 'allowed', devOptions: true, frame: ['card', '32I'],
        instances: [instance(CLOUD, { instanceId: 'fixture-running', policy: maintenance })],
      },
    },
    'frame-32f': {
      about: 'Scenario 32F: the instance status could not be read: grey dot and 状态加载失败 in the meta line, no button there (the list 刷新 reads it again), beside a local device card',
      data: {
        access: 'allowed', frame: ['card', '32F'],
        instances: [instance(CLOUD, { instanceId: 'fixture-running', policy: maintenance })],
      },
    },
    'upgrade-offline': {
      about: 'CIS still reports running/ready from before an upgrade while DeviceLink has the instance offline: the card says upgrading',
      data: {
        access: 'allowed',
        offline: true,
        instances: [
          instance(CLOUD, {
            instanceId: 'fixture-running', policy: maintenance, observedAtMs: 1793860000000,
            upgradeOperation: { operationId: 'op', phase: 'completed', active: false, updatedAtMs: 1793860300000 },
          }),
        ],
      },
    },
    upgrading: {
      about: 'Upgrading: progress in the subtitle, a spinner on the Updates item of the menu, and why instance settings wait',
      data: {
        access: 'allowed',
        instances: [
          instance(CLOUD, {
            instanceId: 'fixture-running', policy: maintenance, updateAvailable: true,
            latestVersion: '0.1.126-cloud.3',
            upgradeOperation: { operationId: 'op', phase: 'backup-running', active: true, updatedAtMs: 1793860000000 },
          }),
        ],
      },
    },
    login: {
      about: 'Waiting for cloud sign-in: the sign-in row, and only sleep in the menu',
      data: {
        access: 'allowed',
        instances: [
          instance(CLOUD, {
            instanceId: 'fixture-running', policy: maintenance, runtimeState: 'starting',
            ready: false, loginRequired: true,
          }),
        ],
      },
    },
    asleep: {
      about: 'An asleep instance: state in the subtitle, instance settings and remote desktop disabled, wake on offer',
      data: {
        access: 'allowed',
        instances: [
          instance(CLOUD, {
            instanceId: 'fixture-running', policy: maintenance, desiredState: 'stopped',
            runtimeState: 'stopped', ready: false, updateAvailable: true,
            latestVersion: '0.1.126-cloud.3',
          }),
        ],
      },
    },
    ...menuCases,
    schedule: scheduleCase(false, 900),
    'schedule-narrow': scheduleCase(false, 360),
    'schedule-complex': scheduleCase(true, 900),
    'schedule-complex-narrow': scheduleCase(true, 360),
    'schedule-open': scheduleCase(false, 900, { scheduleOpen: true }),
    'menu-open': menuCase('update', 900, { menuOpen: true }),
    'menu-upgrading-open': menuCase('upgrading', 900, { menuOpen: true }),
    denied: { about: 'Rejected membership: the device list is unchanged and CIS is never read', data: { access: 'hidden', section: 'remoteControl.devices' } },
    pending: {
      about: 'Pending admission never flashes cloud controls',
      data: { access: 'checking', section: 'remoteControl.devices' },
    },
  },
  async ready(page) {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-access]')?.getAttribute('data-access') ===
        window.__uiPage.ctx.data.access,
    );
    await page.locator(`li[data-device-id="${CLOUD}"]`).waitFor();
  },
  async check(page, ui) {
    const allowed = ui.data.access === 'allowed';
    // A simulated card frame on its own (no dev options open): the card shows it.
    if (ui.data.frame && !ui.data.devOptions) {
      const card = page.locator(`li[data-device-id="${CLOUD}"]`);
      await card.getByText(await ui.t('cloudSettings.instance.statusUnreadable'), { exact: false }).waitFor();
      // 32F: the state in the meta line, with its own icon-only retry right beside it (T52).
      assert.equal(await card.locator('button[data-cloud-inline-retry]').count(), 1);
      await ui.capture('frame');
      return;
    }
    // A release page: no dev options box takes space in the page.
    assert.equal(await page.locator('main .border-dashed').count(), 0);
    if (ui.data.devOptions) {
      const options = page.getByRole('dialog', { name: '开发选项' });
      const marker = page.locator('[data-cloud-preview] button', { hasText: '开发选项' });
      if (ui.data.frame) {
        // A simulated frame is marked on the button, and the card shows it.
        assert.match(await marker.textContent(), /模拟中/);
        await page
          .locator(`li[data-device-id="${CLOUD}"]`)
          .getByText(await ui.t('cloudSettings.instance.cardUpdating'), { exact: false })
          .waitFor();
        await ui.capture('dev-options-fault');
        return;
      }
      // Decided (owner, 2026-11-12): placement and card actions are no longer offered; only the
      // entry to the simulated failures is left.
      await options.getByRole('button', { name: '打开异常场景面板' }).waitFor();
      assert.equal(await options.getByRole('radiogroup').count(), 0);
      // T32: one entry, the scenario panel; the scenarios are chosen there.
      const openPanel = options.getByRole('button', { name: '打开异常场景面板' });
      assert.doesNotMatch(await marker.textContent(), /模拟中/);
      assert.equal(await page.locator('main [data-cloud-preview]').count(), 0);
      await ui.capture('dev-options');
      // The panel opens with nothing simulated yet (亲手体验 first, then the 验收清单), and ending
      // a chosen frame closes it without leaving a fault.
      await openPanel.click();
      const scenarios = page.getByRole('region', { name: '异常场景' });
      await scenarios.getByRole('radiogroup', { name: '更新流程的结果' }).waitFor();
      const running = scenarios.getByRole('button', { name: /^运行中/ }).first();
      await running.waitFor();
      await ui.capture('scenario-panel');
      await running.click();
      await scenarios.getByRole('button', { name: '结束模拟', exact: true }).click();
      await scenarios.waitFor({ state: 'detached' });
      assert.doesNotMatch(await marker.textContent(), /模拟中/);
      return;
    }
    const card = page.locator(`li[data-device-id="${CLOUD}"]`);
    const manage = card.getByRole('button', { name: await ui.t('cloudSettings.instance.manage'), exact: true });
    /** Opens the card's ⋯ menu; returns it. */
    const openMenu = async () => {
      await manage.click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      return menu;
    };
    const menuItem = async (menu, key) =>
      menu.getByRole('menuitem', { name: new RegExp(`^${await ui.t(key)}`) });
    const closeMenu = async (menu) => {
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
    };
    if (ui.data.schedule) {
      await (await menuItem(await openMenu(), 'cloudSettings.instance.updates')).click();
      const dialog = page.getByRole('dialog', { name: await ui.t('cloudSettings.instance.updates') });
      const hours = dialog.getByRole('combobox', { name: await ui.t('cloudSettings.instance.schedule') });
      await hours.waitFor();
      // The old editor is gone: no time zone picker, weekday buttons, times or added windows.
      assert.equal(await dialog.locator('details, input[type="time"]').count(), 0);
      assert.equal(await dialog.getByRole('button', { pressed: true }).count(), 0);
      if (ui.data.schedule === 'complex') {
        assert.equal((await hours.textContent()).trim(), await ui.t('cloudSettings.instance.scheduleKeepMany'));
        await dialog.getByText(new RegExp(`^${(await ui.t('cloudSettings.instance.scheduleKept', { schedule: 'X', zone: 'Y' })).split('X')[0]}`)).waitFor();
      } else {
        assert.equal(
          (await hours.textContent()).trim(),
          await ui.t('cloudSettings.instance.scheduleDefault', {
            schedule: await ui.t('cloudSettings.instance.windowDaily', { start: '03:00', end: '05:00' }),
          }),
        );
      }
      // Changes save as they are made (direction C): 完成 is the only button in the footer.
      await dialog.getByRole('button', { name: await ui.t('cloudSettings.instance.done'), exact: true }).waitFor();
      await ui.capture('dialog');
      if (ui.data.scheduleOpen) {
        await hours.click();
        const options = page.getByRole('option');
        await options.first().waitFor();
        // The default and the other 23 daily windows: the default is not offered twice.
        assert.equal(await options.count(), 24);
        await ui.capture('dropdown');
        await page.keyboard.press('Escape');
        await options.first().waitFor({ state: 'detached' });
      }
      await dialog.getByRole('button', { name: await ui.t('cloudSettings.instance.done'), exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      return;
    }
    if (ui.data.menuState) {
      const state = ui.data.menuState;
      await card
        .getByText(await ui.t(state === 'upgrading' ? 'cloudSettings.instance.cardUpdating' : `cloudSettings.instance.state.${state === 'asleep' ? 'asleep' : 'running'}`), { exact: false })
        .waitFor();
      // No row under the header; the menu sits before remote desktop. Its name is just Manage (T59).
      assert.equal(await card.locator('[data-cloud-instance]').count(), 0);
      const header = card.getByRole('button', { name: await ui.t('remoteDesktop.title') }).locator('..');
      const labels = await header.locator('button').evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label')));
      assert.deepEqual(labels.slice(0, 2), [await ui.t('cloudSettings.instance.manage'), await ui.t('remoteDesktop.title')]);
      // The update dot only for an update to take.
      assert.equal(await manage.locator('.bg-\\[var\\(--status-bar-accent\\)\\]').count(), state === 'update' ? 1 : 0);
      // The menu entry never spins; a spinner sits on the item in progress.
      assert.equal(await manage.locator('.animate-spinner').count(), 0);
      // One line of actions; the name shows in full and the subtitle wraps in lines, not letters.
      const centers = await header.locator('button').evaluateAll((buttons) =>
        buttons.map((b) => { const r = b.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
      assert.equal(new Set(centers).size, 1, `one line of actions: ${centers}`);
      const title = card.locator('span.truncate').first();
      assert.ok(await title.evaluate((el) => el.scrollWidth <= el.clientWidth), 'the card name is not cut');
      const subtitle = card.locator('span.break-words').first();
      assert.ok((await subtitle.boundingBox()).height <= 3 * 17, 'the subtitle wraps in at most three lines');
      // Glyph spacing as the menu entry demo measured it: between drawn strokes (lucide extents).
      if (state === 'running' || state === 'update') {
        const gaps = await header.evaluate((row) => {
          const EXT = {
            'lucide-sliders-horizontal': [2, 22], 'lucide-monitor': [1, 23], 'lucide-pencil': [1, 23],
          };
          const ink = [...row.querySelectorAll('button svg')].map((icon) => {
            const name = [...icon.classList].find((c) => c in EXT);
            const r = icon.getBoundingClientRect(), k = r.width / 24;
            return { l: r.left + EXT[name][0] * k, r: r.left + EXT[name][1] * k };
          });
          return ink.slice(1).map((b, i) => Math.round((b.l - ink[i].r) * 10) / 10);
        });
        console.log(`SPACING menu-${state}-${ui.viewport.width}: ${gaps.join(' / ')}`);
        for (const gap of gaps) assert.ok(Math.abs(gap - 25.2) <= 2, `glyph gaps ${gaps}`);
      }
      await card.scrollIntoViewIfNeeded();
      await ui.capture('card');
      if (ui.data.menuOpen) {
        const menu = await openMenu();
        const updates = await menuItem(menu, 'cloudSettings.instance.updates');
        await updates.waitFor();
        if (state === 'upgrading') {
          // Upgrading spins on Updates, which still opens the dialog; Sleep waits.
          assert.equal(await updates.locator('.animate-spinner').count(), 1);
          assert.equal(await updates.getAttribute('data-disabled'), null);
          assert.equal(await menu.getByRole('menuitem').last().getAttribute('data-disabled'), '');
        }
        await ui.capture('menu');
        await closeMenu(menu);
      }
      return;
    }
    // The cloud instances link opens My devices (no separate group any more).
    assert.equal(await page.locator('#settings-search-target-remote-devices > button').getAttribute('aria-expanded'), 'true');
    const remove = card.getByRole('button', { name: await ui.t('settings.devices.delete'), exact: true });
    if (!allowed) {
      assert.equal(await manage.count(), 0);
      assert.equal(await remove.count(), 1);
      return;
    }
    if (!ui.data.instances.length) {
      await page.getByRole('button', { name: await ui.t('cloudSettings.onboarding.claim'), exact: true }).waitFor();
      await page.locator('li[data-device-id="cloud-claim"]').scrollIntoViewIfNeeded();
      await ui.capture('claim');
      return;
    }
    assert.equal(await remove.count(), 0);
    // Other devices keep their delete button, status and exact row set.
    const other = page.locator('li[data-device-id="mac-mini"]');
    assert.equal(await other.getByRole('button', { name: await ui.t('settings.devices.delete'), exact: true }).count(), 1);
    assert.equal(await other.locator('[data-cloud-instance]').count(), 0);
    const view = ui.data.instances[0];
    if (view.loginRequired) {
      await card.getByText(await ui.t('cloudSettings.onboarding.needsLogin')).waitFor();
      await card.getByRole('button', { name: await ui.t('cloudSettings.onboarding.initialize'), exact: true }).waitFor();
      await card.scrollIntoViewIfNeeded();
      await ui.capture('card');
      // Signing in is the next step: only sleep is in the menu.
      const menu = await openMenu();
      assert.deepEqual(
        await menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.textContent)),
        [await ui.t('cloudSettings.instance.sleep')],
      );
      await closeMenu(menu);
      return;
    }
    await manage.waitFor();
    /** The settings item: disabled with its reason, or usable. */
    const settingsItem = async (reasonKey) => {
      const menu = await openMenu();
      const settings = await menuItem(menu, 'cloudSettings.onboarding.openSettings');
      if (reasonKey) {
        assert.equal(await settings.getAttribute('data-disabled'), '');
        await settings.getByText(await ui.t(reasonKey)).waitFor();
      } else assert.equal(await settings.getAttribute('data-disabled'), null);
      return menu;
    };
    if (view.upgradeOperation) {
      await card.getByText(await ui.t('cloudSettings.instance.cardUpdating'), { exact: false }).waitFor();
      await card.scrollIntoViewIfNeeded();
      await ui.capture('card');
      await closeMenu(await settingsItem('cloudSettings.instance.settingsUpgrading'));
      return;
    }
    if (view.desiredState === 'stopped') {
      await card.getByText(await ui.t('cloudSettings.instance.state.asleep'), { exact: false }).waitFor();
      assert.equal(await card.getByRole('button', { name: await ui.t('remoteDesktop.title') }).isDisabled(), true);
      await card.scrollIntoViewIfNeeded();
      await ui.capture('card');
      const menu = await settingsItem('cloudSettings.instance.settingsWakeFirst');
      await (await menuItem(menu, 'cloudSettings.instance.wake')).waitFor();
      await closeMenu(menu);
      return;
    }
    await card.getByText(await ui.t('cloudSettings.instance.state.running'), { exact: false }).waitFor();
    await card.scrollIntoViewIfNeeded();
    await ui.capture('card');
    const menu = await settingsItem(null);
    // The update mark is on the menu's Updates item.
    const updates = await menuItem(menu, 'cloudSettings.instance.updates');
    assert.equal(
      await updates.getByText(await ui.t('cloudSettings.instance.updateBadge')).count(),
      view.updateAvailable ? 1 : 0,
    );
    if (!view.updateAvailable) {
      await closeMenu(menu);
      return;
    }
    // Updates and maintenance open in a dialog; the upgrade asks first, above it.
    await updates.click();
    const dialog = page.getByRole('dialog', { name: await ui.t('cloudSettings.instance.updates') });
    await dialog.getByText(/0\.1\.121-cloud\.10/).first().waitFor();
    await dialog.getByRole('switch', { name: await ui.t('cloudSettings.instance.autoUpdateEnable') }).waitFor();
    await ui.capture('dialog');
    await dialog.getByRole('button', { name: await ui.t('cloudSettings.instance.upgradeNow'), exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: await ui.t('cloudSettings.instance.upgradeConfirm'), exact: true }).waitFor();
    await ui.capture('upgrade-confirm');
    // Cancel the confirmation and the dialog: nothing is written (instanceUpgrade is forbidden).
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'detached' });
    await dialog.getByRole('button', { name: await ui.t('cloudSettings.instance.done'), exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    const pending = page.locator(`li[data-device-id="${PENDING}"]`);
    await pending.getByRole('button', { name: await ui.t('cloudSettings.onboarding.initialize'), exact: true }).waitFor();
    await pending.scrollIntoViewIfNeeded();
    await ui.capture('cis-only');
    // Collapsed, My devices keeps this computer and the cloud instances visible.
    await page.locator('#settings-search-target-remote-devices > button').click();
    assert.equal(await card.isVisible(), true);
    assert.equal(await pending.isVisible(), true);
    assert.equal(await page.locator('li[data-device-id="mac-mini"]').isVisible(), false);
    await page.locator('#settings-search-target-remote-devices').scrollIntoViewIfNeeded();
    await ui.capture('folded');
  },
};

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

export default {
  name: 'cloud-access',
  entry: './fixture.tsx',
  viewport: { width: 900, height: 900 },
  real: 'RemoteControlSection, MyDevicesPanel and CloudDeviceDirectory (cloud instance operations on device cards, CIS-only rows, claim entry, embedded CloudInstanceSection), CloudInstanceAccessProvider and CloudSettingsShortcut',
  notCovered:
    'Real CIS/authentication, the device-link directory, the relay/SSH panels and instance mutations (all forbidden here); navigation, search and the leave guard have unit coverage',
  stubs: {
    'src/renderer/contexts/AuthContext':
      'export const useAuth=()=>({mode:"cloud",isAuthenticated:true,isInitializing:false,canEnterApp:true,dataOwnerId:"fixture-owner",dataOwnerGeneration:1});',
    'src/renderer/features/device-link/useDeviceLinkDeviceList':
      'export const useDeviceLinkDeviceList=()=>[];',
    // The device directory as the device-link service reports it: this Mac, the cloud
    // instance (a Linux device) and an ordinary computer.
    'src/renderer/hooks/useDeviceLinkSettings': `const d=(deviceId,name,platform,appVersion,online,isSelf=false)=>({deviceId,name,platform,appVersion,lastSeenAt:Date.now()-3600e3,online,busy:false,remoteControlEnabled:true,controlEnabled:true,isSelf,deviceInfo:null});
const noop=async()=>{};
export const useDeviceLinkSettings=()=>({enabled:true,linkStatus:"online",connectionIssue:null,standby:false,devices:[d("self","Studio Mac","darwin","0.1.126",true,true),d("${CLOUD}","云端 Cindy","linux","0.1.121-cloud.10",true),d("mac-mini","Mac mini","darwin","0.1.125",false)],controlledBy:[],revokedControllers:[],disabledControlDeviceIds:[],listError:null,refreshing:false,refresh:noop,setEnabled:noop,rename:noop,remove:async()=>false,disconnectAll:noop,revoke:noop,restore:noop,setDeviceControlEnabled:noop});`,
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
      about: 'The cloud device card gains CIS state and settings rows, with an update available; a CIS-only instance waiting for login gets its own row',
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
    const card = page.locator(`li[data-device-id="${CLOUD}"]`);
    // The cloud instances link opens My devices (no separate group any more).
    assert.equal(await page.locator('#settings-search-target-remote-devices > button').getAttribute('aria-expanded'), 'true');
    const settings = card.getByRole('button', { name: await ui.t('cloudSettings.onboarding.openSettings') });
    const remove = card.getByRole('button', { name: await ui.t('settings.devices.delete'), exact: true });
    if (!allowed) {
      assert.equal(await settings.count(), 0);
      assert.equal(await remove.count(), 1);
      return;
    }
    if (!ui.data.instances.length) {
      await page.getByRole('button', { name: await ui.t('cloudSettings.onboarding.claim'), exact: true }).waitFor();
      await page.locator('li[data-device-id="cloud-claim"]').scrollIntoViewIfNeeded();
      await ui.capture('claim');
      return;
    }
    await settings.waitFor();
    assert.equal(await remove.count(), 0);
    // Other devices keep their delete button, status and exact row set.
    const other = page.locator('li[data-device-id="mac-mini"]');
    assert.equal(await other.getByRole('button', { name: await ui.t('settings.devices.delete'), exact: true }).count(), 1);
    assert.equal(await other.locator('[data-cloud-instance]').count(), 0);
    const updates = card.getByRole('button', { name: await ui.t('cloudSettings.instance.updates') });
    await updates.getByText('0.1.126-cloud.3').waitFor();
    if (ui.data.instances[0].desiredState === 'stopped') {
      await card.getByText(await ui.t('cloudSettings.instance.state.asleep')).waitFor();
      assert.equal(await settings.isDisabled(), true);
      assert.equal(await card.getByRole('button', { name: await ui.t('remoteDesktop.title') }).isDisabled(), true);
      await card.getByRole('button', { name: await ui.t('cloudSettings.instance.wake'), exact: true }).waitFor();
      await card.scrollIntoViewIfNeeded();
      await ui.capture('card');
      return;
    }
    await card.getByText(await ui.t('cloudSettings.instance.state.running')).waitFor();
    assert.equal(await settings.isDisabled(), false);
    const pending = page.locator(`li[data-device-id="${PENDING}"]`);
    await pending.getByRole('button', { name: await ui.t('cloudSettings.onboarding.initialize'), exact: true }).waitFor();
    await card.scrollIntoViewIfNeeded();
    await ui.capture('card');
    await updates.click();
    await card.getByText('0.1.121-cloud.10', { exact: true }).waitFor();
    await card.scrollIntoViewIfNeeded();
    await ui.capture('maintenance');
    await pending.scrollIntoViewIfNeeded();
    await ui.capture('cis-only');
    // Collapsed, My devices keeps this computer and the cloud instances visible.
    await updates.click();
    await page.locator('#settings-search-target-remote-devices > button').click();
    assert.equal(await card.isVisible(), true);
    assert.equal(await pending.isVisible(), true);
    assert.equal(await page.locator('li[data-device-id="mac-mini"]').isVisible(), false);
    await page.locator('#settings-search-target-remote-devices').scrollIntoViewIfNeeded();
    await ui.capture('folded');
  },
};

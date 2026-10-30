import assert from 'node:assert/strict';
export default {
  name: 'cloud-instance-sidebar',
  entry: './fixture.tsx',
  cases: { default: { about: 'CIS management stays reachable with the local relay stopped' } },
  viewport: { width: 320, height: 200 },
  real: 'CloudInstanceSidebarEntries, access provider, DeviceSectionHeader and CloudSettingsShortcut',
  notCovered:
    'Synthetic CIS list and unavailable remote desktop; no production credentials, task targets or cloud writes.',
  stubs: {
    'src/renderer/contexts/AuthContext':
      'export const useAuth=()=>({mode:"cloud",isAuthenticated:true,isInitializing:false,canEnterApp:true,dataOwnerId:"fixture-owner",dataOwnerGeneration:1});',
    'src/renderer/features/remote-desktop/useRemoteDesktopAvailability':
      'export const useRemoteDesktopAvailability=()=>({available:false,checking:false,reason:"remoteDesktop.shortcut.offline"});',
  },
  async ready(page) {
    await page.getByRole('link').first().waitFor();
  },
  async check(page, ui) {
    const name = await ui.t('cloudSettings.onboarding.defaultName', { number: 1 });
    const settings = page.getByRole('link', {
      name: await ui.t('cloudSettings.openFor', { name }),
      exact: true,
    });
    assert.equal(await settings.evaluate((el) => getComputedStyle(el.parentElement).opacity), '0');
    await ui.capture('resting');
    await page.getByRole('link', { name, exact: true }).hover();
    await settings.waitFor({ state: 'visible' });
    await ui.capture('hover');
    await settings.click();
    assert.equal(
      await page.getByRole('status').textContent(),
      '/cloud-settings?deviceId=cloud-device-0123456789abcdef01234567',
    );
  },
};

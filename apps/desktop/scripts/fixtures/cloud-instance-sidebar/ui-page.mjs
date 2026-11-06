import assert from 'node:assert/strict';
export default {
  name: 'cloud-instance-sidebar',
  entry: './fixture.tsx',
  cases: {
    default: {
      about: 'Project area lists no separate cloud instance entries; an online instance keeps its device-header shortcut',
    },
  },
  viewport: { width: 320, height: 240 },
  real: 'ProjectsSection with device grouping, DeviceSectionHeader, CloudSettingsShortcut and the access provider',
  notCovered:
    'Synthetic device index; no sessions, projects, remote desktop, production credentials or cloud writes. Settings → Remote connections → Cloud instances is covered by the cloud-access page.',
  stubs: {
    'src/renderer/contexts/AuthContext':
      'export const useAuth=()=>({mode:"cloud",isAuthenticated:true,isInitializing:false,canEnterApp:true,dataOwnerId:"fixture-owner",dataOwnerGeneration:1});',
    'src/renderer/features/remote-desktop/useRemoteDesktopAvailability':
      'export const useRemoteDesktopAvailability=()=>({available:false,checking:false,reason:"remoteDesktop.shortcut.offline"});',
  },
  async ready(page) {
    await page.getByText('我的云端 Cindy').first().waitFor();
  },
  async check(page, ui) {
    const name = '我的云端 Cindy';
    const settings = page.getByRole('link', {
      name: await ui.t('cloudSettings.openFor', { name }),
      exact: true,
    });
    await settings.waitFor({ state: 'attached' });
    // Only the device header row: no extra instance links in the project area.
    assert.equal(await page.getByRole('link').count(), 1);
    await ui.capture('resting');
    await page.getByText(name).first().hover();
    await settings.waitFor({ state: 'visible' });
    await ui.capture('hover');
  },
};

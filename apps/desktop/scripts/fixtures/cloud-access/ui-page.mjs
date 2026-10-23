import assert from 'node:assert/strict';

export default {
  name: 'cloud-access',
  entry: './fixture.tsx',
  viewport: { width: 900, height: 650 },
  real: 'CloudInstanceAccessProvider, CloudInstancesSection and CloudSettingsShortcut; empty membership and hidden admission states',
  notCovered:
    'Real CIS/authentication, the full Settings navigation and instance mutations; navigation/search have unit coverage',
  stubs: {
    'src/renderer/contexts/AuthContext':
      'export const useAuth=()=>({mode:"cloud",isAuthenticated:true,dataOwnerId:"fixture-owner",dataOwnerGeneration:1});',
    'src/renderer/features/device-link/useDeviceLinkDeviceList':
      'export const useDeviceLinkDeviceList=()=>[];',
  },
  cases: {
    default: {
      about: 'Admitted account without an instance can claim one',
      data: { access: 'allowed' },
    },
    denied: { about: 'Rejected membership has no cloud controls', data: { access: 'hidden' } },
    pending: {
      about: 'Pending admission never flashes cloud controls',
      data: { access: 'checking' },
    },
  },
  async ready(page) {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-access]')?.getAttribute('data-access') ===
        window.__uiPage.ctx.data.access,
    );
  },
  async check(page, ui) {
    const allowed = ui.data.access === 'allowed';
    assert.equal(await page.getByTestId('cloud-instances-page').count(), Number(allowed));
    assert.equal(await page.getByRole('link').count(), Number(allowed));
    if (allowed) {
      await page
        .getByRole('button', { name: await ui.t('cloudSettings.onboarding.claim'), exact: true })
        .waitFor();
      await page.locator('.group\\/device-header').hover();
      await ui.capture('shortcut-hover');
    }
  },
};

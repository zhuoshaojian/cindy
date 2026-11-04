import assert from 'node:assert/strict';
export default {
  name: 'cloud-sleep-login', entry: './fixture.tsx', viewport: { width: 800, height: 700 },
  real: 'CloudInstancesPage with sleeping and waiting-for-login runtime states',
  notCovered: 'Live CIS, SSO authorization, IPC and actual runtime power changes',
  cases: {
    default: { about: 'Sleeping runtime retains login requirement', data: { sleeping: true } },
    waiting: { about: 'User can sleep a runtime waiting for login', data: { sleeping: false } },
  },
  async check(page, ui) {
    const key = ui.data.sleeping ? 'cloudSettings.onboarding.wakeAndLogin' : 'cloudSettings.instance.sleep';
    await page.getByRole('button', { name: await ui.t(key), exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: await ui.t(key), exact: true }).isEnabled(), true);
  },
};

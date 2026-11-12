import access from '../cloud-access/ui-page.mjs';
import settings from '../cloud-settings/ui-page.mjs';

const CLOUD = 'cloud-device-0123456789abcdef01234567';

/**
 * The 验收清单 of the dev options' scenario panel (cloudFaultScripts.ts, `check: true`): the common
 * path and one representative of each failure or edge pattern, each on its own page. `frame` is
 * [scenario, code, name?]; `wait` is what has to be on screen before the picture.
 */
const FRAMES = {
  '32A': { frame: ['card', '32A'], about: 'The card, running' },
  '32B': { frame: ['card', '32B'], about: 'The card, starting (also after waking)' },
  '32H': { frame: ['card', '32H'], about: 'The card, asleep' },
  '32I': { frame: ['card', '32I'], about: 'The card, updating' },
  '32F': { frame: ['card', '32F'], about: 'The card: its status could not be read' },
  '30': { frame: ['power', '30'], wait: '[role=alertdialog]', about: 'The sleep confirmation' },
  '30B': { frame: ['power', '30B'], about: 'The card: sleep did not happen' },
  '29E': { frame: ['card-upgrading', '29E'], wait: '[role=status], [role=alert]', about: 'The notice when an update ended' },
  '25': { frame: ['upgrade', '25', '有新版本'], wait: '[role=dialog]', about: 'The updates dialog with a new version' },
  '25B': { frame: ['upgrade', '25B'], wait: '[role=dialog]', about: 'The updates dialog: the update failed, try again' },
  '26B': { frame: ['policy', '26B'], wait: '[role=dialog]', about: 'The updates dialog: the schedule was not saved' },
  // T43: the update dialog as one settings card (the local About page), and the card's notes.
  // T57: the card's menu while an update is scheduled, and the trigger's "update available" dot.
  '29H': { frame: ['card-upgrading', '29H'], wait: '[role=menu]', about: 'Scheduled: the card still runs; the Updates item has the clock and 已安排' },
  '29C': { frame: ['card-upgrading', '29C'], about: 'An update available: the dot on the manage trigger' },
  // T59: the menu opened from that trigger; marks in neutral text, the dot the one coloured element.
  '29C-menu': {
    frame: ['card-upgrading', '29C'],
    press: 'button[aria-label="管理"]',
    wait: '[role=menu]',
    about: 'An update available: the menu opened from 管理, the 有更新 mark in neutral text',
  },
  '29D': { frame: ['card-upgrading', '29D'], wait: '[role=menu]', about: 'An update failed: the 更新失败 mark in neutral text' },
  '25A': { frame: ['upgrade', '25A'], wait: '[role=dialog]', about: 'The updates dialog: queued, no button' },
  '25I': { frame: ['upgrade', '25I'], wait: '[role=dialog]', about: 'The updates dialog: failed (recovery-hold), nothing to do' },
  '25D': { frame: ['upgrade', '25D'], wait: '[role=dialog]', about: 'The updates dialog: updating, status with a spinner' },
  '25F': { frame: ['upgrade', '25F'], wait: '[role=dialog]', about: 'The updates dialog: updated' },
  '25H': { frame: ['upgrade', '25H'], wait: '[role=dialog]', about: 'The updates dialog: failed and rolled back' },
  '25L': { frame: ['upgrade', '25L'], wait: '[role=dialog]', about: 'The updates dialog: updates only in the update hours' },
  '25M': { frame: ['upgrade', '25M'], wait: '[role=dialog]', about: 'The updates dialog: asleep, why update now is greyed' },
  '30C': { frame: ['power', '30C'], about: 'The card: the state after sleep could not be read, without a card in the card' },
  '32C': { frame: ['card', '32C'], about: 'The card in error, with how to restart it' },
  '28B': { frame: ['claim', '28B'], about: 'The claim entry: not claimed, in red' },
  '28C': { frame: ['claim', '28C'], about: 'The claim entry: its result could not be read, without a card in the card' },
  // T44 (A2 #15, #17–#19): 「状态加载失败」 in the failing thing's own status place; the dot follows the subtitle.
  '28D': { frame: ['claim', '28D'], about: 'No card yet and the list could not be read: the device list error line' },
  '25C': { frame: ['upgrade', '25C'], wait: '[role=dialog]', about: 'The updates dialog: the instance state could not be read, in the version row' },
  '26C': { frame: ['policy', '26C'], wait: '[role=dialog]', about: 'The updates dialog: the schedule could not be read, under the dropdown' },
  '29G': { frame: ['card-upgrading', '29G'], about: 'Update held: running, with a green dot; the failure is on the Updates mark' },
  '32P': { frame: ['card', '32P'], about: 'Running but DeviceLink does not have it: the offline state of any device' },
  '32O': { frame: ['card', '32O'], about: 'The list has not answered yet: reading, with a spinner' },
  '19A': { frame: ['session', '19A'], settings: true, about: 'The settings page' },
  '18-loading': { frame: ['session', '18', '正在加载…'], settings: true, about: 'The settings page, loading' },
  '18-failed': { frame: ['session', '18', '加载失败'], settings: true, about: 'The settings page could not be read' },
  '33A': { frame: ['session', '33A'], settings: true, about: 'The settings page: the instance is not available' },
  '31A': { frame: ['group', '31A'], settings: true, wait: '[data-cloud-group-status]', about: 'One group could not be read again' },
  '19B': { frame: ['save-result', '19B'], settings: true, about: 'A change was not saved, with a retry' },
  '20A': { frame: ['providers', '20A'], settings: true, about: 'The model providers' },
  '21A': { frame: ['im', '21A'], settings: true, about: 'The IM bots, none connected' },
  '27W': { frame: ['auth', '27W'], settings: true, about: 'An authorization waits for the browser' },
  '27A': { frame: ['auth', '27A'], settings: true, about: 'An authorization completed' },
  '27B': { frame: ['auth', '27B'], settings: true, about: 'An authorization failed' },
  // T50: the plugin page, with the instance's plugins answered by the fixture (read-only).
  // T50: the scenario panel, its 验收清单 grouped, with the running card chosen.
  panel: { frame: ['card', '32A'], panel: true, desktopBackground: true, wait: '[data-cloud-fault-beacon]', about: 'The scenario panel over the frame it shows, on the desktop background' },
  // T55: 亲手体验 · 更新流程, clicked through to 正在更新.
  play: { play: 'done', panel: true, desktopBackground: true, wait: '[data-cloud-fault-beacon]', about: 'The update flow, played with real clicks' },
  '34A': { frame: ['plugins', '34A'], settings: true, plugins: true, wait: 'text=个人笔记', about: 'The plugins page of the instance' },
};

export default {
  name: 'cloud-frames',
  entry: './fixture.tsx',
  viewport: { width: 1040, height: 800 },
  real:
    'The scenario panel frames (cloudFaults.ts, cloudFaultScripts.ts) on RemoteControlSection with CloudDeviceDirectory and CloudMaintenanceDialog, and on CloudSettingsPanel with its native sections, provider, IM and authorization pages',
  notCovered:
    'The panel itself and its navigation; on the plugin page (34A) the instance\'s plugins are the fixture\'s. Every answer is the frame\'s: no CIS, DeviceLink or authorization runs.',
  // The two pages these frames sit on, with their own stand-ins.
  stubs: {
    ...access.stubs,
    ...settings.stubs,
    // The settings page also reads the list's request state: keep the real module, list nothing.
    'src/renderer/features/device-link/useDeviceLinkDeviceList': {
      partial:
        'const cloudDevice=[{deviceId:"' + CLOUD + '",name:"云端 Cindy",platform:"linux",online:true,isSelf:false,controlEnabled:true,remoteControlEnabled:true}];' +
        'export const useDeviceLinkDeviceList=()=>(window.__uiPage?.ctx?.data?.plugins?cloudDevice:[]);',
    },
    'src/renderer/contexts/AuthContext':
      'export const useAuth=()=>({mode:"cloud",isAuthenticated:true,isInitializing:false,canEnterApp:true,dataOwnerId:"fixture-owner",dataOwnerGeneration:1}); export const useOptionalAuthDeviceId=()=>null; export const useOptionalAuthUser=()=>null; export const useOptionalDataOwnerGeneration=()=>1;',
  },
  cases: {
    // The card as it is when nothing is simulated; the frames below are the 验收清单.
    default: { about: 'The running card, no frame chosen', data: {} },
    ...Object.fromEntries(
      Object.entries(FRAMES).map(([id, { about, ...data }]) => [`frame-${id.toLowerCase()}`, { about, data }]),
    ),
  },
  async ready(page) {
    const onSettings = await page.evaluate(() => !!window.__uiPage?.ctx?.data?.settings);
    await page
      .locator(onSettings ? '[data-testid="cloud-settings"]' : `li[data-device-id="${CLOUD}"]`)
      .first()
      .waitFor();
  },
  async check(page, ui) {
    if (ui.data.press) await page.locator(ui.data.press).first().click();
    if (ui.data.wait) await page.locator(ui.data.wait).first().waitFor();
    if (ui.data.play) {
      const t = (key) => ui.t(`cloudSettings.instance.${key}`);
      await page.waitForTimeout(400);
      await ui.capture('play-start');
      // At this width the panel covers the card's ⋯: folded, as the owner would, then opened again.
      await page.getByRole('button', { name: '收起', exact: true }).click();
      await page.locator(`li[data-device-id="${CLOUD}"] [data-cloud-updates-opener]`).first().click();
      await page.getByRole('menuitem', { name: new RegExp(await t('updates')) }).first().click();
      await page.getByRole('button', { name: await t('upgradeNow'), exact: true }).click();
      await page.getByRole('button', { name: await t('upgradeConfirm'), exact: true }).click();
      // The request (2 s), queued (3 s), then 正在更新.
      await page.waitForTimeout(6500);
      // Mid-flow: the dialog, with the folded panel saying where the run is.
      await page.mouse.move(1, 1);
      await ui.capture('play-updating');
      // Closed: the card follows, and the panel's header names the step.
      await page.getByRole('button', { name: await t('done'), exact: true }).click();
      await page.locator('button', { hasText: '亲手体验' }).first().click();
      await page.locator('[data-cloud-fault-beacon]').waitFor();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(1000);
      await ui.capture('play-updating-panel');
      return;
    }
    // The frame's own reads answer at once; let them land.
    await page.waitForTimeout(400);
    await ui.capture('frame');
    if (ui.data.panel) {
      // The rest of the 验收清单, then 全部画面 opened (it starts folded).
      const list = page.locator('[data-cloud-fault-beacon] .overflow-y-auto');
      await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await ui.capture('panel-rest');
      await page.getByRole('button', { name: /全部画面/ }).click();
      await page.getByRole('button', { name: /卡片的各种状态/ }).click();
      await page.getByRole('heading', { name: '更新', exact: true }).last().scrollIntoViewIfNeeded();
      await ui.capture('panel-all');
    }
  },
};

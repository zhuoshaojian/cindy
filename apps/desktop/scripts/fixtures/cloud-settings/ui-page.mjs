import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Expand Vite's eager glob for this esbuild-only fixture. Keep the actual catalog
// implementation and every real sidecar; do not replace search behavior with mocks.
const settingsDir = fileURLToPath(
  new URL('../../../src/renderer/components/settings/', import.meta.url),
);
const searchFiles = readdirSync(settingsDir, { recursive: true })
  .filter((name) => name.endsWith('.settings-search.ts'))
  .sort();
const imports = searchFiles
  .map(
    (name, index) => `import search${index} from ${JSON.stringify(path.join(settingsDir, name))};`,
  )
  .join('\n');
const catalog =
  imports +
  '\n' +
  readFileSync(path.join(settingsDir, 'settingsSearchCatalog.ts'), 'utf8')
    .replace(
      /const modules = import\.meta\.glob[^;]+;/,
      `const modules = {${searchFiles.map((_, index) => `search${index}`).join(',')}};`,
    )
    .replaceAll(
      "'./settingsSearchTypes'",
      JSON.stringify(path.join(settingsDir, 'settingsSearchTypes')),
    );
export default {
  name: 'cloud-settings',
  entry: './fixture.tsx',
  viewport: { width: 1040, height: 800 },
  real: 'CloudSettingsPanel, NativeCloudSections and shared native settings views, sidebar and search',
  notCovered:
    'Uses in-memory cloud state. No real CIS, login, credentials or runtime changes; bot forms use synthetic tickets, without real authorization or credential persistence.',
  stubs: {
    'src/renderer/components/settings/settingsSearchCatalog': catalog,
    'src/renderer/contexts/AuthContext':
      'export const useAuth=()=>({mode:"cloud",isAuthenticated:true,dataOwnerId:"fixture-owner",dataOwnerGeneration:1}); export const useOptionalAuthDeviceId=()=>null; export const useOptionalAuthUser=()=>null;',
    // Voice input is not mounted here; its worklet needs Vite's ?url asset loader.
    'src/renderer/voice-input/workletUrl':
      'export function getVoiceInputWorkletUrl(){return "http://cindy-ui.test/unused-worklet.js";}',
  },
  cases: {
    'im-read-failure': {
      about:
        'Native new-conversation section remains visible on failed cloud reads and recovers after retry',
      data: { bots: true, imReadFailure: true },
    },
    'im-preferences': {
      about: 'Target IM defaults and personal Telegram group controls',
      data: { bots: true, imPreferences: true },
    },
    appearance: {
      about: 'Cloud reply animation override and per-field reset',
      data: { appearance: true },
    },
    pages: {
      about: 'Tools, automation, storage and about reuse the local page frames',
      data: { pages: true },
      viewport: { width: 1040, height: 900 },
    },
    bots: { about: 'All six personal bot channels and credential forms', data: { bots: true } },
    default: { about: 'Cloud language and Linux send shortcut reuse native settings' },
    personalization: {
      about: 'Cloud links, tips and reset controls reuse native settings',
      data: { personalization: true },
    },
    unavailable: {
      about: 'Contacts work without sync; missing saved shell remains visible',
      data: { personalization: true, unavailable: true },
    },
    narrow: {
      about: 'Cloud controls and dropdowns at a narrow desktop window',
      viewport: { width: 760, height: 850 },
    },
  },
  async ready(page) {
    await page.locator('#settings-search-target-general-language [role="combobox"]').waitFor();
  },
  async check(page, ui) {
    if (ui.data.pages) {
      for (const [tab, ready] of [
        ['settings.tabs.builtinTools', 'settings.builtinTools.plugins.browser.name'],
        ['settings.tabs.computerUse', 'settings.computerUse.android.title'],
        ['settings.tabs.storage', 'settings.about.storage.databaseSectionTitle'],
        ['settings.tabs.about', 'settings.about.analyticsLabel'],
      ]) {
        await page.getByRole('tab', { name: await ui.t(tab), exact: true }).click();
        await page.getByText(await ui.t(ready), { exact: true }).first().waitFor();
        await ui.capture(tab.split('.').pop());
      }
      return;
    }
    if (ui.data.appearance) {
      await page
        .getByRole('tab', { name: await ui.t('settings.tabs.appearance'), exact: true })
        .click();
      // Target theme, display mode, fonts and sidebar styles reuse the local appearance view.
      await page.getByRole('combobox', { name: await ui.t('settings.appearance.themeAriaLabel') }).waitFor();
      await page.getByRole('radio', { name: await ui.t('settings.appearance.themeAria.dark') }).click();
      assert.equal(
        await page.getByRole('radio', { name: await ui.t('settings.appearance.themeAria.dark') }).getAttribute('aria-checked'),
        'true',
      );
      await ui.capture('theme');
      const fade = page.locator('#settings-search-target-appearance-stream-fade');
      const toggle = fade.getByRole('switch', {
        name: await ui.t('settings.streamFade.toggleAria'),
      });
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await ui.capture('fade-disabled');
      await fade
        .getByRole('button', { name: await ui.t('settings.defaults.restore'), exact: true })
        .click();
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      await ui.capture('fade-default');
    } else if (ui.data.imReadFailure) {
      await page.getByRole('tab', { name: await ui.t('settings.tabs.imBot'), exact: true }).click();
      await page.getByText(await ui.t('settings.wechatBot.title'), { exact: true }).click();
      const defaults = page.getByRole('region', {
        name: await ui.t('settings.imBot.defaults.title'),
      });
      await defaults.getByRole('alert').waitFor();
      await defaults.scrollIntoViewIfNeeded();
      await ui.capture('im-read-failed');
      await defaults
        .getByRole('button', { name: await ui.t('cloudSettings.reload'), exact: true })
        .click();
      await defaults.getByRole('alert').waitFor({ state: 'hidden' });
      await defaults
        .getByText(await ui.t('settings.imBot.defaults.modelLabel'), { exact: true })
        .waitFor();
      await ui.capture('im-read-recovered');
    } else if (ui.data.imPreferences) {
      await page.getByRole('tab', { name: await ui.t('settings.tabs.imBot'), exact: true }).click();
      await page.getByText(await ui.t('settings.telegramBot.title'), { exact: true }).click();
      const defaults = page.getByRole('region', {
        name: await ui.t('settings.imBot.defaults.title'),
      });
      await defaults.scrollIntoViewIfNeeded();
      await ui.capture('im-default-model');
      const group = page.getByRole('radiogroup', {
        name: `Cloud group · ${await ui.t('settings.telegramBot.groups.title')}`,
      });
      await group
        .getByRole('radio', {
          name: await ui.t('settings.telegramBot.groups.mode.always'),
          exact: true,
        })
        .click();
      assert.equal(
        await group
          .getByRole('radio', {
            name: await ui.t('settings.telegramBot.groups.mode.always'),
            exact: true,
          })
          .getAttribute('aria-checked'),
        'true',
      );
      await ui.capture('telegram-group-always');
    } else if (ui.data.bots) {
      await page.getByRole('tab', { name: await ui.t('settings.tabs.imBot'), exact: true }).click();
      for (const channel of ['wechat', 'wecom', 'feishu', 'dingtalk', 'discord', 'telegram'])
        await page.getByText(await ui.t(`settings.${channel}Bot.title`), { exact: true }).waitFor();
      await ui.capture('all-channels');
      await page.getByText(await ui.t('settings.feishuBot.title'), { exact: true }).click();
      await page.getByLabel(await ui.t('settings.feishuBot.appIdLabel'), { exact: true }).waitFor();
      await page
        .getByLabel(await ui.t('settings.feishuBot.appSecretLabel'), { exact: true })
        .scrollIntoViewIfNeeded();
      await ui.capture('feishu-form');
    } else if (ui.data.personalization) {
      await page
        .getByRole('tab', { name: await ui.t('settings.tabs.personalization'), exact: true })
        .click();
      const terminal = page.getByRole('combobox', {
        name: await ui.t('settings.terminalShell.card.selectAria'),
      });
      await terminal.waitFor();
      await terminal.scrollIntoViewIfNeeded();
      await ui.capture('terminal');
      if (ui.data.unavailable) {
        assert.ok((await terminal.textContent()).includes('fish'));
        assert.equal(
          await page
            .getByRole('switch', { name: await ui.t('settings.contacts.enable.toggleAria') })
            .isEnabled(),
          true,
        );
        assert.equal(
          await page
            .getByRole('switch', { name: await ui.t('settings.contacts.sync.toggleAria') })
            .isEnabled(),
          false,
        );
      }
      await terminal.click();
      await ui.capture('shell-choices');
      await page.keyboard.press('Escape');
      const web = page.getByRole('radiogroup', {
        name: await ui.t('settings.linkOpen.web.ariaLabel'),
      });
      await web
        .getByRole('radio', { name: await ui.t('settings.linkOpen.options.sidebar'), exact: true })
        .click();
      const links = page.locator('#settings-search-target-personalization-link-open');
      const reset = links.getByRole('button', {
        name: await ui.t('settings.defaults.restore'),
        exact: true,
      });
      await reset.waitFor();
      await ui.capture('links-customized');
      await reset.click();
      await reset.waitFor({ state: 'hidden' });
      assert.equal(
        await web
          .getByRole('radio', {
            name: await ui.t('settings.linkOpen.options.external'),
            exact: true,
          })
          .getAttribute('aria-checked'),
        'true',
      );
      await page.locator('#settings-search-target-personalization-tips').scrollIntoViewIfNeeded();
      await ui.capture('tips');
    } else {
      const language = page.getByRole('combobox', {
        name: await ui.t('settings.language.ariaLabel'),
      });
      const textWidth = await language.evaluate(
        (element) =>
          element.parentElement.querySelector('p').parentElement.getBoundingClientRect().width,
      );
      assert.ok(textWidth >= 180, `Language explanation must remain readable: ${textWidth}px`);
      const triggerBox = await language.boundingBox();
      await language.click();
      const menuBox = await page.getByRole('listbox').boundingBox();
      assert.ok(
        triggerBox && menuBox && Math.abs(triggerBox.width - menuBox.width) <= 2,
        'Language menu follows trigger width',
      );
      await ui.capture('languages');
      await page.keyboard.press('Escape');
      const shortcut = page.getByRole('switch', {
        name: await ui.t('settings.composer.sendShortcut.ariaLabel', { shortcut: 'Ctrl+Enter' }),
      });
      await shortcut.click();
      await page
        .locator('#settings-composer')
        .getByRole('button', { name: await ui.t('settings.defaults.restore'), exact: true })
        .waitFor();
      assert.equal(await shortcut.getAttribute('aria-checked'), 'true');
      await ui.capture('composer-customized');
    }
  },
};

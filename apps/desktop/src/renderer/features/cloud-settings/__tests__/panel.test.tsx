// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { CloudSettingsPanel } from '../CloudSettingsView';
import { createTrialCloudSettingsClient } from '../trial';
import { SETTINGS_SEARCH_ENTRIES } from '@/components/settings/settingsSearchCatalog';
import { cloudSearchEntryAllowed } from '../search';
import type { CloudSettingsClient } from '../client';
import { CLOUD_SETTINGS_DOMAINS } from '../../../../shared/cloudSettings';
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/device-link/useDeviceLinkDeviceList', () => ({
  useDeviceLinkDeviceList: vi.fn(),
}));
// Model pickers read the target catalog over DeviceLink; covered in model-settings.test.tsx.
vi.mock('../CloudModelSettings', () => ({
  CloudAuxiliarySettings: () => null,
  CloudBotsSettings: () => null,
  CloudSubagentSettings: () => null,
  CloudVisionBridgeSettings: () => null,
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);
function setup(configure?: (client: CloudSettingsClient) => void) {
  Object.assign(window, {
    electronAPI: new Proxy(
      {},
      {
        get() {
          throw Error('LOCAL_API_FORBIDDEN');
        },
      },
    ),
  });
  const client = createTrialCloudSettingsClient();
  configure?.(client);
  const save = vi.spyOn(client, 'save');
  render(<CloudSettingsPanel name="Cloud trial" client={client} online trial onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.personalization' }));
  return { client, save };
}
const ready = async (input: HTMLElement) =>
  waitFor(() => expect(input.matches(':disabled')).toBe(false));
const general = async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.general' }));
  await screen.findByText('settings.agentResource.title');
  const input = within(document.querySelector('#settings-agent-resource')!).getByRole('spinbutton');
  await ready(input);
  return input;
};
describe('shared native cloud settings', () => {
  it('uses native blur submission, rejects intermediate invalid values, then resets the cloud default', async () => {
    const { save } = setup();
    const input = await general();
    for (const value of ['', '-1', '3.5', '99']) {
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    }
    expect(save).not.toHaveBeenCalled();
    for (const [index, value] of ['6', '7'].entries()) {
      fireEvent.change(input, { target: { value } });
      expect(save).toHaveBeenCalledTimes(index);
      fireEvent.blur(input);
      await waitFor(() => expect(save).toHaveBeenCalledTimes(index + 1));
      await ready(input);
      expect((input as HTMLInputElement).value).toBe(value);
    }
    fireEvent.click(
      within(input.closest('section')!).getByRole('button', { name: 'settings.defaults.restore' }),
    );
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('4'));
  });
  it('applies the native balanced preset using target CPU count, in one cloud write', async () => {
    const { save } = setup();
    const input = await general();
    fireEvent.click(screen.getByRole('radio', { name: 'settings.agentResource.presets.balanced' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await ready(input);
    expect(save.mock.calls[0][1]).toEqual({
      maxConcurrentCommands: 4,
      processPriority: 'low',
      capToolchainThreads: true,
    });
    expect(
      screen
        .getByRole('radio', { name: 'settings.agentResource.presets.balanced' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });
  it('retains the native prompt editor draft across categories without a write', async () => {
    const { save } = setup();
    const input = await screen.findByRole('textbox', {
      name: 'settings.personalization.ariaLabel',
    });
    fireEvent.change(input, { target: { value: 'cloud-only draft' } });
    await general();
    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.personalization' }));
    await ready(input);
    expect((input as HTMLTextAreaElement).value).toBe('cloud-only draft');
    expect(save).not.toHaveBeenCalled();
  });
  it('saves the prompt with the original button and retains uncertain edits without replay', async () => {
    const { save } = setup();
    const input = await screen.findByRole('textbox', {
      name: 'settings.personalization.ariaLabel',
    });
    save.mockRejectedValueOnce(Error('UNKNOWN'));
    fireEvent.change(input, { target: { value: 'unsure' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.personalization.save' }));
    await screen.findByText('cloudSettings.saveUnconfirmed');
    expect((input as HTMLTextAreaElement).value).toBe('unsure');
    expect(input.matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'cloudSettings.reload' }));
    await ready(input);
    expect(save).toHaveBeenCalledTimes(1);
    expect((input as HTMLTextAreaElement).value).toBe('unsure');
  });
  it('preserves the native memory dependency between Cindy and agent memory', async () => {
    const { save } = setup();
    await screen.findByText('settings.memory.title');
    const memory = document.querySelector<HTMLElement>(
      '#settings-search-target-personalization-memory',
    )!;
    const switches = within(memory).getAllByRole('switch');
    expect(switches[1].matches(':disabled')).toBe(true);
    expect(switches[2].matches(':disabled')).toBe(true);
    fireEvent.click(switches[0]);
    await ready(switches[0]);
    await waitFor(() => expect(switches[1].matches(':disabled')).toBe(false));
    expect(switches[3].matches(':disabled')).toBe(true);
    expect(save.mock.calls[0][1]).toEqual({ maker: false });
  });
  it('removes obsolete global compaction controls and reads only current domains', async () => {
    let read: MockInstance<CloudSettingsClient['read']>;
    setup((client) => {
      read = vi.spyOn(client, 'read');
    });
    await screen.findByText('settings.memory.title');
    expect(screen.queryByText('settings.compaction.title')).toBeNull();
    expect(read!.mock.calls.flat(2)).not.toContain('claudeCompaction');
    expect(read!.mock.calls.flat(2)).not.toContain('piCompaction');
  });
  it('keeps contacts usable when only device sync is unavailable', async () => {
    const { save } = setup((client) => {
      const read = client.read;
      client.read = async (domains) =>
        (await read(domains)).map((s) =>
          s.domain === 'contactsSync'
            ? { domain: s.domain, status: 'unavailable', revision: null }
            : s,
        );
    });
    const enabled = await screen.findByRole('switch', {
      name: 'settings.contacts.enable.toggleAria',
    });
    await ready(enabled);
    expect(
      screen
        .getByRole('switch', { name: 'settings.contacts.sync.toggleAria' })
        .matches(':disabled'),
    ).toBe(true);
    expect(screen.getByText('cloudSettings.settingUnavailable')).toBeTruthy();
    fireEvent.click(enabled);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].domain).toBe('contacts');
    expect(save.mock.calls[0][1]).toEqual({ enabled: true });
  });
  it('shows an unavailable saved shell instead of an empty selection without changing it', async () => {
    const { save } = setup((client) => {
      const read = client.read;
      client.read = async (domains) =>
        (await read(domains)).map((s) =>
          s.domain === 'terminal'
            ? {
                ...s,
                value: { defaultShellPref: 'fish' },
                customizedKeys: ['defaultShellPref'],
                isCustomized: true,
              }
            : s,
        );
    });
    const shell = await screen.findByRole('combobox', {
      name: 'settings.terminalShell.card.selectAria',
    });
    await ready(shell);
    expect(shell.textContent).toContain('settings.terminalShell.unavailable');
    expect(save).not.toHaveBeenCalled();
  });
  it('saves and resets link preferences independently through the cloud adapter', async () => {
    const { save } = setup();
    const links = await screen.findByRole('radiogroup', {
      name: 'settings.linkOpen.web.ariaLabel',
    });
    const sidebar = within(links).getByRole('radio', { name: 'settings.linkOpen.options.sidebar' });
    await ready(sidebar);
    fireEvent.click(sidebar);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await ready(sidebar);
    expect(save.mock.calls[0][0].domain).toBe('desktopChat');
    expect(save.mock.calls[0][1]).toEqual({ webLinkOpenPreference: 'sidebar' });
    const section = document.querySelector('#settings-search-target-personalization-link-open')!;
    fireEvent.click(
      within(section as HTMLElement).getByRole('button', { name: 'settings.defaults.restore' }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1].slice(1)).toEqual([{}, ['webLinkOpenPreference']]);
    await ready(sidebar);
    expect((await save.mock.results[1].value).state.value.localLinkOpenPreference).toBe('sidebar');
  });
  it('uses target Linux shortcut semantics and writes only the remote composer field', async () => {
    const { save } = setup();
    await general();
    const toggle = screen.getByRole('switch', { name: 'settings.composer.sendShortcut.ariaLabel' });
    await ready(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].domain).toBe('desktopChat');
    expect(save.mock.calls[0][1]).toEqual({ composerSendShortcut: 'modifier-enter' });
    await ready(toggle);
    fireEvent.click(
      within(document.querySelector('#settings-composer')!).getByRole('button', {
        name: 'settings.defaults.restore',
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1].slice(1)).toEqual([{}, ['composerSendShortcut']]);
  });
  it('keeps controls and their search entries absent when the cloud does not advertise desktop preferences', async () => {
    setup((client) => {
      const connect = client.connect;
      client.connect = async () => {
        const cap = await connect();
        return {
          ...cap,
          domains: cap.domains.filter((d) => d !== 'desktopChat' && d !== 'desktopGeneral'),
        };
      };
    });
    await screen.findByText('settings.memory.title');
    expect(screen.queryByText('settings.linkOpen.title')).toBeNull();
    expect(screen.queryByText('settings.promptRecommendation.label')).toBeNull();
    await general();
    expect(screen.queryByText('settings.composer.title')).toBeNull();
    expect(screen.queryByText('settings.language.title')).toBeNull();
  });
  it('removes cached controls when the cloud withdraws a capability', async () => {
    let supported = true;
    const { save } = setup((client) => {
      const connect = client.connect;
      client.connect = async () => {
        const cap = await connect();
        return { ...cap, domains: cap.domains.filter((d) => supported || d !== 'desktopChat') };
      };
    });
    await screen.findByText('settings.linkOpen.title');
    supported = false;
    fireEvent.click(screen.getByRole('button', { name: 'cloudSettings.reload' }));
    await waitFor(() => expect(screen.queryByText('settings.linkOpen.title')).toBeNull());
    expect(save).not.toHaveBeenCalled();
  });
  it('filters automation search by the individual capability', () => {
    for (const [id, domain] of [
      ['settings.computerUse.browser.title', 'browserTools'],
      ['settings.computerUse.directControl.title', 'computerTools'],
    ] as const) {
      const entry = SETTINGS_SEARCH_ENTRIES.find((e) => e.id === id)!;
      expect(cloudSearchEntryAllowed(entry, [domain], false)).toBe(true);
      expect(
        cloudSearchEntryAllowed(
          entry,
          [domain === 'browserTools' ? 'computerTools' : 'browserTools'],
          false,
        ),
      ).toBe(false);
    }
  });
  it('uses native search and filters unsupported local-only entries without removing navigation', async () => {
    setup();
    await screen.findByRole('textbox', { name: 'settings.personalization.ariaLabel' });
    const search = screen.getByRole('combobox', { name: 'settings.search.ariaLabel' });
    fireEvent.change(search, { target: { value: 'shortcuts' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('tab', { name: 'settings.tabs.appearance' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'settings.tabs.providers' })).toBeTruthy();
    const allowed = SETTINGS_SEARCH_ENTRIES.filter((e) =>
      cloudSearchEntryAllowed(e, [...CLOUD_SETTINGS_DOMAINS], false),
    );
    expect(allowed.some((e) => e.id === 'settings.agentResource.preset')).toBe(true);
    for (const id of ['general.language', 'general.composer', 'personalization.linkOpen'])
      expect(allowed.some((e) => e.id === id)).toBe(true);
    for (const id of [
      'settings.computerUse.android.title',
      'settings.appearance.themeLabel',
      'settings.appearance.font.uiSize.label',
      'settings.about.analyticsLabel',
    ])
      expect(allowed.some((e) => e.id === id)).toBe(true);
    // Device setup, files and local-only terminal fonts are not target settings.
    for (const denied of [
      'general.appearance',
      'settings.computerUse.android.adb.title',
      'settings.appearance.wallpaper.title',
      'settings.appearance.localThemes.title',
      'settings.appearance.font.terminalFamily.label',
      'settings.about.storage.cleanupLabel',
    ])
      expect(allowed.some((e) => e.id === denied)).toBe(false);
  });
  it('does not write any settings just by opening every supported category', async () => {
    const { save } = setup();
    await screen.findByRole('textbox', { name: 'settings.personalization.ariaLabel' });
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab);
      await waitFor(() => expect(screen.queryByText('cloudSettings.loading')).toBeNull());
    }
    expect(save).not.toHaveBeenCalled();
  });
});

// Regression: shared controls must persist only their own target field, then remove that override.
it('saves target notifications and stream fade without changing unrelated cloud fields', async () => {
  const { client, save } = setup();
  await general();
  const notifications = screen.getByRole('switch', {
    name: 'settings.notifications.sessionDoneAria',
  });
  await ready(notifications);
  fireEvent.click(notifications);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][1]).toEqual({ notificationsEnabled: false });
  fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.appearance' }));
  const fade = await screen.findByRole('switch', { name: 'settings.streamFade.toggleAria' });
  await ready(fade);
  fireEvent.click(fade);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await ready(fade);
  fireEvent.click(screen.getByRole('button', { name: 'settings.defaults.restore' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  const [chat] = await client.read(['desktopChat']);
  expect(chat.customizedKeys).toEqual([]);
  expect(chat.value).toMatchObject({ streamFadePreference: 'on', composerSendShortcut: 'enter' });
});

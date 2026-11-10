// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { CloudSettingsPanel } from '../CloudSettingsView';
import { createTrialCloudSettingsClient } from '../trial';
import { SETTINGS_SEARCH_ENTRIES } from '@/components/settings/settingsSearchCatalog';
import { cloudSearchEntryAllowed } from '../search';
import type { CloudSettingsClient } from '../client';
import { CLOUD_SETTINGS_DOMAINS } from '../../../../shared/cloudSettings';
import { SETTINGS_DISPLAY_LOCALES } from '../../../../shared/settingsReadCatalog';
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
  it('confirms a write without rereading the category, and still rereads on a category switch', async () => {
    let read: MockInstance<CloudSettingsClient['read']>;
    const { save } = setup((client) => {
      read = vi.spyOn(client, 'read');
    });
    const input = await general();
    const before = read!.mock.calls.length;
    fireEvent.click(screen.getByRole('radio', { name: 'settings.agentResource.presets.balanced' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await ready(input);
    expect(read!.mock.calls.length).toBe(before);
    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.personalization' }));
    await waitFor(() => expect(read!.mock.calls.length).toBe(before + 1));
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
    // Turning Cindy memory back on must not save the agent switches as customized.
    fireEvent.click(switches[1]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await ready(switches[0]);
    fireEvent.click(switches[0]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save.mock.calls[2][1]).toEqual({ maker: true });
    expect(save.mock.calls[2][2]).toBeUndefined();
    await ready(switches[0]);
    expect(switches[1].getAttribute('aria-checked')).toBe('false');
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
  // 2026-11-04 product review: these only change the instance's own window.
  it('leaves instance-window-only preferences to the remote desktop', async () => {
    const { save } = setup();
    await screen.findByText('settings.memory.title');
    expect(screen.queryByRole('tab', { name: 'settings.tabs.appearance' })).toBeNull();
    for (const text of [
      'settings.linkOpen.title',
      'settings.promptRecommendation.label',
      'settings.messageNavRail.cell.label',
    ])
      expect(screen.queryByText(text)).toBeNull();
    await general();
    expect(screen.queryByText('settings.composer.title')).toBeNull();
    expect(
      screen.queryByRole('switch', { name: 'settings.notifications.sessionDoneAria' }),
    ).toBeNull();
    expect(screen.getByText('settings.language.title')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps controls absent when the cloud does not advertise desktop preferences', async () => {
    setup((client) => {
      const connect = client.connect;
      client.connect = async () => {
        const cap = await connect();
        return { ...cap, domains: cap.domains.filter((d) => d !== 'desktopGeneral') };
      };
    });
    await screen.findByText('settings.memory.title');
    await general();
    expect(screen.queryByText('settings.language.title')).toBeNull();
  });
  it('offers the newer display languages only when the instance lists them', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    const menu = async () => {
      await general();
      fireEvent.keyDown(screen.getByRole('combobox', { name: 'settings.language.ariaLabel' }), {
        key: 'ArrowDown',
      });
      return screen.getAllByRole('option').map((option) => option.textContent);
    };
    setup();
    expect(await menu()).toEqual(
      ['system', 'en', 'zh-CN', 'zh-TW', 'ja', 'ko'].map((l) => `settings.language.options.${l}`),
    );
    cleanup();
    setup((client) => {
      const read = client.read;
      client.read = async (domains) =>
        (await read(domains)).map((s) =>
          s.domain === 'desktopGeneral'
            ? {
                ...s,
                choices: {
                  ...s.choices,
                  locale: SETTINGS_DISPLAY_LOCALES.map((value) => ({ value, label: value })),
                },
              }
            : s,
        );
    });
    expect((await menu()).slice(6)).toEqual(
      ['es', 'fr', 'de', 'pt-PT', 'pt-BR', 'classical'].map((l) => `settings.language.options.${l}`),
    );
  });
  // The instance may use a display language outside the cloud wire.
  it('sends an unrepresentable instance language to the cloud desktop', async () => {
    setup((client) => {
      const read = client.read;
      client.read = async (domains) =>
        (await read(domains)).map((s) =>
          s.domain === 'desktopGeneral'
            ? { domain: 'desktopGeneral', status: 'unavailable', revision: null }
            : s,
        );
    });
    await screen.findByText('settings.memory.title');
    await general();
    const language = document.querySelector<HTMLElement>('#settings-search-target-general-language')!;
    expect(within(language).getByText('settings.language.title')).toBeTruthy();
    expect(
      within(language).getByRole('button', { name: 'cloudSettings.openInCloudDesktop' }),
    ).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'settings.language.ariaLabel' })).toBeNull();
    expect(screen.queryByText('cloudSettings.readFailed')).toBeNull();
  });
  // The page title lived only inside the prompt editor, so it vanished with the prompt.
  it('keeps the personalization title when the cloud does not report the prompt', async () => {
    setup((client) => {
      const connect = client.connect;
      client.connect = async () => {
        const cap = await connect();
        return { ...cap, domains: cap.domains.filter((d) => d !== 'personalization') };
      };
    });
    await screen.findByText('settings.memory.title');
    expect(screen.getAllByText('settings.personalization.title')).toHaveLength(1);
    expect(
      screen.queryByRole('textbox', { name: 'settings.personalization.ariaLabel' }),
    ).toBeNull();
  });
  it('shows the instance runtime version in About like the local app version', async () => {
    setup();
    cleanup();
    render(
      <CloudSettingsPanel
        name="Cloud trial"
        client={createTrialCloudSettingsClient()}
        online
        trial
        version="0.1.120-cloud.1-cn-amd64"
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.about' }));
    await screen.findByText('settings.about.appVersionLabel');
    // Since v0.1.130 an info row is a SettingsRow: the value sits in the row's trailing slot.
    expect(screen.getByText('0.1.120-cloud.1-cn-amd64')).toBeTruthy();
  });
  it('removes cached controls when the cloud withdraws a capability', async () => {
    let supported = true;
    const { save } = setup((client) => {
      const connect = client.connect;
      client.connect = async () => {
        const cap = await connect();
        return { ...cap, domains: cap.domains.filter((d) => supported || d !== 'terminal') };
      };
    });
    await screen.findByText('settings.terminalShell.title');
    supported = false;
    fireEvent.click(screen.getByRole('button', { name: 'cloudSettings.reload' }));
    await waitFor(() => expect(screen.queryByText('settings.terminalShell.title')).toBeNull());
    expect(save).not.toHaveBeenCalled();
  });
  // 2026-11-04 product review: without plugin management here, the category is not a dead end.
  it('opens the cloud desktop for plugins when the page cannot manage them', async () => {
    setup((client) => {
      const connect = client.connect;
      client.connect = async () => {
        return { ...(await connect()), pluginAuthorization: undefined };
      };
    });
    await screen.findByText('settings.memory.title');
    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.ghosts' }));
    expect(
      await screen.findByRole('button', { name: 'cloudSettings.openInCloudDesktop' }),
    ).toBeTruthy();
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
    expect(screen.queryByRole('tab', { name: 'settings.tabs.appearance' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'settings.tabs.providers' })).toBeTruthy();
    const allowed = SETTINGS_SEARCH_ENTRIES.filter((e) =>
      cloudSearchEntryAllowed(e, [...CLOUD_SETTINGS_DOMAINS], false),
    );
    expect(allowed.some((e) => e.id === 'settings.agentResource.preset')).toBe(true);
    expect(allowed.some((e) => e.id === 'general.language')).toBe(true);
    // A cloud instance cannot reach the user's Android devices: no ADB entry or domain.
    expect(CLOUD_SETTINGS_DOMAINS).not.toContain('androidTools');
    expect(allowed.some((e) => e.tab === 'computer-use' && /android/i.test(e.id))).toBe(false);
    expect(allowed.some((e) => e.id === 'settings.about.analyticsLabel')).toBe(true);
    // Device setup, files and settings that only change the instance's own window are not
    // target settings.
    for (const denied of [
      'general.appearance',
      'general.notifications',
      'general.composer',
      'settings.composer.sendShortcut.label',
      'personalization.linkOpen',
      'settings.promptRecommendation.label',
      'settings.appearance.themeLabel',
      'settings.appearance.font.uiSize.label',
      'appearance.streamFade',
      'settings.computerUse.android.adb.title',
      'settings.appearance.wallpaper.title',
      'settings.appearance.localThemes.title',
      'settings.appearance.font.terminalFamily.label',
      'settings.about.storage.cleanupLabel',
    ])
      expect(allowed.some((e) => e.id === denied), denied).toBe(false);
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

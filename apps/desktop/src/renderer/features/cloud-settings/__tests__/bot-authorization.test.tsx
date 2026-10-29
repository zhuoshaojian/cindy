// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudBotAuthorization } from '../CloudBotAuthorization';
import { createTrialCloudSettingsClient } from '../trial';
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
describe('cloud IM authorization', () => {
  it.each(['Slack', 'Telegram', 'X', 'settings.wechatBot.title'])(
    'connects and cancels %s with cloud tickets and no local API',
    async (label) => {
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
      const client = createTrialCloudSettingsClient(),
        manage = vi.spyOn(client, 'manage');
      const props = { client, online: true, active: true, name: 'Cloud', trial: true };
      const view = render(<CloudBotAuthorization {...props} />);
      const toggle = await screen.findByRole('switch', { name: label });
      fireEvent.click(toggle);
      const complete = await screen.findByRole('button', {
        name: 'cloudSettings.authTrialComplete',
      });
      fireEvent.click(complete);
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
      expect(manage.mock.calls.filter(([c]) => c.operation === 'run')).toHaveLength(1);
      expect(manage.mock.calls[0][0]).toMatchObject({ section: 'bots' });
      view.rerender(<CloudBotAuthorization {...props} online={false} />);
      expect(toggle.matches(':disabled')).toBe(true);
    },
  );
});

// Regression: the native panel hid all disconnected credential-based bots.
// Existing coverage had only fieldless OAuth; a connect ticket with required fields
// must remain visible and submit once through the scoped bridge (unit/jsdom).
it('shows all personal channels and submits credentials only to the selected cloud ticket', async () => {
  const client = createTrialCloudSettingsClient();
  const original = client.manage!;
  let sent: unknown;
  const id = crypto.randomUUID();
  const manage = vi.spyOn(client, 'manage').mockImplementation(async (command) => {
    if (command.operation !== 'list') {
      sent = structuredClone(command);
      return original(command);
    }
    return {
      kind: 'page',
      section: 'bots',
      offset: 0,
      items: [
        ...['wecom', 'feishu', 'dingtalk', 'discord', 'telegram'].map((channel) => ({
          id: `bot:${channel}`,
          label: channel,
          group: 'management.personalBots',
          status: 'disconnected' as const,
          actions: [
            {
              id,
              intent: 'connect' as const,
              label: 'management.actions.connect',
              expiresAt: Date.now() + 300000,
              fields: [
                {
                  name: 'token',
                  label: 'Token',
                  kind: 'password' as const,
                  required: true,
                  maxLength: 100,
                },
              ],
            },
          ],
        })),
        {
          id: 'bot:official:readonly',
          label: 'Read-only connection',
          group: 'management.officialBots',
          status: 'connected',
          actions: [],
        },
      ],
    };
  });
  const props = { client, online: true, active: true, name: 'Cloud', trial: true };
  const view = render(<CloudBotAuthorization {...props} />);
  for (const channel of ['wecom', 'feishu', 'dingtalk', 'discord', 'telegram'])
    expect(await screen.findByText(`settings.${channel}Bot.title`)).toBeTruthy();
  expect(screen.getByText('Read-only connection')).toBeTruthy();
  fireEvent.click(screen.getByText('settings.telegramBot.title'));
  const token = screen.getByLabelText('settings.telegramBot.tokenLabel');
  expect(token.getAttribute('type')).toBe('password');
  fireEvent.change(token, { target: { value: 'invalid-test-token' } });
  fireEvent.click(await screen.findByRole('button', { name: 'settings.telegramBot.connect' }));
  await waitFor(() =>
    expect(manage.mock.calls.filter(([c]) => c.operation === 'run')).toHaveLength(1),
  );
  expect(sent).toMatchObject({
    actionId: id,
    values: { token: 'invalid-test-token' },
  });
  expect(screen.queryByLabelText('settings.telegramBot.tokenLabel')).toBeNull();
  view.rerender(<CloudBotAuthorization {...props} online={false} />);
  expect(screen.queryByLabelText('settings.telegramBot.tokenLabel')).toBeNull();
});

// The new controller must never save model or group settings to this computer or
// to an official hook. Mock only the heavy picker, keep the native view/controller.
const pickers = vi.hoisted(() => ({ model: null as any, permission: null as any }));
vi.mock('@/components/new-chat/ModelSelector', () => ({
  ModelSelector: (props: any) => {
    pickers.model = props;
    return <span>Target model picker</span>;
  },
}));
vi.mock('@/components/new-chat/PermissionSelector', () => ({
  PermissionSelector: (props: any) => {
    pickers.permission = props;
    return <span>Target permission picker</span>;
  },
}));
import { CloudImSettings } from '../CloudImSettings';
it('saves an admitted target route, rejects a local-only route and resets only that channel', async () => {
  const client = createTrialCloudSettingsClient();
  const [state] = await client.read(['imFeishu']);
  const save = vi.fn(async (s, set, clear) => (await client.save(s, set, clear)).state);
  const props = { itemId: 'bot:feishu', deviceId: 'cloud-target', disabled: false, save };
  const view = render(<CloudImSettings {...props} states={{ imFeishu: state }} />);
  expect(pickers.model.deviceId).toBe('cloud-target');
  expect(pickers.permission.deviceId).toBe('cloud-target');
  expect(
    pickers.model.onUnifiedSelect({
      engine: 'cc',
      modelId: 'local-only',
      providerId: 'local',
      effort: 'high',
    }),
  ).toBe(false);
  expect(save).not.toHaveBeenCalled();
  await pickers.model.onUnifiedSelect({
    engine: 'cc',
    modelId: 'fixture-model',
    providerId: 'fixture-provider',
    effort: 'low',
  });
  const [saved] = await client.read(['imFeishu']);
  expect(saved.value?.claudeCode).toEqual({
    modelId: 'fixture-model',
    providerId: 'fixture-provider',
    effort: 'low',
  });
  expect(save.mock.calls[0][1]).toEqual({
    agentKind: 'claude-code',
    claudeCode: saved.value?.claudeCode,
  });
  view.rerender(<CloudImSettings {...props} states={{ imFeishu: saved }} />);
  fireEvent.click(screen.getByRole('button', { name: 'settings.imBot.defaults.useAutomatic' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  const [automatic] = await client.read(['imFeishu']);
  expect(automatic.value?.claudeCode).toEqual({ modelId: '', providerId: null, effort: 'high' });
  view.rerender(<CloudImSettings {...props} states={{ imFeishu: automatic }} />);
  fireEvent.click(screen.getByRole('button', { name: 'settings.defaults.restore' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  expect(save.mock.calls[2][2]).toEqual(Object.keys(state.defaults!));
  expect((await client.read(['imFeishu']))[0].customizedKeys).toEqual([]);
});
it('keeps missing saved Telegram groups and never applies personal groups to official hooks', async () => {
  const client = createTrialCloudSettingsClient();
  const [state] = await client.read(['telegramGroups']);
  state.value = { always: ['-999'] };
  state.isCustomized = true;
  state.customizedKeys = ['always'];
  const save = vi.fn(async (_s: unknown, _set: Record<string, unknown>) => state);
  const props = {
    deviceId: 'cloud-target',
    states: { telegramGroups: state },
    disabled: false,
    save,
  };
  const view = render(<CloudImSettings {...props} itemId="bot:official:telegram" />);
  expect(screen.queryByText('Cloud group')).toBeNull();
  view.rerender(<CloudImSettings {...props} itemId="bot:telegram" />);
  const group = screen.getByRole('radiogroup', {
    name: 'Cloud group · settings.telegramBot.groups.title',
  });
  fireEvent.click(
    within(group).getByRole('radio', { name: 'settings.telegramBot.groups.mode.always' }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][1]).toEqual({ always: ['-999', '-100123'] });
  view.rerender(<CloudImSettings {...props} disabled itemId="bot:telegram" />);
  expect(
    within(group)
      .getByRole('radio', { name: 'settings.telegramBot.groups.mode.mention' })
      .matches(':disabled'),
  ).toBe(true);
});

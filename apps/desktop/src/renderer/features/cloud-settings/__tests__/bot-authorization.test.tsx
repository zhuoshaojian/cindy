// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

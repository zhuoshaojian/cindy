// @vitest-environment jsdom
// A failed persona request must not leave the section stuck: the sync button reports failure
// and becomes usable again, and a failed load stays silent instead of an unhandled rejection.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { TelegramPersonaSettings } from '../TelegramBehaviorSettings';

const getPersona = vi.fn();
const setPersona = vi.fn();
Object.assign(window, { electronAPI: { telegramBot: { getPersona, setPersona } } });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  getPersona.mockReset();
  setPersona.mockReset();
});

describe('TelegramPersonaSettings', () => {
  it('reports a failed profile sync and lets the user retry', async () => {
    getPersona.mockResolvedValue({ botName: 'Cindy', soul: '' });
    setPersona.mockRejectedValueOnce(new Error('[IPC_ERROR] unavailable'));
    render(<TelegramPersonaSettings />);
    const sync = await screen.findByRole('button', { name: 'settings.telegramBot.persona.sync.idle' });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(sync);
    });
    expect(screen.getByRole('button', { name: 'settings.telegramBot.persona.sync.failed' })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    const retry = screen.getByRole('button', { name: 'settings.telegramBot.persona.sync.idle' });
    expect(retry.matches(':disabled')).toBe(false);
  });

  it('stays empty without an unhandled rejection when the persona cannot be read', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    getPersona.mockRejectedValue(new Error('[IPC_ERROR] unavailable'));
    const { container } = render(<TelegramPersonaSettings />);
    await waitFor(() => expect(getPersona).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(container.textContent).toBe('');
    expect(unhandled).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from '@/lib/toast';
import { LanguageSectionView } from '../LanguageSection';

vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const menu = () => {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'settings.language.ariaLabel' }), {
    key: 'ArrowDown',
  });
  return screen
    .getAllByRole('option')
    .map((option) => option.textContent?.replace('settings.language.options.', ''));
};

it('offers only the languages its target can save', () => {
  render(
    <LanguageSectionView
      locale="ja"
      onChange={vi.fn()}
      locales={['system', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko']}
    />,
  );
  expect(menu()).toEqual(['system', 'en', 'zh-CN', 'zh-TW', 'ja', 'ko']);
});

it('keeps every language and the classical entry without a limit', () => {
  render(<LanguageSectionView locale="system" onChange={vi.fn()} />);
  expect(menu()).toEqual([
    'system',
    'en',
    'zh-CN',
    'zh-TW',
    'ja',
    'ko',
    'es',
    'fr',
    'de',
    'pt-PT',
    'pt-BR',
    'classical',
  ]);
});

// This computer resolves whether it saved the choice. The cloud page reports its own unconfirmed
// saves and resolves nothing, so only an explicit false says the language was not saved.
it.each([
  ['this computer could not save it', false, 1],
  ['this computer saved it', true, 0],
  ['the target reports its own failures', undefined, 0],
])('says the language was not saved only when %s', async (_case, result, toasts) => {
  const onChange = vi.fn(async () => result);
  render(<LanguageSectionView locale="system" onChange={onChange} />);
  menu();
  fireEvent.keyDown(screen.getByRole('option', { name: 'settings.language.options.ja' }), {
    key: 'Enter',
  });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('ja'));
  await act(async () => {});
  expect(toast.error).toHaveBeenCalledTimes(toasts);
  if (toasts) expect(toast.error).toHaveBeenCalledWith('regionScreenshot.translation.saveFailed');
});

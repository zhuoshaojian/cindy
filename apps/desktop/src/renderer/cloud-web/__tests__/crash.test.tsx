// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudWebErrorBoundary } from '../crash';
import { crashReport, showStartFailure } from '../startFailure';

vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

it('keeps the message, the frames and the browser, also when the stack omits the message', () => {
  const safari = new TypeError('undefined is not an object');
  safari.stack = 'render@https://cloud.example.invalid/app.js:1:2';
  const report = crashReport(safari);
  expect(report.message).toBe('TypeError: undefined is not an object');
  expect(report.details.split('\n\n')).toEqual([
    'TypeError: undefined is not an object',
    'render@https://cloud.example.invalid/app.js:1:2',
    navigator.userAgent,
  ]);
  const chrome = new Error('boom');
  chrome.stack = 'Error: boom\n    at render (app.js:1:2)';
  expect(crashReport(chrome).details.split('\n\n').slice(0, 2)).toEqual([
    'Error: boom',
    '    at render (app.js:1:2)',
  ]);
});

it('shows the crash screen with the report instead of a blank page', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = () => {
    throw new TypeError('settings.value is undefined');
  };
  render(
    <CloudWebErrorBoundary>
      <Broken />
    </CloudWebErrorBoundary>,
  );
  expect(screen.getByText('appError.title')).toBeTruthy();
  expect(screen.getByRole('button', { name: /appError.reload/u })).toBeTruthy();
  fireEvent.click(
    screen.getAllByRole('button').find((b) => !/appError/u.test(b.textContent ?? ''))!,
  );
  expect(document.body.textContent).toContain('TypeError: settings.value is undefined');
});

it('writes a start failure into an empty page and leaves mounted pages alone', () => {
  const root = document.createElement('div');
  showStartFailure(new TypeError('Failed to fetch dynamically imported module'), root);
  expect(root.textContent).toContain('TypeError: Failed to fetch dynamically imported module');
  expect(root.querySelector('button')).toBeTruthy();
  const mounted = document.createElement('div');
  mounted.append(document.createElement('main'));
  showStartFailure(new Error('late'), mounted);
  expect(mounted.textContent).not.toContain('late');
});

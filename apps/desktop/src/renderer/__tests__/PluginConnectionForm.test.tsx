// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import i18n from '@/i18n';
import { PluginSetupPrompt } from '@/components/new-chat/PluginSetupPrompt';
import type { PendingPluginSetup } from '@/lib/makerChatStore';

const pending: PendingPluginSetup = { requestId: 'connection-card', revision: 1, remoteConnection: true,
  ghost: { id: 'demo', name: 'Demo' }, steps: [{ id: 'connection', groupId: 'service', groupMode: 'any_of',
    title: 'Connect service', description: 'Use your service account', phase: 'pending',
    action: { kind: 'manage_connection', id: 'manage_connection:connection:service' } }] };
beforeEach(async () => { await i18n.changeLanguage('en'); });
afterEach(cleanup);
function form(p = pending, device = 'cloud-a') {
  const onCommand = vi.fn();
  const element = (next = p, target = device) => <PluginSetupPrompt pending={next} remote remoteDeviceId={target}
    viewerState="expanded" commandInFlight={null} onCommand={onCommand} onViewerStateChange={vi.fn()} />;
  return { ...render(element()), element, onCommand };
}
describe('cloud connection card', () => {
  it('renders a protected connection form, sends one private submission and clears input', () => {
    const h = form();
    const host = screen.getByLabelText('Instance address'), token = screen.getByLabelText('Access token');
    expect(screen.queryByText('Complete this setup on the controlled desktop. This card will update automatically.')).toBeNull();
    expect(token.getAttribute('type')).toBe('password');
    fireEvent.change(host, { target: { value: 'https://git.example.test/' } });
    fireEvent.change(token, { target: { value: 'synthetic-pat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    expect(h.onCommand).toHaveBeenCalledWith('connection-card', 'submit_form', 'manage_connection:connection:service',
      { host: 'https://git.example.test/', value: 'synthetic-pat' });
    expect((token as HTMLInputElement).value).toBe('');
    expect((host as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('synthetic-pat');
  });
  it('rejects a path target and focuses the address without submitting', () => {
    const h = form();
    const host = screen.getByLabelText('Instance address');
    fireEvent.change(host, { target: { value: 'https://git.example.test/path' } });
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'synthetic-pat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    expect(h.onCommand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(host);
  });
  it.each(['revision', 'target', 'cancel'] as const)('drops private input on %s change', change => {
    const h = form();
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'synthetic-pat' } });
    if (change === 'cancel') {
      h.rerender(h.element({ ...pending, terminal: true }));
      expect(screen.queryByLabelText('Access token')).toBeNull();
    } else {
      h.rerender(h.element(change === 'revision' ? { ...pending, revision: 2 } : pending, change === 'target' ? 'cloud-b' : 'cloud-a'));
      expect((screen.getByLabelText('Access token') as HTMLInputElement).value).toBe('');
    }
  });
  it('does not show an input form for an older Host without connection capability', () => {
    form({ ...pending, remoteConnection: undefined });
    expect(screen.queryByLabelText('Access token')).toBeNull();
  });
});

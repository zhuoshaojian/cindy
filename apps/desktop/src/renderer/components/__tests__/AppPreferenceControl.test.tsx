// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppPreferenceRequest, AppPreferenceReply } from '../../../shared/appPreferenceControl';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'system', familyId: 'cindy', setTheme: vi.fn(), setFamily: vi.fn() }),
}));
vi.mock('@/hooks/useLocale', () => ({ useLocale: () => ({ locale: 'system', setLocale: vi.fn() }) }));
vi.mock('@/contexts/dataOwnerGeneration', () => ({ isDataOwnerPushStampCurrent: () => true }));

import { AppPreferenceControl } from '../AppPreferenceControl';

type Listener = (request: AppPreferenceRequest) => Promise<void> | void;
let listener: Listener | null = null;
const reply = vi.fn<(value: AppPreferenceReply) => void>();
const setDebugNet = vi.fn(async (_enabled: boolean) => ({ ok: true as const }));
const setSwallow = vi.fn(async (_enabled: boolean) => undefined);

function request(operation: AppPreferenceRequest['operation'], patch?: AppPreferenceRequest['patch']): AppPreferenceRequest {
  return { requestId: '00000000-0000-4000-8000-000000000001', ownerStamp: { dataOwnerId: 'owner', ownerGeneration: 1 },
    expiresAt: Date.now() + 5000, operation, ...(patch ? { patch } : {}) } as AppPreferenceRequest;
}
async function send(value: AppPreferenceRequest): Promise<AppPreferenceReply> {
  reply.mockClear();
  await act(async () => { await listener!(value); });
  expect(reply).toHaveBeenCalledTimes(1);
  return reply.mock.calls[0]![0];
}

beforeEach(() => {
  localStorage.clear();
  listener = null;
  Object.assign(window, { electronAPI: {
    appPreferenceControl: { onRequest: (next: Listener) => { listener = next; return () => {}; }, reply, onSettingsChanged: () => () => {} },
    ccSetDebugNet: setDebugNet,
    windowBehavior: { setSwallowActivationClick: setSwallow },
  } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AppPreferenceControl', () => {
  it('reports the sidebar, Feishu, activation click and network diagnostics preferences', async () => {
    render(<AppPreferenceControl />);
    const result = await send(request('get'));
    expect(result.ok).toBe(true);
    expect(result.state).toMatchObject({ sidebarPinned: 'text', feishuNotifications: false, swallowActivationClick: false, networkDebug: false });
    expect(['text', 'list']).toContain(result.state?.sidebarTasks);
  });

  it('saves them through the same setters as Settings and confirms what was stored', async () => {
    render(<AppPreferenceControl />);
    const patch = { sidebarPinned: 'card', sidebarTasks: 'text', feishuNotifications: true, swallowActivationClick: true, networkDebug: true } as const;
    const result = await send(request('update', patch));
    expect(result).toMatchObject({ ok: true, state: patch });
    expect(localStorage.getItem('sidebar.cardMode')).toBe('card');
    expect(localStorage.getItem('sidebar.mainListMode')).toBe('text');
    expect(localStorage.getItem('notifications.feishuEnabled')).toBe('true');
    expect(localStorage.getItem('input.swallowActivationClick')).toBe('true');
    expect(localStorage.getItem('experimental.debug-network')).toBe('true');
    expect(setSwallow).toHaveBeenCalledWith(true);
    expect(setDebugNet).toHaveBeenCalled();
  });

  it('refuses a value outside the preference grammar', async () => {
    render(<AppPreferenceControl />);
    const result = await send(request('update', { sidebarTasks: 'card' } as never));
    expect(result.ok).toBe(false);
    expect(localStorage.getItem('sidebar.mainListMode')).toBeNull();
  });
});

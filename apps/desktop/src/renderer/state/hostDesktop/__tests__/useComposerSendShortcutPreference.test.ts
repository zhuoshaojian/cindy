// @vitest-environment jsdom
import { installDesktopPreferencesHarness, settleDesktopPreferences } from '../../../__tests__/desktopPreferencesHarness';
let host: ReturnType<typeof installDesktopPreferencesHarness>;


import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  getComposerSendShortcutPreference,
  useComposerSendShortcutPreference,
} from '../useComposerSendShortcutPreference';
import { __resetDesktopPreferencesForTests } from '../../hostDesktopPreferences';
import { getDefaultVoiceInputSettings } from '../../../../shared/voiceInputData';

const KEY = 'chat.sendShortcutPreference';


describe('useComposerSendShortcutPreference', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDesktopPreferencesForTests();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        platform: 'darwin',
        voiceInput: {
          getDataSnapshot: () => ({ settings: getDefaultVoiceInputSettings('darwin') }),
        },
      },
    });
    host = installDesktopPreferencesHarness();
  });

  it('defaults to Enter and treats the default as not customized', async () => {
    expect(getComposerSendShortcutPreference()).toBe('enter');

    const { result } = renderHook(() => useComposerSendShortcutPreference());

    expect(result.current.preference).toBe('enter');
    expect(result.current.isCustomized).toBe(false);
  });

  it('only accepts the modifier-enter override from storage', async () => {
    localStorage.setItem(KEY, 'modifier-enter');
    expect(getComposerSendShortcutPreference()).toBe('modifier-enter');

    __resetDesktopPreferencesForTests();
    localStorage.setItem(KEY, 'enter');
    expect(getComposerSendShortcutPreference()).toBe('enter');

    __resetDesktopPreferencesForTests();
    localStorage.setItem(KEY, 'garbage');
    expect(getComposerSendShortcutPreference()).toBe('enter');
  });

  it('persists the non-default override and clears it when Enter is chosen again', async () => {
    const { result } = renderHook(() => useComposerSendShortcutPreference());

    await act(async () => { result.current.setPreference('modifier-enter'); await settleDesktopPreferences(); });
    expect(host.snapshot()).toMatchObject({ status: 'ready', value: { composerSendShortcut: 'modifier-enter' }, customizedKeys: ['composerSendShortcut'] });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getComposerSendShortcutPreference()).toBe('modifier-enter');
    expect(result.current.isCustomized).toBe(true);

    await act(async () => { result.current.setPreference('enter'); await settleDesktopPreferences(); });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getComposerSendShortcutPreference()).toBe('enter');
    expect(result.current.isCustomized).toBe(false);
  });

  it('keeps the Composer preference unchanged when Voice Input owns Cmd+Enter', async () => {
    const settings = {
      ...getDefaultVoiceInputSettings('darwin'),
      shortcut: {
        trigger: 'keyboard' as const,
        code: 'Enter',
        key: 'Enter',
        modifiers: { meta: true, ctrl: false, alt: false, shift: false, fn: false },
      },
    };
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        platform: 'darwin',
        voiceInput: { getDataSnapshot: () => ({ settings }) },
      },
    });

    const { result } = renderHook(() => useComposerSendShortcutPreference());
    let updateResult: ReturnType<typeof result.current.setPreference> | undefined;

    act(() => {
      updateResult = result.current.setPreference('modifier-enter');
    });

    expect(updateResult).toEqual({ ok: false, conflict: 'composer-voice-input' });
    expect(result.current.preference).toBe('enter');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('updates mounted hooks when another renderer changes the preference', async () => {
    const { result } = renderHook(() => useComposerSendShortcutPreference());

    await act(async () => {
      await settleDesktopPreferences();
      host.external({ composerSendShortcut: 'modifier-enter' });
      await settleDesktopPreferences();
    });

    expect(result.current.preference).toBe('modifier-enter');
    expect(result.current.isCustomized).toBe(true);
  });
});

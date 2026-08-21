// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSendDisabledNotice } from '../useSendDisabledNotice';

describe('useSendDisabledNotice', () => {
  it('notifies only once while the same disabled reason stays active', () => {
    const onNotify = vi.fn();
    const { result } = renderHook(() =>
      useSendDisabledNotice({
        active: true,
        message: 'Cloud Cindy is waking',
        onNotify,
      }),
    );

    act(() => result.current());
    act(() => result.current());

    expect(onNotify).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith('Cloud Cindy is waking');
  });

  it('allows a new notice after the disabled state or reason clears', () => {
    const onNotify = vi.fn();
    const { result, rerender } = renderHook(
      ({ active, message }: { active: boolean; message?: string }) =>
        useSendDisabledNotice({ active, message, onNotify }),
      {
        initialProps: {
          active: true,
          message: 'Cloud Cindy is waking' as string | undefined,
        },
      },
    );

    act(() => result.current());
    rerender({ active: false, message: undefined });
    rerender({ active: true, message: 'Cloud Cindy is waking' });
    act(() => result.current());

    expect(onNotify).toHaveBeenCalledTimes(2);
  });
});

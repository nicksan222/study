import { test } from '@study/testing';

import { usePhoneLayout } from './use-phone-layout';

test.unit.stable(
  'updates the notebook layout when the phone breakpoint changes',
  ({ vi, renderHook, act, expect }) => {
    const media = window.matchMedia('(max-width: 600px)');
    let phone = false;
    let changed: (() => void) | undefined;

    vi.spyOn(window, 'matchMedia').mockReturnValue({
      ...media,
      get matches() {
        return phone;
      },
      addEventListener: vi.fn((_event, callback) => {
        changed = callback as () => void;
      })
    });
    const view = renderHook(() => usePhoneLayout());

    expect(view.result.current).toBe(false);
    act(() => {
      phone = true;
      changed?.();
    });
    expect(view.result.current).toBe(true);
  }
);

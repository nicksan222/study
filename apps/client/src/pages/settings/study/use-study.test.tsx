import { testStable } from '@study/testing/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport as settingsTransport } from '#client/test/rpc.tsx';

import { useStudySettings } from './use-study';

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));

beforeEach(() => {
  api.load.mockReset().mockResolvedValue({ newCardsPerDay: 20 });
  api.save.mockReset().mockResolvedValue({});
});

function setup() {
  const fixture = settingsTransport(async (tag, input) => {
    if (tag === 'settings.reviewSettings') return api.load();

    if (tag === 'settings.saveReviewSettings') {
      const result = await api.save(input);

      await fixture.notify();

      return result;
    }

    throw new Error(`Unexpected endpoint ${tag}`);
  });

  return renderHook(() => useStudySettings(), { wrapper: fixture.wrapper });
}

testStable(
  'rejects empty, fractional and out-of-range values without sending a request',
  async () => {
    const { result } = setup();

    await waitFor(() => expect(result.current.draft).toBe('20'));

    for (const value of ['', '-1', '1.5', '10001']) {
      act(() => result.current.setDraft(value));
      expect(result.current.valid).toBe(false);
      act(() => result.current.save());
    }

    expect(api.save).not.toHaveBeenCalled();
  }
);

testStable('saves zero and reloads the committed allowance', async () => {
  const { result } = setup();

  await waitFor(() => expect(result.current.draft).toBe('20'));
  api.load.mockResolvedValue({ newCardsPerDay: 0 });
  act(() => result.current.setDraft('0'));
  act(() => result.current.save());
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ newCardsPerDay: 0 }));
  await waitFor(() => expect(result.current.data?.newCardsPerDay).toBe(0));
  expect(result.current.changed).toBe(false);
});

testStable('restores the saved allowance on failure and recovers by retrying', async () => {
  const { result } = setup();

  await waitFor(() => expect(result.current.draft).toBe('20'));
  api.save.mockRejectedValue(new Error('offline'));
  act(() => result.current.setDraft('30'));
  act(() => result.current.save());
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.draft).toBe('30');
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.error).toBe(false));
});

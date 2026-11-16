import { test } from '@study/testing';

import { useStudySettings } from './use-study';

const api = test.hoisted(() => ({ load: test.vi.fn(), save: test.vi.fn() }));

test.beforeEach(() => {
  api.load.mockReset().mockResolvedValue({ newCardsPerDay: 20 });
  api.save.mockReset().mockResolvedValue({});
});

function setup() {
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.reviewSettings') return api.load();

    if (tag === 'settings.saveReviewSettings') {
      const result = await api.save(input);

      await fixture.notify();

      return result;
    }

    throw new Error(`Unexpected endpoint ${tag}`);
  });

  return test.renderHook(() => useStudySettings(), { wrapper: fixture.wrapper });
}

test.stable(
  'rejects empty, fractional and out-of-range values without sending a request',
  async () => {
    const { result } = setup();

    await test.waitFor(() => test.expect(result.current.draft).toBe('20'));

    for (const value of ['', '-1', '1.5', '10001']) {
      test.act(() => result.current.setDraft(value));
      test.expect(result.current.valid).toBe(false);
      test.act(() => result.current.save());
    }

    test.expect(api.save).not.toHaveBeenCalled();
  }
);

test.stable('saves zero and reloads the committed allowance', async () => {
  const { result } = setup();

  await test.waitFor(() => test.expect(result.current.draft).toBe('20'));
  api.load.mockResolvedValue({ newCardsPerDay: 0 });
  test.act(() => result.current.setDraft('0'));
  test.act(() => result.current.save());
  await test.waitFor(() => test.expect(api.save).toHaveBeenCalledWith({ newCardsPerDay: 0 }));
  await test.waitFor(() => test.expect(result.current.data?.newCardsPerDay).toBe(0));
  test.expect(result.current.changed).toBe(false);
});

test.stable('restores the saved allowance on failure and recovers by retrying', async () => {
  const { result } = setup();

  await test.waitFor(() => test.expect(result.current.draft).toBe('20'));
  api.save.mockRejectedValue(new Error('offline'));
  test.act(() => result.current.setDraft('30'));
  test.act(() => result.current.save());
  await test.waitFor(() => test.expect(result.current.error).toBe(true));
  test.expect(result.current.draft).toBe('30');
  test.act(() => result.current.retry());
  await test.waitFor(() => test.expect(result.current.error).toBe(false));
});

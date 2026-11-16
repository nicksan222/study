import { test } from '@study/testing';

import { useStudySettings } from './use-study';

function createApi(mock: test.Mock) {
  return { load: mock.fn(), save: mock.fn() };
}

let api: ReturnType<typeof createApi>;

test.unit.beforeEach(({ mock }) => {
  api = createApi(mock);
  api.load.mockResolvedValue({ newCardsPerDay: 20 });
  api.save.mockResolvedValue({});
});

function setup({
  rpcTestTransport,
  renderHook
}: Pick<test.unit.Context, 'rpcTestTransport' | 'renderHook'>) {
  const fixture = rpcTestTransport(async (tag, input) => {
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

test.unit.stable(
  'rejects empty, fractional and out-of-range values without sending a request',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    const { result } = setup({ rpcTestTransport, renderHook });

    await waitFor(() => expect(result.current.draft).toBe('20'));

    for (const value of ['', '-1', '1.5', '10001']) {
      act(() => result.current.setDraft(value));
      expect(result.current.valid).toBe(false);
      act(() => result.current.save());
    }

    expect(api.save).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'saves zero and reloads the committed allowance',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    const { result } = setup({ rpcTestTransport, renderHook });

    await waitFor(() => expect(result.current.draft).toBe('20'));
    api.load.mockResolvedValue({ newCardsPerDay: 0 });
    act(() => result.current.setDraft('0'));
    act(() => result.current.save());
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ newCardsPerDay: 0 }));
    await waitFor(() => expect(result.current.data?.newCardsPerDay).toBe(0));
    expect(result.current.changed).toBe(false);
  }
);

test.unit.stable(
  'restores the saved allowance on failure and recovers by retrying',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    const { result } = setup({ rpcTestTransport, renderHook });

    await waitFor(() => expect(result.current.draft).toBe('20'));
    api.save.mockRejectedValue(new Error('offline'));
    act(() => result.current.setDraft('30'));
    act(() => result.current.save());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.draft).toBe('30');
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBe(false));
  }
);

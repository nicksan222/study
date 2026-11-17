import { test } from '@study/testing';

import { usePerformanceSettings } from './use-performance';

function createApi(mock: test.Mock) {
  return { load: mock.fn(), save: mock.fn() };
}

let api: ReturnType<typeof createApi>;

test.unit.beforeEach(({ mock }) => {
  api = createApi(mock);
  api.load.mockResolvedValue({ maxConcurrentAi: 2, maxQueuedAi: 16 });
  api.save.mockResolvedValue({});
});

function setup({
  rpcTestTransport,
  renderHook
}: Pick<test.unit.Context, 'rpcTestTransport' | 'renderHook'>) {
  const fixture = rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.concurrencySettings') return api.load();

    if (tag === 'settings.saveConcurrencySettings') {
      const result = await api.save(input);

      await fixture.notify();

      return result;
    }

    throw new Error(`Unexpected endpoint ${tag}`);
  });

  return renderHook(() => usePerformanceSettings(), { wrapper: fixture.wrapper });
}

test.unit.stable(
  'rejects invalid active and queue limits without sending a request',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    const { result } = setup({ rpcTestTransport, renderHook });

    await waitFor(() => expect(result.current.active.value).toBe('2'));

    for (const value of ['', '0', '1.5', '9']) {
      act(() => result.current.active.setValue(value));
      expect(result.current.active.valid).toBe(false);
    }

    for (const value of ['', '-1', '2.5', '65']) {
      act(() => result.current.queued.setValue(value));
      expect(result.current.queued.valid).toBe(false);
    }

    expect(api.save).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'saves zero queue capacity while preserving active capacity and its unsaved draft',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    const { result } = setup({ rpcTestTransport, renderHook });

    await waitFor(() => expect(result.current.queued.value).toBe('16'));
    act(() => result.current.active.setValue(''));
    act(() => result.current.queued.setValue('0'));
    api.load.mockResolvedValue({ maxConcurrentAi: 2, maxQueuedAi: 0 });
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({ maxConcurrentAi: 2, maxQueuedAi: 0 })
    );
    await waitFor(() => expect(result.current.data?.maxQueuedAi).toBe(0));
    expect(result.current.queued.changed).toBe(false);
    expect(result.current.active.value).toBe('');
  }
);

test.unit.stable(
  'does not save unchanged values and retains a failed draft before explicit retry',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    const { result } = setup({ rpcTestTransport, renderHook });

    await waitFor(() => expect(result.current.active.value).toBe('2'));
    expect(api.save).not.toHaveBeenCalled();
    api.save.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.active.setValue('1'));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.active.value).toBe('1');
    api.load.mockResolvedValue({ maxConcurrentAi: 1, maxQueuedAi: 16 });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBe(false));
  }
);

test.unit.stable(
  'exposes loading failures and retries to recover saved limits',
  async ({ waitFor, expect, act, rpcTestTransport, renderHook }) => {
    api.load.mockRejectedValueOnce(new Error('offline'));
    const { result } = setup({ rpcTestTransport, renderHook });

    await waitFor(() => expect(result.current.error).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.active.value).toBe('2'));
    expect(result.current.error).toBe(false);
  }
);

import { test } from '@study/testing';

import { usePerformanceSettings } from './use-performance';

const api = test.hoisted(() => ({ load: test.vi.fn(), save: test.vi.fn() }));

test.beforeEach(() => {
  api.load.mockReset().mockResolvedValue({ maxConcurrentAi: 2, maxQueuedAi: 16 });
  api.save.mockReset().mockResolvedValue({});
});

function setup() {
  const fixture = test.rpcTestTransport(async (tag, input) => {
    if (tag === 'settings.concurrencySettings') return api.load();

    if (tag === 'settings.saveConcurrencySettings') {
      const result = await api.save(input);

      await fixture.notify();

      return result;
    }

    throw new Error(`Unexpected endpoint ${tag}`);
  });

  return test.renderHook(() => usePerformanceSettings(), { wrapper: fixture.wrapper });
}

test.stable('rejects invalid active and queue limits without sending a request', async () => {
  const { result } = setup();

  await test.waitFor(() => test.expect(result.current.active.value).toBe('2'));

  for (const value of ['', '0', '1.5', '9']) {
    test.act(() => result.current.active.setValue(value));
    test.expect(result.current.active.valid).toBe(false);
    test.act(() => result.current.active.save());
  }

  for (const value of ['', '-1', '2.5', '65']) {
    test.act(() => result.current.queued.setValue(value));
    test.expect(result.current.queued.valid).toBe(false);
    test.act(() => result.current.queued.save());
  }

  test.expect(api.save).not.toHaveBeenCalled();
});

test.stable(
  'saves zero queue capacity while preserving active capacity and its unsaved draft',
  async () => {
    const { result } = setup();

    await test.waitFor(() => test.expect(result.current.queued.value).toBe('16'));
    test.act(() => result.current.active.setValue('8'));
    test.act(() => result.current.queued.setValue('0'));
    api.load.mockResolvedValue({ maxConcurrentAi: 2, maxQueuedAi: 0 });
    test.act(() => result.current.queued.save());
    await test.waitFor(() =>
      test.expect(api.save).toHaveBeenCalledWith({ maxConcurrentAi: 2, maxQueuedAi: 0 })
    );
    await test.waitFor(() => test.expect(result.current.data?.maxQueuedAi).toBe(0));
    test.expect(result.current.queued.changed).toBe(false);
    test.expect(result.current.active.value).toBe('8');
  }
);

test.stable(
  'does not save unchanged values and retains a failed draft before explicit retry',
  async () => {
    const { result } = setup();

    await test.waitFor(() => test.expect(result.current.active.value).toBe('2'));
    test.act(() => result.current.active.save());
    test.expect(api.save).not.toHaveBeenCalled();
    api.save.mockRejectedValue(new Error('offline'));
    test.act(() => result.current.active.setValue('1'));
    test.act(() => result.current.active.save());
    await test.waitFor(() => test.expect(result.current.error).toBe(true));
    test.expect(result.current.active.value).toBe('1');
    test.act(() => result.current.retry());
    await test.waitFor(() => test.expect(result.current.error).toBe(false));
  }
);

test.stable('exposes loading failures and retries to recover saved limits', async () => {
  api.load.mockRejectedValueOnce(new Error('offline'));
  const { result } = setup();

  await test.waitFor(() => test.expect(result.current.error).toBe(true));
  test.act(() => result.current.retry());
  await test.waitFor(() => test.expect(result.current.active.value).toBe('2'));
  test.expect(result.current.error).toBe(false);
});

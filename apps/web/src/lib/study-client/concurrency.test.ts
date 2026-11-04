import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { loadConcurrencySettings, saveConcurrencySettings } from './concurrency';

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), closed: 0 }));

vi.mock('./client', async () => {
  const { Effect } = await import('effect');

  return {
    studyClient: Effect.acquireRelease(
      Effect.succeed({
        'settings.concurrencySettings': () => api.load(),
        'settings.saveConcurrencySettings': (input: unknown) => api.save(input)
      }),
      () =>
        Effect.sync(() => {
          api.closed++;
        })
    )
  };
});

beforeEach(() => {
  api.closed = 0;
  api.load.mockReset().mockReturnValue(Effect.succeed({ maxConcurrentAi: 2, maxQueuedAi: 16 }));
  api.save.mockReset().mockReturnValue(Effect.succeed({}));
});

testStable(
  'reads and saves the canonical concurrency settings and closes request scopes',
  async () => {
    expect(await loadConcurrencySettings()).toEqual({ maxConcurrentAi: 2, maxQueuedAi: 16 });
    await saveConcurrencySettings({ maxConcurrentAi: 1, maxQueuedAi: 0 });
    expect(api.save).toHaveBeenCalledWith({ maxConcurrentAi: 1, maxQueuedAi: 0 });
    expect(api.closed).toBe(2);
  }
);

testStable('preserves typed save failures and releases the RPC scope', async () => {
  api.save.mockReturnValue(Effect.fail({ kind: 'transient', message: 'offline' }));
  await expect(
    saveConcurrencySettings({ maxConcurrentAi: 8, maxQueuedAi: 64 })
  ).rejects.toMatchObject({ kind: 'transient' });
  expect(api.closed).toBe(1);
});

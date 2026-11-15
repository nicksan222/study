import { testStable } from '@study/testing/vitest';
import { Effect, Queue, Result, Schedule as importedSchedule, Stream } from 'effect';
import { AsyncResult, AtomRegistry } from 'effect/reactivity';
import { expect, vi } from 'vite-plus/test';

import type { LiveFrame } from '../src/protocol.ts';
import { liveQueryAtom, SubscriptionDefect } from '../src/react-state.ts';

const policy = {
  livenessTimeoutMs: 1000,
  reconnectDelayMs: 1,
  retryable: () => true,
  unauthorized: () => false
};

testStable(
  'live atoms share continuous latest snapshots and release the final subscription',
  async () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
    const queue = await Effect.runPromise(Queue.unbounded<number>());
    let active = 0;
    const snapshot = (value: number): LiveFrame<number, never> => ({
      _tag: 'Snapshot',
      result: Result.succeed(value)
    });
    const acquire = Effect.sync(() => {
      active++;

      return Stream.fromQueue(queue).pipe(Stream.map(snapshot));
    });
    const release = () =>
      Effect.sync(() => {
        active--;
      });
    const atom = liveQueryAtom(
      () => Stream.unwrap(Effect.acquireRelease(acquire, release)),
      policy
    );
    const cancelFirst = registry.subscribe(atom, () => {}, { immediate: true });
    const cancelSecond = registry.subscribe(atom, () => {}, { immediate: true });

    await vi.waitFor(() => expect(active).toBe(1));
    await Effect.runPromise(Queue.offer(queue, 1));
    await vi.waitFor(() => expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(1));
    await Effect.runPromise(Queue.offer(queue, 2));
    await vi.waitFor(() => expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(2));
    cancelFirst();
    expect(active).toBe(1);
    cancelSecond();
    await vi.waitFor(() => expect(active).toBe(0));
    registry.dispose();
  }
);

testStable('failed refresh preserves failure and previous value during reconnect', async () => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
  let attempts = 0;
  const atom = liveQueryAtom(
    () => {
      attempts++;

      return attempts === 1
        ? Stream.make({ _tag: 'Snapshot' as const, result: Result.succeed(42) }).pipe(
            Stream.concat(Stream.fail('offline'))
          )
        : Stream.never;
    },
    { ...policy, reconnectDelayMs: 100 }
  );
  const cancel = registry.subscribe(atom, () => {}, { immediate: true });

  await vi.waitFor(() => {
    const state = registry.get(atom);

    expect(state.stale).toBe(true);
    expect(AsyncResult.isFailure(state.result)).toBe(true);
    expect(AsyncResult.getOrElse(state.result, () => -1)).toBe(42);
  });
  cancel();
  registry.dispose();
});

testStable('authorization failures clear previously successful data and do not retry', async () => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
  let attempts = 0;
  const atom = liveQueryAtom(
    () => {
      attempts++;

      return Stream.make(
        { _tag: 'Snapshot' as const, result: Result.succeed(42) },
        { _tag: 'Snapshot' as const, result: Result.fail('denied') }
      ).pipe(Stream.concat(Stream.never));
    },
    { ...policy, unauthorized: (error) => error === 'denied', retryable: () => false }
  );
  const cancel = registry.subscribe(atom, () => {}, { immediate: true });

  await vi.waitFor(() => {
    const result = registry.get(atom).result;

    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => -1)).toBe(-1);
  });
  expect(attempts).toBe(1);
  cancel();
  registry.dispose();
});

testStable(
  'domain failures remain observed and recover on a later authoritative snapshot',
  async () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
    const queue = await Effect.runPromise(Queue.unbounded<LiveFrame<number, string>>());
    let opens = 0;
    const atom = liveQueryAtom(
      () => {
        opens++;

        return Stream.fromQueue(queue);
      },
      { ...policy, retryable: () => false }
    );
    const cancel = registry.subscribe(atom, () => {}, { immediate: true });

    await Effect.runPromise(
      Queue.offer(queue, { _tag: 'Snapshot', result: Result.fail('unavailable') })
    );
    await vi.waitFor(() => expect(AsyncResult.isFailure(registry.get(atom).result)).toBe(true));
    await Effect.runPromise(Queue.offer(queue, { _tag: 'Heartbeat' }));
    expect(AsyncResult.isFailure(registry.get(atom).result)).toBe(true);
    await Effect.runPromise(Queue.offer(queue, { _tag: 'Snapshot', result: Result.succeed(7) }));
    await vi.waitFor(() => expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(7));
    expect(opens).toBe(1);
    expect(registry.get(atom).stale).toBe(false);
    cancel();
    registry.dispose();
  }
);

testStable(
  'healthy heartbeat traffic prevents idle query reconnection without fabricating data',
  async () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
    let opens = 0;
    const atom = liveQueryAtom(
      () => {
        opens++;

        return Stream.make({ _tag: 'Heartbeat' as const }).pipe(
          Stream.repeat(importedSchedule.spaced(5))
        );
      },
      { ...policy, livenessTimeoutMs: 20 }
    );
    const cancel = registry.subscribe(atom, () => {}, { immediate: true });

    await Effect.runPromise(Effect.sleep(70));
    expect(opens).toBe(1);
    expect(AsyncResult.isInitial(registry.get(atom).result)).toBe(true);
    cancel();
    registry.dispose();
  }
);

testStable(
  'transient domain failures recover through bounded retries without a dependency change',
  async () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
    let attempts = 0;
    const atom = liveQueryAtom(
      () => {
        attempts++;

        return Stream.make(
          attempts === 1
            ? { _tag: 'Snapshot' as const, result: Result.fail('transient') }
            : { _tag: 'Snapshot' as const, result: Result.succeed(9) }
        ).pipe(Stream.concat(Stream.never));
      },
      { ...policy, reconnectDelayMs: 5, reconnectMaxDelayMs: 20 }
    );
    const cancel = registry.subscribe(atom, () => {}, { immediate: true });

    await vi.waitFor(() => expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(9));
    expect(attempts).toBe(2);
    cancel();
    registry.dispose();
  }
);

testStable.each([NaN, Infinity, -1, 0, 0.5])(
  'rejects invalid maximum reconnect delay %s',
  (reconnectMaxDelayMs) => {
    expect(() =>
      liveQueryAtom(() => Stream.never, { ...policy, reconnectDelayMs: 1, reconnectMaxDelayMs })
    ).toThrow(RangeError);
  }
);

testStable(
  'refreshing frames retain the prior snapshot and expose a slow read as stale and waiting',
  async () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
    const queue = await Effect.runPromise(Queue.unbounded<LiveFrame<number, string>>());
    const atom = liveQueryAtom(() => Stream.fromQueue(queue), policy);
    const cancel = registry.subscribe(atom, () => {}, { immediate: true });

    await Effect.runPromise(Queue.offer(queue, { _tag: 'Snapshot', result: Result.succeed(1) }));
    await vi.waitFor(() => expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(1));
    await Effect.runPromise(Queue.offer(queue, { _tag: 'Refreshing' }));
    await vi.waitFor(() => {
      const state = registry.get(atom);

      expect(AsyncResult.getOrThrow(state.result)).toBe(1);
      expect(state.result.waiting).toBe(true);
      expect(state.stale).toBe(true);
    });
    await Effect.runPromise(Queue.offer(queue, { _tag: 'Snapshot', result: Result.succeed(2) }));
    await vi.waitFor(() => {
      const state = registry.get(atom);

      expect(AsyncResult.getOrThrow(state.result)).toBe(2);
      expect(state.result.waiting).toBe(false);
      expect(state.stale).toBe(false);
    });
    cancel();
    registry.dispose();
  }
);

testStable(
  'remote defects are typed and recover according to the bounded read policy',
  async () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
    const defect = new Error('Temporary remote defect');
    let opens = 0;
    const atom = liveQueryAtom(
      () => {
        opens++;

        return opens === 1
          ? Stream.die(defect)
          : Stream.make({ _tag: 'Snapshot' as const, result: Result.succeed(12) }).pipe(
              Stream.concat(Stream.never)
            );
      },
      { ...policy, reconnectDelayMs: 50, reconnectMaxDelayMs: 100 }
    );
    const cancel = registry.subscribe(atom, () => {}, { immediate: true });

    await vi.waitFor(
      () => {
        const state = registry.get(atom);
        const error = AsyncResult.error(state.result);

        expect(error._tag).toBe('Some');

        if (error._tag === 'Some') {
          expect(error.value).toBeInstanceOf(SubscriptionDefect);

          if (error.value instanceof SubscriptionDefect) expect(error.value.cause).toBe(defect);
        }

        expect(state.disconnected).toBe(true);
      },
      { interval: 5 }
    );
    await vi.waitFor(() => expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(12));
    expect(opens).toBe(2);
    cancel();
    registry.dispose();
  }
);

testStable('releasing a failed subscription cancels its pending defect retry', async () => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
  let opens = 0;
  const atom = liveQueryAtom(
    () => {
      opens++;

      return Stream.die(new Error('Temporary defect'));
    },
    { ...policy, reconnectDelayMs: 30 }
  );
  const cancel = registry.subscribe(atom, () => {}, { immediate: true });

  await vi.waitFor(() => expect(AsyncResult.isFailure(registry.get(atom).result)).toBe(true), {
    interval: 5
  });
  cancel();
  await Effect.runPromise(Effect.sleep(75));
  expect(opens).toBe(1);
  registry.dispose();
});

testStable('pure stream interruption does not become a retryable remote defect', async () => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
  let opens = 0;
  const atom = liveQueryAtom(
    () => {
      opens++;

      return Stream.fromEffect(Effect.interrupt);
    },
    { ...policy, reconnectDelayMs: 5 }
  );
  const cancel = registry.subscribe(atom, () => {}, { immediate: true });

  await Effect.runPromise(Effect.sleep(30));
  expect(opens).toBe(1);
  expect(AsyncResult.error(registry.get(atom).result)._tag).toBe('None');
  cancel();
  registry.dispose();
});

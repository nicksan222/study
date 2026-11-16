import { test } from '@study/testing';
import { Effect, Queue, Result, Schedule as importedSchedule, Stream } from 'effect';
import { AsyncResult, AtomRegistry } from 'effect/reactivity';

import type { LiveFrame } from '../src/protocol.ts';
import { liveQueryAtom, SubscriptionDefect } from '../src/react-state.ts';

const policy = {
  livenessTimeoutMs: 1000,
  reconnectDelayMs: 1,
  retryable: () => true,
  unauthorized: () => false
};

test.stable(
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

    await test.vi.waitFor(() => test.expect(active).toBe(1));
    await Effect.runPromise(Queue.offer(queue, 1));
    await test.vi.waitFor(() =>
      test.expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(1)
    );
    await Effect.runPromise(Queue.offer(queue, 2));
    await test.vi.waitFor(() =>
      test.expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(2)
    );
    cancelFirst();
    test.expect(active).toBe(1);
    cancelSecond();
    await test.vi.waitFor(() => test.expect(active).toBe(0));
    registry.dispose();
  }
);

test.stable('failed refresh preserves failure and previous value during reconnect', async () => {
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

  await test.vi.waitFor(() => {
    const state = registry.get(atom);

    test.expect(state.stale).toBe(true);
    test.expect(AsyncResult.isFailure(state.result)).toBe(true);
    test.expect(AsyncResult.getOrElse(state.result, () => -1)).toBe(42);
  });
  cancel();
  registry.dispose();
});

test.stable(
  'authorization failures clear previously successful data and do not retry',
  async () => {
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

    await test.vi.waitFor(() => {
      const result = registry.get(atom).result;

      test.expect(AsyncResult.isFailure(result)).toBe(true);
      test.expect(AsyncResult.getOrElse(result, () => -1)).toBe(-1);
    });
    test.expect(attempts).toBe(1);
    cancel();
    registry.dispose();
  }
);

test.stable(
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
    await test.vi.waitFor(() =>
      test.expect(AsyncResult.isFailure(registry.get(atom).result)).toBe(true)
    );
    await Effect.runPromise(Queue.offer(queue, { _tag: 'Heartbeat' }));
    test.expect(AsyncResult.isFailure(registry.get(atom).result)).toBe(true);
    await Effect.runPromise(Queue.offer(queue, { _tag: 'Snapshot', result: Result.succeed(7) }));
    await test.vi.waitFor(() =>
      test.expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(7)
    );
    test.expect(opens).toBe(1);
    test.expect(registry.get(atom).stale).toBe(false);
    cancel();
    registry.dispose();
  }
);

test.stable(
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
    test.expect(opens).toBe(1);
    test.expect(AsyncResult.isInitial(registry.get(atom).result)).toBe(true);
    cancel();
    registry.dispose();
  }
);

test.stable(
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

    await test.vi.waitFor(() =>
      test.expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(9)
    );
    test.expect(attempts).toBe(2);
    cancel();
    registry.dispose();
  }
);

test.stable.each([NaN, Infinity, -1, 0, 0.5])(
  'rejects invalid maximum reconnect delay %s',
  (reconnectMaxDelayMs) => {
    test
      .expect(() =>
        liveQueryAtom(() => Stream.never, { ...policy, reconnectDelayMs: 1, reconnectMaxDelayMs })
      )
      .toThrow(RangeError);
  }
);

test.stable(
  'refreshing frames retain the prior snapshot and expose a slow read as stale and waiting',
  async () => {
    const registry = AtomRegistry.make({ defaultIdleTTL: 0, timeoutResolution: 1 });
    const queue = await Effect.runPromise(Queue.unbounded<LiveFrame<number, string>>());
    const atom = liveQueryAtom(() => Stream.fromQueue(queue), policy);
    const cancel = registry.subscribe(atom, () => {}, { immediate: true });

    await Effect.runPromise(Queue.offer(queue, { _tag: 'Snapshot', result: Result.succeed(1) }));
    await test.vi.waitFor(() =>
      test.expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(1)
    );
    await Effect.runPromise(Queue.offer(queue, { _tag: 'Refreshing' }));
    await test.vi.waitFor(() => {
      const state = registry.get(atom);

      test.expect(AsyncResult.getOrThrow(state.result)).toBe(1);
      test.expect(state.result.waiting).toBe(true);
      test.expect(state.stale).toBe(true);
    });
    await Effect.runPromise(Queue.offer(queue, { _tag: 'Snapshot', result: Result.succeed(2) }));
    await test.vi.waitFor(() => {
      const state = registry.get(atom);

      test.expect(AsyncResult.getOrThrow(state.result)).toBe(2);
      test.expect(state.result.waiting).toBe(false);
      test.expect(state.stale).toBe(false);
    });
    cancel();
    registry.dispose();
  }
);

test.stable(
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

    await test.vi.waitFor(
      () => {
        const state = registry.get(atom);
        const error = AsyncResult.error(state.result);

        test.expect(error._tag).toBe('Some');

        if (error._tag === 'Some') {
          test.expect(error.value).toBeInstanceOf(SubscriptionDefect);

          if (error.value instanceof SubscriptionDefect)
            test.expect(error.value.cause).toBe(defect);
        }

        test.expect(state.disconnected).toBe(true);
      },
      { interval: 5 }
    );
    await test.vi.waitFor(() =>
      test.expect(AsyncResult.getOrThrow(registry.get(atom).result)).toBe(12)
    );
    test.expect(opens).toBe(2);
    cancel();
    registry.dispose();
  }
);

test.stable('releasing a failed subscription cancels its pending defect retry', async () => {
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

  await test.vi.waitFor(
    () => test.expect(AsyncResult.isFailure(registry.get(atom).result)).toBe(true),
    {
      interval: 5
    }
  );
  cancel();
  await Effect.runPromise(Effect.sleep(75));
  test.expect(opens).toBe(1);
  registry.dispose();
});

test.stable('pure stream interruption does not become a retryable remote defect', async () => {
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
  test.expect(opens).toBe(1);
  test.expect(AsyncResult.error(registry.get(atom).result)._tag).toBe('None');
  cancel();
  registry.dispose();
});

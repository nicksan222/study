import { test } from '@study/testing';
import { Deferred, Effect, Stream } from 'effect';

test.stable(
  'stream observations return the matching snapshot and release the subscription',
  async ({ expect, runTestEffect, observeUntil }) => {
    let released = false;
    const release = Effect.sync(() => {
      released = true;
    });
    const stream = Stream.unwrap(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => release);

        return Stream.fromIterable(['pending', 'ready', 'later']);
      })
    );

    expect(await runTestEffect(observeUntil(stream, (value) => value === 'ready'))).toBe('ready');
    expect(released).toBe(true);
  }
);

test.stable(
  'stream observations preserve typed failures and reject exhausted observations',
  async ({ runTestEffect, observeUntil, expect }) => {
    const failure = { kind: 'unavailable' };
    const result = await runTestEffect(
      observeUntil(Stream.fail(failure), () => true).pipe(Effect.result)
    );

    expect(result).toMatchObject({ failure });
    await expect(runTestEffect(observeUntil(Stream.empty, () => true))).rejects.toThrow(
      'Observation ended before matching'
    );
  }
);

test.stable(
  'test cancellation interrupts owned Effect work and awaits its finalizers',
  async ({ runTestEffect, expect }) => {
    const controller = new AbortController();
    const started = await Effect.runPromise(Deferred.make<void>());
    let released = false;
    const release = Effect.sync(() => {
      released = true;
    });
    const running = runTestEffect(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => release);
        yield* Deferred.succeed(started, undefined);
        yield* Effect.never;
      }),
      { signal: controller.signal }
    );
    const result = running.then(
      () => 'unexpected success',
      () => 'interrupted'
    );

    await Effect.runPromise(Deferred.await(started));
    controller.abort();
    expect(await result).toBe('interrupted');
    expect(released).toBe(true);
  }
);

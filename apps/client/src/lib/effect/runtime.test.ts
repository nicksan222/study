import { StudyError } from '@study/contracts';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { runRequest } from './runtime';

test.stable('preserves expected failures and their retry metadata', async () => {
  const error = new StudyError('rate_limited', 'limited', { retryAfterMs: 300 });

  await test.expect(runRequest(Effect.fail(error))).rejects.toBe(error);
});

test.stable('returns successful values', async () => {
  test.expect(await runRequest(Effect.succeed(42))).toBe(42);
});

test.stable('keeps unexpected defects as internal failures with their cause', async () => {
  await test.expect(runRequest(Effect.die(new Error('defect')))).rejects.toMatchObject({
    kind: 'internal',
    cause: test.expect.anything()
  });
});

test.stable('forwards interruption to the transport without presenting an error', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted = false;
  const operation = Effect.tryPromise({
    try: (signal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
        started();
      }),
    catch: (cause) => new StudyError('transient', 'offline', { cause })
  });
  const pending = runRequest(operation, controller.signal);

  await ready;
  controller.abort();
  await test.expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  test.expect(aborted).toBe(true);
});

test.stable('does not start an operation when its owner is already aborted', async () => {
  const controller = new AbortController();

  controller.abort();
  let started = false;

  await test
    .expect(
      runRequest(
        Effect.sync(() => {
          started = true;
        }),
        controller.signal
      )
    )
    .rejects.toMatchObject({ name: 'AbortError' });
  test.expect(started).toBe(false);
});

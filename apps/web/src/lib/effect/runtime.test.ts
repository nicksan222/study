import { StudyError } from '@study/contracts/errors';
import { Effect } from 'effect';
import { expect, it } from 'vite-plus/test';

import { runRequest } from './runtime';

it('preserves expected failures and their retry metadata', async () => {
  const error = new StudyError('rate_limited', 'limited', { retryAfterMs: 300 });

  await expect(runRequest(Effect.fail(error))).rejects.toBe(error);
});

it('returns successful values', async () => {
  expect(await runRequest(Effect.succeed(42))).toBe(42);
});

it('keeps unexpected defects as internal failures with their cause', async () => {
  await expect(runRequest(Effect.die(new Error('defect')))).rejects.toMatchObject({
    kind: 'internal',
    cause: expect.anything()
  });
});

it('forwards interruption to the transport without presenting an error', async () => {
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
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(aborted).toBe(true);
});

it('does not start an operation when its owner is already aborted', async () => {
  const controller = new AbortController();

  controller.abort();
  let started = false;

  await expect(
    runRequest(
      Effect.sync(() => {
        started = true;
      }),
      controller.signal
    )
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(started).toBe(false);
});

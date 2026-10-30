import { StudyError } from '@study/contracts/errors';
import { Effect } from 'effect';
import { expect, it } from 'vite-plus/test';

import { runOperation } from './runtime';

it('preserves expected failures and their retry metadata', async () => {
  const error = new StudyError('rate_limited', 'limited', { retryAfterMs: 300 });

  expect(await runOperation(Effect.fail(error), new AbortController().signal)).toEqual({
    status: 'error',
    error
  });
});

it('returns successful values', async () => {
  expect(await runOperation(Effect.succeed(42), new AbortController().signal)).toEqual({
    status: 'ready',
    value: 42
  });
});

it('keeps unexpected defects as internal failures with their cause', async () => {
  const result = await runOperation(Effect.die(new Error('defect')), new AbortController().signal);

  expect(result.status).toBe('error');

  if (result.status === 'error') {
    expect(result.error.kind).toBe('internal');
    expect(result.error.cause).toBeDefined();
  }
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
  const pending = runOperation(operation, controller.signal);

  await ready;
  controller.abort();
  expect(await pending).toEqual({ status: 'cancelled' });
  expect(aborted).toBe(true);
});

it('does not start an operation when its owner is already aborted', async () => {
  const controller = new AbortController();

  controller.abort();
  let started = false;

  expect(
    await runOperation(
      Effect.sync(() => {
        started = true;
      }),
      controller.signal
    )
  ).toEqual({ status: 'cancelled' });
  expect(started).toBe(false);
});

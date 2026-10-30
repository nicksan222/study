import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyError } from '@study/contracts/errors';
import { Effect, Logger } from 'effect';

import { adaptRequestCheck } from './tool-adapter.ts';

test('provider preflights inherit the scoped logger and preserve typed failures', async () => {
  const messages: unknown[] = [];
  const logger = Logger.make((entry) => messages.push(entry.message));

  function* verifyScopedPreflights() {
    const context = yield* Effect.context<never>();
    const span = yield* Effect.currentSpan;
    const callback = adaptRequestCheck(Effect.logInfo('Preflight checked'), span, {}, context);

    yield* Effect.promise(() => callback(undefined));
    assert.equal(messages.length, 1);
    const error = new StudyError('invalid_input', 'stale request');
    const invalid = adaptRequestCheck(Effect.fail(error), span, {}, context);

    yield* Effect.promise(() =>
      assert.rejects(invalid(undefined), (actual: unknown) => actual === error)
    );
  }

  await Effect.runPromise(
    Effect.gen(verifyScopedPreflights).pipe(
      Effect.withSpan('scoped-preflight'),
      Effect.provide(Logger.layer([logger]))
    )
  );
});

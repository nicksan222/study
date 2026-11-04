/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies provider preflight callbacks retain the originating Effect logger and     │
 * │ propagate typed failures. This protects context across the callback bridge into the      │
 * │ model request.                                                                           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: provider preflights inherit the scoped logger and preserve typed failures.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes ./tool-adapter.ts directly with Vitest   ; no application or database fixture is │
 * │ involved.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { Effect, Logger } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { adaptRequestCheck } from './tool-adapter.ts';

testStable(
  'provider preflights inherit the scoped logger and preserve typed failures',
  async () => {
    const messages: unknown[] = [];
    const logger = Logger.make((entry) => messages.push(entry.message));

    function* verifyScopedPreflights() {
      const context = yield* Effect.context<never>();
      const span = yield* Effect.currentSpan;
      const callback = adaptRequestCheck(Effect.logInfo('Preflight checked'), span, {}, context);

      yield* Effect.promise(() => callback(undefined));
      assert.strictEqual(messages.length, 1);
      const error = new StudyError('invalid_input', 'stale request');
      const invalid = adaptRequestCheck(Effect.fail(error), span, {}, context);

      yield* Effect.promise(() =>
        expect(invalid(undefined)).rejects.toSatisfy((actual: unknown) => actual === error)
      );
    }

    await Effect.runPromise(
      Effect.gen(verifyScopedPreflights).pipe(
        Effect.withSpan('scoped-preflight'),
        Effect.provide(Logger.layer([logger]))
      )
    );
  }
);

/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies schema validation and rollback in the shared mutation harness.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks rejected inputs and failed writes cannot change persisted values.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Exercises real typed stores and SQLite transactions without feature services.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { preferences } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { defineStore, storeMutation } from '#server/platform/definitions/define-store';
import { validatedMutation } from '#server/platform/definitions/validated-mutation';

const probe = defineStore({
  name: 'test/ValidatedProbe',
  entity: { singular: 'value', plural: 'values' },
  make: ({ db }) => ({
    queries: {},
    mutations: {
      save: storeMutation({
        input: Schema.Int,
        output: Schema.Void,
        run: (value) => {
          db.orm
            .insert(preferences)
            .values({ scope: 'validation', key: String(value), value: String(value) })
            .run();
        }
      })
    }
  })
});

testStable(
  'validated mutation rejects inputs and rolls back a typed store write on failure',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const failure = new StudyError('internal', 'write failed');
    const save = validatedMutation({
      input: Schema.Int,
      message: 'Expected an integer',
      write: (tx, value) => {
        tx.store(probe).save(value);

        if (value === 2) throw failure;

        return { value };
      }
    });
    const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(Database, { store: context })));

    try {
      assert.deepStrictEqual(await run(save(1)), { value: 1 });
      const invalid = await run(Effect.flip(save(1.5)));

      assert.strictEqual(invalid.kind, 'invalid_input');
      assert.strictEqual(invalid.message, 'Expected an integer');
      assert.strictEqual(await run(Effect.flip(save(2))), failure);
      assert.deepStrictEqual(
        context.db.orm
          .select()
          .from(preferences)
          .all()
          .map((row) => row.value),
        ['1']
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

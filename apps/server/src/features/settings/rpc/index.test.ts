/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies settings RPC behavior and typed failures against an isolated SQLite-      │
 * │ backed server layer.                                                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises settings RPC exposes typed settings and maps service failures.               │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SettingsRpc } from '@study/contracts/settings/rpc';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Settings } from '#server/features/settings/index';
import { admissionLayer, makeAdmission } from '#server/platform/ai/admission';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { SettingsRpcLive } from './index.ts';

test('settings RPC exposes typed settings and maps service failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = SettingsRpcLive.pipe(
    Layer.provide(Settings.layer),
    Layer.provide(admissionLayer(makeAdmission())),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(SettingsRpc, { flatten: true });

          assert.deepEqual(yield* client('settings.concurrencySettings', {}), {
            maxConcurrentAi: 2,
            maxQueuedAi: 16
          });
          yield* client('settings.saveConcurrencySettings', { maxConcurrentAi: 4, maxQueuedAi: 8 });
          assert.deepEqual(yield* client('settings.concurrencySettings', {}), {
            maxConcurrentAi: 4,
            maxQueuedAi: 8
          });
          assert.equal((yield* client('settings.appSettings', {})).zoomPercent, 100);
          yield* client('settings.saveReviewSettings', { newCardsPerDay: 33 });
          assert.equal((yield* client('settings.reviewSettings', {})).newCardsPerDay, 33);
          context.db.orm.run(
            sql`CREATE TRIGGER reject_review BEFORE INSERT ON preferences WHEN NEW.scope = 'review' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          assert.ok(
            (yield* Effect.flip(client('settings.saveReviewSettings', { newCardsPerDay: 44 }))).kind
          );
          assert.equal((yield* client('settings.reviewSettings', {})).newCardsPerDay, 33);
          assert.deepEqual(
            [...SettingsRpc.requests.keys()].sort(),
            [
              'settings.concurrencySettings',
              'settings.saveConcurrencySettings',
              'settings.appearancePreferences',
              'settings.saveAppearancePreferences',
              'settings.appSettings',
              'settings.llmSettings',
              'settings.materialSettings',
              'settings.reviewSettings',
              'settings.saveAppSettings',
              'settings.saveLlmSettings',
              'settings.saveMaterialSettings',
              'settings.saveReviewSettings',
              'settings.saveSidebarSettings',
              'settings.sidebarSettings'
            ].sort()
          );
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('saving concurrency immediately resizes the shared gate after commit and preserves active work', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const owner = makeAdmission({ concurrency: 2, maxWaiting: 2 });
  const handlers = SettingsRpcLive.pipe(
    Layer.provide(Settings.layer),
    Layer.provide(admissionLayer(owner)),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(SettingsRpc, { flatten: true });
          const releases = yield* Effect.all([
            Deferred.make<void>(),
            Deferred.make<void>(),
            Deferred.make<void>(),
            Deferred.make<void>()
          ]);
          const entered = yield* Effect.all([
            Deferred.make<void>(),
            Deferred.make<void>(),
            Deferred.make<void>(),
            Deferred.make<void>()
          ]);
          let dispatches = 0;
          const work = (index: number) =>
            owner.run(
              Effect.gen(function* () {
                dispatches++;
                yield* Deferred.succeed(entered[index]!, undefined);
                yield* Deferred.await(releases[index]!);
              })
            );
          const first = yield* Effect.forkChild(work(0));
          const second = yield* Effect.forkChild(work(1));

          yield* Deferred.await(entered[0]!);
          yield* Deferred.await(entered[1]!);
          const third = yield* Effect.forkChild(work(2));
          const fourth = yield* Effect.forkChild(work(3));

          yield* Effect.yieldNow;
          yield* client('settings.saveConcurrencySettings', { maxConcurrentAi: 1, maxQueuedAi: 3 });
          assert.deepEqual(yield* client('settings.concurrencySettings', {}), {
            maxConcurrentAi: 1,
            maxQueuedAi: 3
          });
          yield* Deferred.succeed(releases[0]!, undefined);
          yield* Fiber.join(first);
          yield* Effect.yieldNow;
          assert.equal(dispatches, 2);
          yield* Deferred.succeed(releases[1]!, undefined);
          yield* Fiber.join(second);
          yield* Deferred.await(entered[2]!);
          assert.equal(dispatches, 3);

          // Raising the setting dispatches existing queued work without another submission.
          yield* client('settings.saveConcurrencySettings', { maxConcurrentAi: 2, maxQueuedAi: 2 });
          yield* Deferred.await(entered[3]!);
          assert.equal(dispatches, 4);

          context.db.orm.run(
            sql`CREATE TRIGGER reject_concurrency BEFORE INSERT ON preferences WHEN NEW.scope = 'concurrency' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          yield* Effect.flip(
            client('settings.saveConcurrencySettings', { maxConcurrentAi: 1, maxQueuedAi: 0 })
          );
          assert.deepEqual(yield* client('settings.concurrencySettings', {}), {
            maxConcurrentAi: 2,
            maxQueuedAi: 2
          });
          yield* Deferred.succeed(releases[2]!, undefined);
          yield* Fiber.join(third);
          assert.equal(
            yield* owner.run(Effect.succeed('unchanged after failed save')),
            'unchanged after failed save'
          );
          yield* Deferred.succeed(releases[3]!, undefined);
          yield* Fiber.join(fourth);
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

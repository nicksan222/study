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

import { SettingsRpc } from '@study/contracts/settings/rpc';
import {
  defaultAgentRules,
  defaultWorkspacePreferences,
  defaultQuizSettings
} from '@study/contracts/settings/types';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Settings } from '#server/features/settings/index';
import { admissionLayer, makeAdmission } from '#server/platform/ai/admission';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { SettingsRpcLive } from './index.ts';

testStable('settings RPC exposes typed settings and maps service failures', async () => {
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

          expect(yield* client('settings.agentRules', {})).toStrictEqual(defaultAgentRules);
          const rules = {
            ...defaultAgentRules,
            documents: 'Keep worked examples.',
            titles: 'Use descriptive titles.'
          };

          yield* client('settings.saveAgentRules', rules);
          expect(yield* client('settings.agentRules', {})).toStrictEqual(rules);
          expect(
            Exit.isFailure(
              yield* Effect.exit(
                client('settings.saveAgentRules', { ...rules, documents: 'x'.repeat(8001) })
              )
            )
          ).toBe(true);
          expect(yield* client('settings.agentRules', {})).toStrictEqual(rules);
          expect(yield* client('settings.workspacePreferences', {})).toStrictEqual(
            defaultWorkspacePreferences
          );
          yield* client('settings.saveWorkspacePreferences', {
            ...defaultWorkspacePreferences,
            autosaveIntervalSeconds: 7
          });
          assert.strictEqual(
            (yield* client('settings.workspacePreferences', {})).autosaveIntervalSeconds,
            7
          );
          expect(yield* client('settings.concurrencySettings', {})).toStrictEqual({
            maxConcurrentAi: 2,
            maxQueuedAi: 16
          });
          yield* client('settings.saveConcurrencySettings', { maxConcurrentAi: 4, maxQueuedAi: 8 });
          expect(yield* client('settings.concurrencySettings', {})).toStrictEqual({
            maxConcurrentAi: 4,
            maxQueuedAi: 8
          });
          const quiz = {
            ...defaultQuizSettings,
            questionCount: 4,
            questionOrder: 'source' as const,
            shuffleChoices: true,
            questionKind: 'choice' as const
          };

          yield* client('settings.saveQuizSettings', quiz);
          expect(yield* client('settings.quizSettings', {})).toStrictEqual(quiz);
          assert.strictEqual((yield* client('settings.appSettings', {})).zoomPercent, 100);
          yield* client('settings.saveReviewSettings', { newCardsPerDay: 33 });
          assert.strictEqual((yield* client('settings.reviewSettings', {})).newCardsPerDay, 33);
          context.db.orm.run(
            sql`CREATE TRIGGER reject_review BEFORE INSERT ON preferences WHEN NEW.scope = 'review' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
          );
          assert.ok(
            (yield* Effect.flip(client('settings.saveReviewSettings', { newCardsPerDay: 44 }))).kind
          );
          assert.strictEqual((yield* client('settings.reviewSettings', {})).newCardsPerDay, 33);
          expect([...SettingsRpc.requests.keys()].sort()).toStrictEqual(
            [
              'settings.agentRules',
              'settings.saveAgentRules',
              'settings.quizSettings',
              'settings.saveQuizSettings',
              'settings.workspacePreferences',
              'settings.saveWorkspacePreferences',
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

testStable(
  'saving concurrency immediately resizes the shared gate after commit and preserves active work',
  async () => {
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
            yield* client('settings.saveConcurrencySettings', {
              maxConcurrentAi: 1,
              maxQueuedAi: 3
            });
            expect(yield* client('settings.concurrencySettings', {})).toStrictEqual({
              maxConcurrentAi: 1,
              maxQueuedAi: 3
            });
            yield* Deferred.succeed(releases[0]!, undefined);
            yield* Fiber.join(first);
            yield* Effect.yieldNow;
            assert.strictEqual(dispatches, 2);
            yield* Deferred.succeed(releases[1]!, undefined);
            yield* Fiber.join(second);
            yield* Deferred.await(entered[2]!);
            assert.strictEqual(dispatches, 3);

            // Raising the setting dispatches existing queued work without another submission.
            yield* client('settings.saveConcurrencySettings', {
              maxConcurrentAi: 2,
              maxQueuedAi: 2
            });
            yield* Deferred.await(entered[3]!);
            assert.strictEqual(dispatches, 4);

            context.db.orm.run(
              sql`CREATE TRIGGER reject_concurrency BEFORE INSERT ON preferences WHEN NEW.scope = 'concurrency' BEGIN SELECT RAISE(ABORT, 'rejected'); END`
            );
            yield* Effect.flip(
              client('settings.saveConcurrencySettings', { maxConcurrentAi: 1, maxQueuedAi: 0 })
            );
            expect(yield* client('settings.concurrencySettings', {})).toStrictEqual({
              maxConcurrentAi: 2,
              maxQueuedAi: 2
            });
            yield* Deferred.succeed(releases[2]!, undefined);
            yield* Fiber.join(third);
            assert.strictEqual(
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
  }
);

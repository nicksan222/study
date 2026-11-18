import { SettingsRpc } from '@study/contracts';
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
import {
  defaultAgentRules,
  defaultWorkspacePreferences,
  defaultQuizSettings
} from '@study/contracts';
import { sql } from '@study/db';
import {
  admissionLayer,
  AuthManager,
  ChatGptSession,
  makeAdmission,
  ServerContext,
  Database
} from '@study/server';
import { test } from '@study/testing';
import { Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Settings } from '#server/features/settings/index';
import { testLiveQueries } from '#testing/live-queries';

import { SettingsRpcLive } from './index.ts';

const sessionLayer = (request?: ChatGptSession['Service']['request']) =>
  Layer.effect(
    ChatGptSession,
    Effect.acquireRelease(
      Effect.sync(() => ({
        issuer: 'https://login.example.test',
        request,
        manager: new AuthManager({
          issuer: 'https://login.example.test',
          saveRefresh: async () => {}
        })
      })),
      ({ manager }) => Effect.promise(() => manager.dispose())
    )
  );

const testSession = sessionLayer();

test.server.stable(
  'settings RPC exposes typed settings and maps service failures',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    const handlers = SettingsRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
      Layer.provide(Settings.layer),
      Layer.provide(testSession),
      Layer.provide(admissionLayer(makeAdmission())),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(SettingsRpc, { flatten: true });

            expect((yield* client('settings.usage', { days: 30 })).totals.requests).toBe(0);

            expect(yield* client('settings.agentRules', {})).toStrictEqual(defaultAgentRules);
            const rules = {
              ...defaultAgentRules,
              pages: 'Keep worked examples.',
              titles: 'Use descriptive titles.'
            };

            yield* client('settings.saveAgentRules', rules);
            expect(yield* client('settings.agentRules', {})).toStrictEqual(rules);
            expect(
              Exit.isFailure(
                yield* Effect.exit(
                  client('settings.saveAgentRules', { ...rules, pages: 'x'.repeat(8001) })
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
            yield* client('settings.saveConcurrencySettings', {
              maxConcurrentAi: 4,
              maxQueuedAi: 8
            });
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
              (yield* Effect.flip(client('settings.saveReviewSettings', { newCardsPerDay: 44 })))
                .kind
            );
            assert.strictEqual((yield* client('settings.reviewSettings', {})).newCardsPerDay, 33);
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

test.server.stable(
  'saving concurrency immediately resizes the shared gate after commit and preserves active work',
  async ({ databases, expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    const owner = makeAdmission({ concurrency: 2, maxWaiting: 2 });
    const handlers = SettingsRpcLive.pipe(Layer.provide(testLiveQueries)).pipe(
      Layer.provide(Settings.layer),
      Layer.provide(testSession),
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
      await location.cleanup();
    }
  }
);

test.server.stable(
  'model procedures scope catalogs and offers to the current ChatGPT account',
  async ({ databases, expect }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    let current = 'gpt-6.2-sol';
    let denied = false;
    const session = sessionLayer(async (input) =>
      String(input) === 'https://models.dev/api.json'
        ? Response.json({})
        : denied
          ? new Response(null, { status: 403 })
          : Response.json({ models: [{ slug: current, visibility: 'list' }] })
    );
    const handlers = SettingsRpcLive.pipe(
      Layer.provide(testLiveQueries),
      Layer.provide(Settings.layer),
      Layer.provide(admissionLayer(makeAdmission())),
      Layer.provideMerge(session),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(SettingsRpc, { flatten: true });
            const { manager } = yield* ChatGptSession;
            const signIn = (subject: string) =>
              Effect.promise(() =>
                manager.replace(
                  { subject, clientId: 'test', refreshToken: null, sharing: true },
                  { accessToken: subject, expiresIn: 3600 }
                )
              );

            yield* signIn('account-a');
            expect(yield* client('settings.refreshModelCatalog', {})).toEqual({
              apiAvailable: true,
              chatAvailable: true
            });
            expect((yield* client('settings.modelCatalog', {})).models['1']).toEqual([current]);
            const invalid = { tier: 'medium', setup: { provider: 1, model: 1 } } as const;

            expect((yield* Effect.flip(client('settings.saveModelTier', invalid))).kind).toBe(
              'invalid_input'
            );
            expect(
              (yield* Effect.flip(
                client('settings.saveModelTier', {
                  ...invalid,
                  setup: { provider: 1, model: 'gpt-6-luna' }
                })
              )).kind
            ).toBe('invalid_input');
            const [initial] = (yield* client('settings.modelUpdates', {})).filter(
              ({ tier }) => tier === 'medium'
            );

            yield* client('settings.dismissModelUpdate', initial!);
            current = 'gpt-6.3-sol';
            yield* client('settings.refreshModelCatalog', {});
            const [offer] = (yield* client('settings.modelUpdates', {})).filter(
              ({ tier }) => tier === 'medium'
            );

            expect((yield* Effect.flip(client('settings.applyModelUpdate', initial!))).kind).toBe(
              'invalid_input'
            );
            denied = true;
            expect((yield* client('settings.refreshModelCatalog', {})).chatAvailable).toBe(false);
            expect((yield* client('settings.modelCatalog', {})).models['1']).toEqual([current]);
            yield* signIn('account-b');
            expect((yield* client('settings.modelCatalog', {})).models['1']).toBeUndefined();
            expect((yield* Effect.flip(client('settings.applyModelUpdate', offer!))).kind).toBe(
              'invalid_input'
            );
            yield* client('settings.refreshModelCatalog', {});
            expect((yield* client('settings.modelCatalog', {})).models['1']).toBeUndefined();
            denied = false;
            yield* client('settings.refreshModelCatalog', {});
            const [newOffer] = (yield* client('settings.modelUpdates', {})).filter(
              ({ tier }) => tier === 'medium'
            );

            yield* client('settings.applyModelUpdate', newOffer!);
            yield* client('settings.saveModelTier', {
              tier: 'smart',
              setup: { provider: 1, model: current }
            });
            expect((yield* client('settings.llmSettings', {})).medium.model).toBe(current);
          })
        ).pipe(Effect.provide(handlers))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

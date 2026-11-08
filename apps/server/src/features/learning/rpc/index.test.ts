/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises typed missing-attempt failures and the practice RPC lifecycle for        │
 * │ starting, reading, and stopping project practice.                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Runs RPC requests with real learning services and controlled database fixtures.        │
 * │ - Checks the contract through typed RPC calls and controlled feature layers.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses the typed RPC test client and controlled feature layers; production       │
 * │ handlers retain ownership of request behavior.                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { QuizAttemptId } from '@study/contracts/ids';
import { LearningRpc } from '@study/contracts/learning/rpc';
import { plainBlock } from '@study/contracts/sources/document';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';
import { assert } from 'vite-plus/test';

import { Learning } from '#server/features/learning/service/index';
import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { LearningRpcLive } from './index.ts';

testStable('native learning RPC maps missing attempts to typed failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = LearningRpcLive.pipe(
    Layer.provide(
      Learning.layer.pipe(
        Layer.provideMerge(Settings.layer),
        Layer.provideMerge(Materials.layer),
        Layer.provideMerge(Pages.layer)
      )
    ),
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(LearningRpc, { flatten: true });
          const attemptId = 999n as QuizAttemptId;

          assert.ok(
            (yield* Effect.flip(client('learning.attempt', { attemptId }))).kind === 'not_found'
          );
          assert.ok(Option.isNone(yield* client('learning.findAttempt', { attemptId })));
        }).pipe(Effect.provide(handlers))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable('native practice RPC starts, reads, and stops project practice', async () => {
  const s = await import('@study/db/schema');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const db = Layer.succeed(Database, { store: context });
  const services = Learning.layer.pipe(
    Layer.provideMerge(Settings.layer),
    Layer.provideMerge(Materials.layer),
    Layer.provideMerge(Pages.layer),
    Layer.provideMerge(db)
  );
  const handlers = LearningRpcLive.pipe(Layer.provide(services));

  try {
    const project = context.db.orm
      .insert(s.projects)
      .values({ name: 'Practice RPC', created_at: 1n, updated_at: 1n })
      .returning()
      .get();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Materials;
          const doc = yield* (yield* Pages).create({
            createKey: randomUUID(),
            inputs: [],
            citations: [],
            projectId: project.id,
            title: 'Document',
            document: {
              blocks: [plainBlock('paragraph', 'Source', { type: 'authored' })],
              meta: {
                extractor: null,
                extractorVersion: 1,
                provider: null,
                durationMs: null,
                pageCount: null,
                refiners: [],
                waitingFor: [],
                corrected: false,
                omissions: []
              }
            }
          });
          const client = yield* RpcTest.makeClient(LearningRpc, { flatten: true });
          const started = yield* client('learning.startPractice', {
            projectId: project.id,
            inputs: [{ kind: 'page', versionId: doc.version!.id }]
          });

          assert.strictEqual(started.slots.length, 2);
          assert.strictEqual(
            (yield* client('learning.practice', { projectId: project.id })).epoch,
            started.epoch
          );
          assert.ok(
            (yield* client('learning.stopPractice', { projectId: project.id })).enabled === false
          );
        }).pipe(Effect.provide(handlers), Effect.provide(services))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

testStable(
  'native ordering RPC keeps answers private and restores the committed sequence',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const services = Learning.layer.pipe(
      Layer.provideMerge(Settings.layer),
      Layer.provideMerge(Materials.layer),
      Layer.provideMerge(Pages.layer),
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    const handlers = LearningRpcLive.pipe(Layer.provideMerge(services));

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const material = yield* (yield* Materials).create({
              title: 'RPC sequence',
              publish: true,
              content: {
                kind: 'quiz',
                questions: [
                  {
                    kind: 'ordering',
                    prompt: 'Order',
                    explanation: 'First A, then B.',
                    items: [{ text: 'A' }, { text: 'B' }]
                  }
                ]
              }
            });
            const client = yield* RpcTest.makeClient(LearningRpc, { flatten: true });
            const attempt = yield* client('learning.startQuiz', { versionId: material.version.id });
            const question = attempt.questions[0]!;

            assert.ok(question.kind === 'ordering');
            assert.ok(!('correctItemIds' in question));
            const itemIds = question.items.map((item) => item.id).reverse();

            yield* client('learning.answerQuestion', {
              attemptId: attempt.id,
              questionId: question.id,
              answer: { type: 'ordering', itemIds }
            });
            const saved = yield* client('learning.attempt', { attemptId: attempt.id });

            assert.deepEqual(saved.questions[0]!.answer, { type: 'ordering', itemIds });
            const completed = yield* client('learning.finishQuiz', { attemptId: attempt.id });

            assert.ok(completed.questions[0]!.kind === 'ordering');
            assert.equal(completed.questions[0]!.correctItemIds.length, 2);
          }).pipe(Effect.provide(handlers))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

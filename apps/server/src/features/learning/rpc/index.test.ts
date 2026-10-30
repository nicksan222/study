import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { QuizAttemptId } from '@study/contracts/ids';
import { LearningRpc } from '@study/contracts/learning/rpc';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Option } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Learning } from '#server/features/learning/service/index';
import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { LearningRpcLive } from './index.ts';

test('native learning RPC maps missing attempts to typed failures', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const handlers = LearningRpcLive.pipe(
    Layer.provide(
      Learning.layer.pipe(Layer.provideMerge(Settings.layer), Layer.provideMerge(Materials.layer))
    ),
    Layer.provide(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(LearningRpc, { flatten: true });
          const attemptId = 999n as QuizAttemptId;

          assert.equal(
            (yield* Effect.flip(client('learning.attempt', { attemptId }))).kind,
            'not_found'
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

test('native practice RPC starts, reads, and stops project practice', async () => {
  const s = await import('@study/db/schema');
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const db = Layer.succeed(Database, { store: context });
  const services = Learning.layer.pipe(
    Layer.provideMerge(Settings.layer),
    Layer.provideMerge(Materials.layer),
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
          const materials = yield* Materials;
          const doc = yield* materials.create({
            projectId: project.id,
            title: 'Document',
            content: {
              kind: 'document',
              blocks: [{ kind: 'paragraph', text: 'Source', anchor: { type: 'page', page: 1 } }],
              meta: {
                extractor: null,
                extractorVersion: 1,
                provider: null,
                durationMs: null,
                pageCount: null,
                refiners: [],
                waitingFor: [],
                corrected: false
              }
            }
          });
          const client = yield* RpcTest.makeClient(LearningRpc, { flatten: true });
          const started = yield* client('learning.startPractice', {
            projectId: project.id,
            inputVersionIds: [doc.version.id]
          });

          assert.equal(started.slots.length, 2);
          assert.equal(
            (yield* client('learning.practice', { projectId: project.id })).epoch,
            started.epoch
          );
          assert.equal(
            (yield* client('learning.stopPractice', { projectId: project.id })).enabled,
            false
          );
        }).pipe(Effect.provide(handlers), Effect.provide(services))
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

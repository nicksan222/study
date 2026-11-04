import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
/** Genuine learning deletion uses exact output ownership; Documents and Sources retain their independent lifetimes. */
import { testStable } from '@study/testing/node';
import { Effect, Layer, Schema, Exit } from 'effect';
import { RpcTest } from 'effect/rpc';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import {
  materialDeletionWorkflow,
  materialDeletionHandler
} from '#server/features/materials/workflows/deletion';
import { materialGenerationWorkflow } from '#server/features/materials/workflows/generation';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import { learningGeneration, queueLearningGeneration } from '#testing/learning-generation';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  materialDeletionEvent,
  deletionDocument
} from '#testing/material-deletion';
import { assertScrubbed, awaitNativeStatus } from '#testing/session-deletion';
const content = (text: string) => ({
  kind: 'diagram' as const,
  format: 'mermaid' as const,
  payload: `flowchart TD\nA[${text}]`
});

testStable(
  'native RPC deletes only its exact learning output, preserving shared authored evidence, raw captures and independent outputs',
  async () => {
    const f = await documentTransformFixture();
    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Documents;
          const chats = yield* Conversations;
          const evidence = yield* docs.create({
            createKey: randomUUID(),
            title: 'Shared evidence',
            document: deletionDocument('Independent exact evidence'),
            inputs: [],
            citations: []
          });
          assert.ok(evidence.version);
          const input = { kind: 'document' as const, versionId: evidence.version.id };
          const root = yield* m.create({
            title: 'Root',
            content: content('ORIGINAL_DELETE_ONLY'),
            inputs: [input],
            publish: true
          });
          yield* m.updateDescription({
            id: root.id,
            description: 'PRIVATE_DESCRIPTION_DELETE_ONLY',
            expectedDescription: null
          });
          const kept = yield* m.create({
            title: 'Kept',
            content: content('Intentional independent output'),
            inputs: [input],
            publish: true
          });
          const session = yield* chats.createUntitledSession({});
          yield* chats.postMessage({
            sessionId: session.id,
            text: 'Retained raw note',
            requestReply: false
          });
          yield* chats.updateSessionSelection({
            sessionId: session.id,
            expectedRevision: 0n,
            targets: [{ input, scope: { kind: 'document' } }]
          });
          const capture = yield* chats.captureSessionContext({
            sessionId: session.id,
            intentKey: 'independent-capture',
            instruction: 'Independent raw instruction',
            preferences: {}
          });
          yield* m.attach({ materialId: root.id, sessionId: session.id });
          return { root, kept, evidence: evidence.version, session, capture };
        }).pipe(Effect.provide(f.domain()))
      );
      const input = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc);
            const preview = yield* rpc['materials.previewDeletion']({ materialId: saved.root.id });
            assert.deepEqual(preview.versionIds, [saved.root.version.id]);
            assert.deepEqual(preview.sessionIds, [saved.session.id]);
            const input = { materialId: saved.root.id, token: preview.token };
            const accepted = yield* rpc['materials.requestDeletion'](input);
            assert.equal(accepted.status, 'pending');
            assert.deepEqual(accepted.materialIds, [saved.root.id]);
            assert.deepEqual(yield* rpc['materials.requestDeletion'](input), accepted);
            assert.equal(
              (yield* Effect.flip(rpc['materials.materialVersion']({ id: saved.root.version.id })))
                .kind,
              'not_found'
            );
            return input;
          })
        ).pipe(Effect.provide(MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()))))
      );
      f.reopen();
      await cleanupMaterial(f, saved.root.id);
      f.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Documents;
          const chats = yield* Conversations;
          assert.deepEqual((yield* m.material({ id: saved.kept.id })).version, saved.kept.version);
          assert.deepEqual(yield* docs.version({ id: saved.evidence.id }), saved.evidence);
          assert.deepEqual(
            yield* chats.sessionContext({ requestId: saved.capture.requestId }),
            saved.capture
          );
          assert.equal(
            (yield* chats.thread({ sessionId: saved.session.id, limit: 10 })).items[0]?.versions[0]
              ?.text,
            'Retained raw note'
          );
          const completed = yield* m.deletion({ materialId: saved.root.id });
          assert.equal(completed.status, 'completed');
          assert.deepEqual(yield* m.requestDeletion(input), completed);
          assert.deepEqual(
            (yield* m.materials({ limit: 10, archived: false })).items.map((item) => item.id),
            [saved.kept.id]
          );
        }).pipe(Effect.provide(f.domain()))
      );
      assertScrubbed(f, 'ORIGINAL_DELETE_ONLY');
      assertScrubbed(f, 'PRIVATE_DESCRIPTION_DELETE_ONLY');
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'learning deletion preview rejects substituted identity, new versions and newly attached sessions without persisting a barrier',
  async () => {
    const f = await documentTransformFixture();
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const chats = yield* Conversations;
          const root = yield* m.create({ title: 'Root', content: content('Old'), publish: true });
          const other = yield* m.create({
            title: 'Other',
            content: content('Other'),
            publish: true
          });
          const first = yield* m.previewDeletion({ materialId: root.id });
          assert.equal(
            (yield* Effect.flip(m.requestDeletion({ materialId: other.id, token: first.token })))
              .kind,
            'invalid_input'
          );
          yield* m.createVersion({ materialId: root.id, content: content('New'), publish: true });
          assert.equal(
            (yield* Effect.flip(m.requestDeletion({ materialId: root.id, token: first.token })))
              .kind,
            'invalid_input'
          );
          const second = yield* m.previewDeletion({ materialId: root.id });
          const session = yield* chats.createUntitledSession({});
          yield* m.attach({ materialId: root.id, sessionId: session.id });
          assert.equal(
            (yield* Effect.flip(m.requestDeletion({ materialId: root.id, token: second.token })))
              .kind,
            'invalid_input'
          );
          assert.equal(f.context.db.orm.select().from(s.material_deletions).all().length, 0);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

testStable(
  'learning deletion barrier and outbox roll back together on event persistence failure',
  async () => {
    const f = await documentTransformFixture();
    try {
      const root = await Effect.runPromise(
        Effect.flatMap(Materials, (m) =>
          m.create({ title: 'Rollback', content: content('ROLLBACK_PRIVATE'), publish: true })
        ).pipe(Effect.provide(f.domain()))
      );
      f.context.db.exec(
        "CREATE TRIGGER reject_material_intent BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialDeletionRequested' BEGIN SELECT RAISE(ABORT,'injected'); END"
      );
      await assert.rejects(acceptMaterialDeletion(f, root.id));
      assert.equal(f.context.db.orm.select().from(s.material_deletions).all().length, 0);
      assert.equal(f.context.db.orm.select().from(s.material_deletion_members).all().length, 0);
      assert.equal(f.context.db.orm.select().from(s.material_deletion_requests).all().length, 0);
      await Effect.runPromise(
        Effect.gen(function* () {
          assert.deepEqual(
            (yield* (yield* Materials).material({ id: root.id })).version,
            root.version
          );
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

for (const doubleFailure of [false, true])
  testStable(
    `failed cleanup retries after restart and fences stale completion (failure settlement blocked=${doubleFailure})`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const root = await Effect.runPromise(
          Effect.flatMap(Materials, (m) =>
            m.create({ title: 'Root', content: content('RETRY_CLEANUP_MARKER'), publish: true })
          ).pipe(Effect.provide(f.domain()))
        );

        const accepted = await acceptMaterialDeletion(f, root.id);

        f.context.db.orm.run(
          sql.raw(
            `CREATE TRIGGER reject_material_scrub BEFORE DELETE ON material_diagram_versions BEGIN SELECT RAISE(ABORT,'injected'); END`
          )
        );

        if (doubleFailure)
          f.context.db.orm.run(
            sql.raw(
              `CREATE TRIGGER reject_material_failure BEFORE UPDATE ON material_deletions WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'injected'); END`
            )
          );

        await cleanupMaterial(f, root.id).catch(() => undefined);

        const failed = await Effect.runPromise(
          Effect.flatMap(Materials, (m) => m.deletion({ materialId: root.id })).pipe(
            Effect.provide(f.domain())
          )
        );

        assert.equal(failed.status, doubleFailure ? 'pending' : 'failed');

        await Effect.runPromise(
          awaitNativeStatus(f, `material-cleanup/${accepted.operationId}/1`, 'completed')
        );

        assert.equal(
          workflowStore(f.context).execution(`material-cleanup/${accepted.operationId}/1`)!.status,
          'completed'
        );

        f.context.db.orm.run(sql.raw('DROP TRIGGER reject_material_scrub'));

        if (doubleFailure) f.context.db.orm.run(sql.raw('DROP TRIGGER reject_material_failure'));

        f.reopen();

        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const retry = yield* m.retryDeletion({ materialId: root.id });

            assert.equal(retry.attempt, 2);

            const stale = yield* m.failMaterialDeletion({
              materialId: root.id,
              attempt: 1,
              errorKind: 'internal'
            });

            assert.equal(stale.status, 'pending');

            assert.equal(stale.attempt, 2);
          }).pipe(Effect.provide(f.domain()))
        );

        assert.equal(materialDeletionEvent(f, root.id).attempt, 2);

        await cleanupMaterial(f, root.id);

        assertScrubbed(f, 'RETRY_CLEANUP_MARKER');

        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const completed = yield* m.deletion({ materialId: root.id });

            assert.equal(completed.status, 'completed');

            assert.deepEqual(yield* m.retryDeletion({ materialId: root.id }), completed);
          }).pipe(Effect.provide(f.domain()))
        );
      } finally {
        await f.close();
      }
    }
  );

testStable(
  'native retirement rejects late checkpoints and deferred delivery while unrelated execution survives',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await learningGeneration(f);
      queueLearningGeneration(f);
      const versionId = await f.execute(f.event(saved.request.id), 'original-generation');
      const output = await Effect.runPromise(
        Effect.flatMap(Materials, (m) => m.materialVersion({ id: versionId })).pipe(
          Effect.provide(f.domain())
        )
      );

      const event = f.event(saved.request.id);

      const gate = DurableDeferred.make('private-material-gate');

      const independentGate = DurableDeferred.make('independent-material-gate');

      const independent = Workflow.make('independent-material-deletion-test', {
        payload: { id: Schema.String },
        idempotencyKey: ({ id }) => id,
        success: Schema.String
      });

      const pausedGeneration = Effect.gen(function* () {
        yield* Activity.make({
          name: 'private-material-partial',
          success: Schema.String,
          execute: Effect.succeed('PRIVATE_NATIVE_CHECKPOINT_DELETE')
        });

        yield* DurableDeferred.await(gate);

        return output.id;
      });

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            const m = yield* Materials;

            yield* engine.register(materialGenerationWorkflow, () => pausedGeneration);

            yield* engine.register(independent, () =>
              DurableDeferred.await(independentGate).pipe(Effect.as('kept'))
            );

            yield* engine.register(materialDeletionWorkflow, materialDeletionHandler);

            yield* engine.execute(materialGenerationWorkflow, {
              executionId: 'retire-material-run',
              payload: { event },
              discard: true
            });

            yield* engine.execute(independent, {
              executionId: 'keep-material-run',
              payload: { id: 'keep' },
              discard: true
            });

            yield* awaitNativeStatus(f, 'retire-material-run', 'suspended');

            yield* awaitNativeStatus(f, 'keep-material-run', 'suspended');

            const p = yield* m.previewDeletion({ materialId: output.material_id });

            yield* m.requestDeletion({
              materialId: output.material_id,
              token: p.token
            });

            const deletion = materialDeletionEvent(f, output.material_id);

            yield* engine.execute(materialDeletionWorkflow, {
              executionId: 'material-native-cleanup',
              payload: { event: deletion }
            });

            assert.equal(
              (yield* m.deletion({ materialId: output.material_id })).status,
              'completed'
            );

            assert.equal(
              workflowStore(f.context).execution('retire-material-run')?.status,
              'cancelled'
            );

            assert.equal(
              workflowStore(f.context).execution('keep-material-run')?.status,
              'suspended'
            );

            yield* engine.deferredDone(gate, {
              workflowName: materialGenerationWorkflow._tag,
              executionId: 'retire-material-run',
              deferredName: gate.name,
              exit: Exit.void
            });

            assert.equal(
              workflowStore(f.context).deferred('retire-material-run', gate.name),
              undefined
            );

            yield* engine.deferredDone(independentGate, {
              workflowName: independent._tag,
              executionId: 'keep-material-run',
              deferredName: independentGate.name,
              exit: Exit.void
            });

            yield* awaitNativeStatus(f, 'keep-material-run', 'completed');

            assertScrubbed(f, 'PRIVATE_NATIVE_CHECKPOINT_DELETE');
          }).pipe(Effect.provide(f.services()))
        )
      );
    } finally {
      await f.close();
    }
  }
);

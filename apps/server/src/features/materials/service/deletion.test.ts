/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises learning deletion behavior through real persistence boundaries.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies native RPC deletes only its exact learning output, preserving shared authored │
 * │   evidence, raw captures and independent outputs.                                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
/** Genuine learning deletion uses exact output ownership; Pages and Sources retain their independent lifetimes. */
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, Schema, Exit } from 'effect';
import { RpcTest } from 'effect/rpc';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import {
  materialDeletionWorkflow,
  materialDeletionHandler
} from '#server/features/materials/workflows/deletion';
import { materialGenerationWorkflow } from '#server/features/materials/workflows/generation';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { workflowStore } from '#server/platform/workflows/store';
import { learningGeneration, queueLearningGeneration } from '#testing/learning-generation';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  materialDeletionEvent,
  deletionDocument
} from '#testing/material-deletion';
import { assertScrubbed, awaitNativeStatus } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

const content = (text: string) => ({
  kind: 'diagram' as const,
  format: 'mermaid' as const,
  payload: `flowchart TD\nA[${text}]`
});

testStable(
  'native RPC deletes only its exact learning output, preserving shared authored evidence, raw captures and independent outputs',
  async () => {
    const f = await pageTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Pages;
          const chats = yield* Notes;
          const evidence = yield* docs.create({
            createKey: crypto.randomUUID(),
            title: 'Shared evidence',
            document: deletionDocument('Independent exact evidence'),
            inputs: [],
            citations: []
          });

          assert.ok(evidence.version);
          const input = { kind: 'page' as const, versionId: evidence.version.id };
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
          const note = yield* chats.createUntitledNote({});

          yield* chats.postMessage({
            noteId: note.id,
            text: 'Retained raw note',
            requestReply: false
          });
          yield* chats.updateNoteSelection({
            noteId: note.id,
            expectedRevision: 0n,
            targets: [{ input, scope: { kind: 'document' } }]
          });
          const capture = yield* chats.captureNoteContext({
            noteId: note.id,
            intentKey: 'independent-capture',
            instruction: 'Independent raw instruction',
            preferences: {}
          });

          yield* m.attach({ materialId: root.id, noteId: note.id });

          return { root, kept, evidence: evidence.version, note, capture };
        }).pipe(Effect.provide(f.domain()))
      );
      const input = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc);
            const preview = yield* rpc['materials.previewDeletion']({ materialId: saved.root.id });

            expect(preview.versionIds).toStrictEqual([saved.root.version.id]);
            expect(preview.noteIds).toStrictEqual([saved.note.id]);
            const input = { materialId: saved.root.id, token: preview.token };
            const accepted = yield* rpc['materials.requestDeletion'](input);

            assert.ok(accepted.status === 'pending');
            expect(accepted.materialIds).toStrictEqual([saved.root.id]);
            expect(yield* rpc['materials.requestDeletion'](input)).toStrictEqual(accepted);
            assert.ok(
              (yield* Effect.flip(rpc['materials.materialVersion']({ id: saved.root.version.id })))
                .kind === 'not_found'
            );

            return input;
          })
        ).pipe(Effect.provide(MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()))))
      );

      await f.reopen();
      await cleanupMaterial(f, saved.root.id);
      await f.reopen();
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Pages;
          const chats = yield* Notes;

          expect((yield* m.material({ id: saved.kept.id })).version).toStrictEqual(
            saved.kept.version
          );
          expect(yield* docs.version({ id: saved.evidence.id })).toStrictEqual(saved.evidence);
          expect(yield* chats.noteContext({ requestId: saved.capture.requestId })).toStrictEqual(
            saved.capture
          );
          assert.ok(
            (yield* chats.thread({ noteId: saved.note.id, limit: 10 })).items[0]?.versions[0]
              ?.text === 'Retained raw note'
          );
          const completed = yield* m.deletion({ materialId: saved.root.id });

          assert.ok(completed.status === 'completed');
          expect(yield* m.requestDeletion(input)).toStrictEqual(completed);
          expect(
            (yield* m.materials({ limit: 10, archived: false })).items.map((item) => item.id)
          ).toStrictEqual([saved.kept.id]);
        }).pipe(Effect.provide(f.domain()))
      );
      assertScrubbed(f, 'ORIGINAL_DELETE_ONLY');
      assertScrubbed(f, 'PRIVATE_DESCRIPTION_DELETE_ONLY');
      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

testStable(
  'learning deletion preview rejects substituted identity, new versions and newly attached notes without persisting a barrier',
  async () => {
    const f = await pageTransformFixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const chats = yield* Notes;
          const root = yield* m.create({ title: 'Root', content: content('Old'), publish: true });
          const other = yield* m.create({
            title: 'Other',
            content: content('Other'),
            publish: true
          });
          const first = yield* m.previewDeletion({ materialId: root.id });

          assert.ok(
            (yield* Effect.flip(m.requestDeletion({ materialId: other.id, token: first.token })))
              .kind === 'invalid_input'
          );
          yield* m.createVersion({ materialId: root.id, content: content('New'), publish: true });
          assert.ok(
            (yield* Effect.flip(m.requestDeletion({ materialId: root.id, token: first.token })))
              .kind === 'invalid_input'
          );
          const second = yield* m.previewDeletion({ materialId: root.id });
          const note = yield* chats.createUntitledNote({});

          yield* m.attach({ materialId: root.id, noteId: note.id });
          assert.ok(
            (yield* Effect.flip(m.requestDeletion({ materialId: root.id, token: second.token })))
              .kind === 'invalid_input'
          );
          assert.strictEqual(f.context.db.orm.select().from(s.material_deletions).all().length, 0);
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
    const f = await pageTransformFixture();

    try {
      const root = await Effect.runPromise(
        Effect.flatMap(Materials, (m) =>
          m.create({ title: 'Rollback', content: content('ROLLBACK_PRIVATE'), publish: true })
        ).pipe(Effect.provide(f.domain()))
      );

      f.context.db.exec(
        "CREATE TRIGGER reject_material_intent BEFORE INSERT ON workflow_events WHEN NEW.type='MaterialDeletionRequested' BEGIN SELECT RAISE(ABORT,'injected'); END"
      );
      await expect(acceptMaterialDeletion(f, root.id)).rejects.toSatisfy(() => true);
      assert.strictEqual(f.context.db.orm.select().from(s.material_deletions).all().length, 0);
      assert.strictEqual(
        f.context.db.orm.select().from(s.material_deletion_members).all().length,
        0
      );
      assert.strictEqual(
        f.context.db.orm.select().from(s.material_deletion_requests).all().length,
        0
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          expect((yield* (yield* Materials).material({ id: root.id })).version).toStrictEqual(
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
      const f = await pageTransformFixture();

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

        assert.strictEqual(failed.status, doubleFailure ? 'pending' : 'failed');

        await Effect.runPromise(
          awaitNativeStatus(f, `material-cleanup/${accepted.operationId}/1`, 'completed')
        );

        assert.ok(
          workflowStore(f.context).execution(`material-cleanup/${accepted.operationId}/1`)!
            .status === 'completed'
        );

        f.context.db.orm.run(sql.raw('DROP TRIGGER reject_material_scrub'));

        if (doubleFailure) f.context.db.orm.run(sql.raw('DROP TRIGGER reject_material_failure'));

        await f.reopen();

        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const retry = yield* m.retryDeletion({ materialId: root.id });

            assert.strictEqual(retry.attempt, 2);

            const stale = yield* m.failMaterialDeletion({
              materialId: root.id,
              attempt: 1,
              errorKind: 'internal'
            });

            assert.ok(stale.status === 'pending');

            assert.strictEqual(stale.attempt, 2);
          }).pipe(Effect.provide(f.domain()))
        );

        assert.strictEqual(materialDeletionEvent(f, root.id).attempt, 2);

        await cleanupMaterial(f, root.id);

        assertScrubbed(f, 'RETRY_CLEANUP_MARKER');

        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;

            const completed = yield* m.deletion({ materialId: root.id });

            assert.ok(completed.status === 'completed');

            expect(yield* m.retryDeletion({ materialId: root.id })).toStrictEqual(completed);
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
    const f = await pageTransformFixture();

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

            assert.ok(
              (yield* m.deletion({ materialId: output.material_id })).status === 'completed'
            );

            assert.ok(
              workflowStore(f.context).execution('retire-material-run')?.status === 'cancelled'
            );

            assert.ok(
              workflowStore(f.context).execution('keep-material-run')?.status === 'suspended'
            );

            yield* engine.deferredDone(gate, {
              workflowName: materialGenerationWorkflow._tag,
              executionId: 'retire-material-run',
              deferredName: gate.name,
              exit: Exit.void
            });

            assert.strictEqual(
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

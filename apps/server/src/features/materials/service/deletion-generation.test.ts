/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises learning deletion generation behavior through real persistence           │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies generated learning deletion fences replay, releases exact authored evidence   │
 * │   and never reassigns cleanup ownership.                                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
/** Generated learning output deletion releases evidence pins and retires only its original native ownership. */
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import { learningGeneration, queueLearningGeneration } from '#testing/learning-generation';
import { acceptMaterialDeletion, cleanupMaterial } from '#testing/material-deletion';
import { assertScrubbed } from '#testing/session-deletion';

testStable(
  'generated learning deletion fences replay, releases exact authored evidence and never reassigns cleanup ownership',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await learningGeneration(f);
      const event = f.event(saved.request.id);

      queueLearningGeneration(f);
      const versionId = await f.execute(event, 'completed-generation');
      const output = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Documents;
          const output = yield* m.materialVersion({ id: versionId });

          assert.deepEqual(output.inputs, [
            { kind: 'document', versionId: saved.input.version.id }
          ]);
          const preview = yield* docs.previewDeletion({ id: saved.input.id });

          assert.deepEqual(preview.blockedVersionIds, [saved.input.version.id]);
          assert.equal(
            (yield* Effect.flip(docs.delete({ documentId: saved.input.id, token: preview.token })))
              .kind,
            'invalid_input'
          );

          return output;
        }).pipe(Effect.provide(f.domain()))
      );
      const accepted = await acceptMaterialDeletion(f, output.material_id);
      const owner = f.context.db.orm
        .select()
        .from(s.material_deletion_requests)
        .where(eq(s.material_deletion_requests.request_id, saved.request.id))
        .get();

      assert.equal(owner?.deletion_id, output.material_id);
      assert.equal(owner.kind, 'generation');
      f.context.db.exec(
        "CREATE TRIGGER reject_generation_cleanup BEFORE DELETE ON material_flashcard_versions BEGIN SELECT RAISE(ABORT,'injected'); END"
      );
      await assert.rejects(cleanupMaterial(f, output.material_id));
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          assert.equal((yield* m.deletion({ materialId: output.material_id })).status, 'failed');
          assert.equal(
            (yield* Effect.flip(m.materialVersion({ id: versionId }))).kind,
            'not_found'
          );
        }).pipe(Effect.provide(f.domain()))
      );
      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.material_deletion_requests)
          .where(eq(s.material_deletion_requests.request_id, saved.request.id))
          .get(),
        owner
      );
      f.context.db.exec('DROP TRIGGER reject_generation_cleanup');
      f.reopen();
      await Effect.runPromise(
        Effect.flatMap(Materials, (m) => m.retryDeletion({ materialId: output.material_id })).pipe(
          Effect.provide(f.domain())
        )
      );
      await cleanupMaterial(f, output.material_id);
      f.reopen();
      const retired = f.context.db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, saved.request.id))
        .get();

      assert.ok(retired);
      assert.equal(retired.payload, '{}');
      assert.equal(retired.cancelled, true);
      assert.equal(retired.result_version_id, null);
      assert.equal(retired.result_hash, null);
      assertScrubbed(f, 'HISTORY_PRIVATE_GENERATION');
      assertScrubbed(f, 'GENERATED_HISTORICAL_BODY');
      const native = workflowStore(f.context).execution('completed-generation');

      assert.equal(native?.status, 'completed');
      assert.equal(native.payload, '{}');
      assert.equal(native.result, null);
      assert.equal(native.owner_token, null);
      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.workflow_activities)
          .where(eq(s.workflow_activities.execution_id, 'completed-generation'))
          .all(),
        []
      );
      assert.ok(
        f.context.db.orm
          .select()
          .from(s.workflow_retired_correlations)
          .all()
          .some(
            (row) =>
              row.correlation_id === saved.request.id &&
              row.event_type === 'MaterialGenerationRequested'
          )
      );
      const calls = f.bodies.length;

      await assert.rejects(f.execute(event, 'replay-retired-generation'));
      assert.equal(f.bodies.length, calls);
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Documents;

          assert.equal(
            (yield* m.deletion({ materialId: output.material_id })).operationId,
            accepted.operationId
          );
          assert.equal(
            (yield* Effect.flip(
              m.materialGeneration({ requestId: saved.request.id, verifyOnly: true })
            )).kind,
            'not_found'
          );
          const preview = yield* docs.previewDeletion({ id: saved.input.id });

          assert.deepEqual(preview.blockedVersionIds, []);
          yield* docs.delete({ documentId: saved.input.id, token: preview.token });
        }).pipe(Effect.provide(f.domain()))
      );
      f.reopen();
      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.material_generation_requests)
          .where(eq(s.material_generation_requests.id, saved.request.id))
          .get(),
        retired
      );
      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.material_deletion_requests)
          .where(eq(s.material_deletion_requests.request_id, saved.request.id))
          .get(),
        owner
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      await f.close();
    }
  }
);

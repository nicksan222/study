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

import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
/** Generated learning output deletion releases evidence pins and retires only its original native ownership. */
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { workflowStore } from '#server/platform/workflows/store';
import { learningGeneration, queueLearningGeneration } from '#testing/learning-generation';
import { acceptMaterialDeletion, cleanupMaterial } from '#testing/material-deletion';
import { assertScrubbed } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

testStable(
  'generated learning deletion fences replay, releases exact authored evidence and never reassigns cleanup ownership',
  async () => {
    const f = await pageTransformFixture();

    try {
      const saved = await learningGeneration(f);
      const event = f.event(saved.request.id);

      queueLearningGeneration(f);
      const versionId = await f.execute(event, 'completed-generation');
      const output = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Pages;
          const output = yield* m.materialVersion({ id: versionId });

          expect(output.inputs).toStrictEqual([
            { kind: 'page', versionId: saved.input.version.id }
          ]);
          const preview = yield* docs.previewDeletion({ id: saved.input.id });

          expect(preview.blockedVersionIds).toStrictEqual([saved.input.version.id]);
          assert.ok(
            (yield* Effect.flip(docs.delete({ pageId: saved.input.id, token: preview.token })))
              .kind === 'invalid_input'
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

      assert.ok(owner);
      assert.strictEqual(owner.deletion_id, output.material_id);
      assert.ok(owner.kind === 'generation');
      f.context.db.exec(
        "CREATE TRIGGER reject_generation_cleanup BEFORE DELETE ON material_flashcard_versions BEGIN SELECT RAISE(ABORT,'injected'); END"
      );
      await expect(cleanupMaterial(f, output.material_id)).rejects.toSatisfy(() => true);
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          assert.ok((yield* m.deletion({ materialId: output.material_id })).status === 'failed');
          assert.ok(
            (yield* Effect.flip(m.materialVersion({ id: versionId }))).kind === 'not_found'
          );
        }).pipe(Effect.provide(f.domain()))
      );
      expect(
        f.context.db.orm
          .select()
          .from(s.material_deletion_requests)
          .where(eq(s.material_deletion_requests.request_id, saved.request.id))
          .get()
      ).toStrictEqual(owner);
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
      assert.ok(retired.payload === '{}');
      assert.ok(retired.cancelled === true);
      assert.ok(retired.result_version_id === null);
      assert.ok(retired.result_hash === null);
      assertScrubbed(f, 'HISTORY_PRIVATE_GENERATION');
      assertScrubbed(f, 'GENERATED_HISTORICAL_BODY');
      const native = workflowStore(f.context).execution('completed-generation');

      assert.ok(native?.status === 'completed');
      assert.ok(native.payload === '{}');
      assert.ok(native.result === null);
      assert.ok(native.owner_token === null);
      expect(
        f.context.db.orm
          .select()
          .from(s.workflow_activities)
          .where(eq(s.workflow_activities.execution_id, 'completed-generation'))
          .all()
      ).toStrictEqual([]);
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

      await expect(f.execute(event, 'replay-retired-generation')).rejects.toSatisfy(() => true);
      assert.strictEqual(f.bodies.length, calls);
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Pages;

          assert.strictEqual(
            (yield* m.deletion({ materialId: output.material_id })).operationId,
            accepted.operationId
          );
          assert.ok(
            (yield* Effect.flip(
              m.materialGeneration({ requestId: saved.request.id, verifyOnly: true })
            )).kind === 'not_found'
          );
          const preview = yield* docs.previewDeletion({ id: saved.input.id });

          expect(preview.blockedVersionIds).toStrictEqual([]);
          yield* docs.delete({ pageId: saved.input.id, token: preview.token });
        }).pipe(Effect.provide(f.domain()))
      );
      f.reopen();
      expect(
        f.context.db.orm
          .select()
          .from(s.material_generation_requests)
          .where(eq(s.material_generation_requests.id, saved.request.id))
          .get()
      ).toStrictEqual(retired);
      expect(
        f.context.db.orm
          .select()
          .from(s.material_deletion_requests)
          .where(eq(s.material_deletion_requests.request_id, saved.request.id))
          .get()
      ).toStrictEqual(owner);
      expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

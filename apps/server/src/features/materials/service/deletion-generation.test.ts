import { eq, sql } from '@study/db';
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
import * as s from '@study/db';
import { test } from '@study/testing';
/** Generated learning output deletion releases evidence pins and retires only its original native ownership. */
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { workflowStore } from '#server/platform/workflows/store';
import { learningGeneration, queueLearningGeneration } from '#testing/learning-generation';
import { acceptMaterialDeletion, cleanupMaterial } from '#testing/material-deletion';
import { assertScrubbed } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

test.stable(
  'generated learning deletion fences replay, releases exact authored evidence and never reassigns cleanup ownership',
  async ({ databases }) => {
    const f = await pageTransformFixture(databases);

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

          test
            .expect(output.inputs)
            .toStrictEqual([{ kind: 'page', versionId: saved.input.version.id }]);
          const preview = yield* docs.previewDeletion({ id: saved.input.id });

          test.expect(preview.blockedVersionIds).toStrictEqual([saved.input.version.id]);
          test.assert.ok(
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

      test.assert.ok(owner);
      test.assert.strictEqual(owner.deletion_id, output.material_id);
      test.assert.ok(owner.kind === 'generation');
      f.context.db.exec(
        "CREATE TRIGGER reject_generation_cleanup BEFORE DELETE ON material_flashcard_versions BEGIN SELECT RAISE(ABORT,'injected'); END"
      );
      await test.expect(cleanupMaterial(f, output.material_id)).rejects.toSatisfy(() => true);
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          test.assert.ok(
            (yield* m.deletion({ materialId: output.material_id })).status === 'failed'
          );
          test.assert.ok(
            (yield* Effect.flip(m.materialVersion({ id: versionId }))).kind === 'not_found'
          );
        }).pipe(Effect.provide(f.domain()))
      );
      test
        .expect(
          f.context.db.orm
            .select()
            .from(s.material_deletion_requests)
            .where(eq(s.material_deletion_requests.request_id, saved.request.id))
            .get()
        )
        .toStrictEqual(owner);
      f.context.db.exec('DROP TRIGGER reject_generation_cleanup');
      await f.reopen();
      await Effect.runPromise(
        Effect.flatMap(Materials, (m) => m.retryDeletion({ materialId: output.material_id })).pipe(
          Effect.provide(f.domain())
        )
      );
      await cleanupMaterial(f, output.material_id);
      await f.reopen();
      const retired = f.context.db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, saved.request.id))
        .get();

      test.assert.ok(retired);
      test.assert.ok(retired.payload === '{}');
      test.assert.ok(retired.cancelled === true);
      test.assert.ok(retired.result_version_id === null);
      test.assert.ok(retired.result_hash === null);
      assertScrubbed(f, 'HISTORY_PRIVATE_GENERATION');
      assertScrubbed(f, 'GENERATED_HISTORICAL_BODY');
      const native = workflowStore(f.context).execution('completed-generation');

      test.assert.ok(native?.status === 'completed');
      test.assert.ok(native.payload === '{}');
      test.assert.ok(native.result === null);
      test.assert.ok(
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

      await test
        .expect(f.execute(event, 'replay-retired-generation'))
        .rejects.toSatisfy(() => true);
      test.assert.strictEqual(f.bodies.length, calls);
      await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const docs = yield* Pages;

          test.assert.strictEqual(
            (yield* m.deletion({ materialId: output.material_id })).operationId,
            accepted.operationId
          );
          test.assert.ok(
            (yield* Effect.flip(
              m.materialGeneration({ requestId: saved.request.id, verifyOnly: true })
            )).kind === 'not_found'
          );
          const preview = yield* docs.previewDeletion({ id: saved.input.id });

          test.expect(preview.blockedVersionIds).toStrictEqual([]);
          yield* docs.delete({ pageId: saved.input.id, token: preview.token });
        }).pipe(Effect.provide(f.domain()))
      );
      await f.reopen();
      test
        .expect(
          f.context.db.orm
            .select()
            .from(s.material_generation_requests)
            .where(eq(s.material_generation_requests.id, saved.request.id))
            .get()
        )
        .toStrictEqual(retired);
      test
        .expect(
          f.context.db.orm
            .select()
            .from(s.material_deletion_requests)
            .where(eq(s.material_deletion_requests.request_id, saved.request.id))
            .get()
        )
        .toStrictEqual(owner);
      test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

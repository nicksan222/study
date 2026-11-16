import { eq, sql } from '@study/db';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises learning history generation behavior through real persistence            │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies completed learning generation cleanup proof rejects restoring private         │
 * │   payload, result, pins or ownership.                                                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import * as s from '@study/db';
import { test } from '@study/testing';
/** Generated learning history owns private retirement; exact authored inputs stay pinned until release. */
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/index';
import { makeGenerationRetirement } from '#server/features/materials/store/generation-retirement';
import { Pages } from '#server/features/pages/index';
import { workflowStore } from '#server/platform/workflows/store';
import { learningGeneration, queueLearningGeneration } from '#testing/learning-generation';
import { deletionDocument } from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';
import { assertScrubbed } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';

type Fixture = Awaited<ReturnType<typeof pageTransformFixture>>;

function assertRetired(f: Fixture, requestId: string) {
  const row = f.context.db.orm
    .select()
    .from(s.material_generation_requests)
    .where(eq(s.material_generation_requests.id, requestId))
    .get();

  test.assert.ok(row);
  test.assert.ok(row.payload === '{}');
  test.assert.ok(row.cancelled === true);
  test.assert.ok(row.result_version_id === null);
  test.assert.ok(row.result_hash === null);
  test
    .expect(
      f.context.db.orm
        .select()
        .from(s.material_evidence_inputs)
        .where(eq(s.material_evidence_inputs.request_id, requestId))
        .all()
    )
    .toStrictEqual([]);
}

for (const attemptInputFirst of [false, true])
  test.stable(
    `generated learning history preserves exact ownership when authored input retirement is ${attemptInputFirst ? 'attempted first' : 'not requested'}`,
    async ({ databases }) => {
      const f = await pageTransformFixture(databases);

      try {
        const saved = await learningGeneration(f);
        const event = f.event(saved.request.id);

        queueLearningGeneration(f);
        const versionId = await f.execute(event, 'history-generated');
        const kept = await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;
            const docs = yield* Pages;
            const output = yield* m.materialVersion({ id: versionId });

            test.assert.ok(output.content.kind === 'flashcards');

            test.assert.ok(!(output.content.kind !== 'flashcards'), 'Expected flashcards');

            const content = {
              kind: 'flashcards' as const,
              cards: output.content.cards.map(({ front, back }) => ({ front, back }))
            };
            const copy = yield* m.create({
              title: 'Independent publication',
              content,
              publish: true
            });
            const current = yield* m.createVersion({
              materialId: output.material_id,
              content,
              publish: true
            });

            yield* docs.save({
              pageId: saved.input.id,
              expectedVersionId: saved.input.version.id,
              key: 'advance',
              document: deletionDocument('Current input')
            });
            const scope = { pageId: saved.input.id, keepLatest: 1 };

            if (attemptInputFirst) {
              const blocked = yield* docs.previewHistory(scope);

              test.expect(blocked.blockedVersionIds).toStrictEqual([saved.input.version.id]);
              test.assert.ok(
                (yield* Effect.flip(docs.retireHistory({ ...scope, token: blocked.token })))
                  .kind === 'invalid_input'
              );
            }

            return { copy, current, owner: output.material_id, content, scope };
          }).pipe(Effect.provide(f.domain()))
        );
        const accepted = await acceptHistory(f, kept.owner, 'history-output');

        test.expect(accepted.candidateIds).toStrictEqual([versionId]);
        const owner = f.context.db.orm
          .select()
          .from(s.material_history_requests)
          .where(eq(s.material_history_requests.request_id, saved.request.id))
          .get();

        test.assert.ok(owner?.kind === 'generation');
        test.assert.ok(owner.operation_id === 'history-output');
        await cleanupHistory(f, 'history-output');
        await f.reopen();
        assertRetired(f, saved.request.id);
        assertScrubbed(f, 'HISTORY_PRIVATE_GENERATION');
        const native = workflowStore(f.context).execution('history-generated');

        test.assert.ok(native?.payload === '{}');
        test.assert.ok(native.result === null);
        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;
            const docs = yield* Pages;

            test.assert.ok(
              (yield* m.historyPrune({ operationId: 'history-output' })).status === 'completed'
            );
            test.assert.strictEqual(
              (yield* m.material({ id: kept.owner })).version.id,
              kept.current.id
            );
            test
              .expect(yield* m.materialVersion({ id: kept.copy.version.id }))
              .toStrictEqual(kept.copy.version);
            test
              .expect((yield* m.materialVersion({ id: kept.current.id })).content)
              .toStrictEqual(kept.current.content);
            test.assert.ok(
              (yield* Effect.flip(m.materialVersion({ id: versionId }))).kind === 'not_found'
            );

            if (attemptInputFirst) {
              const preview = yield* docs.previewHistory(kept.scope);

              test.expect(preview.blockedVersionIds).toStrictEqual([]);
              yield* docs.retireHistory({ ...kept.scope, token: preview.token });
            }
          }).pipe(Effect.provide(f.domain()))
        );
        const calls = f.bodies.length;

        await test
          .expect(f.execute(event, 'late-history-generation'))
          .rejects.toSatisfy(() => true);
        test.assert.strictEqual(f.bodies.length, calls);
        test
          .expect(
            f.context.db.orm
              .select()
              .from(s.material_history_requests)
              .where(eq(s.material_history_requests.request_id, saved.request.id))
              .get()
          )
          .toStrictEqual(owner);
        test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );

test.stable(
  'completed learning generation cleanup proof rejects restoring private payload, result, pins or ownership',
  async ({ databases }) => {
    const f = await pageTransformFixture(databases);

    try {
      const saved = await learningGeneration(f);

      queueLearningGeneration(f);
      const versionId = await f.execute(f.event(saved.request.id), 'scrub-proof-generation');
      const owner = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const output = yield* m.materialVersion({ id: versionId });

          yield* m.createVersion({
            materialId: output.material_id,
            content: {
              kind: 'flashcards',
              cards: [{ front: 'Current proof output', back: 'Current' }]
            },
            publish: true
          });

          return output.material_id;
        }).pipe(Effect.provide(f.domain()))
      );
      const retirement = () => makeGenerationRetirement(f.context);

      test.assert.ok(retirement().isScrubbed(saved.request.id) === false);
      await acceptHistory(f, owner, 'scrub-shape-proof');
      test.assert.ok(retirement().isScrubbed(saved.request.id) === false);
      await cleanupHistory(f, 'scrub-shape-proof');
      await f.reopen();
      test.assert.ok(retirement().isScrubbed(saved.request.id) === true);
      test.assert.ok(retirement().isScrubbed('missing') === false);

      for (const patch of [
        sql`payload='{ }'`,
        sql`payload='{"private":"body"}'`,
        sql`cancelled=0`,
        sql`result_version_id=${versionId},result_hash='restored'`
      ])
        test.assert.throws(() =>
          f.context.db.orm.run(
            sql`UPDATE material_generation_requests SET ${patch} WHERE id=${saved.request.id}`
          )
        );

      test.assert.throws(() =>
        f.context.db.orm
          .insert(s.material_evidence_inputs)
          .values({
            request_id: saved.request.id,
            page_version_id: saved.input.version.id,
            position: 0n
          })
          .run()
      );
      test.assert.throws(() =>
        f.context.db.orm
          .update(s.material_history_requests)
          .set({ kind: 'publication' })
          .where(eq(s.material_history_requests.request_id, saved.request.id))
          .run()
      );
      test.assert.ok(retirement().isScrubbed(saved.request.id) === true);
      assertRetired(f, saved.request.id);
    } finally {
      await f.close();
    }
  }
);

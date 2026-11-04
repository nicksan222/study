import assert from 'node:assert/strict';

import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
/** Generated learning history owns private retirement; exact authored inputs stay pinned until release. */
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { makeGenerationRetirement } from '#server/features/materials/store/generation-retirement';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import { learningGeneration, queueLearningGeneration } from '#testing/learning-generation';
import { deletionDocument } from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';
import { assertScrubbed } from '#testing/session-deletion';

type Fixture = Awaited<ReturnType<typeof documentTransformFixture>>;
function assertRetired(f: Fixture, requestId: string) {
  const row = f.context.db.orm
    .select()
    .from(s.material_generation_requests)
    .where(eq(s.material_generation_requests.id, requestId))
    .get();
  assert.ok(row);
  assert.equal(row.payload, '{}');
  assert.equal(row.cancelled, true);
  assert.equal(row.result_version_id, null);
  assert.equal(row.result_hash, null);
  assert.deepEqual(
    f.context.db.orm
      .select()
      .from(s.material_evidence_inputs)
      .where(eq(s.material_evidence_inputs.request_id, requestId))
      .all(),
    []
  );
}
for (const attemptInputFirst of [false, true])
  testStable(
    `generated learning history preserves exact ownership when authored input retirement is ${attemptInputFirst ? 'attempted first' : 'not requested'}`,
    async () => {
      const f = await documentTransformFixture();
      try {
        const saved = await learningGeneration(f);
        const event = f.event(saved.request.id);
        queueLearningGeneration(f);
        const versionId = await f.execute(event, 'history-generated');
        const kept = await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;
            const docs = yield* Documents;
            const output = yield* m.materialVersion({ id: versionId });
            assert.equal(output.content.kind, 'flashcards');
            if (output.content.kind !== 'flashcards') throw new Error('Expected flashcards');
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
              documentId: saved.input.id,
              expectedVersionId: saved.input.version.id,
              key: 'advance',
              document: deletionDocument('Current input')
            });
            const scope = { documentId: saved.input.id, keepLatest: 1 };
            if (attemptInputFirst) {
              const blocked = yield* docs.previewHistory(scope);
              assert.deepEqual(blocked.blockedVersionIds, [saved.input.version.id]);
              assert.equal(
                (yield* Effect.flip(docs.retireHistory({ ...scope, token: blocked.token }))).kind,
                'invalid_input'
              );
            }
            return { copy, current, owner: output.material_id, content, scope };
          }).pipe(Effect.provide(f.domain()))
        );
        const accepted = await acceptHistory(f, kept.owner, 'history-output');
        assert.deepEqual(accepted.candidateIds, [versionId]);
        const owner = f.context.db.orm
          .select()
          .from(s.material_history_requests)
          .where(eq(s.material_history_requests.request_id, saved.request.id))
          .get();
        assert.equal(owner?.kind, 'generation');
        assert.equal(owner.operation_id, 'history-output');
        await cleanupHistory(f, 'history-output');
        f.reopen();
        assertRetired(f, saved.request.id);
        assertScrubbed(f, 'HISTORY_PRIVATE_GENERATION');
        const native = workflowStore(f.context).execution('history-generated');
        assert.equal(native?.payload, '{}');
        assert.equal(native.result, null);
        assert.equal(native.owner_token, null);
        assert.deepEqual(
          f.context.db.orm
            .select()
            .from(s.workflow_activities)
            .where(eq(s.workflow_activities.execution_id, 'history-generated'))
            .all(),
          []
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const m = yield* Materials;
            const docs = yield* Documents;
            assert.equal(
              (yield* m.historyPrune({ operationId: 'history-output' })).status,
              'completed'
            );
            assert.equal((yield* m.material({ id: kept.owner })).version.id, kept.current.id);
            assert.deepEqual(
              yield* m.materialVersion({ id: kept.copy.version.id }),
              kept.copy.version
            );
            assert.deepEqual(
              (yield* m.materialVersion({ id: kept.current.id })).content,
              kept.current.content
            );
            assert.equal(
              (yield* Effect.flip(m.materialVersion({ id: versionId }))).kind,
              'not_found'
            );
            if (attemptInputFirst) {
              const preview = yield* docs.previewHistory(kept.scope);
              assert.deepEqual(preview.blockedVersionIds, []);
              yield* docs.retireHistory({ ...kept.scope, token: preview.token });
            }
          }).pipe(Effect.provide(f.domain()))
        );
        const calls = f.bodies.length;
        await assert.rejects(f.execute(event, 'late-history-generation'));
        assert.equal(f.bodies.length, calls);
        assert.deepEqual(
          f.context.db.orm
            .select()
            .from(s.material_history_requests)
            .where(eq(s.material_history_requests.request_id, saved.request.id))
            .get(),
          owner
        );
        assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        await f.close();
      }
    }
  );

testStable(
  'completed learning generation cleanup proof rejects restoring private payload, result, pins or ownership',
  async () => {
    const f = await documentTransformFixture();
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
      const retirement = () =>
        makeGenerationRetirement({ db: f.context.db, clock: f.context.clock });
      assert.equal(retirement().isScrubbed(saved.request.id), false);
      await acceptHistory(f, owner, 'scrub-shape-proof');
      assert.equal(retirement().isScrubbed(saved.request.id), false);
      await cleanupHistory(f, 'scrub-shape-proof');
      f.reopen();
      assert.equal(retirement().isScrubbed(saved.request.id), true);
      assert.equal(retirement().isScrubbed('missing'), false);
      for (const patch of [
        sql`payload='{ }'`,
        sql`payload='{"private":"body"}'`,
        sql`cancelled=0`,
        sql`result_version_id=${versionId},result_hash='restored'`
      ])
        assert.throws(() =>
          f.context.db.orm.run(
            sql`UPDATE material_generation_requests SET ${patch} WHERE id=${saved.request.id}`
          )
        );
      assert.throws(() =>
        f.context.db.orm
          .insert(s.material_evidence_inputs)
          .values({
            request_id: saved.request.id,
            document_version_id: saved.input.version.id,
            position: 0n
          })
          .run()
      );
      assert.throws(() =>
        f.context.db.orm
          .update(s.material_history_requests)
          .set({ kind: 'publication' })
          .where(eq(s.material_history_requests.request_id, saved.request.id))
          .run()
      );
      assert.equal(retirement().isScrubbed(saved.request.id), true);
      assertRetired(f, saved.request.id);
    } finally {
      await f.close();
    }
  }
);

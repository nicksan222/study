/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises generated history and shared generation retirement ownership.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps current and independent publications while removing private native payloads.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Controlled provider responses drive production generation against migrated SQLite.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { makeGenerationRetirement } from '#server/features/materials/store/generation-retirement';
import { Projects } from '#server/features/projects/index';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import type { MaterialDeletionFixture } from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';
import { assertScrubbed, validDocumentTransformOutput } from '#testing/session-deletion';

function generate(f: MaterialDeletionFixture, transform: boolean) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const m = yield* Materials;

      const project = yield* (yield* Projects).createProject({ name: 'Generated history' });

      const input = yield* m.create({
        title: 'Evidence',
        projectId: project.id,
        content: { kind: 'document', ...deletionDocument('Shared generation evidence') },
        publish: true
      });

      if (!transform) {
        const request = yield* m.requestMaterialGeneration({
          projectId: project.id,
          kind: 'flashcards',
          title: 'Aid',
          instruction: 'HISTORY_PRIVATE_GENERATION',
          inputVersionIds: [input.version.id]
        });

        return { input, request };
      }

      const c = yield* Conversations;

      const session = yield* c.createUntitledSession({});

      yield* c.updateSessionSelection({
        sessionId: session.id,
        expectedRevision: 0n,
        targets: [{ versionId: input.version.id, scope: { kind: 'document' } }]
      });

      const capture = yield* c.captureSessionContext({
        sessionId: session.id,
        intentKey: 'no-target',
        instruction: 'HISTORY_PRIVATE_GENERATION',
        preferences: {}
      });

      const request = yield* c.requestDocumentTransform({
        contextRequestId: capture.requestId,
        title: 'No target',
        operations: ['clarity']
      });

      return { input, request };
    }).pipe(Effect.provide(f.domain()))
  );
}

function assertRetired(f: MaterialDeletionFixture, id: string) {
  const row = f.context.db.orm
    .select()
    .from(s.material_generation_requests)
    .where(eq(s.material_generation_requests.id, id))
    .get();

  assert.ok(row);

  assert.equal(row.payload, '{}');

  assert.equal(row.cancelled, true);

  assert.equal(row.result_version_id, null);

  assert.equal(row.result_hash, null);

  assert.equal(row.result_metadata, null);

  assert.deepEqual(
    f.context.db.orm
      .select()
      .from(s.material_generation_inputs)
      .where(eq(s.material_generation_inputs.request_id, id))
      .all(),
    []
  );
}

function queueHistoricalOutput(
  f: Awaited<ReturnType<typeof documentTransformFixture>>,
  transform: boolean
) {
  f.replies.push(
    { kind: 'sources', query: 'generation evidence' },
    {
      kind: 'output',
      output: transform
        ? validDocumentTransformOutput('GENERATED_HISTORICAL_BODY [1]')
        : {
            kind: 'flashcards',
            cards: [{ front: 'GENERATED_HISTORICAL_BODY [1]', back: 'Shared generation evidence' }]
          }
    }
  );
}

function assertNativeRetired(f: Awaited<ReturnType<typeof documentTransformFixture>>) {
  const native = workflowStore(f.context).execution('history-generated');

  assert.ok(native);

  assert.equal(native.payload, '{}');

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

  assert.ok(
    f.context.db.orm
      .select()
      .from(s.workflow_retired_executions)
      .where(eq(s.workflow_retired_executions.execution_id, 'history-generated'))
      .get()
  );
}

for (const transform of [false, true]) {
  for (const retireInputFirst of [false, true]) {
    testStable(
      `${transform ? 'no-target Document' : 'generated aid'} history preserves generation ownership when input retirement is ${retireInputFirst ? 'completed first' : 'not involved'}`,
      async () => {
        const f = await documentTransformFixture();

        try {
          const saved = await generate(f, transform);

          const event = f.event(saved.request.id);

          queueHistoricalOutput(f, transform);

          await f.execute(event, 'history-generated');

          const output = await Effect.runPromise(
            Effect.gen(function* () {
              const m = yield* Materials;

              const request = yield* m.materialGeneration({
                requestId: saved.request.id,
                verifyOnly: true
              });

              assert.ok(request.resultVersionId !== null);

              return yield* m.materialVersion({ id: request.resultVersionId });
            }).pipe(Effect.provide(f.domain()))
          );

          const publication = f.context.db.orm
            .select()
            .from(s.workflowEvents)
            .where(eq(s.workflowEvents.type, 'MaterialPublished'))
            .all()
            .find((row) => row.correlationId === saved.request.id);

          assert.ok(publication);

          assert.equal(
            f.context.db.orm
              .select()
              .from(s.material_versions)
              .where(eq(s.material_versions.id, output.id))
              .get()?.generation_request_id,
            saved.request.id
          );

          const kept = await Effect.runPromise(
            Effect.gen(function* () {
              const m = yield* Materials;

              const copy = yield* m.create({
                title: 'Independent publication',
                content:
                  output.content.kind === 'flashcards'
                    ? {
                        kind: 'flashcards',
                        cards: output.content.cards.map(({ front, back }) => ({ front, back }))
                      }
                    : output.content,
                publish: true
              });

              const current = yield* m.createVersion({
                materialId: output.material_id,
                content: output.content,
                publish: true
              });

              yield* m.createVersion({
                materialId: saved.input.id,
                content: { kind: 'document', ...deletionDocument('Current input') },
                publish: true
              });

              return { copy, current };
            }).pipe(Effect.provide(f.domain()))
          );

          let owner: typeof s.material_history_requests.$inferSelect | undefined;

          if (retireInputFirst) {
            await acceptHistory(f, saved.input.id, 'history-input-owner');

            // An active prior generation owner cannot be reused, even for an exact output.
            await assert.rejects(acceptHistory(f, output.material_id, 'history-output-overlap'));

            assert.equal(
              f.context.db.orm
                .select()
                .from(s.material_history_prunes)
                .where(eq(s.material_history_prunes.operation_id, 'history-output-overlap'))
                .get(),
              undefined
            );

            await cleanupHistory(f, 'history-input-owner');

            f.reopen();

            assertRetired(f, saved.request.id);

            owner = f.context.db.orm
              .select()
              .from(s.material_history_requests)
              .where(eq(s.material_history_requests.request_id, saved.request.id))
              .get();

            assert.equal(owner?.kind, 'generation');
          }

          const accepted = await acceptHistory(f, output.material_id, 'history-output');

          assert.deepEqual(accepted.candidateIds, [output.id]);

          const generationOwner = f.context.db.orm
            .select()
            .from(s.material_history_requests)
            .where(eq(s.material_history_requests.request_id, saved.request.id))
            .get();

          assert.equal(generationOwner?.kind, 'generation');

          assert.equal(
            generationOwner?.operation_id,
            retireInputFirst ? 'history-input-owner' : 'history-output'
          );

          if (owner) assert.deepEqual(generationOwner, owner);

          await cleanupHistory(f, 'history-output');

          f.reopen();

          assertRetired(f, saved.request.id);

          if (!transform || retireInputFirst) assertScrubbed(f, 'HISTORY_PRIVATE_GENERATION');

          assertNativeRetired(f);

          await Effect.runPromise(
            Effect.gen(function* () {
              const m = yield* Materials;

              assert.equal(
                (yield* m.historyPrune({ operationId: accepted.operationId })).status,
                'completed'
              );

              assert.equal(
                (yield* m.material({ id: output.material_id })).version.id,
                kept.current.id
              );

              assert.deepEqual(
                yield* m.materialVersion({ id: kept.copy.version.id }),
                kept.copy.version
              );

              assert.deepEqual(
                (yield* m.materialVersion({ id: kept.current.id })).content,
                output.content
              );

              assert.equal(
                (yield* Effect.flip(m.materialVersion({ id: output.id }))).kind,
                'not_found'
              );
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
            generationOwner
          );
        } finally {
          await f.close();
        }
      }
    );
  }
}

testStable(
  'completed generation proof requires exact private cleanup and rejects restoring any payload component',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await generate(f, false);
      const retirement = makeGenerationRetirement({ db: f.context.db, clock: f.context.clock });

      f.replies.push(
        { kind: 'sources', query: 'generation evidence' },
        {
          kind: 'output',
          output: {
            kind: 'flashcards',
            cards: [{ front: 'Retained proof output [1]', back: 'Shared generation evidence' }]
          }
        }
      );
      await f.execute(f.event(saved.request.id), 'scrub-proof-generation');
      const current = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;
          const request = yield* m.materialGeneration({
            requestId: saved.request.id,
            verifyOnly: true
          });

          assert.ok(request.resultVersionId !== null);

          const input = yield* m.createVersion({
            materialId: saved.input.id,
            content: { kind: 'document', ...deletionDocument('Current proof input') },
            publish: true
          });

          return { input, outputId: request.resultVersionId };
        }).pipe(Effect.provide(f.domain()))
      );

      assert.equal(retirement.isScrubbed(saved.request.id), false);
      await acceptHistory(f, saved.input.id, 'scrub-shape-proof');
      assert.equal(retirement.isScrubbed(saved.request.id), false);
      await cleanupHistory(f, 'scrub-shape-proof');
      f.reopen();

      const reopened = makeGenerationRetirement({ db: f.context.db, clock: f.context.clock });

      assert.equal(reopened.isScrubbed(saved.request.id), true);
      assert.equal(reopened.isScrubbed('missing'), false);

      for (const patch of [
        sql`payload='{ }'`,
        sql`payload='{"private":"body"}'`,
        sql`cancelled=0`,
        sql`result_metadata='{}'`,
        sql`result_version_id=${current.outputId},result_hash='restored'`
      ]) {
        assert.throws(() =>
          f.context.db.orm.run(
            sql`UPDATE material_generation_requests SET ${patch} WHERE id=${saved.request.id}`
          )
        );
      }

      assert.throws(() =>
        f.context.db.orm
          .insert(s.material_generation_inputs)
          .values({
            request_id: saved.request.id,
            version_id: current.input.id,
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
      assert.equal(reopened.isScrubbed(saved.request.id), true);
      assertRetired(f, saved.request.id);
    } finally {
      await f.close();
    }
  }
);

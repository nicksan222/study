/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises sequential deletion of generated outputs after their inputs are retired. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps immutable original generation ownership and native replay fences across cleanup. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Controlled provider responses drive production generation and deletion Workflows against │
 * │ SQLite.                                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import type { MaterialId } from '@study/contracts/ids';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  deletionDocument
} from '#testing/material-deletion';
import type { MaterialDeletionFixture } from '#testing/material-deletion';
import {
  assertScrubbed,
  awaitNativeStatus,
  validDocumentTransformOutput
} from '#testing/session-deletion';

function generatedRequest(f: MaterialDeletionFixture, transform: boolean) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const materials = yield* Materials;

      const project = yield* (yield* Projects).createProject({ name: 'Generation retirement' });

      const input = yield* materials.create({
        title: 'Input A',
        projectId: project.id,
        publish: true,
        content: { kind: 'document', ...deletionDocument('Generation evidence') }
      });

      if (!transform) {
        const request = yield* materials.requestMaterialGeneration({
          projectId: project.id,
          kind: 'flashcards',
          title: 'Output B',
          instruction: 'PRIVATE_GENERATION_INSTRUCTION_ONLY',
          inputVersionIds: [input.version.id]
        });

        return { input, request };
      }

      const chats = yield* Conversations;

      const session = yield* chats.createUntitledSession({});

      yield* chats.updateSessionSelection({
        sessionId: session.id,
        expectedRevision: 0n,
        targets: [{ versionId: input.version.id, scope: { kind: 'document' } }]
      });

      const capture = yield* chats.captureSessionContext({
        sessionId: session.id,
        intentKey: 'generation',
        instruction: 'PRIVATE_GENERATION_INSTRUCTION_ONLY',
        preferences: {}
      });

      const request = yield* chats.requestDocumentTransform({
        contextRequestId: capture.requestId,
        title: 'Output B',
        operations: ['clarity']
      });

      return { input, request };
    }).pipe(Effect.provide(f.domain()))
  );
}

function rejectSharedCleanup(f: MaterialDeletionFixture, materialId: MaterialId) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const materials = yield* Materials;

      const preview = yield* materials.previewDeletion({ materialId });

      const error = yield* Effect.flip(
        materials.requestDeletion({ materialId, descendantIds: [], token: preview.token })
      );

      assert.equal(error.kind, 'invalid_input');
    }).pipe(Effect.provide(f.domain()))
  );
}

function retiredRequest(f: MaterialDeletionFixture, requestId: string) {
  const row = f.context.db.orm
    .select()
    .from(s.material_generation_requests)
    .where(eq(s.material_generation_requests.id, requestId))
    .get();

  assert.ok(row);

  assert.equal(row.payload, '{}');

  assert.equal(row.cancelled, true);

  assert.equal(row.result_metadata, null);

  assert.equal(row.result_version_id, null);

  assert.equal(row.result_hash, null);

  assert.equal(
    f.context.db.orm
      .select()
      .from(s.material_generation_inputs)
      .where(eq(s.material_generation_inputs.request_id, requestId))
      .all().length,
    0
  );

  return row;
}

for (const transform of [false, true]) {
  testStable(
    `kept ${transform ? 'no-target Document transform' : 'generated flashcards'} can be deleted after completed input retirement without reassignment or resurrection`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const saved = await generatedRequest(f, transform);

        const event = f.event(saved.request.id);

        f.replies.push({ kind: 'sources', query: 'Generation evidence' });

        f.replies.push({
          kind: 'output',
          output: transform
            ? validDocumentTransformOutput('INTENTIONAL_GENERATION_COPY [1]')
            : {
                kind: 'flashcards',
                cards: [{ front: 'INTENTIONAL_GENERATION_COPY [1]', back: 'Generation evidence' }]
              }
        });

        await f.execute(event, 'completed-generation');

        const output = await Effect.runPromise(
          Effect.gen(function* () {
            const materials = yield* Materials;

            const request = yield* materials.materialGeneration({
              requestId: saved.request.id,
              verifyOnly: true
            });

            assert.ok(request.resultVersionId !== null);

            return yield* materials.materialVersion({ id: request.resultVersionId });
          }).pipe(Effect.provide(f.domain()))
        );

        assert.notEqual(output.material_id, saved.input.id);

        assert.equal(
          f.context.db.orm
            .select()
            .from(s.material_versions)
            .where(eq(s.material_versions.id, output.id))
            .get()?.generation_request_id,
          saved.request.id
        );

        const accepted = await acceptMaterialDeletion(f, saved.input.id);
        // Live overlapping retirement must still reject, including the failed-cleanup interval.

        await rejectSharedCleanup(f, output.material_id);

        f.context.db.orm.run(
          sql.raw(
            "CREATE TRIGGER reject_generation_cleanup BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT,'injected'); END"
          )
        );

        await assert.rejects(cleanupMaterial(f, saved.input.id));

        await Effect.runPromise(
          awaitNativeStatus(f, `material-cleanup/${accepted.operationId}/1`, 'completed')
        );

        const failed = await Effect.runPromise(
          Effect.flatMap(Materials, (m) => m.deletion({ materialId: saved.input.id })).pipe(
            Effect.provide(f.domain())
          )
        );

        assert.equal(failed.status, 'failed');

        await rejectSharedCleanup(f, output.material_id);

        assert.equal(
          f.context.db.orm
            .select()
            .from(s.material_deletions)
            .where(eq(s.material_deletions.material_id, output.material_id))
            .get(),
          undefined
        );

        f.context.db.orm.run(sql.raw('DROP TRIGGER reject_generation_cleanup'));

        f.reopen();

        await Effect.runPromise(
          Effect.flatMap(Materials, (m) => m.retryDeletion({ materialId: saved.input.id })).pipe(
            Effect.provide(f.domain())
          )
        );

        await cleanupMaterial(f, saved.input.id);

        f.reopen();

        const retired = retiredRequest(f, saved.request.id);

        const owner = f.context.db.orm
          .select()
          .from(s.material_deletion_requests)
          .where(eq(s.material_deletion_requests.request_id, saved.request.id))
          .get();

        assert.deepEqual(owner, {
          request_id: saved.request.id,
          deletion_id: saved.input.id,
          kind: 'generation'
        });

        const fences = f.context.db.orm
          .select()
          .from(s.workflow_retired_correlations)
          .where(eq(s.workflow_retired_correlations.correlation_id, saved.request.id))
          .all();

        assert.ok(fences.some((fence) => fence.event_type === 'MaterialGenerationRequested'));

        const nativeFence = f.context.db.orm
          .select()
          .from(s.workflow_retired_executions)
          .where(eq(s.workflow_retired_executions.execution_id, 'completed-generation'))
          .get();

        assert.deepEqual(nativeFence, {
          execution_id: 'completed-generation',
          correlation_id: saved.request.id
        });

        const run = workflowStore(f.context).execution('completed-generation');

        assert.ok(run);

        assert.equal(run.status, 'completed');

        assert.equal(run.payload, '{}');

        assert.equal(run.result, null);

        assert.equal(run.owner_token, null);

        assert.equal(
          f.context.db.orm
            .select()
            .from(s.workflow_activities)
            .where(eq(s.workflow_activities.execution_id, 'completed-generation'))
            .all().length,
          0
        );

        assert.deepEqual(
          await Effect.runPromise(
            Effect.gen(function* () {
              const materials = yield* Materials;
              const citations = yield* materials.citations({ id: output.id, limit: 10 });

              assert.equal(citations.items.length, 1);
              assert.equal(citations.items[0]?.inputVersionId, saved.input.version.id);
              assert.equal(citations.items[0]?.evidence?.availability, 'unavailable');

              return yield* materials.materialVersion({ id: output.id });
            }).pipe(Effect.provide(f.domain()))
          ),
          { ...output, instruction: null }
        );

        assertScrubbed(f, 'PRIVATE_GENERATION_INSTRUCTION_ONLY');

        await acceptMaterialDeletion(f, output.material_id);

        assert.deepEqual(
          f.context.db.orm
            .select()
            .from(s.material_deletion_requests)
            .where(eq(s.material_deletion_requests.request_id, saved.request.id))
            .get(),
          owner
        );

        await cleanupMaterial(f, output.material_id);

        f.reopen();

        assert.deepEqual(retiredRequest(f, saved.request.id), retired);

        assert.deepEqual(
          f.context.db.orm
            .select()
            .from(s.workflow_retired_executions)
            .where(eq(s.workflow_retired_executions.execution_id, 'completed-generation'))
            .get(),
          nativeFence
        );

        assert.deepEqual(
          f.context.db.orm
            .select()
            .from(s.material_deletion_requests)
            .where(eq(s.material_deletion_requests.request_id, saved.request.id))
            .get(),
          owner
        );

        assert.deepEqual(
          f.context.db.orm
            .select()
            .from(s.workflow_retired_correlations)
            .where(eq(s.workflow_retired_correlations.correlation_id, saved.request.id))
            .all(),
          fences
        );

        const calls = f.bodies.length;

        await assert.rejects(f.execute(event, 'replay-retired-generation'));

        assert.equal(f.bodies.length, calls);

        assertScrubbed(f, 'INTENTIONAL_GENERATION_COPY');

        await Effect.runPromise(
          Effect.gen(function* () {
            const materials = yield* Materials;

            assert.equal(
              (yield* materials.deletion({ materialId: output.material_id })).status,
              'completed'
            );

            assert.equal(
              (yield* Effect.flip(materials.materialVersion({ id: output.id }))).kind,
              'not_found'
            );

            assert.equal(
              (yield* Effect.flip(
                materials.materialGeneration({ requestId: saved.request.id, verifyOnly: true })
              )).kind,
              'not_found'
            );
          }).pipe(Effect.provide(f.domain()))
        );
      } finally {
        await f.close();
      }
    }
  );
}

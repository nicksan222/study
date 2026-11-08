/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact native deletion attempts and canonical query bindings over SQLite. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks pending retry noncompetition and stale attempt settlement fences.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real feature services and native Workflow timing gates without changing guards.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { noteDeletionRequestedSchema } from '@study/contracts/events';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Deferred, Effect, Exit, Option } from 'effect';
import { DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import {
  NoteDeletionStore,
  NoteDeletionOwnershipStore,
  NoteDeletionCorrelationStore
} from '#server/features/notes/store/deletion';
import {
  noteDeletionWorkflow,
  noteDeletionHandler
} from '#server/features/notes/workflows/deletion';
import { Workflows } from '#server/features/workflows/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';
import { setup, deletionEvent, assertScrubbed, awaitNativeStatus } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';
import { withTestPublication } from '#testing/publication';

testStable(
  'canonical status, ownership and correlation queries bind directly with typed aggregate results',
  async () => {
    const fixture = await pageTransformFixture();

    try {
      const saved = await setup(fixture, 'DIRECT_QUERY_BINDING_8');

      await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* useStore(NoteDeletionStore);

          const ownership = yield* useStore(NoteDeletionOwnershipStore);

          const correlations = yield* useStore(NoteDeletionCorrelationStore);

          assert.ok(Option.isNone(yield* status.findNoteDeletion(saved.note.id)));

          assert.ok((yield* Effect.flip(status.noteDeletion(saved.note.id))).kind === 'not_found');

          const owned = yield* ownership.deletionOwnership(saved.note.id);

          assert.ok(owned.contextIds.includes(saved.capture.requestId));

          assert.ok(owned.correlations.includes(saved.capture.requestId));

          const accepted = yield* (yield* Notes).deleteNote(saved.note.id);

          const retained = yield* correlations.deletionCorrelation(saved.note.id);

          assert.strictEqual(
            (yield* status.noteDeletion(saved.note.id)).operationId,
            accepted.operationId
          );

          assert.ok(retained.correlations.includes(saved.request.id));

          assert.ok(retained.correlations.includes(saved.capture.requestId));

          expect((yield* ownership.deletionOwnership(saved.note.id)).contextIds).toStrictEqual([]);

          expect(
            yield* transaction((tx) =>
              tx.store(NoteDeletionCorrelationStore).deletionCorrelation(saved.note.id)
            )
          ).toStrictEqual(retained);
        }).pipe(Effect.provide(fixture.domain()))
      );

      fixture.reopen();

      await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* useStore(NoteDeletionStore);

          const correlations = yield* useStore(NoteDeletionCorrelationStore);

          assert.strictEqual((yield* status.noteDeletion(saved.note.id)).attempt, 1);

          assert.ok(
            (yield* correlations.deletionCorrelation(saved.note.id)).correlations.includes(
              saved.request.id
            )
          );
        }).pipe(Effect.provide(fixture.domain()))
      );
    } finally {
      await fixture.close();
    }
  }
);

for (const state of ['running', 'suspended'] as const) {
  testStable(
    `pending retry waits for every exact current native execution while ${state}, then rejects stale settlement`,
    async () => {
      const fixture = await pageTransformFixture();

      const marker = `ATTEMPT_FENCE_${state}_8`;

      try {
        const saved = await setup(fixture, marker);

        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const chats = yield* Notes;

              const engine = yield* WorkflowEngine.WorkflowEngine;

              const accepted = yield* chats.deleteNote(saved.note.id);

              const event = deletionEvent(fixture, saved.note.id);

              const entered = yield* Deferred.make<void>();

              const release = yield* Deferred.make<void>();

              const durable = DurableDeferred.make('hold-deletion-owner');

              const probe = Workflow.make('note-deletion-owner-probe', {
                payload: { event: noteDeletionRequestedSchema },
                idempotencyKey: ({ event }) => event.eventId
              });

              let currentRuns = 0;

              yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));

              const probeHandler = Effect.fn(function* ({
                event: value
              }: {
                event: typeof noteDeletionRequestedSchema.Type;
              }) {
                if (
                  value.eventId !== event.eventId ||
                  value.correlationId !== event.correlationId ||
                  currentRuns++ === 0
                )
                  return;

                yield* Deferred.succeed(entered, undefined);

                if (state === 'running') yield* Deferred.await(release);
                else yield* DurableDeferred.await(durable);
              });

              yield* engine.register(probe, probeHandler);

              yield* engine.register(noteDeletionWorkflow, noteDeletionHandler);
              // A terminal run from another event in this operation does not prove dispatch of attempt 1.
              yield* engine.execute(probe, {
                executionId: 'older-terminal',
                payload: { event: { ...event, eventId: `${accepted.operationId}/older` } }
              });

              expect(yield* chats.retryNoteDeletion(saved.note.id)).toStrictEqual(accepted);

              yield* engine.execute(probe, {
                executionId: 'other-operation',
                payload: { event: { ...event, correlationId: 'other-operation' } }
              });

              yield* engine.execute(probe, { executionId: 'current-terminal', payload: { event } });

              yield* engine.execute(probe, {
                executionId: 'current-held',
                payload: { event },
                discard: true
              });

              yield* Deferred.await(entered);

              yield* awaitNativeStatus(fixture, 'current-held', state);

              const runs = yield* transaction((tx) =>
                Workflows.correlatedExecutions(tx, accepted.operationId, event.eventId)
              );

              expect(runs.map((run) => run.id).sort()).toStrictEqual([
                'current-held',
                'current-terminal'
              ]);

              assert.strictEqual(
                (yield* transaction((tx) =>
                  Workflows.correlatedExecutions(tx, accepted.operationId)
                )).length,
                3
              );

              expect(yield* chats.retryNoteDeletion(saved.note.id)).toStrictEqual(accepted);

              assert.strictEqual(deletionEvents(fixture).length, 1);

              if (state === 'running') yield* Deferred.succeed(release, undefined);
              else
                yield* engine.deferredDone(durable, {
                  workflowName: probe._tag,
                  executionId: 'current-held',
                  deferredName: durable.name,
                  exit: Exit.void
                });

              yield* awaitNativeStatus(fixture, 'current-held', 'completed');

              const retry = yield* chats.retryNoteDeletion(saved.note.id);

              assert.strictEqual(retry.operationId, accepted.operationId);

              assert.strictEqual(retry.attempt, 2);

              assert.strictEqual(deletionEvents(fixture).length, 2);
              // No attempt-2 execution exists yet: old terminal owners cannot cause a third attempt.
              expect(yield* chats.retryNoteDeletion(saved.note.id)).toStrictEqual(retry);

              expect(
                yield* chats.failNoteDeletion({
                  noteId: saved.note.id,
                  errorKind: 'internal',
                  attempt: 1
                })
              ).toStrictEqual(retry);

              yield* withTestPublication(
                fixture.context,
                chats.finishNoteDeletion({ noteId: saved.note.id, attempt: 1 }).pipe(Effect.asVoid)
              );

              expect(yield* chats.noteDeletion(saved.note.id)).toStrictEqual(retry);

              assert.notStrictEqual(
                fixture.context.db.orm
                  .select()
                  .from(s.material_generation_requests)
                  .where(eq(s.material_generation_requests.id, saved.request.id))
                  .get()?.payload,
                '{}'
              );
              // Replayed old handler cannot run its Activity against the newer attempt either.
              yield* engine.execute(noteDeletionWorkflow, {
                executionId: 'stale-handler',
                payload: { event }
              });

              expect(yield* chats.noteDeletion(saved.note.id)).toStrictEqual(retry);

              yield* engine.execute(noteDeletionWorkflow, {
                executionId: 'current-cleanup',
                payload: { event: deletionEvent(fixture, saved.note.id) }
              });

              const completed = yield* chats.noteDeletion(saved.note.id);

              assert.ok(completed.status === 'completed');

              assert.strictEqual(completed.attempt, 2);

              expect(
                yield* chats.failNoteDeletion({
                  noteId: saved.note.id,
                  errorKind: 'internal',
                  attempt: 1
                })
              ).toStrictEqual(completed);

              expect(yield* chats.retryNoteDeletion(saved.note.id)).toStrictEqual(completed);

              assert.strictEqual(deletionEvents(fixture).length, 2);
            }).pipe(Effect.provide(fixture.services()))
          )
        );

        assertScrubbed(fixture, marker);

        fixture.reopen();

        assertScrubbed(fixture, marker);
      } finally {
        await fixture.close();
      }
    }
  );
}

function deletionEvents(fixture: Awaited<ReturnType<typeof pageTransformFixture>>) {
  return fixture.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.type, 'NoteDeletionRequested'))
    .all();
}

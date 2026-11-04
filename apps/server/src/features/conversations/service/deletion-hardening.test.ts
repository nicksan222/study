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

import assert from 'node:assert/strict';

import { sessionDeletionRequestedSchema } from '@study/contracts/events';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Deferred, Effect, Exit, Option } from 'effect';
import { DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import {
  SessionDeletionStore,
  SessionDeletionOwnershipStore,
  SessionDeletionCorrelationStore
} from '#server/features/conversations/store/deletion';
import {
  sessionDeletionWorkflow,
  sessionDeletionHandler
} from '#server/features/conversations/workflows/deletion';
import { Workflows } from '#server/features/workflows/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';
import { documentTransformFixture } from '#testing/document-transform';
import { withTestPublication } from '#testing/publication';
import { setup, deletionEvent, assertScrubbed, awaitNativeStatus } from '#testing/session-deletion';

testStable(
  'canonical status, ownership and correlation queries bind directly with typed aggregate results',
  async () => {
    const fixture = await documentTransformFixture();

    try {
      const saved = await setup(fixture, 'DIRECT_QUERY_BINDING_8');

      await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* useStore(SessionDeletionStore);

          const ownership = yield* useStore(SessionDeletionOwnershipStore);

          const correlations = yield* useStore(SessionDeletionCorrelationStore);

          assert.ok(Option.isNone(yield* status.findSessionDeletion(saved.session.id)));

          assert.equal(
            (yield* Effect.flip(status.sessionDeletion(saved.session.id))).kind,
            'not_found'
          );

          const owned = yield* ownership.deletionOwnership(saved.session.id);

          assert.ok(owned.contextIds.includes(saved.capture.requestId));

          assert.ok(owned.correlations.includes(saved.capture.requestId));

          const accepted = yield* (yield* Conversations).deleteSession(saved.session.id);

          const retained = yield* correlations.deletionCorrelation(saved.session.id);

          assert.equal(
            (yield* status.sessionDeletion(saved.session.id)).operationId,
            accepted.operationId
          );

          assert.ok(retained.correlations.includes(saved.request.id));

          assert.ok(retained.correlations.includes(saved.capture.requestId));

          assert.deepEqual((yield* ownership.deletionOwnership(saved.session.id)).contextIds, []);

          assert.deepEqual(
            yield* transaction((tx) =>
              tx.store(SessionDeletionCorrelationStore).deletionCorrelation(saved.session.id)
            ),
            retained
          );
        }).pipe(Effect.provide(fixture.domain()))
      );

      fixture.reopen();

      await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* useStore(SessionDeletionStore);

          const correlations = yield* useStore(SessionDeletionCorrelationStore);

          assert.equal((yield* status.sessionDeletion(saved.session.id)).attempt, 1);

          assert.ok(
            (yield* correlations.deletionCorrelation(saved.session.id)).correlations.includes(
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
      const fixture = await documentTransformFixture();

      const marker = `ATTEMPT_FENCE_${state}_8`;

      try {
        const saved = await setup(fixture, marker);

        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const chats = yield* Conversations;

              const engine = yield* WorkflowEngine.WorkflowEngine;

              const accepted = yield* chats.deleteSession(saved.session.id);

              const event = deletionEvent(fixture, saved.session.id);

              const entered = yield* Deferred.make<void>();

              const release = yield* Deferred.make<void>();

              const durable = DurableDeferred.make('hold-deletion-owner');

              const probe = Workflow.make('session-deletion-owner-probe', {
                payload: { event: sessionDeletionRequestedSchema },
                idempotencyKey: ({ event }) => event.eventId
              });

              let currentRuns = 0;

              yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));

              const probeHandler = Effect.fn(function* ({
                event: value
              }: {
                event: typeof sessionDeletionRequestedSchema.Type;
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

              yield* engine.register(sessionDeletionWorkflow, sessionDeletionHandler);
              // A terminal run from another event in this operation does not prove dispatch of attempt 1.
              yield* engine.execute(probe, {
                executionId: 'older-terminal',
                payload: { event: { ...event, eventId: `${accepted.operationId}/older` } }
              });

              assert.deepEqual(yield* chats.retrySessionDeletion(saved.session.id), accepted);

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

              assert.deepEqual(runs.map((run) => run.id).sort(), [
                'current-held',
                'current-terminal'
              ]);

              assert.equal(
                (yield* transaction((tx) =>
                  Workflows.correlatedExecutions(tx, accepted.operationId)
                )).length,
                3
              );

              assert.deepEqual(yield* chats.retrySessionDeletion(saved.session.id), accepted);

              assert.equal(deletionEvents(fixture).length, 1);

              if (state === 'running') yield* Deferred.succeed(release, undefined);
              else
                yield* engine.deferredDone(durable, {
                  workflowName: probe._tag,
                  executionId: 'current-held',
                  deferredName: durable.name,
                  exit: Exit.void
                });

              yield* awaitNativeStatus(fixture, 'current-held', 'completed');

              const retry = yield* chats.retrySessionDeletion(saved.session.id);

              assert.equal(retry.operationId, accepted.operationId);

              assert.equal(retry.attempt, 2);

              assert.equal(deletionEvents(fixture).length, 2);
              // No attempt-2 execution exists yet: old terminal owners cannot cause a third attempt.
              assert.deepEqual(yield* chats.retrySessionDeletion(saved.session.id), retry);

              assert.deepEqual(
                yield* chats.failSessionDeletion({
                  sessionId: saved.session.id,
                  errorKind: 'internal',
                  attempt: 1
                }),
                retry
              );

              yield* withTestPublication(
                fixture.context,
                chats
                  .finishSessionDeletion({ sessionId: saved.session.id, attempt: 1 })
                  .pipe(Effect.asVoid)
              );

              assert.deepEqual(yield* chats.sessionDeletion(saved.session.id), retry);

              assert.notEqual(
                fixture.context.db.orm
                  .select()
                  .from(s.material_generation_requests)
                  .where(eq(s.material_generation_requests.id, saved.request.id))
                  .get()?.payload,
                '{}'
              );
              // Replayed old handler cannot run its Activity against the newer attempt either.
              yield* engine.execute(sessionDeletionWorkflow, {
                executionId: 'stale-handler',
                payload: { event }
              });

              assert.deepEqual(yield* chats.sessionDeletion(saved.session.id), retry);

              yield* engine.execute(sessionDeletionWorkflow, {
                executionId: 'current-cleanup',
                payload: { event: deletionEvent(fixture, saved.session.id) }
              });

              const completed = yield* chats.sessionDeletion(saved.session.id);

              assert.equal(completed.status, 'completed');

              assert.equal(completed.attempt, 2);

              assert.deepEqual(
                yield* chats.failSessionDeletion({
                  sessionId: saved.session.id,
                  errorKind: 'internal',
                  attempt: 1
                }),
                completed
              );

              assert.deepEqual(yield* chats.retrySessionDeletion(saved.session.id), completed);

              assert.equal(deletionEvents(fixture).length, 2);
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

function deletionEvents(fixture: Awaited<ReturnType<typeof documentTransformFixture>>) {
  return fixture.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.type, 'SessionDeletionRequested'))
    .all();
}

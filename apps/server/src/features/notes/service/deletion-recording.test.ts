import { failureSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises recording deletion between source import and late note                   │
 * │ publication.                                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks native cancellation, checkpoint fences and independent source task survival.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The fixture owns timing gates while real recording and source services own mutations.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { sourceProcessingRequestedSchema } from '@study/contracts';
import { sourceIdSchema } from '@study/contracts';
import { eq } from '@study/db';
import * as s from '@study/db';
import { test } from '@study/testing';
import { Effect, Exit, Schema } from 'effect';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';

import { Notes } from '#server/features/notes/index';
import {
  noteDeletionHandler,
  noteDeletionWorkflow
} from '#server/features/notes/workflows/deletion';
import { Recordings } from '#server/features/recordings/index';
import { recordingPostSnapshotSchema } from '#server/features/recordings/store/schemas';
import {
  recordingPostHandler,
  recordingPostWorkflow
} from '#server/features/recordings/workflows/index';
import { Sources } from '#server/features/sources/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { workflowStore } from '#server/platform/workflows/store';
import { admitPending } from '#server/platform/workflows/triggers';
import { setup, deletionEvent, assertScrubbed, awaitNativeStatus } from '#testing/note-deletion';
import { pageTransformFixture } from '#testing/page-transform';
import { withTestPublication } from '#testing/publication';
import { withTestAdmission } from '#testing/workflow-admission';

test.server.stable(
  'deleting an in-flight recording fences late attachment and checkpoints while its independent source work survives',
  async ({ databases, assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const fixture = await pageTransformFixture(databases);

    const marker = 'INFLIGHT_RECORDING_SESSION_PRIVATE_8';

    try {
      const saved = await setup(fixture, assert, marker);

      const post = await Effect.runPromise(
        Effect.gen(function* () {
          const recordings = yield* Recordings;

          const recording = yield* recordings.createRecording(saved.note.id);

          yield* recordings.appendRecording({ id: recording.id, samples: [-32768, 0, 32767] });

          return yield* recordings.postRecording({
            note: saved.note.id,
            recording: recording.id,
            name: 'independent-audio.wav'
          });
        }).pipe(Effect.provide(fixture.domain()))
      );

      const persistedEvent = fixture.context.db.orm
        .select()
        .from(s.workflowEvents)
        .where(eq(s.workflowEvents.eventId, post.requestId))
        .get();

      assert.ok(persistedEvent);

      const event = decodeEvent(persistedEvent.payload);

      assert.ok(!(event.type !== 'RecordingPostRequested'), 'Expected recording event');

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            const chats = yield* Notes;

            const recordings = yield* Recordings;

            const sources = yield* Sources;

            const recordingGate = DurableDeferred.make('recording-after-import');

            const sourceGate = DurableDeferred.make('independent-source-reader');

            const sourceReader = Workflow.make('independent-recording-source-reader', {
              payload: { event: sourceProcessingRequestedSchema },
              idempotencyKey: ({ event }) => event.eventId,
              success: Schema.Uint8Array,
              error: failureSchema
            });

            // Real snapshot/import Activities establish the publication boundary before the
            // recording handler attaches a message. This native fixture owns the timing gate.
            const heldRecordingHandler = Effect.fn(function* (
              payload: Parameters<typeof recordingPostHandler>[0]
            ) {
              const snapshot = yield* Activity.make({
                name: 'captured-recording',
                success: recordingPostSnapshotSchema,
                error: failureSchema,
                execute: recordings.recordingPostSnapshot({ requestId: payload.event.requestId })
              });

              yield* Activity.make({
                name: 'import-recording',
                success: sourceIdSchema,
                error: failureSchema,
                execute: withPublicationGuard(
                  fixture.context,
                  sources.importRecording({
                    requestId: payload.event.requestId,
                    noteId: snapshot.noteId,
                    projectId: snapshot.projectId,
                    name: snapshot.name,
                    bytes: snapshot.bytes,
                    durationMs: snapshot.durationMs
                  })
                ).pipe(Effect.map(importedSourceId))
              });

              yield* DurableDeferred.await(recordingGate);

              return yield* recordingPostHandler(payload);
            });

            yield* engine.register(recordingPostWorkflow, heldRecordingHandler);

            const heldSourceHandler = Effect.fn(function* ({
              event: value
            }: {
              event: typeof sourceProcessingRequestedSchema.Type;
            }) {
              const snapshot = yield* sources.sourceSnapshot({
                id: value.sourceId,
                revision: value.inputVersion
              });

              yield* DurableDeferred.await(sourceGate);

              return snapshot.bytes;
            });

            yield* engine.register(sourceReader, heldSourceHandler);

            yield* engine.register(noteDeletionWorkflow, noteDeletionHandler);

            yield* withTestAdmission(
              fixture.context,
              recordingPostWorkflow,
              'recording-in-flight',
              { event },
              engine.execute(recordingPostWorkflow, {
                executionId: 'recording-in-flight',
                payload: { event },
                discard: true
              })
            );

            yield* awaitNativeStatus(fixture, 'recording-in-flight', 'suspended');

            const imported = fixture.context.db.orm.select().from(s.source_recording_imports).get();

            assert.ok(imported);

            const snapshot = yield* sources.sourceSnapshot({ id: imported.source_id, revision: 1 });

            const sourceEventRow = fixture.context.db.orm
              .select()
              .from(s.workflowEvents)
              .where(eq(s.workflowEvents.type, 'SourceProcessingRequested'))
              .get();

            assert.ok(sourceEventRow);

            const sourceEvent = decodeEvent(sourceEventRow.payload);

            assert.ok(!(sourceEvent.type !== 'SourceProcessingRequested'), 'Expected source event');

            assert.strictEqual(sourceEvent.correlationId, event.correlationId);

            yield* withTestAdmission(
              fixture.context,
              sourceReader,
              'shared-source-reader',
              { event: sourceEvent },
              engine.execute(sourceReader, {
                executionId: 'shared-source-reader',
                payload: { event: sourceEvent },
                discard: true
              })
            );

            yield* awaitNativeStatus(fixture, 'shared-source-reader', 'suspended');

            yield* chats.deleteNote(saved.note.id);

            yield* withTestAdmission(
              fixture.context,
              noteDeletionWorkflow,
              'recording-cleanup',
              { event: deletionEvent(fixture, saved.note.id, assert) },
              engine.execute(noteDeletionWorkflow, {
                executionId: 'recording-cleanup',
                payload: { event: deletionEvent(fixture, saved.note.id, assert) }
              })
            );

            assert.ok((yield* chats.noteDeletion(saved.note.id)).status === 'completed');

            assert.ok(
              workflowStore(fixture.context).execution('recording-in-flight')?.status ===
                'cancelled'
            );

            assert.ok(
              workflowStore(fixture.context).execution('shared-source-reader')?.status ===
                'suspended'
            );

            assert.strictEqual(fixture.context.db.orm.select().from(s.recordings).all().length, 0);

            assert.strictEqual(
              fixture.context.db.orm.select().from(s.recording_chunks).all().length,
              0
            );

            assert.strictEqual(
              fixture.context.db.orm.select().from(s.recording_posts).all().length,
              0
            );

            assert.strictEqual(
              fixture.context.db.orm.select().from(s.note_recording_posts).all().length,
              0
            );

            yield* engine.deferredDone(recordingGate, {
              workflowName: recordingPostWorkflow._tag,
              executionId: 'recording-in-flight',
              deferredName: recordingGate.name,
              exit: Exit.void
            });

            assert.strictEqual(workflowStore(fixture.context).retired('recording-in-flight'), true);

            const rejected = yield* Effect.flip(
              withTestPublication(
                fixture.context,
                chats
                  .postRecordingMessage({
                    requestId: event.requestId,
                    noteId: saved.note.id,
                    projectId: null,
                    sourceId: imported.source_id,
                    durationMs: 0
                  })
                  .pipe(Effect.asVoid)
              )
            );

            assert.ok(rejected.kind === 'invalid_input');

            yield* engine.deferredDone(sourceGate, {
              workflowName: sourceReader._tag,
              executionId: 'shared-source-reader',
              deferredName: sourceGate.name,
              exit: Exit.void
            });

            const bytes = yield* withTestAdmission(
              fixture.context,
              sourceReader,
              'shared-source-reader',
              { event: sourceEvent },
              engine.execute(sourceReader, {
                executionId: 'shared-source-reader',
                payload: { event: sourceEvent }
              })
            );

            expect(bytes).toStrictEqual(snapshot.bytes);

            expect(
              (yield* sources.sourceSnapshot({ id: imported.source_id, revision: 1 })).bytes
            ).toStrictEqual(snapshot.bytes);

            assert.strictEqual(
              fixture.context.db.orm.select().from(s.source_recording_imports).all().length,
              1
            );

            assert.strictEqual(
              fixture.context.db.orm
                .select()
                .from(s.workflowEvents)
                .where(eq(s.workflowEvents.eventId, sourceEvent.eventId))
                .get()?.payload,
              sourceEventRow.payload
            );
          }).pipe(Effect.provide(fixture.services()))
        )
      );

      assertScrubbed(fixture, assert, marker);

      await fixture.reopen();

      assert.strictEqual(
        admitPending(
          fixture.context,
          [
            {
              subscription: 'late-recording-dispatch',
              event: 'RecordingPostRequested',
              workflowVersion: 1,
              workflow: recordingPostWorkflow,
              enabled: () => true,
              emits: ['SourceProcessingRequested']
            }
          ],
          Date.now()
        ),
        0
      );

      const native = workflowStore(fixture.context);

      assert.throws(() => native.assertPublication('recording-in-flight', 1));

      assert.strictEqual(
        fixture.context.db.orm.select().from(s.note_recording_posts).all().length,
        0
      );

      assertScrubbed(fixture, assert, marker);
    } finally {
      await fixture.close();
    }
  }
);

function importedSourceId(source: { readonly id: typeof sourceIdSchema.Type }) {
  return source.id;
}

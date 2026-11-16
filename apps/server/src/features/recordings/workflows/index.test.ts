import { eq, sql } from '@study/db';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises recording publication workflows across note and source features          │
 * │ using real workflow and database layers.                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises exercises recording publication workflows across note and source             │
 * │   features using real workflow and database layers..                                     │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import * as tables from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Notes } from '#server/features/notes/index';
import { Projects } from '#server/features/projects/index';
import { Recordings } from '#server/features/recordings/service/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';
import { admitTestExecution } from '#testing/workflow-admission';

import { recordingPostHandler, recordingPostWorkflow } from './index.ts';

for (const deleteCommittedMessage of [false, true])
  test.stable(
    `same-version recording replay after reopen preserves ${deleteCommittedMessage ? 'deleted' : 'retained'} messages`,
    async ({ databases }) => {
      const location = await databases();
      let context = new ServerContext(await location.open());
      const services = () =>
        Layer.mergeAll(Projects.layer, Notes.layer, Sources.layer, Recordings.layer).pipe(
          Layer.provideMerge(Layer.succeed(Database, { store: context }))
        );

      try {
        const pending = await Effect.runPromise(
          Effect.gen(function* () {
            const projects = yield* Projects;
            const notes = yield* Notes;
            const recordings = yield* Recordings;
            const project = yield* projects.createProject({ name: 'Audio' });
            const note = yield* notes.createNote({
              project: project.id,
              title: 'Recording'
            });
            const other = yield* notes.createNote({
              project: project.id,
              title: 'Other'
            });
            const recording = yield* recordings.createRecording(note.id);

            yield* recordings.appendRecording({ id: recording.id, samples: [-32768, 0, 32767] });
            test.assert.strictEqual((yield* recordings.recording(recording.id)).samples, 3n);
            test.assert.ok(
              (yield* Effect.flip(
                recordings.postRecording({
                  note: other.id,
                  recording: recording.id,
                  name: 'wrong.wav'
                })
              )).kind === 'invalid_input'
            );
            context.db.orm.run(
              sql`CREATE TRIGGER fail_recording_event BEFORE INSERT ON workflow_events WHEN NEW.type='RecordingPostRequested' BEGIN SELECT RAISE(ABORT,'unavailable'); END`
            );
            yield* Effect.flip(
              recordings.postRecording({
                note: note.id,
                recording: recording.id,
                name: 'lecture.wav'
              })
            );
            test.assert.strictEqual(
              context.db.orm.select().from(tables.recording_posts).all().length,
              0
            );
            context.db.orm.run(sql`DROP TRIGGER fail_recording_event`);
            const input = { note: note.id, recording: recording.id, name: 'lecture.wav' };
            const post = yield* recordings.postRecording(input);

            test.expect(yield* recordings.postRecording(input)).toStrictEqual(post);
            test.assert.ok(
              (yield* Effect.flip(recordings.appendRecording({ id: recording.id, samples: [1] })))
                .kind === 'invalid_input'
            );
            test.assert.ok(
              (yield* Effect.flip(recordings.deleteRecording(recording.id))).kind ===
                'invalid_input'
            );
            test.assert.strictEqual(
              context.db.orm.select().from(tables.recording_posts).all().length,
              1
            );
            test.assert.throws(() =>
              context.db.orm.run(
                sql`UPDATE recording_chunks SET pcm=x'0100' WHERE recording_id=${recording.id}`
              )
            );
            test.assert.throws(() =>
              context.db.orm.run(
                sql`UPDATE recordings SET note_id=${other.id} WHERE id=${recording.id}`
              )
            );
            test.assert.throws(() =>
              context.db.orm.run(
                sql`UPDATE recording_posts SET name='changed.wav' WHERE recording_id=${recording.id}`
              )
            );

            return { post, project, note };
          }).pipe(Effect.provide(services()))
        );
        const event = decodeEvent(
          context.db.orm.select().from(tables.workflowEvents).all().at(-1)!.payload
        );

        test.assert.ok(!(event.type !== 'RecordingPostRequested'), 'unexpected event');

        const execute = () =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const engine = yield* WorkflowEngine.WorkflowEngine;

                admitTestExecution(context, recordingPostWorkflow, event.requestId, { event });
                yield* engine.register(recordingPostWorkflow, recordingPostHandler);

                return yield* engine.execute(recordingPostWorkflow, {
                  executionId: event.requestId,
                  payload: { event }
                });
              }).pipe(
                Effect.provide(
                  Layer.mergeAll(
                    services(),
                    Layer.succeed(Database, { store: context }),
                    workflowEngineLayer(context)
                  )
                )
              )
            )
          );

        const committedResult = await execute();

        test.assert.strictEqual(
          context.db.orm.select().from(tables.source_recording_imports).all().length,
          1
        );
        test.assert.strictEqual(
          context.db.orm.select().from(tables.note_recording_posts).all().length,
          1
        );

        if (deleteCommittedMessage) {
          const committed = context.db.orm.select().from(tables.note_recording_posts).all()[0]!;

          await Effect.runPromise(
            Effect.flatMap(Notes, (service) => service.deleteMessage(committed.message_id)).pipe(
              Effect.provide(services())
            )
          );
        }

        context.close();
        context = new ServerContext(await location.open());
        const result = await execute();

        test.expect(result).toStrictEqual(committedResult);
        test.assert.ok(result.messageId);
        test.assert.ok(result.sourceId);
        test.expect(await execute()).toStrictEqual(result);
        test.assert.strictEqual(context.db.orm.select().from(tables.sources).all().length, 1);
        const caused = context.db.orm
          .select()
          .from(tables.workflowEvents)
          .all()
          .map((row) => decodeEvent(row.payload))
          .find((item) => item.type === 'SourceProcessingRequested');

        test.assert.strictEqual(caused?.causationId, event.eventId);
        test.assert.strictEqual(caused?.correlationId, event.correlationId);
        test.assert.strictEqual(caused?.depth, 1);
        test.assert.strictEqual(
          context.db.orm.select().from(tables.messages).all().length,
          deleteCommittedMessage ? 0 : 1
        );
        const blob = context.db.orm.select().from(tables.source_blobs).all()[0]!;

        test.expect([...blob.bytes.subarray(44)]).toStrictEqual([0, 128, 0, 0, 255, 127]);
        test.assert.throws(() =>
          context.db.orm.run(
            sql`UPDATE source_blobs SET bytes=x'0100' WHERE source_id=${result.sourceId}`
          )
        );
        test.assert.throws(() =>
          context.db.orm.run(sql`DELETE FROM source_blobs WHERE source_id=${result.sourceId}`)
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const recordings = yield* Recordings;

            test
              .expect(yield* recordings.recordingPost({ requestId: result.requestId }))
              .toStrictEqual(result);
            test.assert.strictEqual((yield* recordings.recordings({ limit: 10 })).items.length, 0);
            const messages = yield* (yield* Notes).thread({
              noteId: pending.note.id,
              limit: 10
            });

            test.assert.strictEqual(messages.items.length, deleteCommittedMessage ? 0 : 1);

            if (!deleteCommittedMessage)
              test.assert.strictEqual(messages.items[0]?.recordedIn, result.sourceId);

            if (!deleteCommittedMessage) {
              const notes = yield* Notes;
              const other = yield* notes.createNote({ title: 'Merge partner' });
              const merged = yield* notes.mergeNotes({
                noteIds: [pending.note.id, other.id],
                intentKey: 'recording-merge'
              });
              const copied = context.db.orm
                .select()
                .from(tables.recordings)
                .where(eq(tables.recordings.note_id, merged.id))
                .get()!;

              test.expect(copied.id).not.toBe(pending.post.recordingId);
              test.expect((yield* recordings.recording(copied.id)).samples).toBe(3n);
              test.expect((yield* recordings.recordings({ limit: 100 })).items).toHaveLength(0);
              test
                .expect(
                  (yield* Effect.flip(recordings.appendRecording({ id: copied.id, samples: [1] })))
                    .kind
                )
                .toBe('invalid_input');
              test
                .expect((yield* Effect.flip(recordings.deleteRecording(copied.id))).kind)
                .toBe('invalid_input');
              test
                .expect(
                  (yield* Effect.flip(
                    recordings.postRecording({
                      note: merged.id,
                      recording: copied.id,
                      name: 'duplicate.wav'
                    })
                  )).kind
                )
                .toBe('invalid_input');
              test
                .expect(
                  (yield* notes.thread({ noteId: merged.id, limit: 100 })).items[0]?.recordedIn
                )
                .toBe(result.sourceId);
            }

            yield* (yield* Projects).deleteProject({ id: pending.project.id });
            test.assert.strictEqual(
              context.db.orm.select().from(tables.recording_posts).all().length,
              1
            );
            test.assert.strictEqual(
              context.db.orm.select().from(tables.note_recording_posts).all().length,
              1
            );
            test.assert.strictEqual(
              context.db.orm.select().from(tables.source_recording_imports).all().length,
              1
            );
          }).pipe(Effect.provide(services()))
        );
      } finally {
        context.close();
        await location.cleanup();
      }
    }
  );

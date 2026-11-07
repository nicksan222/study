/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises recording publication workflows across conversation and source features  │
 * │ using real workflow and database layers.                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises exercises recording publication workflows across conversation and source     │
 * │   features using real workflow and database layers..                                     │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { eq, sql } from '@study/db';
import * as tables from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Projects } from '#server/features/projects/index';
import { Recordings } from '#server/features/recordings/service/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';

import { recordingPostHandler, recordingPostWorkflow } from './index.ts';

for (const deleteCommittedMessage of [false, true])
  testStable(
    `recording replay after checkpoint failure preserves ${deleteCommittedMessage ? 'deleted' : 'retained'} messages`,
    async () => {
      const location = createTestDatabase();
      let context = new ServerContext(location.open());
      const services = () =>
        Layer.mergeAll(Projects.layer, Conversations.layer, Sources.layer, Recordings.layer).pipe(
          Layer.provideMerge(Layer.succeed(Database, { store: context }))
        );

      try {
        const pending = await Effect.runPromise(
          Effect.gen(function* () {
            const projects = yield* Projects;
            const conversations = yield* Conversations;
            const recordings = yield* Recordings;
            const project = yield* projects.createProject({ name: 'Audio' });
            const session = yield* conversations.createSession({
              project: project.id,
              title: 'Recording'
            });
            const other = yield* conversations.createSession({
              project: project.id,
              title: 'Other'
            });
            const recording = yield* recordings.createRecording(session.id);

            yield* recordings.appendRecording({ id: recording.id, samples: [-32768, 0, 32767] });
            assert.strictEqual((yield* recordings.recording(recording.id)).samples, 3n);
            assert.ok(
              (yield* Effect.flip(
                recordings.postRecording({
                  session: other.id,
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
                session: session.id,
                recording: recording.id,
                name: 'lecture.wav'
              })
            );
            assert.strictEqual(
              context.db.orm.select().from(tables.recording_posts).all().length,
              0
            );
            context.db.orm.run(sql`DROP TRIGGER fail_recording_event`);
            const input = { session: session.id, recording: recording.id, name: 'lecture.wav' };
            const post = yield* recordings.postRecording(input);

            expect(yield* recordings.postRecording(input)).toStrictEqual(post);
            assert.ok(
              (yield* Effect.flip(recordings.appendRecording({ id: recording.id, samples: [1] })))
                .kind === 'invalid_input'
            );
            assert.ok(
              (yield* Effect.flip(recordings.deleteRecording(recording.id))).kind ===
                'invalid_input'
            );
            assert.strictEqual(
              context.db.orm.select().from(tables.recording_posts).all().length,
              1
            );
            assert.throws(() =>
              context.db.orm.run(
                sql`UPDATE recording_chunks SET pcm=x'0100' WHERE recording_id=${recording.id}`
              )
            );
            assert.throws(() =>
              context.db.orm.run(
                sql`UPDATE recordings SET session_id=${other.id} WHERE id=${recording.id}`
              )
            );
            assert.throws(() =>
              context.db.orm.run(
                sql`UPDATE recording_posts SET name='changed.wav' WHERE recording_id=${recording.id}`
              )
            );

            return { post, project, session };
          }).pipe(Effect.provide(services()))
        );
        const event = decodeEvent(
          context.db.orm.select().from(tables.workflowEvents).all().at(-1)!.payload
        );

        assert.ok(!(event.type !== 'RecordingPostRequested'), 'unexpected event');

        const execute = () =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const engine = yield* WorkflowEngine.WorkflowEngine;

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

        context.db.orm.run(
          sql`CREATE TRIGGER fail_recording_checkpoint BEFORE INSERT ON workflow_activities WHEN NEW.name='attach-recording' BEGIN SELECT RAISE(ABORT,'checkpoint unavailable'); END`
        );
        await expect(execute()).rejects.toSatisfy(() => true);
        assert.strictEqual(
          context.db.orm.select().from(tables.source_recording_imports).all().length,
          1
        );
        assert.strictEqual(
          context.db.orm.select().from(tables.conversation_recording_posts).all().length,
          1
        );

        if (deleteCommittedMessage) {
          const committed = context.db.orm
            .select()
            .from(tables.conversation_recording_posts)
            .all()[0]!;

          await Effect.runPromise(
            Effect.flatMap(Conversations, (service) =>
              service.deleteMessage(committed.message_id)
            ).pipe(Effect.provide(services()))
          );
        }

        context.db.orm.run(sql`DROP TRIGGER fail_recording_checkpoint`);
        context.db.orm.run(
          sql`UPDATE workflow_executions SET status='suspended',result=NULL,owner_token=NULL WHERE execution_id=${event.requestId}`
        );
        context.close();
        context = new ServerContext(location.open());
        const result = await execute();

        assert.ok(result.messageId);
        assert.ok(result.sourceId);
        expect(await execute()).toStrictEqual(result);
        assert.strictEqual(context.db.orm.select().from(tables.sources).all().length, 1);
        const caused = context.db.orm
          .select()
          .from(tables.workflowEvents)
          .all()
          .map((row) => decodeEvent(row.payload))
          .find((item) => item.type === 'SourceProcessingRequested');

        assert.strictEqual(caused?.causationId, event.eventId);
        assert.strictEqual(caused?.correlationId, event.correlationId);
        assert.strictEqual(caused?.depth, 1);
        assert.strictEqual(
          context.db.orm.select().from(tables.messages).all().length,
          deleteCommittedMessage ? 0 : 1
        );
        const blob = context.db.orm.select().from(tables.source_blobs).all()[0]!;

        expect([...blob.bytes.subarray(44)]).toStrictEqual([0, 128, 0, 0, 255, 127]);
        assert.throws(() =>
          context.db.orm.run(
            sql`UPDATE source_blobs SET bytes=x'0100' WHERE source_id=${result.sourceId}`
          )
        );
        assert.throws(() =>
          context.db.orm.run(sql`DELETE FROM source_blobs WHERE source_id=${result.sourceId}`)
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const recordings = yield* Recordings;

            expect(yield* recordings.recordingPost({ requestId: result.requestId })).toStrictEqual(
              result
            );
            assert.strictEqual((yield* recordings.recordings({ limit: 10 })).items.length, 0);
            const messages = yield* (yield* Conversations).thread({
              sessionId: pending.session.id,
              limit: 10
            });

            assert.strictEqual(messages.items.length, deleteCommittedMessage ? 0 : 1);

            if (!deleteCommittedMessage)
              assert.strictEqual(messages.items[0]?.recordedIn, result.sourceId);

            if (!deleteCommittedMessage) {
              const conversations = yield* Conversations;
              const other = yield* conversations.createSession({ title: 'Merge partner' });
              const merged = yield* conversations.mergeSessions({
                sessionIds: [pending.session.id, other.id],
                intentKey: 'recording-merge'
              });
              const copied = context.db.orm
                .select()
                .from(tables.recordings)
                .where(eq(tables.recordings.session_id, merged.id))
                .get()!;

              expect(copied.id).not.toBe(pending.post.recordingId);
              expect((yield* recordings.recording(copied.id)).samples).toBe(3n);
              expect((yield* recordings.recordings({ limit: 100 })).items).toHaveLength(0);
              expect(
                (yield* Effect.flip(recordings.appendRecording({ id: copied.id, samples: [1] })))
                  .kind
              ).toBe('invalid_input');
              expect((yield* Effect.flip(recordings.deleteRecording(copied.id))).kind).toBe(
                'invalid_input'
              );
              expect(
                (yield* Effect.flip(
                  recordings.postRecording({
                    session: merged.id,
                    recording: copied.id,
                    name: 'duplicate.wav'
                  })
                )).kind
              ).toBe('invalid_input');
              expect(
                (yield* conversations.thread({ sessionId: merged.id, limit: 100 })).items[0]
                  ?.recordedIn
              ).toBe(result.sourceId);
            }

            yield* (yield* Projects).deleteProject({ id: pending.project.id });
            assert.strictEqual(
              context.db.orm.select().from(tables.recording_posts).all().length,
              1
            );
            assert.strictEqual(
              context.db.orm.select().from(tables.conversation_recording_posts).all().length,
              1
            );
            assert.strictEqual(
              context.db.orm.select().from(tables.source_recording_imports).all().length,
              1
            );
          }).pipe(Effect.provide(services()))
        );
      } finally {
        context.close();
        location.cleanup();
      }
    }
  );

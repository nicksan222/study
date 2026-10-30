import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sql } from '@study/db';
import * as tables from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

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
  test(`recording replay after checkpoint failure preserves ${deleteCommittedMessage ? 'deleted' : 'retained'} messages`, async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const services = () =>
      Layer.mergeAll(Projects.layer, Conversations.layer, Sources.layer, Recordings.layer).pipe(
        Layer.provide(Layer.succeed(Database, { store: context }))
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
          const other = yield* conversations.createSession({ project: project.id, title: 'Other' });
          const recording = yield* recordings.createRecording(session.id);

          yield* recordings.appendRecording({ id: recording.id, samples: [-32768, 0, 32767] });
          assert.equal((yield* recordings.recording(recording.id)).samples, 3n);
          assert.equal(
            (yield* Effect.flip(
              recordings.postRecording({
                session: other.id,
                recording: recording.id,
                name: 'wrong.wav'
              })
            )).kind,
            'invalid_input'
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
          assert.equal(context.db.orm.select().from(tables.recording_posts).all().length, 0);
          context.db.orm.run(sql`DROP TRIGGER fail_recording_event`);
          const input = { session: session.id, recording: recording.id, name: 'lecture.wav' };
          const post = yield* recordings.postRecording(input);

          assert.deepEqual(yield* recordings.postRecording(input), post);
          assert.equal(
            (yield* Effect.flip(recordings.appendRecording({ id: recording.id, samples: [1] })))
              .kind,
            'invalid_input'
          );
          assert.equal(
            (yield* Effect.flip(recordings.deleteRecording(recording.id))).kind,
            'invalid_input'
          );
          assert.equal(context.db.orm.select().from(tables.recording_posts).all().length, 1);
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

      if (event.type !== 'RecordingPostRequested') throw new Error('unexpected event');

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
      await assert.rejects(execute());
      assert.equal(context.db.orm.select().from(tables.source_recording_imports).all().length, 1);
      assert.equal(
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
      assert.deepEqual(await execute(), result);
      assert.equal(context.db.orm.select().from(tables.sources).all().length, 1);
      const caused = context.db.orm
        .select()
        .from(tables.workflowEvents)
        .all()
        .map((row) => decodeEvent(row.payload))
        .find((item) => item.type === 'SourceProcessingRequested');

      assert.equal(caused?.causationId, event.eventId);
      assert.equal(caused?.correlationId, event.correlationId);
      assert.equal(caused?.depth, 1);
      assert.equal(
        context.db.orm.select().from(tables.messages).all().length,
        deleteCommittedMessage ? 0 : 1
      );
      const blob = context.db.orm.select().from(tables.source_blobs).all()[0]!;

      assert.deepEqual([...blob.bytes.subarray(44)], [0, 128, 0, 0, 255, 127]);
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

          assert.deepEqual(
            yield* recordings.recordingPost({ requestId: result.requestId }),
            result
          );
          assert.equal((yield* recordings.recordings({ limit: 10 })).items.length, 0);
          const messages = yield* (yield* Conversations).thread({
            sessionId: pending.session.id,
            limit: 10
          });

          assert.equal(messages.items.length, deleteCommittedMessage ? 0 : 1);

          if (!deleteCommittedMessage) assert.equal(messages.items[0]?.recordedIn, result.sourceId);

          yield* (yield* Projects).deleteProject({ id: pending.project.id });
          assert.equal(context.db.orm.select().from(tables.recording_posts).all().length, 0);
          assert.equal(
            context.db.orm.select().from(tables.conversation_recording_posts).all().length,
            0
          );
          assert.equal(
            context.db.orm.select().from(tables.source_recording_imports).all().length,
            0
          );
        }).pipe(Effect.provide(services()))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  });

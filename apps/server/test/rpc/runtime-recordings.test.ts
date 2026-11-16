import { StudyRpc } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Captures and posts a recording over native RPC, then verifies the worker publishes │
 * │ a WAV-backed source and note message. Repeating the post request returns the             │
 * │ same durable result.                                                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: HTTP recording capture hands durable WAV publication to the native worker.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { serve } from '#server/runtime/index';

test.stable(
  'HTTP recording capture hands durable WAV publication to the native worker',
  { timeout: 10000 },
  async ({ resources: location }) => {
    const app = await location.openApp({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'Recording' });
            const note = yield* client['notes.createNote']({
              project: project.id,
              title: 'Audio'
            });
            const recording = yield* client['recordings.createRecording']({ id: note.id });

            yield* client['recordings.appendRecording']({
              id: recording.id,
              samples: [-32768, 0, 32767]
            });
            test.assert.strictEqual(
              (yield* client['recordings.recording']({ id: recording.id })).samples,
              3n
            );
            const post = yield* client['recordings.postRecording']({
              note: note.id,
              recording: recording.id,
              name: 'Lecture.wav'
            });

            const result = yield* test.pollUntil(
              client['recordings.recordingPost']({ requestId: post.requestId }),
              (value) => value.messageId !== null,
              { attempts: 100, interval: '25 millis', message: 'Recording was not posted' }
            );

            test.assert.ok(result.messageId !== null);
            const message = yield* client['notes.message']({ id: result.messageId });

            test.assert.strictEqual(message.recordedIn, result.sourceId);
            test.assert.strictEqual(message.parts[0]?.sourceId, result.sourceId);
            test.assert.strictEqual(
              (yield* client['recordings.recordings']({ limit: 10 })).items.length,
              0
            );
            const replayed = yield* client['recordings.postRecording']({
              note: note.id,
              recording: recording.id,
              name: 'Lecture.wav'
            });

            test.expect(replayed).toStrictEqual(result);
            test.assert.strictEqual(
              (yield* client['notes.thread']({ noteId: note.id, limit: 10 })).items.length,
              1
            );

            return;
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await location.close();
    }
  }
);

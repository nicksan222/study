/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Captures and posts a recording over native RPC, then verifies the worker publishes │
 * │ a WAV-backed source and conversation message. Repeating the post request returns the     │
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

import { StudyRpc } from '@study/contracts/rpc';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

testStable(
  'HTTP recording capture hands durable WAV publication to the native worker',
  { timeout: 10000 },
  async () => {
    const location = createTestDatabase();
    const app = await App.open({ path: location.path });
    const server = await serve(app);

    await app.workers.start();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const project = yield* client['projects.createProject']({ name: 'Recording' });
            const session = yield* client['conversations.createSession']({
              project: project.id,
              title: 'Audio'
            });
            const recording = yield* client['recordings.createRecording']({ id: session.id });

            yield* client['recordings.appendRecording']({
              id: recording.id,
              samples: [-32768, 0, 32767]
            });
            assert.strictEqual(
              (yield* client['recordings.recording']({ id: recording.id })).samples,
              3n
            );
            const post = yield* client['recordings.postRecording']({
              session: session.id,
              recording: recording.id,
              name: 'Lecture.wav'
            });

            for (let attempt = 0; attempt < 100; attempt++) {
              const result = yield* client['recordings.recordingPost']({
                requestId: post.requestId
              });

              if (result.messageId !== null) {
                const message = yield* client['conversations.message']({ id: result.messageId });

                assert.strictEqual(message.recordedIn, result.sourceId);
                assert.strictEqual(message.parts[0]?.sourceId, result.sourceId);
                assert.strictEqual(
                  (yield* client['recordings.recordings']({ limit: 10 })).items.length,
                  0
                );
                const replayed = yield* client['recordings.postRecording']({
                  session: session.id,
                  recording: recording.id,
                  name: 'Lecture.wav'
                });

                expect(replayed).toStrictEqual(result);
                assert.strictEqual(
                  (yield* client['conversations.thread']({ sessionId: session.id, limit: 10 }))
                    .items.length,
                  1
                );

                return;
              }

              yield* Effect.sleep('25 millis');
            }

            assert.fail('Recording was not posted');
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      location.cleanup();
    }
  }
);

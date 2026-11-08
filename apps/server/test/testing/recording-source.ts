/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Publishes a real recording Source while preserving independently owned note        │
 * │ audio.                                                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Prepares independent retained inputs through real feature services.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Test callers own isolated SQLite lifetimes and explicitly control provider responses.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { Notes } from '#server/features/notes/index';
import { Recordings } from '#server/features/recordings/index';
import {
  recordingPostWorkflow,
  recordingPostHandler
} from '#server/features/recordings/workflows/index';
import { decodeEvent } from '#server/platform/workflows/events';
import type { pageTransformFixture } from '#testing/page-transform';

type SourceFixture = Awaited<ReturnType<typeof pageTransformFixture>>;

export async function recordingSource(f: SourceFixture) {
  const post = await Effect.runPromise(
    Effect.gen(function* () {
      const note = yield* (yield* Notes).createUntitledNote({});

      const recordings = yield* Recordings;

      const recording = yield* recordings.createRecording(note.id);

      yield* recordings.appendRecording({ id: recording.id, samples: [-32768, 0, 32767] });

      return yield* recordings.postRecording({
        note: note.id,
        recording: recording.id,
        name: 'source-copy.wav'
      });
    }).pipe(Effect.provide(f.domain()))
  );

  const row = f.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.eventId, post.requestId))
    .get();

  assert.ok(row);

  const event = decodeEvent(row.payload);

  if (event.type !== 'RecordingPostRequested') throw new Error('Expected recording post event');

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(recordingPostWorkflow, recordingPostHandler);

        yield* engine.execute(recordingPostWorkflow, {
          executionId: `recording-source-copy/${post.requestId}`,
          payload: { event }
        });
      }).pipe(Effect.provide(f.services()))
    )
  );

  const snapshot = await Effect.runPromise(
    Effect.flatMap(Recordings, (r) => r.recordingPostSnapshot({ requestId: post.requestId })).pipe(
      Effect.provide(f.domain())
    )
  );

  assert.ok(snapshot.sourceId !== null);

  return snapshot.sourceId;
}

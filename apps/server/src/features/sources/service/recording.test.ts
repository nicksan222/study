import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProjectId, SessionId } from '@study/contracts/ids';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { workflowStore } from '#server/platform/workflows/store';

import { Sources } from './index.ts';

function wav() {
  const bytes = Buffer.alloc(76);

  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(68, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(32, 40);

  return bytes;
}

test('recording imports are fenced, atomic, and replayed only for identical inputs', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Sources.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));
  let completed = false;

  try {
    context.db.orm.run(
      sql`INSERT INTO projects (id,name,created_at,updated_at) VALUES (1,'one',1,1),(2,'two',1,1)`
    );
    context.db.orm.run(
      sql`INSERT INTO sessions (id,project_id,title,title_source,created_at,updated_at) VALUES (1,1,'one','user',1,1)`
    );

    function* verifyRecordingImports() {
      const sources = yield* Sources;
      const input = {
        requestId: 'recording-1',
        projectId: 1n as ProjectId,
        sessionId: 1n as SessionId,
        name: 'recording.wav',
        bytes: wav(),
        durationMs: 1
      };
      const workflow = Workflow.make('recording-import-test', {
        payload: { id: Schema.String },
        idempotencyKey: ({ id }) => id
      });
      const engine = yield* WorkflowEngine.WorkflowEngine;

      function runWorkflow() {
        return Activity.make({
          name: 'import',
          execute: withPublicationGuard(
            context,
            Effect.gen(function* () {
              const first = yield* sources.importRecording(input);
              const again = yield* sources.importRecording(input);

              assert.deepEqual(again, first);
              assert.equal(first.kind, 'audio');
              assert.equal(first.mime, 'audio/wav');
              assert.equal(first.origin, 'recording');
              assert.equal(
                context.db.orm.all(
                  sql`SELECT * FROM workflow_events WHERE type = 'SourceProcessingRequested'`
                ).length,
                1
              );
              assert.deepEqual(
                (yield* sources.sourceSnapshot({ id: first.id, revision: 1 })).bytes,
                new Uint8Array(input.bytes)
              );

              for (const change of [
                { name: 'other.wav' },
                { bytes: Uint8Array.from(input.bytes, (b, i) => (i === 45 ? 1 : b)) },
                { projectId: 2n as ProjectId }
              ]) {
                assert.equal(
                  (yield* Effect.flip(sources.importRecording({ ...input, ...change }))).kind,
                  'invalid_input'
                );
              }

              const badHeader = Uint8Array.from(input.bytes);

              badHeader[24] = 0;
              assert.equal(
                (yield* Effect.flip(
                  sources.importRecording({
                    ...input,
                    requestId: 'bad-header',
                    bytes: badHeader
                  })
                )).kind,
                'invalid_input'
              );
              assert.throws(() =>
                context.db.orm.run(
                  sql`UPDATE source_recording_imports SET duration_ms = 2 WHERE request_id = 'recording-1'`
                )
              );
              assert.throws(() =>
                context.db.orm.run(
                  sql`DELETE FROM source_recording_imports WHERE request_id = 'recording-1'`
                )
              );
              context.db.orm.run(
                sql`CREATE TRIGGER reject_recording_event BEFORE INSERT ON workflow_events BEGIN SELECT RAISE(ABORT, 'rejected'); END`
              );
              yield* Effect.flip(sources.importRecording({ ...input, requestId: 'event-fails' }));
              assert.equal(context.db.orm.all(sql`SELECT * FROM sources`).length, 1);
              assert.equal(context.db.orm.all(sql`SELECT * FROM source_snapshots`).length, 1);
              assert.equal(context.db.orm.all(sql`SELECT * FROM source_processing`).length, 1);
              assert.equal(context.db.orm.all(sql`SELECT * FROM workflow_events`).length, 1);
              assert.equal(
                context.db.orm.all(sql`SELECT * FROM source_recording_imports`).length,
                1
              );
              context.db.orm.run(sql`DROP TRIGGER reject_recording_event`);
              yield* sources.deleteSource({ id: first.id });
              assert.equal(
                (yield* Effect.flip(sources.importRecording(input))).kind,
                'invalid_input'
              );
              workflowStore(context).interrupt('recording-import-test', 'safe');
              assert.equal(
                (yield* Effect.flip(sources.importRecording({ ...input, requestId: 'lost-lease' })))
                  .kind,
                'cancelled'
              );
              assert.equal(context.db.orm.all(sql`SELECT * FROM sources`).length, 0);
              completed = true;
            })
          ).pipe(Effect.orDie)
        });
      }

      yield* engine.register(workflow, runWorkflow);
      const result = yield* Effect.exit(
        engine.execute(workflow, {
          executionId: 'recording-import-test',
          payload: { id: 'one' }
        })
      );

      if (!completed && Exit.isFailure(result)) assert.fail(Cause.pretty(result.cause));
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(verifyRecordingImports).pipe(
          Effect.provide(layer),
          Effect.provide(workflowEngineLayer(context))
        )
      )
    );
    assert.equal(completed, true);
    context.db.orm.run(sql`DELETE FROM projects WHERE id = 1`);
    assert.equal(context.db.orm.all(sql`SELECT * FROM source_recording_imports`).length, 0);
  } finally {
    context.close();
    location.cleanup();
  }
});

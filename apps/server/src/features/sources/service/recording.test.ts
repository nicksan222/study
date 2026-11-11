/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks recording-to-source publication and its workflow activity behavior using    │
 * │ transactional test storage.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises recording imports are fenced, atomic, and replayed only for identical        │
 * │   inputs.                                                                                │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ProjectId, NoteId } from '@study/contracts/ids';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

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

testStable(
  'recording imports are fenced, atomic, and replayed only for identical inputs',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Sources.layer.pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
    let completed = false;

    try {
      context.db.orm.run(
        sql`INSERT INTO projects (id,name,created_at,updated_at) VALUES (1,'one',1,1),(2,'two',1,1)`
      );
      context.db.orm.run(
        sql`INSERT INTO notes (id,title,title_source,created_at,updated_at) VALUES (1,'one','user',1,1)`
      );

      function* verifyRecordingImports() {
        const sources = yield* Sources;
        const input = {
          requestId: 'recording-1',
          projectId: 1n as ProjectId,
          noteId: 1n as NoteId,
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

                expect(again).toStrictEqual(first);
                assert.ok(first.kind === 'audio');
                assert.ok(first.mime === 'audio/wav');
                assert.ok(first.origin === 'recording');
                assert.strictEqual(
                  context.db.orm.all(
                    sql`SELECT * FROM workflow_events WHERE type = 'SourceProcessingRequested'`
                  ).length,
                  1
                );
                expect(
                  (yield* sources.sourceSnapshot({ id: first.id, revision: 1 })).bytes
                ).toStrictEqual(new Uint8Array(input.bytes));

                for (const change of [
                  { name: 'other.wav' },
                  { bytes: Uint8Array.from(input.bytes, (b, i) => (i === 45 ? 1 : b)) },
                  { projectId: 2n as ProjectId }
                ]) {
                  assert.ok(
                    (yield* Effect.flip(sources.importRecording({ ...input, ...change }))).kind ===
                      'invalid_input'
                  );
                }

                const badHeader = Uint8Array.from(input.bytes);

                badHeader[24] = 0;
                assert.ok(
                  (yield* Effect.flip(
                    sources.importRecording({
                      ...input,
                      requestId: 'bad-header',
                      bytes: badHeader
                    })
                  )).kind === 'invalid_input'
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
                assert.strictEqual(context.db.orm.all(sql`SELECT * FROM sources`).length, 1);
                assert.strictEqual(
                  context.db.orm.all(sql`SELECT * FROM source_snapshots`).length,
                  1
                );
                assert.strictEqual(
                  context.db.orm.all(sql`SELECT * FROM source_processing`).length,
                  1
                );
                assert.strictEqual(
                  context.db.orm.all(sql`SELECT * FROM workflow_events`).length,
                  1
                );
                assert.strictEqual(
                  context.db.orm.all(sql`SELECT * FROM source_recording_imports`).length,
                  1
                );
                context.db.orm.run(sql`DROP TRIGGER reject_recording_event`);
                assert.strictEqual((yield* sources.importRecording(input)).id, first.id);
                workflowStore(context).interrupt('recording-import-test', 'safe');
                assert.ok(
                  (yield* Effect.flip(
                    sources.importRecording({ ...input, requestId: 'lost-lease' })
                  )).kind === 'cancelled'
                );
                assert.strictEqual(context.db.orm.all(sql`SELECT * FROM sources`).length, 1);
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
      assert.isTrue(completed);
      context.db.orm.run(sql`DELETE FROM projects WHERE id = 1`);
      assert.strictEqual(context.db.orm.all(sql`SELECT * FROM source_recording_imports`).length, 1);
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

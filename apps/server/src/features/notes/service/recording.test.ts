/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies recording publication posts once and rejects results after the captured   │
 * │ recording changes or is deleted.                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks publication idempotency and invalidation after recording state changes.         │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { eq, sql } from '@study/db';
import type { messages } from '@study/db/schema';
import { notes, sources } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import type { Context } from 'effect';
import { Effect, Layer, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import type { PublicationGuard } from '#server/platform/workflows/publication';
import { withPublicationGuard } from '#server/platform/workflows/publication';

import { Notes } from './index.ts';

testStable('recording publication posts once and rejects changed or deleted results', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const layer = () =>
    Layer.merge(Projects.layer, Notes.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  const run = async (
    id: string,
    action: Effect.Effect<
      void,
      never,
      | Context.Service.Identifier<typeof Notes>
      | Context.Service.Identifier<typeof Projects>
      | Database
      | PublicationGuard
    >
  ) => {
    const workflow = Workflow.make(`recording-post-${id}`, {
      payload: { id: Schema.String },
      idempotencyKey: ({ id }) => id
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () =>
            Activity.make({
              name: 'publish',
              execute: withPublicationGuard(context, action.pipe(Effect.provide(layer()))).pipe(
                Effect.orDie
              )
            })
          );
          yield* engine.execute(workflow, { executionId: id, payload: { id } });
        }).pipe(Effect.provide(layer()), Effect.provide(workflowEngineLayer(context)))
      )
    );
  };

  try {
    let input!: {
      requestId: string;
      noteId: typeof notes.$inferSelect.id;
      sourceId: typeof sources.$inferSelect.id;
      projectId: typeof sources.$inferSelect.project_id & {};
      durationMs: number;
    };
    let messageId!: typeof messages.$inferSelect.id;

    await run(
      'first',
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Recordings' });
        const service = yield* Notes;
        const note = yield* service.createNote({ project: project.id, title: 'Chat' });
        const source = context.db.orm
          .insert(sources)
          .values({
            project_id: project.id,
            origin: 'recording',
            kind: 'audio',
            mime: 'audio/wav',
            name: 'Recording',
            size_bytes: 1n,
            sha256: Buffer.alloc(32),
            created_at: 1n
          })
          .returning()
          .get();

        input = {
          requestId: 'recording-one',
          noteId: note.id,
          sourceId: source.id,
          projectId: project.id,
          durationMs: 1234
        };
        messageId = yield* service.postRecordingMessage(input);
        const message = yield* service.message(messageId);

        assert.ok(message.versions[0]?.text === '');
        assert.strictEqual(message.parts[0]?.sourceId, source.id);
        assert.strictEqual(
          context.db.orm.select().from(notes).where(eq(notes.id, note.id)).get()!.context_revision,
          1n
        );
      }).pipe(Effect.orDie)
    );
    context.close();
    context = new ServerContext(location.open());
    await run(
      'replay',
      Effect.gen(function* () {
        const service = yield* Notes;

        assert.strictEqual(yield* service.postRecordingMessage(input), messageId);
        assert.ok(
          (yield* Effect.flip(service.postRecordingMessage({ ...input, durationMs: 1235 })))
            .kind === 'invalid_input'
        );
        assert.strictEqual(
          context.db.orm.select().from(notes).where(eq(notes.id, input.noteId)).get()!
            .context_revision,
          1n
        );
        const other = yield* (yield* Projects).createProject({ name: 'Other' });
        const wrongSource = context.db.orm
          .insert(sources)
          .values({
            project_id: other.id,
            origin: 'recording',
            kind: 'audio',
            mime: 'audio/wav',
            name: 'Other',
            size_bytes: 1n,
            sha256: Buffer.alloc(32),
            created_at: 1n
          })
          .returning()
          .get();

        assert.ok(
          (yield* Effect.flip(
            service.postRecordingMessage({
              ...input,
              requestId: 'wrong-project',
              sourceId: wrongSource.id
            })
          )).kind === 'invalid_input'
        );
        assert.ok(
          (yield* Effect.flip(service.postRecordingMessage({ ...input, sourceId: wrongSource.id })))
            .kind === 'invalid_input'
        );
        const attachment = context.db.orm
          .insert(sources)
          .values({
            project_id: input.projectId,
            origin: 'attachment',
            kind: 'audio',
            mime: 'audio/wav',
            name: 'Attachment',
            size_bytes: 1n,
            sha256: Buffer.alloc(32),
            created_at: 1n
          })
          .returning()
          .get();

        assert.ok(
          (yield* Effect.flip(
            service.postRecordingMessage({
              ...input,
              requestId: 'wrong-origin',
              sourceId: attachment.id
            })
          )).kind === 'invalid_input'
        );
        context.db.orm.run(
          sql`CREATE TEMP TRIGGER fail_recording_context BEFORE UPDATE OF context_revision ON notes BEGIN SELECT RAISE(ABORT, 'injected context failure'); END`
        );
        yield* Effect.flip(
          service.postRecordingMessage({ ...input, requestId: 'context-rollback' })
        );
        context.db.orm.run(sql`DROP TRIGGER fail_recording_context`);
        assert.strictEqual(context.db.orm.all(sql`SELECT * FROM messages`).length, 1);
        assert.strictEqual(context.db.orm.all(sql`SELECT * FROM note_recording_posts`).length, 1);
        context.db.orm.run(
          sql`CREATE TEMP TRIGGER fail_recording_receipt BEFORE INSERT ON note_recording_posts BEGIN SELECT RAISE(ABORT, 'injected failure'); END`
        );
        yield* Effect.flip(service.postRecordingMessage({ ...input, requestId: 'rollback' }));
        context.db.orm.run(sql`DROP TRIGGER fail_recording_receipt`);
        assert.strictEqual(
          context.db.orm.select().from(notes).where(eq(notes.id, input.noteId)).get()!
            .context_revision,
          1n
        );
        assert.strictEqual(context.db.orm.all(sql`SELECT * FROM messages`).length, 1);
        yield* service.deleteMessage(messageId);
        assert.strictEqual(yield* service.postRecordingMessage(input), messageId);
        assert.strictEqual(context.db.orm.all(sql`SELECT * FROM messages`).length, 0);
        yield* service.deleteNote(input.noteId);
        assert.ok(
          (yield* Effect.flip(service.postRecordingMessage(input))).kind === 'invalid_input'
        );
      }).pipe(Effect.orDie)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

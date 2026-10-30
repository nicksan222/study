import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq, sql } from '@study/db';
import type { messages } from '@study/db/schema';
import { sessions, sources } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import type { Context } from 'effect';
import { Effect, Layer, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import type { PublicationGuard } from '#server/platform/workflows/publication';
import { withPublicationGuard } from '#server/platform/workflows/publication';

import { Conversations } from './index.ts';

test('recording publication posts once and rejects changed or deleted results', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const layer = () =>
    Layer.merge(Projects.layer, Conversations.layer).pipe(
      Layer.provide(Layer.succeed(Database, { store: context }))
    );
  const run = async (
    id: string,
    action: Effect.Effect<
      void,
      never,
      | Context.Service.Identifier<typeof Conversations>
      | Context.Service.Identifier<typeof Projects>
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
      sessionId: typeof sessions.$inferSelect.id;
      sourceId: typeof sources.$inferSelect.id;
      projectId: typeof sources.$inferSelect.project_id & {};
      durationMs: number;
    };
    let messageId!: typeof messages.$inferSelect.id;

    await run(
      'first',
      Effect.gen(function* () {
        const project = yield* (yield* Projects).createProject({ name: 'Recordings' });
        const service = yield* Conversations;
        const session = yield* service.createSession({ project: project.id, title: 'Chat' });
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
          sessionId: session.id,
          sourceId: source.id,
          projectId: project.id,
          durationMs: 1234
        };
        messageId = yield* service.postRecordingMessage(input);
        const message = yield* service.message(messageId);

        assert.equal(message.versions[0]?.text, '');
        assert.equal(message.parts[0]?.sourceId, source.id);
        assert.equal(
          context.db.orm.select().from(sessions).where(eq(sessions.id, session.id)).get()!
            .context_revision,
          1n
        );
      }).pipe(Effect.orDie)
    );
    context.close();
    context = new ServerContext(location.open());
    await run(
      'replay',
      Effect.gen(function* () {
        const service = yield* Conversations;

        assert.equal(yield* service.postRecordingMessage(input), messageId);
        assert.equal(
          (yield* Effect.flip(service.postRecordingMessage({ ...input, durationMs: 1235 }))).kind,
          'invalid_input'
        );
        assert.equal(
          context.db.orm.select().from(sessions).where(eq(sessions.id, input.sessionId)).get()!
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

        assert.equal(
          (yield* Effect.flip(
            service.postRecordingMessage({
              ...input,
              requestId: 'wrong-project',
              sourceId: wrongSource.id
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(service.postRecordingMessage({ ...input, sourceId: wrongSource.id })))
            .kind,
          'invalid_input'
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

        assert.equal(
          (yield* Effect.flip(
            service.postRecordingMessage({
              ...input,
              requestId: 'wrong-origin',
              sourceId: attachment.id
            })
          )).kind,
          'invalid_input'
        );
        context.db.orm.run(
          sql`CREATE TEMP TRIGGER fail_recording_context BEFORE UPDATE OF context_revision ON sessions BEGIN SELECT RAISE(ABORT, 'injected context failure'); END`
        );
        yield* Effect.flip(
          service.postRecordingMessage({ ...input, requestId: 'context-rollback' })
        );
        context.db.orm.run(sql`DROP TRIGGER fail_recording_context`);
        assert.equal(context.db.orm.all(sql`SELECT * FROM messages`).length, 1);
        assert.equal(context.db.orm.all(sql`SELECT * FROM conversation_recording_posts`).length, 1);
        context.db.orm.run(
          sql`CREATE TEMP TRIGGER fail_recording_receipt BEFORE INSERT ON conversation_recording_posts BEGIN SELECT RAISE(ABORT, 'injected failure'); END`
        );
        yield* Effect.flip(service.postRecordingMessage({ ...input, requestId: 'rollback' }));
        context.db.orm.run(sql`DROP TRIGGER fail_recording_receipt`);
        assert.equal(
          context.db.orm.select().from(sessions).where(eq(sessions.id, input.sessionId)).get()!
            .context_revision,
          1n
        );
        assert.equal(context.db.orm.all(sql`SELECT * FROM messages`).length, 1);
        yield* service.deleteMessage(messageId);
        assert.equal(yield* service.postRecordingMessage(input), messageId);
        assert.equal(context.db.orm.all(sql`SELECT * FROM messages`).length, 0);
        yield* service.deleteSession(input.sessionId);
        assert.equal(
          (yield* Effect.flip(service.postRecordingMessage(input))).kind,
          'invalid_input'
        );
      }).pipe(Effect.orDie)
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq, sql } from '@study/db';
import { blocks, documents, sessions, source_processing, sources } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/service/index';
import { Projects } from '#server/features/projects/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { withPublicationGuard } from '#server/platform/workflows/publication';

test('guarded publication validates captured citations and replays without writes', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const layer = Layer.merge(Projects.layer, Conversations.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    function* verifyGuardedCitationPublication() {
      const project = yield* (yield* Projects).createProject({ name: 'Publication' });
      const conversations = yield* Conversations;
      const session = yield* conversations.createSession({
        project: project.id,
        title: 'Chat'
      });
      const source = context.db.orm
        .insert(sources)
        .values({
          project_id: project.id,
          origin: 'attachment',
          kind: 'text',
          mime: 'text/plain',
          name: 'captured.txt',
          size_bytes: 1n,
          sha256: Buffer.alloc(32),
          created_at: 1n
        })
        .returning()
        .get();
      const document = context.db.orm
        .insert(documents)
        .values({ source_id: source.id, extractor_version: 1n, meta: '{}', created_at: 1n })
        .returning()
        .get();

      context.db.orm
        .insert(blocks)
        .values({
          document_id: document.id,
          ordinal: 0n,
          kind: 'paragraph',
          text: 'A quoted passage',
          anchor: JSON.stringify({ type: 'page', page: 3 })
        })
        .run();
      context.db.orm
        .insert(source_processing)
        .values({
          source_id: source.id,
          revision: 1n,
          request_id: 'source',
          published_request_id: 'source',
          document_id: document.id
        })
        .run();
      yield* conversations.postMessage({
        sessionId: session.id,
        text: 'question',
        sourceIds: [source.id]
      });
      const request = yield* conversations.requestReply({ sessionId: session.id });
      const input = {
        requestId: request.requestId,
        text: 'Answer [1]',
        citations: [
          {
            marker: 1,
            sourceId: source.id,
            documentId: document.id,
            blockOrdinal: 0,
            quote: 'quoted passage'
          }
        ]
      };

      assert.equal(
        (yield* Effect.flip(withPublicationGuard(context, conversations.publishReply(input)))).kind,
        'internal'
      );
      const workflow = Workflow.make('reply-publication-test', {
        payload: { id: Schema.String },
        idempotencyKey: ({ id }) => id
      });
      const engine = yield* WorkflowEngine.WorkflowEngine;

      yield* engine.register(workflow, () =>
        Activity.make({
          name: 'publish',
          execute: withPublicationGuard(
            context,
            Effect.gen(function* () {
              for (const bad of [
                { ...input, citations: [{ ...input.citations[0]!, quote: 'forged' }] },
                {
                  ...input,
                  citations: [
                    {
                      ...input.citations[0]!,
                      documentId: (document.id + 1n) as typeof document.id
                    }
                  ]
                },
                {
                  ...input,
                  citations: [
                    { ...input.citations[0]!, sourceId: (source.id + 1n) as typeof source.id }
                  ]
                },
                { ...input, text: 'Answer [2]' },
                { ...input, text: 'Answer [1] and [2]' },
                { ...input, text: ' ' },
                { ...input, text: 'x'.repeat(100_001) },
                { ...input, citations: [{ ...input.citations[0]!, marker: 0 }] },
                { ...input, citations: [{ ...input.citations[0]!, blockOrdinal: 1 }] },
                { ...input, citations: [{ ...input.citations[0]!, quote: ' ' }] },
                { ...input, citations: [input.citations[0]!, input.citations[0]!] },
                { ...input, requestId: 'missing' }
              ]) {
                yield* Effect.flip(conversations.publishReply(bad));
                assert.equal(
                  (yield* conversations.message(request.messageId)).versions[0]?.status,
                  'pending'
                );
                assert.equal(context.db.orm.all(sql`SELECT * FROM citations`).length, 0);
              }

              const staleSession = yield* conversations.createSession({
                project: project.id,
                title: 'Stale'
              });
              const staleQuestion = yield* conversations.postMessage({
                sessionId: staleSession.id,
                text: 'old'
              });
              const stale = yield* conversations.requestReply({ sessionId: staleSession.id });

              yield* conversations.editMessage({ messageId: staleQuestion.id, text: 'new' });
              assert.equal(
                (yield* Effect.flip(
                  conversations.publishReply({
                    requestId: stale.requestId,
                    text: 'answer',
                    citations: []
                  })
                )).kind,
                'invalid_input'
              );
              assert.equal(
                (yield* conversations.message(stale.messageId)).versions[0]?.status,
                'pending'
              );
              yield* conversations.deleteMessage(stale.messageId);
              assert.equal(
                (yield* Effect.flip(
                  conversations.publishReply({
                    requestId: stale.requestId,
                    text: 'answer',
                    citations: []
                  })
                )).kind,
                'not_found'
              );
              const revision = context.db.orm
                .select()
                .from(sessions)
                .where(eq(sessions.id, session.id))
                .get()!.context_revision;

              assert.equal(yield* conversations.publishReply(input), request.versionId);
              const message = yield* conversations.message(request.messageId);

              assert.equal(message.activeVersionId, request.versionId);
              assert.equal(message.versions[0]?.text, 'Answer [1]');
              assert.deepEqual(message.citations, [
                {
                  marker: 1,
                  sourceId: source.id,
                  sourceName: 'captured.txt',
                  anchor: { type: 'page', page: 3 },
                  quote: 'quoted passage'
                }
              ]);
              assert.equal(yield* conversations.publishReply(input), request.versionId);
              yield* Effect.flip(conversations.publishReply({ ...input, text: 'Changed [1]' }));
              yield* Effect.flip(
                conversations.publishReply({
                  ...input,
                  citations: [{ ...input.citations[0]!, quote: 'quoted' }]
                })
              );
              assert.equal(
                context.db.orm.select().from(sessions).where(eq(sessions.id, session.id)).get()!
                  .context_revision,
                revision + 1n
              );
              assert.equal(context.db.orm.all(sql`SELECT * FROM citations`).length, 1);
              assert.equal(
                context.db.orm.all(
                  sql`SELECT * FROM workflow_events WHERE type = 'ConversationGenerationRequested'`
                ).length,
                2
              );
            })
          ).pipe(Effect.orDie)
        })
      );
      yield* engine.execute(workflow, {
        executionId: 'reply-publication-test',
        payload: { id: 'one' }
      });
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(verifyGuardedCitationPublication).pipe(
          Effect.provide(layer),
          Effect.provide(workflowEngineLayer(context))
        )
      )
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

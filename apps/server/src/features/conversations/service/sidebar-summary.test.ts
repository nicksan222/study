/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Covers session and message pagination, immutable versions, attachment ownership    │
 * │ and snapshots, reply and title context limits, outbox rollback, thread isolation,        │
 * │ validation, and explicit or mention-triggered replies.                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises pagination, ownership fences, captured context, and atomic outbox behavior.  │
 * │ - Uses database fixtures to verify service-visible invariants and failures.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The suite uses real SQLite fixtures and service dependencies; domain state remains owned │
 * │ by the feature implementation.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { plainBlock } from '@study/contracts/sources/document';
import { eq } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/service/index';
import { Documents } from '#server/features/documents/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { withTestPublication } from '#testing/publication';

const meta = {
  language: null,
  originalFormat: 'text',
  extractor: null,
  extractorVersion: 1,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
};

testStable(
  'sidebar summaries count distinct attached generated documents and report durable work',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const layer = Layer.merge(Conversations.layer, Documents.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const library = yield* Documents;
          const session = yield* conversations.createSession({ title: 'Study' });

          yield* conversations.setSessionSettled({ id: session.id, settled: true });
          assert.ok((yield* conversations.sessionSummaries({})).items[0]?.settledOverride === true);
          yield* conversations.setSessionSettled({ id: session.id, settled: true });
          assert.ok((yield* conversations.sessionSummaries({})).items[0]?.settledOverride === true);
          yield* conversations.setSessionSettled({ id: session.id, settled: false });
          assert.ok(
            (yield* conversations.sessionSummaries({})).items[0]?.settledOverride === false
          );
          const missing = yield* Effect.flip(
            conversations.setSessionSettled({
              id: (session.id + 1000n) as typeof session.id,
              settled: true
            })
          );

          assert.ok(missing.kind === 'not_found');
          const document = {
            blocks: [plainBlock('paragraph', 'Notes', { type: 'authored' })],
            meta
          };

          yield* library.create({
            createKey: randomUUID(),
            title: 'Manual',
            document,
            sessionId: session.id,
            inputs: [],
            citations: []
          });
          assert.strictEqual(
            (yield* conversations.sessionSummaries({})).items[0]?.generatedDocumentCount,
            0n
          );
          yield* withTestPublication(
            context,
            library
              .createGenerated({
                requestId: 'sidebar-generated',
                title: 'Generated',
                document: {
                  ...document,
                  blocks: [plainBlock('paragraph', 'Generated', { type: 'authored' })]
                },
                inputs: [],
                citations: [],
                operation: 'generate',
                instruction: 'Generate',
                language: null,
                sessionId: session.id
              })
              .pipe(Effect.asVoid)
          );
          const generated = (yield* library.documents({
            sessionId: session.id,
            limit: 10,
            archived: false
          })).items.find((item) => item.title === 'Generated');

          assert.ok(generated);
          const summary = (yield* conversations.sessionSummaries({})).items[0];

          expect(summary).toStrictEqual({
            id: session.id,
            generatedDocumentCount: 1n,
            settledOverride: false,
            running: false,
            activity: 'idle'
          });
          yield* library.archive({ id: generated.id, archived: true });
          assert.strictEqual(
            (yield* conversations.sessionSummaries({})).items[0]?.generatedDocumentCount,
            0n
          );
          const note = yield* conversations.postMessage({
            sessionId: session.id,
            text: 'Question',
            requestReply: false
          });
          const request = yield* conversations.requestReply({ sessionId: session.id });

          context.db.orm
            .insert(workflow_executions)
            .values({
              execution_id: 'sidebar-test',
              workflow_tag: 'test',
              version: 1,
              payload: JSON.stringify({ event: { correlationId: request.requestId } }),
              status: 'running',
              created_at: note.createdAt,
              updated_at: note.createdAt
            })
            .run();
          assert.ok((yield* conversations.sessionSummaries({})).items[0]?.activity === 'answering');
          context.db.orm
            .update(workflow_executions)
            .set({ status: 'completed' })
            .where(eq(workflow_executions.execution_id, 'sidebar-test'))
            .run();
          assert.ok((yield* conversations.sessionSummaries({})).items[0]?.running === false);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
